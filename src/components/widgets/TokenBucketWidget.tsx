import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  BUCKET_BURST,
  BUCKET_RATE,
  type BucketId,
  bucketScenarios,
  LimiterRun,
  type RunScenario,
  summarize,
} from '../../lib/models/rateLimit';
import { BallLegend } from '../physics/BallLegend';
import { usePhysicsScene } from '../physics/runtime';
import { TokenBucketScene } from '../physics/TokenBucketScene';
import { Slider, Toggle } from '../sim/controls';
import { LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import type { StatRow } from '../sim/StatTable';
import { TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { chartMarkers, RunTranscript } from './RunTranscript';
import './TokenBucketWidget.css';

interface Props {
  scenarios?: BucketId[];
  initial?: BucketId;
  title?: string;
  instructions?: string;
}

interface Limits {
  rate: number;
  burst: number;
}

function makeRun(scenario: RunScenario, limits: Limits): LimiterRun {
  return new LimiterRun({
    ...scenario,
    lanes: scenario.lanes.map((lane) => ({
      ...lane,
      limiter: { kind: 'tokenBucket', rate: limits.rate, burst: limits.burst },
    })),
  });
}

export default function TokenBucketWidget({
  scenarios = ['steady', 'burst', 'overload'],
  initial,
  title = 'Token bucket playground',
  instructions = 'Pick a scenario and press Play. Each request takes one token; an empty bucket answers 429. Change the refill rate or bucket size at any time.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const [physicsChoice, setPhysicsChoice] = useState<boolean | null>(null);
  const showPhysics = physicsChoice ?? !reduced;
  const [scenarioId, setScenarioId] = useState<BucketId>(initial ?? scenarios[0] ?? 'steady');
  const [limits, setLimits] = useState<Limits>({ rate: BUCKET_RATE, burst: BUCKET_BURST });
  const runRef = useRef<LimiterRun | null>(null);
  runRef.current ??= makeRun(bucketScenarios[scenarioId], limits);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const burstRef = useRef(limits.burst);
  burstRef.current = limits.burst;

  const { canvasRef, scene } = usePhysicsScene((context) => new TokenBucketScene(context, burstRef.current), {
    enabled: showPhysics,
  });

  const lane = run.lanes[0];
  const tokens = Math.floor(lane?.allowanceOf(0) ?? 0);

  const syncScene = useCallback(() => {
    const model = runRef.current?.lanes[0];
    if (!model || !scene) return;
    scene.setTokens(Math.floor(model.allowanceOf(0)), burstRef.current);
    const counts = summarize(model);
    scene.syncCounts(counts.served, counts.rejections);
  }, [scene]);

  useEffect(() => {
    syncScene();
  }, [syncScene]);

  const restart = (id: BucketId, next: Limits = limits) => {
    runRef.current = makeRun(bucketScenarios[id], next);
    scene?.clear();
    syncScene();
    rerender();
  };

  const onTick = () => {
    const [result] = run.step();
    if (result) scene?.applyTick(result, limits.burst);
    rerender();
  };

  const skipToEnd = () => {
    while (!run.done) run.step();
    syncScene();
    rerender();
  };

  const chooseScenario = (id: BucketId) => {
    setScenarioId(id);
    restart(id);
  };

  const changeLimits = (changes: Partial<Limits>) => {
    const next = { ...limits, ...changes };
    setLimits(next);
    burstRef.current = next.burst;
    if (run.ticks === 0) {
      restart(scenarioId, next);
      return;
    }
    const note =
      changes.rate !== undefined
        ? `You set the refill rate to ${next.rate} tokens/s`
        : `You set the bucket size to ${next.burst} tokens`;
    run.apply(
      { type: 'setLimiter', limiter: { kind: 'tokenBucket', rate: next.rate, burst: next.burst } },
      note,
    );
    syncScene();
    rerender();
  };

  const totals = lane ? summarize(lane) : undefined;
  const sent = totals?.arrived ?? 0;
  const served = totals?.served ?? 0;
  const limited = totals?.limited ?? 0;
  const seconds = run.ticks * run.tickSeconds;
  const scenario = run.scenario;
  const rate = lane?.rateOf(0) ?? 0;

  const rows: StatRow[] = [
    {
      label: 'Client A sends',
      value: `${rate} req/s`,
      detail: `refill ${limits.rate} tokens/s`,
      ...(rate > limits.rate ? { tone: 'warn' as const, note: 'Faster than the refill' } : {}),
    },
    { label: 'Tokens in the bucket', value: `${tokens} of ${limits.burst}` },
    { label: 'Requests sent', value: String(sent) },
    { label: 'Served', value: String(served), ...(served > 0 ? { tone: 'ok' as const } : {}) },
    {
      label: 'Got 429 Too Many Requests',
      value: String(limited),
      ...(limited > 0 ? { tone: 'bad' as const, note: 'Rejected at the door' } : {}),
    },
  ];

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : tokens === 0
        ? ({ tone: 'bad', text: 'Bucket empty: 429' } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${scenario.seconds} s` } as const);

  const summary = `${seconds.toFixed(1)} s of ${scenario.seconds} s. ${tokens} of ${limits.burst} tokens left. ${served} of ${sent} requests served, ${limited} got 429.`;
  const chartTitle = 'Tokens in the bucket';
  const series = run.series[0] ?? [];
  const chartSummary = `${chartTitle}. Now ${series.at(-1) ?? tokens}, lowest ${series.length ? Math.min(...series) : tokens}.`;

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      stats={rows}
      status={status}
      finished={run.done}
      resetKey={scenarioId}
      controls={
        <>
          <Slider
            label="Refill rate"
            value={limits.rate}
            min={2}
            max={20}
            format={(v) => `${v} tokens/s`}
            hint="The long run average a client may send."
            onChange={(v) => changeLimits({ rate: v })}
          />
          <Slider
            label="Bucket size (burst)"
            value={limits.burst}
            min={1}
            max={30}
            format={(v) => `${v} tokens`}
            hint="How many requests a client may send at once after a quiet spell."
            onChange={(v) => changeLimits({ burst: v })}
          />
          <div className="sdv-duel__extra">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
              Skip to the end
            </button>
          </div>
        </>
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: bucketScenarios[id].label,
          diff: bucketScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      {showPhysics ? (
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is not focusable; the stats table carries the same data
        <canvas ref={canvasRef} className="sdv-farm__canvas" aria-hidden="true" data-testid="bucket-canvas" />
      ) : (
        <LoadBars
          label="Token bucket"
          flagFull={false}
          bars={[
            {
              id: 'tokens',
              label: 'Tokens left for client A',
              fill: limits.burst > 0 ? tokens / limits.burst : 0,
              value: `${tokens} of ${limits.burst}`,
              down: tokens === 0 && run.ticks > 0,
            },
          ]}
        />
      )}
      <div className="sdv-farm__footer">
        {showPhysics && (
          <BallLegend>
            <li>
              <span className="sdv-bucket__token" aria-hidden="true" /> Token (amber diamond)
            </li>
            <li>Dropped requests got 429 and land in the tray</li>
          </BallLegend>
        )}
        <Toggle label="Physics animation" checked={showPhysics} onChange={setPhysicsChoice} />
      </div>
      <TraceChart
        title={chartTitle}
        series={[{ label: 'Tokens', values: series, variant: 'a' }]}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={chartMarkers(run.events)}
        minMax={limits.burst}
        summary={chartSummary}
      />
      <RunTranscript events={run.events} tickSeconds={run.tickSeconds} />
    </SimulationShell>
  );
}
