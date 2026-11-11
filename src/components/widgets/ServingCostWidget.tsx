import { m } from 'motion/react';
import { useId, useState } from 'react';
import {
  batchPoint,
  computeMs,
  memoryMs,
  PER_SEQUENCE_MS,
  RIDGE_TOKENS,
  STEP_OVERHEAD_MS,
  SWEEP_BATCHES,
  stepMs,
  TOKENS_PER_MS,
  WEIGHT_READ_MS,
} from '../../lib/models/llmServing';
import { Segmented } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import type { StatRow } from '../sim/StatTable';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { WidgetFrame } from '../sim/WidgetFrame';
import { DiagramScroll } from '../viz/DiagramScroll';
import { safeId } from '../viz/SystemNode';
import './ServingParts.css';
import './ServingCostWidget.css';

interface Props {
  title?: string;
  instructions?: string;
}

const PROMPTS = [0, RIDGE_TOKENS, 2048] as const;
type Prompt = (typeof PROMPTS)[number];
type BatchValue = `${(typeof SWEEP_BATCHES)[number]}`;
type PromptValue = `${Prompt}`;

const batchOptions = SWEEP_BATCHES.map((batch) => ({
  value: `${batch}` as BatchValue,
  label: `${batch}`,
}));
const promptOptions = PROMPTS.map((prompt) => ({
  value: `${prompt}` as PromptValue,
  label: prompt === 0 ? 'None' : `${prompt.toLocaleString('en-US')} tokens`,
}));

const MAX_BATCH = SWEEP_BATCHES[SWEEP_BATCHES.length - 1] ?? 256;
const MAX_PROMPT = PROMPTS[PROMPTS.length - 1] ?? 2048;
const MAX_ROW_MS = Math.max(memoryMs(MAX_BATCH), computeMs(MAX_BATCH, MAX_PROMPT));
const CEILING = 1000 / PER_SEQUENCE_MS;

const BAR_W = 320;
const BAR_X0 = 8;
const BAR_X1 = 312;
const BAR_H = 22;
const MEMORY_Y = 34;
const COMPUTE_Y = 80;

const CHART_W = 320;
const CHART_H = 170;
const PLOT_X0 = 44;
const PLOT_X1 = 310;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 140;
const Y_MAX = 7000;
const curveBatches = Array.from({ length: 65 }, (_, index) => Math.max(1, index * 4));

const whole = (value: number) => Math.round(value).toLocaleString('en-US');
const ms = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ms`;
const cx = (batch: number) => PLOT_X0 + ((PLOT_X1 - PLOT_X0) * batch) / MAX_BATCH;
const cy = (tokensPerSecond: number) => PLOT_BOTTOM - ((PLOT_BOTTOM - PLOT_TOP) * tokensPerSecond) / Y_MAX;
const curvePath = curveBatches
  .map(
    (batch, index) =>
      `${index === 0 ? 'M' : 'L'}${cx(batch).toFixed(1)},${cy(batchPoint(batch).tokensPerSecond).toFixed(1)}`,
  )
  .join(' ');

export default function ServingCostWidget({
  title = 'What one step costs (toy model)',
  instructions = `Every step reads all the model weights once and does math for every token in it. The two overlap, so the slower one sets the step. Pick how many requests decode together and how big a prompt shares the step: up to about ${RIDGE_TOKENS} tokens of math hide under the weight read.`,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const hatchId = `${safeId(useId(), 'serve-cost')}-hatch`;
  const [batch, setBatch] = useState<number>(32);
  const [prompt, setPrompt] = useState<Prompt>(0);

  const memory = memoryMs(batch);
  const compute = computeMs(batch, prompt);
  const kvMs = memory - WEIGHT_READ_MS;
  const decodeMathMs = batch / TOKENS_PER_MS;
  const promptMathMs = prompt / TOKENS_PER_MS;
  const total = stepMs(batch, prompt);
  const computeBound = compute > memory;
  const bound = computeBound ? 'compute bound' : 'memory bound';
  const decodeRate = (batch * 1000) / total;
  const single = batchPoint(1);
  const point = batchPoint(batch);
  const move = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 160, damping: 22 };

  const scale = (value: number) => ((BAR_X1 - BAR_X0) * value) / MAX_ROW_MS;
  const place = (y: number, segments: { key: string; value: number; className: string }[]) => {
    let cursor = BAR_X0;
    return segments.map((segment) => {
      const x = cursor;
      const width = scale(segment.value);
      cursor += width;
      return { ...segment, x, y, width };
    });
  };
  const placed = [
    ...place(MEMORY_Y, [
      { key: 'weights', value: WEIGHT_READ_MS, className: 'sdv-serve-cost__seg--weights' },
      { key: 'kv', value: kvMs, className: 'sdv-serve-cost__seg--decode' },
    ]),
    ...place(COMPUTE_Y, [
      { key: 'decode-math', value: decodeMathMs, className: 'sdv-serve-cost__seg--decode' },
      { key: 'prompt-math', value: promptMathMs, className: 'sdv-serve-cost__seg--prefill' },
    ]),
  ];
  const memoryEnd = BAR_X0 + scale(memory);

  const promptWords = prompt > 0 ? ` and a ${prompt.toLocaleString('en-US')} token prompt` : '';
  const summary = `Toy model. ${batch} requests decoding${promptWords}: memory takes ${ms(memory)} and compute takes ${ms(compute)}, so the step is ${bound} and takes ${ms(STEP_OVERHEAD_MS)} of overhead plus ${ms(Math.max(memory, compute))}, ${ms(total)} in all. Each request gets a token every ${ms(total)}, and the server makes ${whole(decodeRate)} decode tokens per second.`;

  let note: string | undefined;
  if (computeBound) note = 'the prompt stalls every decoder';
  else if (prompt > 0) note = 'the prompt hides under the weight read';

  const stats: StatRow[] = [
    {
      label: 'Step time',
      value: ms(total),
      detail: `${STEP_OVERHEAD_MS} + max(memory ${ms(memory)}, compute ${ms(compute)})`,
    },
    {
      label: 'Slower resource',
      value: computeBound ? 'Compute: the math' : 'Memory: the reads',
      detail: `${(batch + prompt).toLocaleString('en-US')} tokens of math at ${TOKENS_PER_MS} per ms`,
    },
    {
      label: 'Decode tokens per second, whole server',
      value: whole(decodeRate),
      detail: `${batch} tokens every ${ms(total)}`,
    },
    {
      label: 'Tokens per second, each request',
      value: whole(1000 / total),
      detail: 'one token per step',
    },
    {
      label: 'Against batch 1 with no prompt',
      value: `${(total / single.stepMs).toFixed(1)}× step time, ${(decodeRate / single.tokensPerSecond).toFixed(1)}× throughput`,
      tone: computeBound ? 'warn' : 'neutral',
      note,
    },
  ];

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      stats={stats}
      statsCaption={`Toy model. Step time = ${STEP_OVERHEAD_MS} ms overhead + the slower of memory (${WEIGHT_READ_MS} ms weight read + ${PER_SEQUENCE_MS} ms per decoding request) and compute (every token at ${TOKENS_PER_MS} per ms). Every number is illustrative.`}
      controls={
        <>
          <Segmented
            label="Requests decoding together"
            value={`${batch}` as BatchValue}
            options={batchOptions}
            onChange={(value) => setBatch(Number(value))}
          />
          <Segmented
            label="Prompt in the same step"
            value={`${prompt}` as PromptValue}
            options={promptOptions}
            onChange={(value) => setPrompt(Number(value) as Prompt)}
          />
        </>
      }
    >
      <MotionRoot>
        <DiagramScroll label="Step time bars and throughput curve, scrollable">
          <div className="sdv-serve-cost__stage">
            <svg
              className="sdv-serve-svg sdv-serve-cost__bar"
              viewBox={`0 0 ${BAR_W} 128`}
              role="img"
              aria-label={`One step takes ${ms(total)} and is ${bound}. Memory row: weights ${ms(WEIGHT_READ_MS)} plus KV reads ${ms(kvMs)}. Compute row: decode tokens ${ms(decodeMathMs)} plus prompt tokens ${ms(promptMathMs)}. Both rows span 0 to ${ms(MAX_ROW_MS)}.`}
            >
              <defs>
                <pattern
                  id={hatchId}
                  width="5"
                  height="5"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="5" height="5" className="sdv-serve-cost__prefill-bg" />
                  <line x1="0" y1="0" x2="0" y2="5" className="sdv-serve-cost__hatch" />
                </pattern>
              </defs>
              <text x={BAR_X0} y={12} className="sdv-serve-svg__label">
                One step: {ms(total)}, {bound}
              </text>
              <text x={BAR_X0} y={MEMORY_Y - 5}>
                Memory: {ms(memory)}
              </text>
              <text x={BAR_X0} y={COMPUTE_Y - 5}>
                Compute: {ms(compute)}
              </text>
              <text x={BAR_X1} y={MEMORY_Y - 5} textAnchor="end" className="sdv-serve-svg__muted">
                rows span 0 to {ms(MAX_ROW_MS)}
              </text>
              {[MEMORY_Y, COMPUTE_Y].map((y) => (
                <rect
                  key={y}
                  x={BAR_X0}
                  y={y}
                  width={BAR_X1 - BAR_X0}
                  height={BAR_H}
                  rx={4}
                  className="sdv-serve-cost__track"
                />
              ))}
              {placed.map((segment) => (
                <m.rect
                  key={segment.key}
                  y={segment.y}
                  height={BAR_H}
                  initial={false}
                  animate={{ x: segment.x, width: segment.width }}
                  transition={move}
                  fill={segment.key === 'prompt-math' ? `url(#${hatchId})` : undefined}
                  className={`sdv-serve-cost__seg ${segment.className}`}
                />
              ))}
              {[
                [MEMORY_Y - 2, COMPUTE_Y - 18],
                [COMPUTE_Y - 2, COMPUTE_Y + BAR_H + 2],
              ].map(([y1, y2]) => (
                <m.line
                  key={y1}
                  y1={y1}
                  y2={y2}
                  initial={false}
                  animate={{ x1: memoryEnd, x2: memoryEnd }}
                  transition={move}
                  className="sdv-serve-cost__ceiling"
                />
              ))}
              <text x={BAR_X0} y={COMPUTE_Y + BAR_H + 18} className="sdv-serve-svg__muted">
                step = {STEP_OVERHEAD_MS} ms overhead + the longer row
              </text>
            </svg>
            <svg
              className="sdv-serve-svg sdv-serve-cost__chart"
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              role="img"
              aria-label={`Toy model decode throughput against batch size with no prompt. Batch 1 makes ${whole(single.tokensPerSecond)} tokens per second, batch ${batch} makes ${whole(point.tokensPerSecond)}, and the curve flattens toward a ceiling of ${whole(CEILING)} that it never reaches.`}
            >
              {[0, 2000, 4000, 6000].map((tick) => (
                <g key={tick}>
                  <line
                    x1={PLOT_X0}
                    x2={PLOT_X1}
                    y1={cy(tick)}
                    y2={cy(tick)}
                    className="sdv-serve-cost__grid"
                  />
                  <text x={PLOT_X0 - 4} y={cy(tick) + 4} textAnchor="end" className="sdv-serve-svg__muted">
                    {tick.toLocaleString('en-US')}
                  </text>
                </g>
              ))}
              <line
                x1={PLOT_X0}
                x2={PLOT_X1}
                y1={cy(CEILING)}
                y2={cy(CEILING)}
                className="sdv-serve-cost__ceiling"
              />
              <text x={PLOT_X1} y={cy(CEILING) - 4} textAnchor="end" className="sdv-serve-svg__muted">
                ceiling {whole(CEILING)} tok/s
              </text>
              <path d={curvePath} className="sdv-serve-cost__curve" />
              <m.circle
                r={5}
                initial={false}
                animate={{ cx: cx(batch), cy: cy(point.tokensPerSecond) }}
                transition={move}
                className="sdv-serve-cost__dot"
              />
              <text x={PLOT_X0} y={PLOT_BOTTOM + 16} className="sdv-serve-svg__muted">
                1
              </text>
              <text x={PLOT_X1} y={PLOT_BOTTOM + 16} textAnchor="end" className="sdv-serve-svg__muted">
                {MAX_BATCH}
              </text>
              <text
                x={(PLOT_X0 + PLOT_X1) / 2}
                y={PLOT_BOTTOM + 16}
                textAnchor="middle"
                className="sdv-serve-svg__muted"
              >
                requests decoding together
              </text>
              <text x={PLOT_X0 + 4} y={PLOT_TOP + 4} className="sdv-serve-svg__muted">
                decode tok/s, no prompt
              </text>
            </svg>
          </div>
        </DiagramScroll>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the step bars">
        <li>
          <span className="sdv-serve-swatch sdv-serve-cost__key--weights" aria-hidden="true" /> Weights: read
          once per step
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-cost__key--decode" aria-hidden="true" /> Decode: a KV
          read and one token of math per request
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-cost__key--prefill" aria-hidden="true" /> Hatched:
          prompt tokens, math only
        </li>
        <li>dashed line: where the reads end; math left of it is free</li>
        <li>toy model, illustrative ms</li>
      </ul>
    </WidgetFrame>
  );
}
