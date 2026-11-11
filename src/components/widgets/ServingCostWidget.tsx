import { m } from 'motion/react';
import { useId, useState } from 'react';
import {
  batchPoint,
  PER_PROMPT_TOKEN_MS,
  PER_SEQUENCE_MS,
  SWEEP_BATCHES,
  stepMs,
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

const PROMPTS = [0, 512, 2048] as const;
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
const MAX_PROMPT = 2048;
const MAX_STEP_MS = stepMs(MAX_BATCH, MAX_PROMPT);
const CEILING = 1000 / PER_SEQUENCE_MS;

const BAR_W = 320;
const BAR_X0 = 8;
const BAR_X1 = 312;
const BAR_Y = 20;
const BAR_H = 26;

const CHART_W = 320;
const CHART_H = 170;
const PLOT_X0 = 44;
const PLOT_X1 = 310;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 140;
const Y_MAX = 7000;
const curveBatches = Array.from({ length: 65 }, (_, index) => Math.max(1, index * 4));

const whole = (value: number) => Math.round(value).toLocaleString('en-US');
const ms = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ms`;
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
  instructions = 'Every step reads all the model weights once, then does a little work per decoding request and a lot of work per prompt token. Pick how many requests decode together and how big a prompt shares the step.',
}: Props) {
  const reduced = usePrefersReducedMotion();
  const hatchId = `${safeId(useId(), 'serve-cost')}-hatch`;
  const [batch, setBatch] = useState<number>(32);
  const [prompt, setPrompt] = useState<Prompt>(0);

  const weightMs = WEIGHT_READ_MS;
  const decodeMs = PER_SEQUENCE_MS * batch;
  const prefillMs = PER_PROMPT_TOKEN_MS * prompt;
  const total = stepMs(batch, prompt);
  const decodeRate = (batch * 1000) / total;
  const single = batchPoint(1);
  const point = batchPoint(batch);
  const move = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 160, damping: 22 };

  const scale = (value: number) => ((BAR_X1 - BAR_X0) * value) / MAX_STEP_MS;
  const segments = [
    { key: 'weights', label: 'weights', value: weightMs, className: 'sdv-serve-cost__seg--weights' },
    { key: 'decode', label: 'decode', value: decodeMs, className: 'sdv-serve-cost__seg--decode' },
    { key: 'prefill', label: 'prompt', value: prefillMs, className: 'sdv-serve-cost__seg--prefill' },
  ];
  let cursor = BAR_X0;
  const placed = segments.map((segment) => {
    const x = cursor;
    const width = scale(segment.value);
    cursor += width;
    return { ...segment, x, width };
  });

  const summary = `Toy model. ${batch} requests decoding${prompt > 0 ? ` and a ${prompt.toLocaleString('en-US')} token prompt` : ''}: one step takes ${ms(total)} (weights ${ms(weightMs)}, decode ${ms(decodeMs)}, prompt ${ms(prefillMs)}). Each request gets a token every ${ms(total)}, and the server makes ${whole(decodeRate)} decode tokens per second.`;

  const stats: StatRow[] = [
    {
      label: 'Step time',
      value: ms(total),
      detail: `${WEIGHT_READ_MS} + ${PER_SEQUENCE_MS} × ${batch} + ${PER_PROMPT_TOKEN_MS} × ${prompt.toLocaleString('en-US')}`,
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
      tone: prompt > 0 ? 'warn' : 'neutral',
      note: prompt > 0 ? 'the prompt stalls every decoder' : undefined,
    },
  ];

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      stats={stats}
      statsCaption="Toy model. Step time = fixed weight read + per decoding request + per prompt token. Every number is illustrative."
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
        <DiagramScroll label="Step time bar and throughput curve, scrollable">
          <div className="sdv-serve-cost__stage">
            <svg
              className="sdv-serve-svg sdv-serve-cost__bar"
              viewBox={`0 0 ${BAR_W} 78`}
              role="img"
              aria-label={`One step takes ${ms(total)}: weights ${ms(weightMs)}, decode ${ms(decodeMs)}, prompt ${ms(prefillMs)}. The bar spans 0 to ${ms(MAX_STEP_MS)}.`}
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
                One step: {ms(total)}
              </text>
              <text x={BAR_X1} y={12} textAnchor="end" className="sdv-serve-svg__muted">
                bar spans 0 to {ms(MAX_STEP_MS)}
              </text>
              <rect
                x={BAR_X0}
                y={BAR_Y}
                width={BAR_X1 - BAR_X0}
                height={BAR_H}
                rx={4}
                className="sdv-serve-cost__track"
              />
              {placed.map((segment) => (
                <m.rect
                  key={segment.key}
                  y={BAR_Y}
                  height={BAR_H}
                  initial={false}
                  animate={{ x: segment.x, width: segment.width }}
                  transition={move}
                  fill={segment.key === 'prefill' ? `url(#${hatchId})` : undefined}
                  className={`sdv-serve-cost__seg ${segment.className}`}
                />
              ))}
              <text x={BAR_X0} y={64} className="sdv-serve-svg__muted">
                weights {ms(weightMs)}, decode {ms(decodeMs)}, prompt {ms(prefillMs)}
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
      <ul className="sdv-legend" aria-label="How to read the step bar">
        <li>
          <span className="sdv-serve-swatch sdv-serve-cost__key--weights" aria-hidden="true" /> Weights: read
          once per step
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-cost__key--decode" aria-hidden="true" /> Decode: one
          token per request
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-cost__key--prefill" aria-hidden="true" /> Hatched:
          prompt tokens
        </li>
        <li>toy model, illustrative ms</li>
      </ul>
    </WidgetFrame>
  );
}
