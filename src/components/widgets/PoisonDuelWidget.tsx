import { useReducer, useRef, useState } from 'react';
import {
  type ClickKind,
  defaultReaderConfig,
  type EventState,
  MALFORMED_AT_SECONDS,
  MAX_MANUAL_MALFORMED,
  POISON_SECONDS,
  PoisonDuel,
  type ReaderLane,
  type TryLimit,
  tryLimits,
} from '../../lib/models/eventDesign';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import './PoisonDuelWidget.css';

/** The strip shows this many events before the head of the partition. */
const BEHIND = 20;
/** The strip shows this many events from the head onward. */
const AHEAD = 40;
/** A full backlog bar stands for this many waiting clicks. */
const BACKLOG_SCALE = 350;
/** Waiting counts above this mark the partition as falling behind. */
const BEHIND_MARK = 50;
/** The dead-letter tray shows at most this many parked clicks. */
const TRAY = 20;

const limits: TryLimit[] = ['one', 'three', 'ten'];
const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const retryDelay = (defaultReaderConfig.retryDelayTicks * defaultReaderConfig.tickSeconds).toFixed(1);

const stateText: Record<EventState, string> = {
  processed: 'read and counted',
  parked: 'parked in the dead-letter queue',
  retrying: 'failed, retrying',
  waiting: 'waiting',
};
const stateOrder: EventState[] = ['processed', 'parked', 'retrying', 'waiting'];

interface Cell {
  id: number;
  state: EventState;
  kind: ClickKind | undefined;
}

interface Props {
  title?: string;
  instructions?: string;
}

function NodeChip({
  kind,
  name,
  tone,
  text,
  stuck = false,
}: {
  kind: ComponentKind;
  name: string;
  tone: Tone;
  text: string;
  stuck?: boolean;
}) {
  return (
    <li className={`sdv-poison__node sdv-node sdv-node--${kind}`} data-status={stuck ? 'stuck' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="sdv-poison__icon">
        <KindIcon kind={kind} size={24} />
      </svg>
      <span className="sdv-poison__node-name">{name}</span>
      <ToneBadge tone={tone}>{text}</ToneBadge>
    </li>
  );
}

function pathText(lane: ReaderLane): string {
  if (lane.mode === 'retry') {
    return `The consumer retries a failed click every ${retryDelay} s until it works. Clicks behind it wait.`;
  }
  const { maxTries } = lane.model.config;
  if (maxTries === 1) return 'The consumer parks a click in the dead-letter queue on its first failure.';
  return `The consumer retries a failed click every ${retryDelay} s and parks it in the dead-letter queue after ${maxTries} tries.`;
}

function windowCells(lane: ReaderLane): Cell[] {
  const { model } = lane;
  const arrived = model.totals.arrived;
  const start = Math.max(0, model.headId - BEHIND);
  const end = Math.min(arrived, model.headId + AHEAD);
  const cells: Cell[] = [];
  for (let id = start; id < end; id += 1)
    cells.push({ id, state: model.stateOf(id), kind: model.kindOf(id) });
  return cells;
}

function stripSummary(lane: ReaderLane, cells: Cell[]): string {
  if (cells.length === 0) return 'No clicks yet.';
  const { model } = lane;
  const parts = stateOrder
    .map((state) => ({ state, count: cells.filter((cell) => cell.state === state).length }))
    .filter((part) => part.count > 0)
    .map((part) => {
      if (part.state !== 'retrying') return `${part.count} ${stateText[part.state]}`;
      const what = model.headKind === 'malformed' ? 'a malformed click' : 'a click that timed out';
      return `${what} after ${model.headTryCount} failed ${model.headTryCount === 1 ? 'try' : 'tries'}`;
    });
  const malformed = cells.filter((cell) => cell.kind === 'malformed' && cell.state === 'waiting').length;
  const extra =
    malformed > 0
      ? ` ${malformed} malformed ${malformed === 1 ? 'click waits' : 'clicks wait'} in line.`
      : '';
  return `Around the head of the partition, oldest first: ${parts.join(', ')}.${extra}`;
}

function parkedCells(lane: ReaderLane): Cell[] {
  const { model } = lane;
  const cells: Cell[] = [];
  for (let id = 0; id < model.headId; id += 1) {
    if (model.stateOf(id) === 'parked') cells.push({ id, state: 'parked', kind: model.kindOf(id) });
  }
  return cells;
}

function consumerBadge(lane: ReaderLane): { tone: Tone; text: string; stuck: boolean } {
  const { model } = lane;
  const tries = model.headTryCount;
  if (tries === 0) return { tone: 'ok', text: 'Reading', stuck: false };
  const stuck = model.headKind === 'malformed' && lane.mode === 'retry';
  return {
    tone: stuck ? 'bad' : 'warn',
    text: `${tries} failed ${tries === 1 ? 'try' : 'tries'} on one click`,
    stuck,
  };
}

function verdicts(lane: ReaderLane): { tone: Tone; text: string }[] {
  const t = lane.model.totals;
  const list: { tone: Tone; text: string }[] = [];
  const stuck = lane.mode === 'retry' && lane.model.headKind === 'malformed' && lane.model.headTryCount > 0;
  if (stuck)
    list.push({ tone: 'bad', text: `Stuck: ${t.waiting - 1} clicks wait behind one malformed click` });
  else if (t.waiting > BEHIND_MARK)
    list.push({ tone: 'warn', text: `Falling behind: ${t.waiting} clicks waiting` });
  else list.push({ tone: 'ok', text: 'Keeping up' });
  if (t.parked > 0) list.push({ tone: 'warn', text: `${t.parked} parked, waiting for a fix and a replay` });
  if (t.parkedTimeouts > 0) {
    list.push({ tone: 'bad', text: `${t.parkedTimeouts} parked clicks would have worked on the next try` });
  }
  return list;
}

function LanePane({ lane, variant }: { lane: ReaderLane; variant: SeriesVariant }) {
  const { model } = lane;
  const t = model.totals;
  const cells = windowCells(lane);
  const consumer = consumerBadge(lane);
  const parked = lane.mode === 'dead-letter' ? parkedCells(lane) : [];
  const parkedMalformed = parked.filter((cell) => cell.kind === 'malformed').length;
  const shown = parked.slice(Math.max(0, parked.length - TRAY));
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-poison__path">{pathText(lane)}</p>
      <ul className="sdv-poison__nodes" aria-label={`${lane.label}: components`}>
        <NodeChip
          kind="queue"
          name="Partition"
          tone={t.waiting > BEHIND_MARK ? 'warn' : 'ok'}
          text={`${t.waiting} waiting`}
        />
        <NodeChip
          kind="server"
          name="Analytics consumer"
          tone={consumer.tone}
          text={consumer.text}
          stuck={consumer.stuck}
        />
        {lane.mode === 'dead-letter' && (
          <NodeChip
            kind="queue"
            name="Dead-letter queue"
            tone={t.parked > 0 ? 'warn' : 'ok'}
            text={t.parked > 0 ? `${t.parked} parked` : 'Empty'}
          />
        )}
      </ul>
      <div className="sdv-poison__backlog">
        <span className="sdv-poison__backlog-label">Clicks waiting in the partition: {t.waiting}</span>
        <span className="sdv-poison__bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (t.waiting / BACKLOG_SCALE) * 100).toFixed(1)}%` }} />
        </span>
      </div>
      <div className="sdv-poison__strip" aria-hidden="true">
        {cells.map((cell) => (
          <span
            key={cell.id}
            className="sdv-poison__cell"
            data-state={cell.state}
            data-malformed={cell.kind === 'malformed' ? 'true' : undefined}
          />
        ))}
      </div>
      <p className="sdv-poison__strip-text">{stripSummary(lane, cells)}</p>
      {lane.mode === 'dead-letter' && (
        <div className="sdv-poison__tray">
          <span className="sdv-poison__tray-label">
            {parked.length === 0
              ? 'Dead-letter queue: empty.'
              : `Dead-letter queue: ${parkedMalformed} malformed, ${parked.length - parkedMalformed} that timed out once.`}
          </span>
          <span className="sdv-poison__tray-cells" aria-hidden="true">
            {shown.map((cell) => (
              <span
                key={cell.id}
                className="sdv-poison__cell"
                data-state="parked"
                data-malformed={cell.kind === 'malformed' ? 'true' : undefined}
              />
            ))}
          </span>
        </div>
      )}
      <div className="sdv-poison__verdict">
        {verdicts(lane).map((badge) => (
          <ToneBadge key={badge.text} tone={badge.tone}>
            {badge.text}
          </ToneBadge>
        ))}
      </div>
    </section>
  );
}

/** The same clicks and malformed events through a consumer that retries forever and one that parks. */
export default function PoisonDuelWidget({
  title = 'Retry forever versus a dead-letter queue',
  instructions = `Press Play. Both consumers read the same partition of clicks. A buggy producer publishes a malformed click at ${MALFORMED_AT_SECONDS[0]} s and another at ${MALFORMED_AT_SECONDS[1]} s.`,
}: Props) {
  const hydrated = useHydrated();
  const [limit, setLimit] = useState<TryLimit>('three');
  const duelRef = useRef<PoisonDuel | null>(null);
  if (!duelRef.current) duelRef.current = new PoisonDuel(limit);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (next: TryLimit) => {
    duelRef.current = new PoisonDuel(next);
    rerender();
  };
  const chooseLimit = (next: TryLimit) => {
    setLimit(next);
    restart(next);
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };
  const sendMalformed = () => {
    duel.sendMalformed();
    rerender();
  };

  const [retry, park] = duel.lanes;
  const a = retry.model.totals;
  const b = park.model.totals;
  const seconds = duel.ticks * duel.tickSeconds;
  const peak = (lane: ReaderLane) => lane.series.reduce((max, value) => Math.max(max, value), 0);

  const rows: CompareRow[] = [
    { label: 'Clicks (same for both)', values: [a.arrived, b.arrived] },
    { label: 'Read and counted', values: [a.processed, b.processed], better: 'higher' },
    { label: 'Parked in the dead-letter queue', values: [a.parked, b.parked] },
    {
      label: 'Parked clicks one more try would have saved',
      values: [a.parkedTimeouts, b.parkedTimeouts],
      better: 'lower',
    },
    { label: 'Waiting in the partition now', values: [a.waiting, b.waiting], better: 'lower' },
    { label: 'Most clicks waiting at once', values: [peak(retry), peak(park)], better: 'lower' },
    { label: 'Read attempts', values: [a.tries, b.tries] },
  ];

  const summary = `${seconds.toFixed(1)} s of ${POISON_SECONDS} s. Waiting in the partition: retry until it works ${a.waiting}, dead-letter queue ${b.waiting}. Parked in the dead-letter queue: ${b.parked}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);
  const stuck = retry.model.headKind === 'malformed' && retry.model.headTryCount > 0;
  const manualLeft = duel.manualLeft;

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : stuck
        ? ({ tone: 'warn', text: `Retry lane stuck at ${seconds.toFixed(1)} s` } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${POISON_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(limit)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={limit}
      controls={
        <>
          <div className="sdv-duel__extra">
            <button
              type="button"
              className="sdv-button"
              onClick={skipToEnd}
              disabled={!hydrated || duel.done}
            >
              Skip to the end
            </button>
          </div>
          <fieldset className="sdv-control sdv-crash">
            <legend>Break it</legend>
            <div className="sdv-crash__buttons">
              <button
                type="button"
                className="sdv-button"
                onClick={sendMalformed}
                disabled={!hydrated || duel.done || manualLeft === 0}
              >
                Send a malformed click
              </button>
            </div>
            <p className="sdv-control__hint">
              It joins the tail of both partitions, behind every waiting click. {manualLeft} of{' '}
              {MAX_MANUAL_MALFORMED} left.
            </p>
          </fieldset>
        </>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same clicks and malformed events for both"
          columns={[retry.label, park.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="When the dead-letter lane parks a click"
        value={limit}
        options={limits.map((id) => ({ value: id, label: tryLimits[id].label, diff: tryLimits[id].diff }))}
        onChange={chooseLimit}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.mode} lane={lane} variant={variants[index] ?? 'a'} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the click strips">
        {stateOrder.map((state) => (
          <li key={state}>
            <span className="sdv-poison__cell sdv-poison__key" data-state={state} aria-hidden="true" />
            {stateText[state].charAt(0).toUpperCase() + stateText[state].slice(1)}
          </li>
        ))}
        <li>
          <span
            className="sdv-poison__cell sdv-poison__key"
            data-state="waiting"
            data-malformed="true"
            aria-hidden="true"
          />
          Malformed click (crossed)
        </li>
      </ul>
      <TraceChart
        title="Clicks waiting in the partition"
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={20}
        summary={`Clicks waiting in the partition. ${retry.label} ${a.waiting}, ${park.label.toLowerCase()} ${b.waiting}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            Malformed clicks and what each consumer does with them appear here, numbered to match the chart.
          </p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: manual sends can repeat the same text in one tick
              <li key={`${event.tick}-${index}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time> {event.text}
              </li>
            ))}
          </ol>
        )}
        {notes.map((event) => (
          <p key={`${event.tick}-${event.text}`} className="sdv-trace__note">
            {event.text}
          </p>
        ))}
      </div>
      {!hydrated && <p className="sdv-trace__empty">The simulation starts once the page finishes loading.</p>}
    </SimulationShell>
  );
}
