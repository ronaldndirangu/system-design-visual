import { useReducer, useRef } from 'react';
import {
  FOCUS_CODE,
  lagOf,
  ORDER_SECONDS,
  OrderingDuel,
  type OrderLane,
  partitionLabel,
  partitionOf,
} from '../../lib/models/partitionedLog';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { UiIcon } from '../viz/icons';
import './OrderingDuelWidget.css';

/** A full lag bar stands for this many unread events. */
const LAG_SCALE = 40;

interface Props {
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

function LanePane({ lane, variant }: { lane: OrderLane; variant: SeriesVariant }) {
  const { log } = lane;
  const partitions = log.config.partitions;
  const late = log.totals.outOfOrder;
  const route =
    lane.partitioner === 'key'
      ? `Every /${FOCUS_CODE} click goes to ${partitionLabel(partitionOf(FOCUS_CODE, partitions))}.`
      : `Clicks for /${FOCUS_CODE} take turns across P1 to P${partitions}, like every other link.`;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-order__route">{route}</p>
      <ul className="sdv-order__parts" aria-label={`${lane.label}: partitions`}>
        {log.partitions.map((part) => {
          const lag = lagOf(part);
          const reader = log.consumers.find((consumer) => consumer.id === part.owner);
          const stalled = reader !== undefined && log.ticks < reader.stalledUntil;
          return (
            <li key={part.id} className="sdv-order__part">
              <span className="sdv-order__part-name">{partitionLabel(part.id)}</span>
              <span className="sdv-order__bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (lag / LAG_SCALE) * 100).toFixed(1)}%` }} />
              </span>
              <span className="sdv-order__part-meta">
                Lag {lag}
                {lag > LAG_SCALE ? '+' : ''}
              </span>
              {stalled && <ToneBadge tone="warn">{`Consumer ${reader?.id} stalled`}</ToneBadge>}
            </li>
          );
        })}
      </ul>
      <div className="sdv-order__late">
        {late === 0 ? (
          <ToneBadge tone="ok">Every link counted in click order</ToneBadge>
        ) : (
          <ToneBadge tone="bad">{`${late} clicks counted out of order`}</ToneBadge>
        )}
        <p className="sdv-order__late-title">Latest clicks counted out of order</p>
        {log.recentLate.length === 0 ? (
          <p className="sdv-trace__empty">None so far.</p>
        ) : (
          <ol className="sdv-order__late-list">
            {log.recentLate.map((click) => (
              <li key={`${click.code}-${click.seq}`}>
                <span className="sdv-order__late-mark" aria-hidden="true">
                  <UiIcon name="bad" />
                </span>
                Click {click.seq} for /{click.code} arrives after click {click.newest}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** The same clicks keyed by short code or spread round robin, with one consumer stalling. */
export default function OrderingDuelWidget({
  title = 'Same clicks, two ways to pick a partition',
  instructions = 'Press Play. Both logs get the exact same clicks, and consumer 2 stalls at 3 s in both. Only the choice of partition differs.',
}: Props) {
  const hydrated = useHydrated();
  const duelRef = useRef<OrderingDuel | null>(null);
  if (!duelRef.current) duelRef.current = new OrderingDuel();
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = () => {
    duelRef.current = new OrderingDuel();
    rerender();
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };

  const [keyed, spread] = duel.lanes;
  const a = keyed.log.totals;
  const b = spread.log.totals;
  const seconds = duel.ticks * duel.tickSeconds;
  const yesNo = (value: number) => (value > 0 ? 'Yes' : 'No');

  const rows: CompareRow[] = [
    { label: 'Clicks written (same clicks)', values: [a.produced, b.produced] },
    { label: 'Clicks counted', values: [a.firstReads, b.firstReads] },
    { label: 'Counted out of order', values: [a.outOfOrder, b.outOfOrder], better: 'lower' },
    { label: 'Waiting to be read (lag)', values: [keyed.log.lag, spread.log.lag] },
    {
      label: 'Every link counted in click order',
      values: [a.outOfOrder === 0 ? 1 : 0, b.outOfOrder === 0 ? 1 : 0],
      format: yesNo,
      better: 'higher',
    },
  ];

  const summary = `${seconds.toFixed(1)} s of ${ORDER_SECONDS} s. Clicks counted out of order: ${keyed.label.toLowerCase()} ${a.outOfOrder}, ${spread.label.toLowerCase()} ${b.outOfOrder}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${ORDER_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={restart}
      summary={summary}
      status={status}
      finished={duel.done}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same clicks for both"
          columns={[keyed.label, spread.label]}
          rows={rows}
        />
      }
    >
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.partitioner} lane={lane} variant={variants[index] ?? 'a'} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the partitions">
        <li>
          <span className="sdv-order__key" aria-hidden="true" /> Unread events in a partition (lag); a full
          bar is {LAG_SCALE}
        </li>
        <li>
          <span className="sdv-order__late-mark" aria-hidden="true">
            <UiIcon name="bad" />
          </span>
          A click counted after a newer click for the same link
        </li>
      </ul>
      <TraceChart
        title="Clicks counted out of order, running total"
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={10}
        summary={`Clicks counted out of order, running total. ${keyed.label} ${a.outOfOrder}, ${spread.label.toLowerCase()} ${b.outOfOrder}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            Events appear here, numbered to match the chart, as the run plays.
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
