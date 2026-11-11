import { useReducer, useRef, useState } from 'react';
import {
  ATTEMPT_TIMEOUT_MS,
  BUDGET_CAP,
  RETRY_RUN_SECONDS,
  type RetryCellState,
  RetryDuel,
  type RetryLane,
  type RetryScenarioId,
  retryScenarios,
  summarizeRetries,
} from '../../lib/models/retries';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './RetriesWidget.css';

interface Props {
  scenarios?: RetryScenarioId[];
  initial?: RetryScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

function Cells({ cells }: { cells: RetryCellState[] }) {
  return (
    <span className="sdv-rw__cells" aria-hidden="true">
      {cells.map((state, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: workers have no identity beyond their position
        <span key={index} className="sdv-rw__cell" data-state={state} />
      ))}
    </span>
  );
}

function laneHealth(lane: RetryLane, started: boolean): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  const snap = lane.server.snapshot();
  if (snap.down) return { tone: 'bad', text: 'Restarting, refusing connections' };
  if (snap.queued >= lane.server.config.queueLimit) return { tone: 'bad', text: 'Queue full, sending 503' };
  if (snap.workers.includes('nobody') || snap.queuedForNobody > 0) {
    return { tone: 'warn', text: 'Working for clicks that gave up' };
  }
  return { tone: 'ok', text: 'Keeping up' };
}

function LanePane({ lane, variant, started }: { lane: RetryLane; variant: SeriesVariant; started: boolean }) {
  const snap = lane.server.snapshot();
  const { workers, queueLimit } = lane.server.config;
  const busy = snap.workers.filter((cell) => cell !== 'idle').length;
  const nobody = snap.workers.filter((cell) => cell === 'nobody').length;
  const health = laneHealth(lane, started);
  const fill = Math.min(100, (snap.queued / queueLimit) * 100);
  return (
    <section className="sdv-duel__lane sdv-rw__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <div className="sdv-rw__pool">
        <p className="sdv-rw__pool-name">Ingest workers</p>
        <Cells cells={snap.workers} />
        <p className="sdv-qtracks__meta">
          <span>
            {busy} of {workers} busy, {nobody} for nobody
          </span>
        </p>
      </div>
      <div className="sdv-rw__pool">
        <p className="sdv-rw__pool-name">Queue</p>
        <span
          className="sdv-rw__meter"
          data-full={snap.queued >= queueLimit ? '' : undefined}
          aria-hidden="true"
        >
          <span className="sdv-rw__meter-fill" style={{ width: `${fill}%` }} />
        </span>
        <p className="sdv-qtracks__meta">
          <span>
            {snap.queued} of {queueLimit} queued, {snap.queuedForNobody} for nobody
          </span>
          <span>{snap.waitingToRetry} clicks waiting to retry</span>
          {lane.policy === 'budget' && (
            <span>
              Budget {Math.floor(snap.tokens)} of {BUDGET_CAP} retries
            </span>
          )}
        </p>
      </div>
    </section>
  );
}

const formatMs = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;

export default function RetriesWidget({
  scenarios = ['storm', 'healthy', 'blip', 'budget'],
  initial,
  title = 'Same clicks, two retry policies',
  instructions = 'Pick a scenario, then press Play. Both senders deliver the exact same clicks to their own copy of the ingest service; only the retry policy differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<RetryScenarioId>(initial ?? scenarios[0] ?? 'storm');
  const duelRef = useRef<RetryDuel | null>(null);
  if (!duelRef.current) duelRef.current = new RetryDuel(retryScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: RetryScenarioId) => {
    duelRef.current = new RetryDuel(retryScenarios[id]);
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
  const chooseScenario = (id: RetryScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeRetries(first), summarizeRetries(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const started = duel.ticks > 0;
  const attemptsMetric = duel.scenario.metric === 'attempts';
  const hasTrigger = duel.scenario.schedule.length > 0;
  const bothConfirmed = sums[0].confirmed > 0 && sums[1].confirmed > 0;
  const recovery = sums.map((sum) => sum.recoverySeconds ?? Number.POSITIVE_INFINITY) as [number, number];
  const recoveryKnown = duel.done && recovery.some(Number.isFinite);
  const formatRecovery = (value: number) => {
    if (Number.isFinite(value)) return `${value.toFixed(1)} s`;
    if (!hasTrigger) return 'No trouble to recover from';
    return duel.done ? 'Never in this run' : 'Not yet';
  };

  const rows: CompareRow[] = [
    { label: 'Clicks in (same traffic)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Clicks confirmed', values: [sums[0].confirmed, sums[1].confirmed], better: 'higher' },
    { label: 'Clicks given up', values: [sums[0].gaveUp, sums[1].gaveUp], better: 'lower' },
    {
      label: 'Attempts sent (load on the service)',
      values: [sums[0].attempts, sums[1].attempts],
      better: 'lower',
    },
    {
      label: 'Attempts per click',
      values: [sums[0].amplification, sums[1].amplification],
      format: (value) => value.toFixed(2),
      better: 'lower',
    },
    {
      label: 'Turned away (503 or refused)',
      values: [sums[0].rejected, sums[1].rejected],
      better: 'lower',
    },
    {
      label: `Timed out after ${ATTEMPT_TIMEOUT_MS} ms`,
      values: [sums[0].timedOut, sums[1].timedOut],
      better: 'lower',
    },
    {
      label: 'Attempts finished for nobody',
      values: [sums[0].wasted, sums[1].wasted],
      better: 'lower',
    },
    {
      label: 'Repeats the idempotency key caught',
      values: [sums[0].duplicates, sums[1].duplicates],
    },
    {
      label: 'p95 time to confirm a click',
      values: [sums[0].p95Ms, sums[1].p95Ms],
      format: (value, column) => ((sums[column]?.confirmed ?? 0) > 0 ? formatMs(value) : 'none yet'),
      better: bothConfirmed ? 'lower' : undefined,
    },
    {
      label: 'Most attempts in one second',
      values: [sums[0].peakAttemptsPerSecond, sums[1].peakAttemptsPerSecond],
      better: 'lower',
    },
    {
      label: 'Time to recover once the service is healthy',
      values: recovery,
      format: formatRecovery,
      better: recoveryKnown ? 'lower' : undefined,
    },
  ];

  const describeLane = (lane: RetryLane, index: 0 | 1) => {
    const sum = sums[index];
    return `${lane.label}: ${sum.confirmed} confirmed, ${sum.gaveUp} given up, ${sum.attempts} attempts sent`;
  };
  const summary = `${seconds.toFixed(1)} s of ${RETRY_RUN_SECONDS} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;

  const chartTitle = attemptsMetric
    ? 'Attempts sent per second, sampled every 0.1 s'
    : 'Clicks confirmed per second, sampled every 0.1 s (clicks arrive at about 150 per second)';
  const latest = (lane: RetryLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${chartTitle}. ${first.label} now ${latest(first)}. ${second.label} now ${latest(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${RETRY_RUN_SECONDS} s` } as const)
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
          caption="Whole run so far, same clicks for both"
          columns={[first.label, second.label]}
          rows={rows}
        />
      }
    >
      {scenarios.length > 1 ? (
        <ScenarioChips
          label="Scenario"
          value={scenarioId}
          options={scenarios.map((id) => ({
            value: id,
            label: retryScenarios[id].label,
            diff: retryScenarios[id].diff,
          }))}
          onChange={chooseScenario}
        />
      ) : (
        <p className="sdv-rw__diff">{duel.scenario.diff}</p>
      )}
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.policy} lane={lane} variant={variants[index] ?? 'a'} started={started} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the workers and the queue">
        <li>
          <span className="sdv-rw__cell" data-state="idle" aria-hidden="true" /> Free worker
        </li>
        <li>
          <span className="sdv-rw__cell" data-state="working" aria-hidden="true" /> Working on an attempt a
          sender still waits for
        </li>
        <li>
          <span className="sdv-rw__cell" data-state="nobody" aria-hidden="true" /> Working on an attempt whose
          sender already timed out
        </li>
        <li>
          <span className="sdv-rw__meter sdv-rw__meter--legend" data-full="" aria-hidden="true">
            <span className="sdv-rw__meter-fill" style={{ width: '100%' }} />
          </span>{' '}
          Striped queue: full, so new attempts get 503
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
        minMax={attemptsMetric ? 400 : 200}
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
