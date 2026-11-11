import { useReducer, useRef, useState } from 'react';
import {
  BROKER_DOWN_AT_SECONDS,
  type ClickState,
  DB_DOWN_AT_SECONDS,
  type DualOrder,
  dualOrderOptions,
  OUTBOX_SECONDS,
  OutboxDuel,
  RELAY_CRASH_AT_SECONDS,
  type WriterLane,
} from '../../lib/models/deliveryOutbox';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import './OutboxDuelWidget.css';

/** The click strip shows this many of the newest clicks. */
const STRIP = 60;
/** A full outbox bar stands for this many unsent entries. */
const OUTBOX_SCALE = 80;

const orders: DualOrder[] = ['commit-first', 'publish-first'];
const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const stateText: Record<ClickState, string> = {
  both: 'saved and sent',
  waiting: 'waiting in the outbox',
  lost: 'saved, event lost',
  phantom: 'sent, never saved',
  rejected: 'failed, nothing written',
};
const stateOrder: ClickState[] = ['both', 'waiting', 'lost', 'phantom', 'rejected'];

const pathText: Record<WriterLane['mode'], string> = {
  'commit-first': 'The app saves the row, then publishes the event as a second, separate write.',
  'publish-first': 'The app publishes the event, then saves the row as a second, separate write.',
  outbox: 'The app saves the row and an outbox entry in one transaction. A relay publishes the entry later.',
};

interface Props {
  title?: string;
  instructions?: string;
}

function NodeChip({
  kind,
  name,
  up,
  downText,
}: {
  kind: ComponentKind;
  name: string;
  up: boolean;
  downText: string;
}) {
  return (
    <li className={`sdv-outbox__node sdv-node sdv-node--${kind}`} data-status={up ? undefined : 'down'}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="sdv-outbox__icon">
        <KindIcon kind={kind} size={24} />
      </svg>
      <span className="sdv-outbox__node-name">{name}</span>
      <ToneBadge tone={up ? 'ok' : 'bad'}>{up ? 'Up' : downText}</ToneBadge>
    </li>
  );
}

function verdict(lane: WriterLane): { tone: Tone; text: string } {
  const t = lane.model.totals;
  const broken = t.lost + t.phantom;
  if (broken > 0) return { tone: 'bad', text: `${broken} clicks out of sync for good` };
  if (t.waiting > 0) return { tone: 'warn', text: `${t.waiting} saved clicks waiting to publish` };
  return { tone: 'ok', text: 'Database and analytics agree' };
}

function stripSummary(states: ClickState[]): string {
  if (states.length === 0) return 'No clicks yet.';
  const parts = stateOrder
    .map((state) => ({ state, count: states.filter((value) => value === state).length }))
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${stateText[part.state]}`);
  return `Newest ${states.length} clicks, oldest first: ${parts.join(', ')}.`;
}

function LanePane({ lane, variant }: { lane: WriterLane; variant: SeriesVariant }) {
  const { model } = lane;
  const states = model.recent(STRIP);
  const backlog = model.outboxLength;
  const badge = verdict(lane);
  const duplicates = model.totals.duplicates;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-outbox__path">{pathText[lane.mode]}</p>
      <ul className="sdv-outbox__nodes" aria-label={`${lane.label}: components`}>
        <NodeChip kind="database" name="Database" up={model.dbUp} downText="Down" />
        <NodeChip kind="queue" name="Broker" up={model.brokerUp} downText="Down" />
        {model.hasRelay && <NodeChip kind="server" name="Relay" up={model.relayUp} downText="Restarting" />}
      </ul>
      {model.hasRelay && (
        <div className="sdv-outbox__backlog">
          <span className="sdv-outbox__backlog-label">Outbox entries not marked sent: {backlog}</span>
          <span className="sdv-outbox__bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (backlog / OUTBOX_SCALE) * 100).toFixed(1)}%` }} />
          </span>
        </div>
      )}
      <div className="sdv-outbox__strip" aria-hidden="true">
        {states.map((state, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: cells are positions in a sliding window
          <span key={index} className="sdv-outbox__cell" data-state={state} />
        ))}
      </div>
      <p className="sdv-outbox__strip-text">{stripSummary(states)}</p>
      <div className="sdv-outbox__verdict">
        <ToneBadge tone={badge.tone}>{badge.text}</ToneBadge>
        {duplicates > 0 && <ToneBadge tone="warn">{`${duplicates} events sent twice`}</ToneBadge>}
      </div>
    </section>
  );
}

/** The same clicks and faults through a dual write and a transactional outbox. */
export default function OutboxDuelWidget({
  title = 'Dual write versus transactional outbox',
  instructions = `Press Play. Both lanes get the same clicks. The broker fails at ${BROKER_DOWN_AT_SECONDS} s, the database at ${DB_DOWN_AT_SECONDS} s, and the relay crashes at ${RELAY_CRASH_AT_SECONDS} s.`,
}: Props) {
  const hydrated = useHydrated();
  const [order, setOrder] = useState<DualOrder>('commit-first');
  const duelRef = useRef<OutboxDuel | null>(null);
  if (!duelRef.current) duelRef.current = new OutboxDuel(order);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (next: DualOrder) => {
    duelRef.current = new OutboxDuel(next);
    rerender();
  };
  const chooseOrder = (next: DualOrder) => {
    setOrder(next);
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

  const [dual, outbox] = duel.lanes;
  const a = dual.model.totals;
  const b = outbox.model.totals;
  const seconds = duel.ticks * duel.tickSeconds;

  const rows: CompareRow[] = [
    { label: 'Clicks (same for both)', values: [a.arrived, b.arrived] },
    { label: 'Saved and reached analytics', values: [a.both, b.both], better: 'higher' },
    { label: 'Requests that failed, nothing written', values: [a.rejected, b.rejected] },
    { label: 'Lost events (row saved, no event)', values: [a.lost, b.lost], better: 'lower' },
    { label: 'Phantom events (event, no row)', values: [a.phantom, b.phantom], better: 'lower' },
    { label: 'Waiting in the outbox now', values: [a.waiting, b.waiting] },
    { label: 'Events sent twice', values: [a.duplicates, b.duplicates], better: 'lower' },
    {
      label: 'Out of sync now',
      values: [dual.model.outOfSync, outbox.model.outOfSync],
      better: 'lower',
    },
  ];

  const summary = `${seconds.toFixed(1)} s of ${OUTBOX_SECONDS} s. Out of sync now: dual write ${dual.model.outOfSync}, transactional outbox ${outbox.model.outOfSync}. Events sent twice by the outbox relay: ${b.duplicates}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);
  const fault = !outbox.model.brokerUp ? 'Broker down' : !outbox.model.dbUp ? 'Database down' : null;

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : fault
        ? ({ tone: 'warn', text: `${fault} at ${seconds.toFixed(1)} s` } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${OUTBOX_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(order)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={order}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same clicks and faults for both"
          columns={[dual.label, outbox.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Dual write order"
        value={order}
        options={orders.map((id) => ({
          value: id,
          label: dualOrderOptions[id].label,
          diff: dualOrderOptions[id].diff,
        }))}
        onChange={chooseOrder}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.mode} lane={lane} variant={variants[index] ?? 'a'} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the click strips">
        {stateOrder.map((state) => (
          <li key={state}>
            <span className="sdv-outbox__cell sdv-outbox__key" data-state={state} aria-hidden="true" />
            {stateText[state].charAt(0).toUpperCase() + stateText[state].slice(1)}
          </li>
        ))}
      </ul>
      <TraceChart
        title="Clicks out of sync: lost, phantom, or waiting in the outbox"
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={10}
        summary={`Clicks out of sync. ${dual.label} ${dual.model.outOfSync}, ${outbox.label.toLowerCase()} ${outbox.model.outOfSync}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            Faults and their effects appear here, numbered to match the chart, as the run plays.
          </p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
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
