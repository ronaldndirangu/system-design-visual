import { m } from 'motion/react';
import { useId, useMemo, useReducer, useRef, useState } from 'react';
import {
  CHUNK_BUDGETS,
  type ChunkBudget,
  createChunkDuel,
  formatMs,
  LONG_PROMPT_TOKENS,
  runToEnd,
  type ServeDuel,
  type ServeLane,
  summarizeLane,
} from '../../lib/models/llmServing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { Segmented } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { SimulationShell } from '../sim/SimulationShell';
import type { SeriesVariant } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { safeId } from '../viz/SystemNode';
import { duelStatus, EventLog, LanePane, laneVariants, SkipButton, toyNote } from './ServingParts';
import './ServingChunkWidget.css';

interface Props {
  title?: string;
  instructions?: string;
}

type BudgetValue = `${ChunkBudget}`;

const budgetOptions = CHUNK_BUDGETS.map((budget) => ({
  value: `${budget}` as BudgetValue,
  label: `${budget} tokens`,
}));
const WIDTH = 320;
const HEIGHT = 158;
const PLOT_X0 = 30;
const PLOT_X1 = 314;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 134;
const SHORT_INDEX = 7;

interface Axes {
  maxMs: number;
  maxStepMs: number;
}

function axesFor(budget: ChunkBudget): Axes {
  const duel = createChunkDuel(budget);
  let maxMs = 0;
  let maxStepMs = 0;
  for (const lane of duel.lanes) {
    runToEnd(lane);
    maxMs = Math.max(maxMs, lane.clockMs);
    for (const record of lane.history) maxStepMs = Math.max(maxStepMs, record.endMs - record.startMs);
  }
  return { maxMs, maxStepMs: Math.ceil(maxStepMs / 20) * 20 };
}

function longRequest(lane: ServeLane) {
  return lane.requests.find((request) => request.long);
}

function ttftOf(lane: ServeLane, index: number): number {
  const result = lane.results.find((entry) => entry.index === index);
  return result ? result.firstTokenMs - result.arrivalMs : -1;
}

function firstTokenAt(lane: ServeLane): number | null {
  const event = lane.events.find((entry) => entry.kind === 'first');
  return event ? event.atMs : null;
}

function StepChart({ lane, variant, axes }: { lane: ServeLane; variant: SeriesVariant; axes: Axes }) {
  const reduced = usePrefersReducedMotion();
  const hatchId = `${safeId(useId(), 'serve-chunk')}-hatch`;
  const x = (ms: number) => PLOT_X0 + ((PLOT_X1 - PLOT_X0) * ms) / axes.maxMs;
  const h = (ms: number) => ((PLOT_BOTTOM - PLOT_TOP) * ms) / axes.maxStepMs;
  const long = longRequest(lane);
  const arrival = long && lane.clockMs >= long.arrivalMs ? long.arrivalMs : null;
  const first = firstTokenAt(lane);
  const last = lane.history.at(-1);
  const worst = lane.history.reduce((most, record) => Math.max(most, record.endMs - record.startMs), 0);
  const label = last
    ? `Time per step for ${lane.config.label}, ${lane.history.length} steps over ${formatMs(lane.clockMs)}. Longest step so far ${formatMs(worst)}. Last step ${formatMs(last.endMs - last.startMs)}.`
    : `Time per step for ${lane.config.label}, empty until the first step.`;
  const ticks = [0, axes.maxStepMs / 2, axes.maxStepMs];

  return (
    <svg
      className="sdv-serve-svg sdv-serve-chunk__chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" className="sdv-serve-chunk__prefill-bg" />
          <line x1="0" y1="0" x2="0" y2="4" className="sdv-serve-chunk__hatch" />
        </pattern>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PLOT_X0}
            x2={PLOT_X1}
            y1={PLOT_BOTTOM - h(tick)}
            y2={PLOT_BOTTOM - h(tick)}
            className="sdv-serve-chunk__grid"
          />
          <text
            x={PLOT_X0 - 4}
            y={PLOT_BOTTOM - h(tick) + 4}
            textAnchor="end"
            className="sdv-serve-svg__muted"
          >
            {tick}
          </text>
        </g>
      ))}
      <text x={0} y={PLOT_TOP - 8} className="sdv-serve-svg__muted">
        ms per step
      </text>
      <text x={PLOT_X0} y={HEIGHT - 6} className="sdv-serve-svg__muted">
        0 ms
      </text>
      <text x={PLOT_X1} y={HEIGHT - 6} textAnchor="end" className="sdv-serve-svg__muted">
        {formatMs(axes.maxMs)}
      </text>
      <text x={(PLOT_X0 + PLOT_X1) / 2} y={HEIGHT - 6} textAnchor="middle" className="sdv-serve-svg__muted">
        clock
      </text>
      {lane.history.map((record) => {
        const span = record.endMs - record.startMs;
        const prefill = record.prefillTokens > 0;
        return (
          <m.rect
            key={record.step}
            x={x(record.startMs)}
            y={PLOT_BOTTOM - h(span)}
            width={Math.max(0.8, x(record.endMs) - x(record.startMs) - 0.4)}
            height={h(span)}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.18 }}
            fill={prefill ? `url(#${hatchId})` : undefined}
            className={
              prefill
                ? 'sdv-serve-chunk__bar sdv-serve-chunk__bar--prefill'
                : `sdv-serve-chunk__bar sdv-serve-chunk__bar--${variant}`
            }
          />
        );
      })}
      {arrival !== null && (
        <g>
          <line x1={x(arrival)} x2={x(arrival)} y1={6} y2={PLOT_BOTTOM} className="sdv-serve-chunk__marker" />
          <text x={x(arrival) + 3} y={12} className="sdv-serve-svg__label">
            {long?.id} arrives
          </text>
        </g>
      )}
      {first !== null && (
        <g>
          <line
            x1={x(first)}
            x2={x(first)}
            y1={18}
            y2={PLOT_BOTTOM}
            className="sdv-serve-chunk__marker sdv-serve-chunk__marker--first"
          />
          <text x={x(first) + 3} y={24} className="sdv-serve-svg__label">
            {long?.id} first token
          </text>
        </g>
      )}
    </svg>
  );
}

function longStatus(lane: ServeLane): string {
  const long = longRequest(lane);
  if (!long) return 'no long prompt';
  if (lane.clockMs < long.arrivalMs) return `${long.id} arrives at ${formatMs(long.arrivalMs)}`;
  const first = firstTokenAt(lane);
  if (first !== null)
    return `${long.id} got its first token ${formatMs(first - long.arrivalMs)} after it arrived`;
  const seq = lane.running.find((entry) => entry.req.index === long.index);
  if (!seq) return `${long.id} is waiting for a seat`;
  return `${long.id} prefill ${seq.cached.toLocaleString('en-US')} of ${LONG_PROMPT_TOKENS.toLocaleString('en-US')} tokens`;
}

function LaneView({ lane, variant, axes }: { lane: ServeLane; variant: SeriesVariant; axes: Axes }) {
  const last = lane.history.at(-1);
  return (
    <LanePane label={lane.config.label} variant={variant}>
      <StepChart lane={lane} variant={variant} axes={axes} />
      <p className="sdv-serve-meta">
        Clock <strong>{formatMs(lane.clockMs)}</strong>. Last step{' '}
        <strong>{last ? formatMs(last.endMs - last.startMs) : 'none yet'}</strong>
        {last ? `: ${last.prefillTokens} prompt tokens, ${last.decodeSequences} decoding` : ''}.
      </p>
      <p className="sdv-serve-meta">
        <strong>{longStatus(lane)}</strong>.
      </p>
    </LanePane>
  );
}

export default function ServingChunkWidget({
  title = 'One long prompt, with and without chunked prefill',
  instructions = `Six requests are decoding when a ${LONG_PROMPT_TOKENS.toLocaleString('en-US')} token prompt arrives. Each bar is one step: its height is how long every decoding request waits for its next token. Hatched bars carry prompt work. Pick a chunk budget, press Play or Step, and watch the bars when the long prompt lands.`,
}: Props) {
  const hydrated = useHydrated();
  const [budget, setBudget] = useState<ChunkBudget>(64);
  const runRef = useRef<ServeDuel | null>(null);
  if (!runRef.current) runRef.current = createChunkDuel(budget);
  const duel = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const axes = useMemo(() => axesFor(budget), [budget]);

  const restart = (next: ChunkBudget) => {
    runRef.current = createChunkDuel(next);
    rerender();
  };
  const chooseBudget = (value: BudgetValue) => {
    const next = CHUNK_BUDGETS.find((entry) => `${entry}` === value) ?? 64;
    setBudget(next);
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

  const [whole, chunked] = duel.lanes;
  const sums = [summarizeLane(whole), summarizeLane(chunked)] as const;
  const done = duel.done;
  const notYet = (value: number) => (value < 0 ? 'not yet' : formatMs(value));
  const longId = longRequest(whole)?.id ?? 'Long prompt';
  const shortId = whole.requests[SHORT_INDEX]?.id ?? 'Next request';
  const rows: CompareRow[] = [
    {
      label: 'Longest wait between tokens',
      values: [sums[0].worstGapMs, sums[1].worstGapMs],
      format: (value) => formatMs(value),
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Wait between tokens, p95',
      values: [sums[0].p95GapMs, sums[1].p95GapMs],
      format: (value) => formatMs(value),
      better: done ? 'lower' : undefined,
    },
    {
      label: `${longId} (long prompt) time to first token`,
      values: [sums[0].longTtft ?? -1, sums[1].longTtft ?? -1],
      format: notYet,
      better: done ? 'lower' : undefined,
    },
    {
      label: `${shortId} (arrives after it) time to first token`,
      values: [ttftOf(whole, SHORT_INDEX), ttftOf(chunked, SHORT_INDEX)],
      format: notYet,
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Tokens per second',
      values: [sums[0].tokensPerSecond, sums[1].tokensPerSecond],
      format: (value) => Math.round(value).toLocaleString('en-US'),
      better: done ? 'higher' : undefined,
    },
  ];

  const laneWords = (index: 0 | 1) => {
    const sum = sums[index];
    const lane = duel.lanes[index];
    return `${sum.label}: clock ${formatMs(lane.clockMs)}, longest wait between tokens ${formatMs(sum.worstGapMs)}, ${longStatus(lane)}`;
  };
  const summary = `Chunk budget ${budget} tokens. ${laneWords(0)}. ${laneWords(1)}.`;

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(budget)}
      summary={summary}
      status={duelStatus(duel)}
      finished={done}
      resetKey={`${budget}`}
      ticksPerSecond={8}
      controls={
        <>
          <Segmented
            label="Chunk budget per step"
            value={`${budget}` as BudgetValue}
            options={budgetOptions}
            onChange={chooseBudget}
          />
          <SkipButton onSkip={skipToEnd} disabled={!hydrated || done} />
        </>
      }
      readout={
        <CompareTable
          caption={done ? 'Whole run, toy model, illustrative ms' : 'So far (toy model, illustrative ms)'}
          columns={[whole.config.label, chunked.config.label]}
          rows={rows}
        />
      }
    >
      <MotionRoot>
        <div className="sdv-duel__lanes sdv-serve-lanes">
          {duel.lanes.map((lane, index) => (
            <LaneView key={lane.config.label} lane={lane} variant={laneVariants[index] ?? 'a'} axes={axes} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the step charts">
        <li>
          <span className="sdv-serve-swatch sdv-serve-chunk__key--prefill" aria-hidden="true" /> Hatched: the
          step includes prompt tokens
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-chunk__key--decode" aria-hidden="true" /> Solid: decode
          only
        </li>
        <li>
          <span className="sdv-serve-chunk__key--marker" aria-hidden="true" /> Dashed lines: long prompt
          arrives, then gets its first token
        </li>
        <li>{toyNote}</li>
      </ul>
      <EventLog
        duel={duel}
        tags={['Whole', 'Chunked']}
        kinds={['arrive', 'join', 'first']}
        empty="Press Play or Step. Arrivals and first tokens appear here."
      />
    </SimulationShell>
  );
}
