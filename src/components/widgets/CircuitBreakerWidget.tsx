import { useReducer, useRef, useState } from 'react';
import {
  BREAKER_RUN_SECONDS,
  type BreakerCellState,
  BreakerDuel,
  type BreakerLane,
  type BreakerScenarioId,
  type BreakerSnapshot,
  type BreakerState,
  breakerScenarios,
  CALL_TIMEOUT_MS,
  COOLDOWN_MS,
  FAILURE_THRESHOLD,
  MIN_CALLS,
  PROBES,
  summarizeBreaker,
} from '../../lib/models/circuitBreaker';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell, TOY_MODEL_ASSUMPTIONS } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { TranscriptScroll } from '../sim/TranscriptScroll';
import { useHydrated } from '../sim/useHydrated';
import './CircuitBreakerWidget.css';

interface Props {
  scenarios?: BreakerScenarioId[];
  initial?: BreakerScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const leverAngle: Record<BreakerState, number> = { closed: 0, 'half-open': -18, open: -40 };

function Cells({ cells }: { cells: BreakerCellState[] }) {
  return (
    <span className="sdv-cb__cells" aria-hidden="true">
      {cells.map((state, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: workers have no identity beyond their position
        <span key={index} className="sdv-cb__cell" data-state={state} />
      ))}
    </span>
  );
}

/** A knife switch: the lever touches the far contact only while the breaker is closed. */
function BreakerSwitch({ state }: { state: BreakerState }) {
  return (
    <svg
      className="sdv-cb__switch"
      data-state={state}
      viewBox="0 0 72 36"
      width="72"
      height="36"
      aria-hidden="true"
    >
      <line className="sdv-cb__wire" x1="0" y1="30" x2="10" y2="30" />
      <line className="sdv-cb__wire" x1="62" y1="30" x2="72" y2="30" />
      <circle className="sdv-cb__contact" cx="14" cy="30" r="4" />
      <circle className="sdv-cb__contact" cx="58" cy="30" r="4" />
      <line
        className="sdv-cb__lever"
        x1="14"
        y1="30"
        x2="56"
        y2="30"
        style={{ transform: `rotate(${leverAngle[state]}deg)` }}
      />
    </svg>
  );
}

function stateBadge(snap: BreakerSnapshot, limited: boolean): { tone: Tone; text: string } {
  if (snap.state === 'closed') return { tone: 'ok', text: 'Closed: calls go through' };
  if (snap.state === 'open') return { tone: 'bad', text: 'Open: skipping ingest' };
  const out = limited ? `${snap.probesOut} of ${PROBES}` : String(snap.probesOut);
  return { tone: 'warn', text: `Half-open: ${out} probes out` };
}

function laneHealth(lane: BreakerLane, started: boolean): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  const snap = lane.server.snapshot();
  const { workers, queueLimit } = lane.server.config;
  if (snap.queued >= queueLimit) return { tone: 'bad', text: 'Queue full, sending 503' };
  const stuck = snap.workers.filter((cell) => cell === 'stuck').length;
  if (stuck >= workers / 2) return { tone: 'warn', text: 'Workers stuck waiting on ingest' };
  if (snap.state === 'open') return { tone: 'warn', text: 'Answering fast, buffering clicks' };
  return { tone: 'ok', text: 'Keeping up' };
}

function BreakerPanel({ lane, snap }: { lane: BreakerLane; snap: BreakerSnapshot }) {
  if (lane.policy === 'none') {
    return (
      <div className="sdv-cb__pool">
        <p className="sdv-cb__pool-name">Breaker</p>
        <p className="sdv-qtracks__meta">
          <span>None: every redirect calls ingest and waits up to {CALL_TIMEOUT_MS} ms.</span>
        </p>
      </div>
    );
  }
  const badge = stateBadge(snap, lane.policy === 'breaker');
  return (
    <div className="sdv-cb__pool">
      <p className="sdv-cb__pool-name">Breaker</p>
      <div className="sdv-cb__breaker">
        <BreakerSwitch state={snap.state} />
        <ToneBadge tone={badge.tone}>{badge.text}</ToneBadge>
      </div>
      <p className="sdv-qtracks__meta">
        {snap.state === 'closed' && (
          <span>
            Last 1 s: {snap.windowFailures} failed of {snap.windowCalls} calls
          </span>
        )}
        {snap.state === 'open' && <span>Cooldown: {(snap.cooldownLeftMs / 1000).toFixed(1)} s left</span>}
        {snap.state === 'half-open' && <span>{snap.probesSent} probes sent this round</span>}
      </p>
    </div>
  );
}

function LanePane({
  lane,
  variant,
  started,
}: {
  lane: BreakerLane;
  variant: SeriesVariant;
  started: boolean;
}) {
  const snap = lane.server.snapshot();
  const { workers, queueLimit } = lane.server.config;
  const busy = snap.workers.filter((cell) => cell !== 'idle').length;
  const stuck = snap.workers.filter((cell) => cell === 'stuck').length;
  const health = laneHealth(lane, started);
  const fill = Math.min(100, (snap.queued / queueLimit) * 100);
  return (
    <section className="sdv-duel__lane sdv-cb__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <BreakerPanel lane={lane} snap={snap} />
      <div className="sdv-cb__pool">
        <p className="sdv-cb__pool-name">Redirect workers</p>
        <Cells cells={snap.workers} />
        <p className="sdv-qtracks__meta">
          <span>
            {busy} of {workers} busy, {stuck} stuck waiting on ingest
          </span>
        </p>
      </div>
      <div className="sdv-cb__pool">
        <p className="sdv-cb__pool-name">Queue</p>
        <span
          className="sdv-cb__meter"
          data-full={snap.queued >= queueLimit ? '' : undefined}
          aria-hidden="true"
        >
          <span className="sdv-cb__meter-fill" style={{ width: `${fill}%` }} />
        </span>
        <p className="sdv-qtracks__meta">
          <span>
            {snap.queued} of {queueLimit} queued
          </span>
        </p>
      </div>
    </section>
  );
}

/** Run lengths of each breaker state, for the strip under the chart. */
function stateRuns(states: BreakerState[]): { state: BreakerState; start: number; length: number }[] {
  const runs: { state: BreakerState; start: number; length: number }[] = [];
  states.forEach((state, tick) => {
    const last = runs.at(-1);
    if (last && last.state === state) last.length += 1;
    else runs.push({ state, start: tick, length: 1 });
  });
  return runs;
}

function StateStrip({
  lane,
  variant,
  length,
}: {
  lane: BreakerLane;
  variant: SeriesVariant;
  length: number;
}) {
  return (
    <div className="sdv-cb__strip-row">
      <span className="sdv-cb__strip-label">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </span>
      <span className="sdv-cb__strip">
        {stateRuns(lane.states).map((run) => (
          <span
            key={run.start}
            className="sdv-cb__run"
            data-state={run.state}
            style={{ left: `${(run.start / length) * 100}%`, width: `${(run.length / length) * 100}%` }}
          />
        ))}
      </span>
    </div>
  );
}

const formatMs = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;

export default function CircuitBreakerWidget({
  scenarios = ['hang', 'refused', 'probe', 'normal'],
  initial,
  title = 'Same redirects, with and without a breaker',
  instructions = 'Pick a scenario, then press Play. Both lanes get the exact same redirects and call their own copy of the analytics ingest service; only the breaker differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<BreakerScenarioId>(initial ?? scenarios[0] ?? 'hang');
  const duelRef = useRef<BreakerDuel | null>(null);
  if (!duelRef.current) duelRef.current = new BreakerDuel(breakerScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: BreakerScenarioId) => {
    duelRef.current = new BreakerDuel(breakerScenarios[id]);
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
  const chooseScenario = (id: BreakerScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeBreaker(first), summarizeBreaker(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const started = duel.ticks > 0;
  const callsMetric = duel.scenario.metric === 'calls';
  const hasFault = duel.scenario.schedule.length > 0;
  const bothBreakers = duel.lanes.every((lane) => lane.policy !== 'none');
  const bothAnswered = sums[0].answered > 0 && sums[1].answered > 0;
  const recovery = sums.map((sum) => sum.recoverySeconds ?? Number.POSITIVE_INFINITY) as [number, number];
  const recoveryKnown = duel.done && recovery.some(Number.isFinite);
  const formatRecovery = (value: number) => {
    if (Number.isFinite(value)) return `${value.toFixed(1)} s`;
    if (!hasFault) return 'No outage to recover from';
    return duel.done ? 'Never in this run' : 'Not yet';
  };

  const rows: CompareRow[] = [
    { label: 'Redirects in (same traffic)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Redirects answered', values: [sums[0].answered, sums[1].answered], better: 'higher' },
    { label: 'Turned away with 503', values: [sums[0].rejected, sums[1].rejected], better: 'lower' },
    { label: 'Clicks recorded by ingest', values: [sums[0].recorded, sums[1].recorded] },
    { label: 'Clicks buffered to upload later', values: [sums[0].buffered, sums[1].buffered] },
    {
      label: 'Calls sent to ingest (load on it)',
      values: [sums[0].calls, sums[1].calls],
      better: hasFault ? 'lower' : undefined,
    },
    {
      label: `Calls timed out after ${CALL_TIMEOUT_MS} ms`,
      values: [sums[0].timedOut, sums[1].timedOut],
      better: 'lower',
    },
    {
      label: 'Redirects that skipped ingest',
      values: [sums[0].shortCircuited, sums[1].shortCircuited],
    },
    { label: 'Times the breaker opened', values: [sums[0].opens, sums[1].opens] },
    {
      label: 'Probe calls while half-open',
      values: [sums[0].probes, sums[1].probes],
      better: bothBreakers ? 'lower' : undefined,
    },
    {
      label: 'Time the breaker stayed open',
      values: [sums[0].openSeconds, sums[1].openSeconds],
      format: (value) => `${value.toFixed(1)} s`,
    },
    {
      label: 'p95 time to answer a redirect',
      values: [sums[0].p95Ms, sums[1].p95Ms],
      format: (value, column) => ((sums[column]?.answered ?? 0) > 0 ? formatMs(value) : 'none yet'),
      better: bothAnswered ? 'lower' : undefined,
    },
    {
      label: 'Time to record clicks again once ingest heals',
      values: recovery,
      format: formatRecovery,
      better: recoveryKnown ? 'lower' : undefined,
    },
  ];

  const describeLane = (lane: BreakerLane, index: 0 | 1) => {
    const sum = sums[index];
    const state = lane.policy === 'none' ? 'no breaker' : `breaker ${lane.server.breakerState}`;
    return `${lane.label}: ${sum.answered} answered, ${sum.rejected} turned away, ${sum.calls} calls to ingest, ${state}`;
  };
  const summary = `${seconds.toFixed(1)} s of ${BREAKER_RUN_SECONDS} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;

  const chartTitle = callsMetric
    ? 'Calls sent to ingest per second, sampled every 0.1 s (redirects arrive at about 150 per second)'
    : 'Redirects answered per second, sampled every 0.1 s (redirects arrive at about 150 per second)';
  const latest = (lane: BreakerLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${chartTitle}. ${first.label} now ${latest(first)}. ${second.label} now ${latest(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const chartEvents = markerEvents.filter((event) => !event.minor);
  const notes = duel.events.filter((event) => !event.marker);
  const stripLanes = duel.lanes
    .map((lane, index) => ({ lane, variant: variants[index] ?? 'a' }))
    .filter(({ lane }) => lane.policy !== 'none');

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${BREAKER_RUN_SECONDS} s` } as const)
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
      assumptions={TOY_MODEL_ASSUMPTIONS}
      keyStats={[
        {
          label: `Redirects answered (${first.label} / ${second.label})`,
          value: `${sums[0].answered} / ${sums[1].answered}`,
        },
        { label: 'Turned away with 503', value: `${sums[0].rejected} / ${sums[1].rejected}` },
        { label: 'Calls sent to ingest', value: `${sums[0].calls} / ${sums[1].calls}` },
      ]}
      readoutCount={rows.length}
      started={started}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same redirects for both"
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
            label: breakerScenarios[id].label,
            diff: breakerScenarios[id].diff,
          }))}
          onChange={chooseScenario}
        />
      ) : (
        <p className="sdv-cb__diff">{duel.scenario.diff}</p>
      )}
      <p className="sdv-cb__diff">
        Each breaker opens when at least half of {MIN_CALLS} or more calls in the last 1 s failed (threshold{' '}
        {FAILURE_THRESHOLD * 100}%), waits {COOLDOWN_MS / 1000} s, then lets probes through.
      </p>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.policy} lane={lane} variant={variants[index] ?? 'a'} started={started} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the lanes">
        <li>
          <span className="sdv-cb__cell" data-state="idle" aria-hidden="true" /> Free worker
        </li>
        <li>
          <span className="sdv-cb__cell" data-state="busy" aria-hidden="true" /> Busy: lookup, buffer write,
          or a quick ingest call
        </li>
        <li>
          <span className="sdv-cb__cell" data-state="stuck" aria-hidden="true" /> Striped: stuck waiting on
          ingest for 100 ms or more
        </li>
        <li>
          <span className="sdv-cb__meter sdv-cb__meter--legend" data-full="" aria-hidden="true">
            <span className="sdv-cb__meter-fill" style={{ width: '100%' }} />
          </span>{' '}
          Striped queue: full, so new redirects get 503
        </li>
        <li>
          <BreakerSwitch state="closed" /> Lever down: closed
        </li>
        <li>
          <BreakerSwitch state="half-open" /> Lever partly up, dashed: half-open
        </li>
        <li>
          <BreakerSwitch state="open" /> Lever up: open
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
        markers={chartEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={200}
        summary={chartSummary}
      />
      {stripLanes.length > 0 && (
        <div className="sdv-cb__strips" aria-hidden="true">
          <p className="sdv-cb__pool-name">Breaker state over the run</p>
          {stripLanes.map(({ lane, variant }) => (
            <StateStrip key={lane.policy} lane={lane} variant={variant} length={duel.length} />
          ))}
          <p className="sdv-cb__strip-key">
            <span className="sdv-cb__run sdv-cb__run--key" data-state="closed" /> Closed
            <span className="sdv-cb__run sdv-cb__run--key" data-state="open" /> Open
            <span className="sdv-cb__run sdv-cb__run--key" data-state="half-open" /> Half-open
          </p>
        </div>
      )}
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            Events appear here, numbered to match the chart, as the run plays.
          </p>
        )}
        {markerEvents.length > 0 && (
          <TranscriptScroll label="What happened">
            <ol>
              {markerEvents.map((event) => (
                <li key={`${event.tick}-${event.text}`}>
                  {event.minor ? (
                    <span className="sdv-trace__num sdv-cb__num--repeat" aria-hidden="true" />
                  ) : (
                    <span className="sdv-trace__num" aria-hidden="true">
                      {chartEvents.indexOf(event) + 1}
                    </span>
                  )}
                  <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time> {event.text}
                </li>
              ))}
            </ol>
          </TranscriptScroll>
        )}
        {markerEvents.some((event) => event.minor) && (
          <p className="sdv-trace__note">
            Hollow circles mark repeat probe cycles. The chart leaves them out so its numbered markers stay
            readable; the state strips under the chart show every cycle.
          </p>
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
