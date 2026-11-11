import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  QUEUE_LIMIT,
  QUEUE_RUN_SECONDS,
  QueueDuel,
  type QueueLane,
  type QueueScenarioId,
  type QueueTick,
  type QueueTickPair,
  queueMetricLabels,
  queueScenarios,
  summarizeQueue,
  WAIT_BUDGET_MS,
  WORKERS,
} from '../../lib/models/backpressure';
import { BallLegend } from '../physics/BallLegend';
import { type QueueLaneView, QueueScene } from '../physics/QueueScene';
import { usePhysicsScene } from '../physics/runtime';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { Toggle } from '../sim/controls';
import { LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import './BackpressureWidget.css';

interface Props {
  scenarios?: QueueScenarioId[];
  initial?: QueueScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const BALL_VALUE = 2;
/** Scale for the line meter of an unbounded queue, which has no limit to measure against. */
const UNBOUNDED_SCALE = 300;

const idleTick: QueueTick = {
  arrived: 0,
  served: 0,
  late: 0,
  rejected: 0,
  dropped: 0,
  startedInTime: 0,
  startedLate: 0,
  leftLine: 0,
  waits: [],
  queued: 0,
  busy: 0,
};
const idlePair: QueueTickPair = [idleTick, idleTick];

const formatMs = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
const perSecond = (value: number) => `${Math.round(value)}/s`;

function lineLimit(lane: QueueLane): number | null {
  return lane.server.snapshot().admitLimit;
}

function limitText(lane: QueueLane): string {
  const limit = lineLimit(lane);
  if (lane.policy === 'none') return 'No line';
  if (limit === null) return '';
  if (lane.policy === 'shed') return `Admits up to ${limit}`;
  return `Limit ${limit}`;
}

function laneView(lane: QueueLane): QueueLaneView {
  const snap = lane.server.snapshot();
  return {
    label: lane.label,
    detail:
      snap.queued > 0
        ? `${snap.queued} waiting, oldest ${formatMs(snap.oldestWaitMs)}`
        : `${snap.busy} of ${WORKERS} workers busy`,
    queued: snap.queued,
    limit: snap.admitLimit,
    limitLabel: limitText(lane),
    busy: snap.busy,
  };
}

const views = (duel: QueueDuel) => [laneView(duel.lanes[0]), laneView(duel.lanes[1])] as const;

function laneHealth(duel: QueueDuel, lane: QueueLane, started: boolean): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  const snap = lane.server.snapshot();
  if (duel.lateRate(lane) > 0) return { tone: 'bad', text: 'Answering after clients gave up' };
  if (duel.rejectRate(lane) > 0) {
    if (lane.policy === 'none') return { tone: 'warn', text: 'Workers busy, sending 503' };
    if (lane.policy === 'shed') return { tone: 'warn', text: 'Shedding load with 503' };
    return { tone: 'warn', text: 'Line full, sending 503' };
  }
  if (snap.oldestWaitMs > WAIT_BUDGET_MS) return { tone: 'warn', text: 'Line growing' };
  return { tone: 'ok', text: 'Keeping up' };
}

function LanePane({
  duel,
  lane,
  variant,
  started,
}: {
  duel: QueueDuel;
  lane: QueueLane;
  variant: SeriesVariant;
  started: boolean;
}) {
  const snap = lane.server.snapshot();
  const health = laneHealth(duel, lane, started);
  const limit = snap.admitLimit;
  const line =
    lane.policy === 'none'
      ? 'No waiting line'
      : limit === null
        ? `${snap.queued} waiting, no limit`
        : `${snap.queued} waiting of ${limit}`;
  return (
    <section className="sdv-duel__lane sdv-bp__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <p className="sdv-qtracks__meta">
        <span>{line}</span>
        <span>
          {snap.busy} of {WORKERS} workers busy
        </span>
      </p>
      <p className="sdv-qtracks__meta">
        <span>In time {perSecond(duel.goodput(lane))}</span>
        <span>Late {perSecond(duel.lateRate(lane))}</span>
        <span>503 {perSecond(duel.rejectRate(lane))}</span>
      </p>
    </section>
  );
}

function LineBars({ lanes }: { lanes: readonly QueueLane[] }) {
  return (
    <LoadBars
      label="Requests waiting in line"
      flagFull={false}
      bars={lanes.flatMap((lane) => {
        const snap = lane.server.snapshot();
        const limit = snap.admitLimit;
        const full = limit !== null && limit > 0 && snap.queued >= limit;
        const lineBar =
          lane.policy === 'none'
            ? {
                id: `${lane.policy}-line`,
                label: `${lane.label}: line`,
                fill: 0,
                value: 'no line, a busy server sends 503',
              }
            : {
                id: `${lane.policy}-line`,
                label: `${lane.label}: line`,
                fill: snap.queued / (limit ?? UNBOUNDED_SCALE),
                value:
                  limit === null
                    ? `${snap.queued} waiting, no limit`
                    : `${snap.queued} of ${limit} waiting${full ? ' (full)' : ''}`,
              };
        return [
          lineBar,
          {
            id: `${lane.policy}-workers`,
            label: `${lane.label}: workers`,
            fill: snap.busy / WORKERS,
            value: `${snap.busy} of ${WORKERS} busy`,
          },
        ];
      })}
    />
  );
}

export default function BackpressureWidget({
  scenarios = ['viral', 'steady', 'burst', 'slow'],
  initial,
  title = 'Same traffic, two waiting lines',
  instructions = 'Pick a scenario, then press Play. Both servers get the exact same requests and the same 5 workers; only the waiting line differs.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const [physicsChoice, setPhysicsChoice] = useState<boolean | null>(null);
  const showPhysics = physicsChoice ?? !reduced;
  const [scenarioId, setScenarioId] = useState<QueueScenarioId>(initial ?? scenarios[0] ?? 'viral');
  const duelRef = useRef<QueueDuel | null>(null);
  if (!duelRef.current) duelRef.current = new QueueDuel(queueScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const { canvasRef, scene } = usePhysicsScene((context) => new QueueScene(context, BALL_VALUE), {
    enabled: showPhysics,
  });

  const resync = useCallback(() => {
    const current = duelRef.current;
    if (!current || !scene) return;
    scene.clear();
    scene.applyTick(idlePair, views(current));
  }, [scene]);

  useEffect(() => {
    resync();
  }, [resync]);

  const restart = (id: QueueScenarioId) => {
    duelRef.current = new QueueDuel(queueScenarios[id]);
    scene?.clear();
    scene?.applyTick(idlePair, views(duelRef.current));
    rerender();
  };
  const onTick = () => {
    const pair = duel.step();
    if (pair) scene?.applyTick(pair, views(duel));
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    resync();
    rerender();
  };
  const chooseScenario = (id: QueueScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeQueue(first), summarizeQueue(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const started = duel.ticks > 0;
  const metric = duel.scenario.metric;
  const waitFormat = (value: number, column: number) =>
    (duel.lanes[column]?.waits.length ?? 0) > 0 ? formatMs(value) : 'none yet';
  const oneDecimal = (value: number) => value.toFixed(1);

  const rows: CompareRow[] = [
    { label: 'Requests in (same traffic)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Answered in time (under 1 s)', values: [sums[0].served, sums[1].served], better: 'higher' },
    {
      label: 'Answered late, client already gave up',
      values: [sums[0].late, sums[1].late],
      better: 'lower',
    },
    { label: 'Turned away at the door (503)', values: [sums[0].rejected, sums[1].rejected], better: 'lower' },
    { label: 'Dropped from the line', values: [sums[0].dropped, sums[1].dropped], better: 'lower' },
    { label: 'Still inside the server', values: [sums[0].inside, sums[1].inside] },
    {
      label: 'p95 wait in line, started requests',
      values: [sums[0].p95WaitMs, sums[1].p95WaitMs],
      format: waitFormat,
      better: 'lower',
    },
    { label: 'Longest line', values: [sums[0].peakQueue, sums[1].peakQueue], better: 'lower' },
    {
      label: "Little's law: average line L",
      values: [sums[0].averageLine, sums[1].averageLine],
      format: oneDecimal,
    },
    {
      label: 'Admitted per second λ',
      values: [sums[0].admittedPerSecond, sums[1].admittedPerSecond],
      format: oneDecimal,
    },
    {
      label: 'Average wait in line W',
      values: [sums[0].averageWaitMs, sums[1].averageWaitMs],
      format: (value) => `${Math.round(value)} ms`,
    },
    {
      label: 'λ × W (matches L)',
      values: [
        (sums[0].admittedPerSecond * sums[0].averageWaitMs) / 1000,
        (sums[1].admittedPerSecond * sums[1].averageWaitMs) / 1000,
      ],
      format: oneDecimal,
    },
  ];

  const laneSentence = (lane: QueueLane, index: 0 | 1) => {
    const sum = sums[index];
    return `${lane.label}: ${sum.served} answered in time, ${sum.late} late, ${sum.rejected} turned away, ${lane.server.snapshot().queued} waiting now`;
  };
  const summary = `${seconds.toFixed(1)} s of ${QUEUE_RUN_SECONDS} s. ${laneSentence(first, 0)}. ${laneSentence(second, 1)}.`;

  const chartTitle = `${queueMetricLabels[metric]}, sampled every 0.1 s`;
  const latest = (lane: QueueLane) => Math.round(lane.series.at(-1) ?? 0);
  const peakOf = (lane: QueueLane) => Math.round(Math.max(0, ...lane.series));
  const chartSummary = `${chartTitle}. ${first.label} now ${latest(first)}, peak ${peakOf(first)}. ${second.label} now ${latest(second)}, peak ${peakOf(second)}.`;
  const chartFloor = metric === 'queued' ? QUEUE_LIMIT : 60;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${QUEUE_RUN_SECONDS} s` } as const)
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
          label: queueScenarios[id].label,
          diff: queueScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.policy}
            duel={duel}
            lane={lane}
            variant={variants[index] ?? 'a'}
            started={started}
          />
        ))}
      </div>
      {showPhysics ? (
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is not focusable; the lane panes and table carry the same data
        <canvas ref={canvasRef} className="sdv-bp__canvas" aria-hidden="true" data-testid="queue-canvas" />
      ) : (
        <LineBars lanes={duel.lanes} />
      )}
      <div className="sdv-farm__footer">
        {showPhysics && (
          <BallLegend>
            <li>
              <span className="sdv-bp__late" aria-hidden="true" /> Answered late (slashed ring)
            </li>
            <li>1 ball = {BALL_VALUE} requests</li>
          </BallLegend>
        )}
        <Toggle label="Physics animation" checked={showPhysics} onChange={setPhysicsChoice} />
      </div>
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
        minMax={chartFloor}
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
