import { useReducer, useRef, useState } from 'react';
import {
  ACK_CRASH_SECONDS,
  ACK_SECONDS,
  type AckMode,
  AckModeRun,
  ackScenarios,
  type OffsetConsumer,
  type OffsetState,
} from '../../lib/models/deliveryOutbox';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type StatRow, ToneBadge } from '../sim/StatTable';
import { TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import './AckModeWidget.css';

/** The log strip shows this many offsets around the consumer. */
const WINDOW = 40;
/** Offsets kept in view before the earliest of the read position and the committed offset. */
const LEAD = 12;

const modes: AckMode[] = ['ack-first', 'ack-after', 'dedupe'];

const commitText: Record<AckMode, string> = {
  'ack-first': 'Commits the offset when it takes a batch, before counting it.',
  'ack-after': 'Counts the whole batch, then commits the offset.',
  dedupe:
    'Counts the whole batch, then commits the offset. Saves each counted click id and skips ids it has seen, at any offset.',
};

const stateText: Record<OffsetState, string> = {
  counted: 'Counted once',
  double: 'Counted twice',
  lost: 'Lost: committed, never counted',
  'in-hand': 'In hand: taken, not counted yet',
  waiting: 'In the log, not taken yet',
};
const stateOrder: OffsetState[] = ['counted', 'double', 'lost', 'in-hand', 'waiting'];

interface Props {
  title?: string;
  instructions?: string;
}

const pct = (value: number) => `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;

function LogStrip({ model }: { model: OffsetConsumer }) {
  const [cursor] = model.inHand;
  const produced = model.totals.produced;
  const start = Math.max(0, Math.min(cursor, model.committed) - LEAD);
  const offsets = Array.from({ length: WINDOW }, (_, index) => start + index).filter(
    (offset) => offset < produced,
  );
  const at = (offset: number) => ((offset - start) / WINDOW) * 100;
  const states = offsets.map((offset) => model.offsetState(offset));
  const counts = stateOrder
    .map((state) => ({ state, count: states.filter((value) => value === state).length }))
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${stateText[part.state].toLowerCase()}`);
  const end = start + offsets.length;
  return (
    <div className="sdv-ack__log">
      <div className="sdv-ack__strip" aria-hidden="true">
        <div className="sdv-ack__cells">
          {offsets.map((offset, index) => (
            <span key={offset} className="sdv-ack__cell" data-state={states[index]} />
          ))}
          {model.committed >= start && model.committed <= start + WINDOW && (
            <span className="sdv-ack__committed" style={{ left: pct(at(model.committed)) }} />
          )}
          {cursor >= start && cursor <= start + WINDOW && (
            <span className="sdv-ack__cursor" style={{ left: pct(at(cursor)) }} />
          )}
        </div>
      </div>
      <p className="sdv-qtracks__meta">
        <span>
          Offsets {start} to {Math.max(start, end - 1)} of {produced}
        </span>
        <span>Read position {cursor}</span>
        <span>Committed offset {model.committed}</span>
      </p>
      <p className="sdv-ack__strip-text">
        {offsets.length === 0 ? 'The log is empty.' : `In view: ${counts.join(', ')}.`}
      </p>
    </div>
  );
}

/** One analytics consumer counting clicks under a chosen offset commit policy, with crashes. */
export default function AckModeWidget({
  title = 'When does the consumer commit its offset?',
  instructions = `Pick a policy, then press Play. The consumer crashes at ${ACK_CRASH_SECONDS.join(' s and ')} s. You can crash it yourself too.`,
}: Props) {
  const hydrated = useHydrated();
  const [mode, setMode] = useState<AckMode>('ack-after');
  const runRef = useRef<AckModeRun | null>(null);
  if (!runRef.current) runRef.current = new AckModeRun(mode);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (next: AckMode) => {
    runRef.current = new AckModeRun(next);
    rerender();
  };
  const chooseMode = (next: AckMode) => {
    setMode(next);
    restart(next);
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    rerender();
  };
  const crash = () => {
    run.apply({ type: 'crash' });
    rerender();
  };

  const { model } = run;
  const t = model.totals;
  const seconds = run.ticks * run.tickSeconds;
  const error = model.countError;
  const errorText = error === 0 ? 'Exact' : error > 0 ? `${error} too high` : `${-error} too low`;

  const relayCopies = t.produced - t.clicks;
  const stats: StatRow[] = [
    { label: 'Log entries', value: t.produced.toLocaleString('en-US') },
    {
      label: 'Distinct clicks',
      value: t.clicks.toLocaleString('en-US'),
      ...(relayCopies > 0
        ? { note: `The relay published ${relayCopies === 1 ? 'one event' : `${relayCopies} events`} twice` }
        : {}),
    },
    { label: 'Analytics count', value: t.counted.toLocaleString('en-US') },
    {
      label: 'Lost: committed, never counted',
      value: String(t.lost),
      tone: t.lost > 0 ? 'bad' : 'ok',
      ...(t.lost > 0 ? { note: 'Gone for good' } : {}),
    },
    {
      label: 'Counted twice',
      value: String(t.doubleCounted),
      tone: t.doubleCounted > 0 ? 'bad' : 'ok',
      ...(t.doubleCounted > 0 ? { note: 'Count too high' } : {}),
    },
    {
      label: 'Skipped: click id already counted',
      value: String(t.skipped),
      ...(t.skipped > 0 ? { tone: 'ok' as const, note: 'Duplicates absorbed' } : {}),
    },
    {
      label: 'Count error',
      value: errorText,
      tone: error === 0 ? 'ok' : 'bad',
    },
    { label: 'Not counted yet (in hand or still in the log)', value: String(model.uncounted) },
  ];

  const summary = `${seconds.toFixed(1)} s of ${ACK_SECONDS} s. ${ackScenarios[mode].label}. ${t.produced} log entries for ${t.clicks} clicks. ${t.crashes} crashes. Lost ${t.lost}, counted twice ${t.doubleCounted}, skipped ${t.skipped}. Count error: ${errorText.toLowerCase()}.`;
  const events = run.events;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : !model.up
        ? ({ tone: 'warn', text: `Consumer restarting at ${seconds.toFixed(1)} s` } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${ACK_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(mode)}
      summary={summary}
      stats={stats}
      status={status}
      finished={run.done}
      resetKey={mode}
      controls={
        <>
          <div className="sdv-duel__extra sdv-ack__skip">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
              Skip to the end
            </button>
          </div>
          <fieldset className="sdv-control sdv-crash">
            <legend>Break it</legend>
            <div className="sdv-crash__buttons">
              <button
                type="button"
                className="sdv-button"
                onClick={crash}
                disabled={!hydrated || run.done || run.ticks === 0 || !model.up}
              >
                Crash the consumer
              </button>
            </div>
            <p className="sdv-control__hint">
              The consumer restarts after {(model.config.restartTicks * run.tickSeconds).toFixed(1)} s and
              resumes from its committed offset.
            </p>
          </fieldset>
        </>
      }
    >
      <ScenarioChips
        label="Commit policy"
        value={mode}
        options={modes.map((id) => ({
          value: id,
          label: ackScenarios[id].label,
          diff: ackScenarios[id].diff,
        }))}
        onChange={chooseMode}
      />
      <div className="sdv-ack">
        <section className="sdv-ack__topic" aria-label="Click log, one partition">
          <h4 className="sdv-ack__heading">Click log, one partition</h4>
          <LogStrip model={model} />
        </section>
        <section className="sdv-ack__member" aria-label="Analytics consumer">
          <h4 className="sdv-ack__heading">Analytics consumer</h4>
          <div
            className="sdv-ack__consumer sdv-node sdv-node--server"
            data-status={model.up ? undefined : 'down'}
          >
            <span className="sdv-ack__consumer-name">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="sdv-ack__icon">
                <KindIcon kind="server" size={24} />
              </svg>
              Click counter
            </span>
            <ToneBadge tone={model.up ? 'ok' : 'bad'}>
              {model.up ? 'Reading' : 'Crashed, restarting'}
            </ToneBadge>
            <span className="sdv-ack__consumer-meta">{commitText[mode]}</span>
            <span className="sdv-ack__consumer-meta">
              Batches of {model.config.batchSize}, reads{' '}
              {Math.round(model.config.readPerTick / run.tickSeconds)} clicks per second.
            </span>
          </div>
        </section>
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the log">
        {stateOrder.map((state) => (
          <li key={state}>
            <span className="sdv-ack__cell sdv-ack__key" data-state={state} aria-hidden="true" />
            {stateText[state]}
          </li>
        ))}
        <li>
          <span className="sdv-ack__key sdv-ack__key--cursor" aria-hidden="true" /> Read position
        </li>
        <li>
          <span className="sdv-ack__key sdv-ack__key--committed" aria-hidden="true" /> Committed offset
        </li>
      </ul>
      <TraceChart
        title="Miscounted clicks: lost plus counted twice"
        series={[{ label: ackScenarios[mode].label, values: run.series, variant: 'a' }]}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={events.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={10}
        summary={`Miscounted clicks so far: ${t.lost + t.doubleCounted}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {events.length === 0 ? (
          <p className="sdv-trace__empty">
            The relay copy, crashes and restarts appear here, numbered to match the chart, as the run plays.
          </p>
        ) : (
          <ol>
            {events.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(event.tick * run.tickSeconds).toFixed(1)} s</time> {event.text}
              </li>
            ))}
          </ol>
        )}
      </div>
      {!hydrated && <p className="sdv-trace__empty">The simulation starts once the page finishes loading.</p>}
    </SimulationShell>
  );
}
