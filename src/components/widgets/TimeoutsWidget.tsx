import { useReducer, useRef, useState } from 'react';
import {
  type CellState,
  SLOW_MS,
  summarizeTimeouts,
  TIMEOUT_RUN_SECONDS,
  TimeoutDuel,
  type TimeoutLane,
  type TimeoutScenarioId,
  timeoutScenarios,
} from '../../lib/models/timeouts';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './TimeoutsWidget.css';

interface Props {
  scenarios?: TimeoutScenarioId[];
  initial?: TimeoutScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

function Cells({ cells, kind }: { cells: CellState[]; kind: 'worker' | 'connection' }) {
  return (
    <span className="sdv-tw__cells" aria-hidden="true">
      {cells.map((state, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pool slots have no identity beyond their position
        <span key={index} className="sdv-tw__cell" data-kind={kind} data-state={state} />
      ))}
    </span>
  );
}

function laneHealth(lane: TimeoutLane, started: boolean): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  const snap = lane.server.snapshot();
  const { queueLimit } = lane.server.config;
  if (snap.queued >= queueLimit) return { tone: 'bad', text: 'Queue full, sending 503' };
  if (snap.connections.includes('nobody') || snap.poolWaitingForNobody > 0) {
    return { tone: 'warn', text: 'Querying for nobody' };
  }
  if (snap.workers.includes('waiting')) return { tone: 'warn', text: 'Workers stuck waiting' };
  return { tone: 'ok', text: 'Keeping up' };
}

function LanePane({
  lane,
  variant,
  started,
}: {
  lane: TimeoutLane;
  variant: SeriesVariant;
  started: boolean;
}) {
  const snap = lane.server.snapshot();
  const { workers, connections, queueLimit } = lane.server.config;
  const busy = snap.workers.filter((cell) => cell !== 'idle').length;
  const stuck = snap.workers.filter((cell) => cell === 'waiting').length;
  const used = snap.connections.filter((cell) => cell !== 'idle').length;
  const nobody = snap.connections.filter((cell) => cell === 'nobody').length;
  const health = laneHealth(lane, started);
  return (
    <section className="sdv-duel__lane sdv-tw__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <div className="sdv-tw__pool">
        <p className="sdv-tw__pool-name">Server workers</p>
        <Cells cells={snap.workers} kind="worker" />
        <p className="sdv-qtracks__meta">
          <span>
            {busy} of {workers} busy, {stuck} stuck
          </span>
          <span>
            Queue {snap.queued} of {queueLimit}
          </span>
        </p>
      </div>
      <div className="sdv-tw__pool">
        <p className="sdv-tw__pool-name">Database connections</p>
        <Cells cells={snap.connections} kind="connection" />
        <p className="sdv-qtracks__meta">
          <span>
            {used} of {connections} in use, {nobody} for nobody
          </span>
          <span>{snap.poolWaiting} queries waiting</span>
        </p>
      </div>
    </section>
  );
}

const formatLatency = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;

export default function TimeoutsWidget({
  scenarios = ['hang', 'healthy', 'long'],
  initial,
  title = 'Same traffic, two timeout settings',
  instructions = 'Pick a scenario, then press Play. Both servers receive the exact same requests; only the timeout differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<TimeoutScenarioId>(initial ?? scenarios[0] ?? 'hang');
  const duelRef = useRef<TimeoutDuel | null>(null);
  if (!duelRef.current) duelRef.current = new TimeoutDuel(timeoutScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: TimeoutScenarioId) => {
    duelRef.current = new TimeoutDuel(timeoutScenarios[id]);
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
  const chooseScenario = (id: TimeoutScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeTimeouts(first), summarizeTimeouts(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const started = duel.ticks > 0;
  const connectionsMetric = duel.scenario.metric === 'connections';
  const bothServed = sums[0].served > 0 && sums[1].served > 0;
  const latency = (value: number, column: number) =>
    (sums[column]?.served ?? 0) > 0 ? formatLatency(value) : 'none yet';

  const rows: CompareRow[] = [
    { label: 'Requests in (same traffic)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Redirects served', values: [sums[0].served, sums[1].served], better: 'higher' },
    {
      label: 'Turned away, queue full (503)',
      values: [sums[0].rejected, sums[1].rejected],
      better: 'lower',
    },
    { label: 'Timed out (504)', values: [sums[0].failed, sums[1].failed], better: 'lower' },
    {
      label: 'Failed in total (503 plus 504)',
      values: [sums[0].rejected + sums[0].failed, sums[1].rejected + sums[1].failed],
      better: 'lower',
    },
    {
      label: 'p95 redirect time, served requests',
      values: [sums[0].p95Ms, sums[1].p95Ms],
      format: latency,
      better: bothServed ? 'lower' : undefined,
    },
    {
      label: 'Most workers busy at once',
      values: [sums[0].peakWorkers, sums[1].peakWorkers],
      better: 'lower',
    },
    {
      label: 'Most connections in use at once',
      values: [sums[0].peakConnections, sums[1].peakConnections],
      better: 'lower',
    },
    {
      label: 'Queries finished for nobody',
      values: [sums[0].ranForNobody, sums[1].ranForNobody],
      better: 'lower',
    },
  ];

  const describeLane = (lane: TimeoutLane, index: 0 | 1) => {
    const sum = sums[index];
    return `${lane.label}: ${sum.served} served, ${sum.rejected} turned away, ${sum.failed} timed out`;
  };
  const summary = `${seconds.toFixed(1)} s of ${TIMEOUT_RUN_SECONDS} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;

  const chartTitle = connectionsMetric
    ? 'Database connections in use, out of 16, sampled every 0.1 s'
    : 'Busy workers, out of 16, sampled every 0.1 s';
  const latest = (lane: TimeoutLane) => lane.series.at(-1) ?? 0;
  const peak = (lane: TimeoutLane) => (connectionsMetric ? lane.peakConnections : lane.peakWorkers);
  const chartSummary = `${chartTitle}. ${first.label} now ${latest(first)}, peak ${peak(first)}. ${second.label} now ${latest(second)}, peak ${peak(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${TIMEOUT_RUN_SECONDS} s` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

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
          label: timeoutScenarios[id].label,
          diff: timeoutScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.policy} lane={lane} variant={variants[index] ?? 'a'} started={started} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the pools">
        <li>
          <span className="sdv-tw__cell" data-state="idle" aria-hidden="true" /> Free
        </li>
        <li>
          <span className="sdv-tw__cell" data-kind="worker" data-state="working" aria-hidden="true" />
          <span className="sdv-tw__cell" data-kind="connection" data-state="working" aria-hidden="true" />{' '}
          Busy with a normal lookup
        </li>
        <li>
          <span className="sdv-tw__cell" data-state="waiting" aria-hidden="true" /> Held over {SLOW_MS} ms,
          waiting on a replica
        </li>
        <li>
          <span className="sdv-tw__cell" data-state="nobody" aria-hidden="true" /> Query for a request that
          already gave up
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
        minMax={16}
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
