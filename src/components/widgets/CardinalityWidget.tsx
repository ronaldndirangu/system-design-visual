import { useReducer, useRef, useState } from 'react';
import { formatBytes } from '../../lib/models/estimates';
import {
  CardinalityDuel,
  type CardinalityLane,
  type CardinalityScenarioId,
  type CardinalitySummary,
  cardinalityScenarios,
  DUEL_SECONDS,
  headMemoryBytes,
  INCIDENT_SECONDS,
  NEAR_LIMIT,
  SERIES_LIMIT,
  summarize,
} from '../../lib/models/metrics';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './CardinalityWidget.css';

const CELLS = 100;
const SLOTS_PER_CELL = SERIES_LIMIT / CELLS;
const BUDGET = formatBytes(headMemoryBytes(SERIES_LIMIT));
const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

interface Props {
  scenarios?: CardinalityScenarioId[];
  initial?: CardinalityScenarioId;
  title?: string;
  instructions?: string;
}

const count = (value: number) => Math.round(value).toLocaleString('en-US');

function laneTone(sum: CardinalitySummary): { tone: Tone; text: string } {
  if (sum.exported > SERIES_LIMIT) return { tone: 'bad', text: 'At the limit, rejecting new series' };
  if (sum.stored >= NEAR_LIMIT) return { tone: 'warn', text: 'Near the limit' };
  return { tone: 'ok', text: 'Under the limit' };
}

function LanePane({
  lane,
  sum,
  variant,
}: {
  lane: CardinalityLane;
  sum: CardinalitySummary;
  variant: SeriesVariant;
}) {
  const state = laneTone(sum);
  const full = sum.exported > SERIES_LIMIT;
  const rejected = sum.exported - sum.stored;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <div className="sdv-cardinality__state">
        <ToneBadge tone={state.tone}>{state.text}</ToneBadge>
      </div>
      <div className="sdv-cardinality__grid" aria-hidden="true" data-full={full ? '' : undefined}>
        {Array.from({ length: CELLS }, (_, cell) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: cells are fixed memory slots identified by position
            key={cell}
            className="sdv-cardinality__cell"
            data-used={sum.stored > cell * SLOTS_PER_CELL ? '' : undefined}
          />
        ))}
      </div>
      <p className="sdv-cardinality__meta">
        <span>
          {count(sum.stored)} of {count(SERIES_LIMIT)} series slots used ({formatBytes(sum.memoryBytes)} of{' '}
          {BUDGET})
        </span>
        {rejected > 0 && <span>{count(rejected)} newer series rejected</span>}
      </p>
      <div className="sdv-cardinality__newest">
        <p className="sdv-cardinality__newest-title">Newest series</p>
        {lane.newest.length === 0 ? (
          <p className="sdv-cardinality__empty">None yet</p>
        ) : (
          <ul>
            {lane.newest.map((series) => (
              <li key={series.labels}>
                <code>{series.labels}</code>
                {series.stored ? (
                  <ToneBadge tone="ok">Stored</ToneBadge>
                ) : (
                  <ToneBadge tone="bad">Rejected</ToneBadge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function CardinalityWidget({
  scenarios = ['launch', 'steady', 'bots'],
  initial,
  title = 'One request stream, two label policies',
  instructions = `Pick a scenario, then press Play. Both toy ingesters receive the exact same requests and store at most ${count(SERIES_LIMIT)} series each. Raw labels keeps the raw path and user_id on every series; the allowlist keeps only route, status, and host. The clock is sped up. Every route fails about 1 request in 100 all along, and checkout starts failing at ${INCIDENT_SECONDS} s in every scenario.`,
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<CardinalityScenarioId>(initial ?? scenarios[0] ?? 'launch');
  const duelRef = useRef<CardinalityDuel | null>(null);
  if (!duelRef.current) duelRef.current = new CardinalityDuel(cardinalityScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((ticks: number) => ticks + 1, 0);

  const restart = (id: CardinalityScenarioId) => {
    duelRef.current = new CardinalityDuel(cardinalityScenarios[id]);
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
  const chooseScenario = (id: CardinalityScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarize(first, duel.requests), summarize(second, duel.requests)] as const;
  const seconds = duel.ticks * duel.tickSeconds;

  const rows: CompareRow[] = [
    { label: 'Requests (same traffic)', values: [sums[0].requests, sums[1].requests], format: count },
    {
      label: `Active series stored (limit ${count(SERIES_LIMIT)})`,
      values: [sums[0].stored, sums[1].stored],
      format: count,
      better: 'lower',
    },
    {
      label: 'Head memory, about 3 KB a series',
      values: [sums[0].memoryBytes, sums[1].memoryBytes],
      format: (value) => `${formatBytes(value)} of ${BUDGET}`,
      better: 'lower',
    },
    {
      label: 'Samples received',
      values: [sums[0].samplesReceived, sums[1].samplesReceived],
      format: count,
    },
    { label: 'Samples stored', values: [sums[0].samplesStored, sums[1].samplesStored], format: count },
    {
      label: 'Samples rejected',
      values: [sums[0].samplesRejected, sums[1].samplesRejected],
      format: count,
      better: 'lower',
    },
    {
      label: 'Checkout 500s counted',
      values: [sums[0].checkoutErrorsCounted, sums[1].checkoutErrorsCounted],
      format: (value, column) => `${count(value)} of ${count(sums[column]?.checkoutErrors ?? 0)}`,
      better: 'higher',
    },
    {
      label: 'Series read by the checkout error panel',
      values: [sums[0].checkoutSeries, sums[1].checkoutSeries],
      format: count,
      better: 'lower',
    },
  ];

  const describeLane = (lane: CardinalityLane, sum: CardinalitySummary) =>
    `${lane.label}: ${count(sum.stored)} series stored of ${count(sum.exported)} created, ${count(sum.samplesRejected)} samples rejected, ${sum.checkoutErrorsCounted} of ${sum.checkoutErrors} checkout 500s counted`;
  const summary = `${seconds.toFixed(1)} s of ${DUEL_SECONDS} s. ${describeLane(first, sums[0])}. ${describeLane(second, sums[1])}.`;

  const chartTitle = `Series stored by each ingester (limit ${count(SERIES_LIMIT)})`;
  const latest = (lane: CardinalityLane) => count(lane.series.at(-1) ?? 0);
  const chartSummary = `${chartTitle}. ${first.label} now ${latest(first)}, ${second.label.toLowerCase()} now ${latest(second)}. A line that goes flat at ${count(SERIES_LIMIT)} has hit the limit.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${DUEL_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={scenarioId}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same requests for both"
          columns={[first.label, second.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: cardinalityScenarios[id].label,
          diff: cardinalityScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.id}
            lane={lane}
            sum={sums[index === 0 ? 0 : 1]}
            variant={variants[index] ?? 'a'}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the memory grids">
        <li>
          <span className="sdv-cardinality__cell" data-used="" aria-hidden="true" />
          Filled square: {SLOTS_PER_CELL} series stored
        </li>
        <li>
          <span className="sdv-cardinality__cell" aria-hidden="true" />
          Hollow square: {SLOTS_PER_CELL} free slots
        </li>
        <li>
          <span className="sdv-cardinality__cell" data-used="" data-full="" aria-hidden="true" />
          Striped squares: limit reached, new series rejected
        </li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={SERIES_LIMIT * 1.2}
        summary={chartSummary}
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
    </SimulationShell>
  );
}
