import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import {
  BATCH_SLOTS,
  type BatchScenarioId,
  batchScenarios,
  createBatchDuel,
  formatMs,
  joinIds,
  type ServeDuel,
  type ServeLane,
  type SlotCell,
  summarizeLane,
} from '../../lib/models/llmServing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import type { SeriesVariant } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { safeId } from '../viz/SystemNode';
import { duelStatus, EventLog, LanePane, laneVariants, SkipButton, toyNote } from './ServingParts';
import './ServingBatchWidget.css';

interface Props {
  title?: string;
  instructions?: string;
}

const scenarioIds: BatchScenarioId[] = ['mixed', 'uniform', 'burst'];
const WINDOW = 16;
const COL = 13;
const ROW = 26;
const GRID_X = 46;
const HEAD = 18;
const WIDTH = 330;
const HEIGHT = HEAD + BATCH_SLOTS * ROW + 4;
const SIDE_X = GRID_X + WINDOW * COL + 8;
const slotKeys = Array.from({ length: BATCH_SLOTS }, (_, slot) => `slot-${slot + 1}`);

const kindWords: Record<SlotCell['kind'], string> = {
  prefill: 'prefill',
  decode: 'decode',
  held: 'held idle',
  empty: 'free',
};

function cellWords(cell: SlotCell | undefined, lane: ServeLane): string {
  if (!cell) return 'free';
  if (cell.request === null) return kindWords[cell.kind];
  const id = lane.requests[cell.request]?.id ?? '';
  if (cell.kind === 'empty') return `${id} waiting for prefill`;
  return `${id} ${kindWords[cell.kind]}`;
}

function SlotGrid({ lane, variant }: { lane: ServeLane; variant: SeriesVariant }) {
  const reduced = usePrefersReducedMotion();
  const uid = safeId(useId(), 'serve-grid');
  const hatchId = `${uid}-hatch`;
  const clipId = `${uid}-clip`;
  const shown = lane.history.slice(-WINDOW);
  const offset = WINDOW - shown.length;
  const last = lane.history.at(-1);
  const slide = reduced ? { duration: 0 } : { duration: 0.16 };
  const nowWords = Array.from({ length: BATCH_SLOTS }, (_, slot) => cellWords(last?.slots[slot], lane));
  const label = last
    ? `Batch slots for the last ${shown.length} steps. Now: ${nowWords.map((words, slot) => `slot ${slot + 1} ${words}`).join(', ')}.`
    : 'Batch slots, empty until the first step.';

  return (
    <svg
      className="sdv-serve-svg sdv-serve-grid"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <pattern
          id={hatchId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" className="sdv-serve-grid__held-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="sdv-serve-grid__hatch" />
        </pattern>
        <clipPath id={clipId}>
          <rect x={GRID_X} y={HEAD} width={WINDOW * COL} height={BATCH_SLOTS * ROW} />
        </clipPath>
      </defs>
      <text x={GRID_X} y={12} className="sdv-serve-svg__muted">
        older
      </text>
      <text x={GRID_X + WINDOW * COL} y={12} textAnchor="end" className="sdv-serve-svg__muted">
        newest step
      </text>
      <text x={SIDE_X} y={12} className="sdv-serve-svg__muted">
        now
      </text>
      {slotKeys.map((slotKey, slot) => {
        const y = HEAD + slot * ROW;
        const cell = last?.slots[slot];
        const id =
          cell?.request !== null && cell?.request !== undefined ? lane.requests[cell.request]?.id : null;
        return (
          <g key={slotKey}>
            <text x={0} y={y + 17} className="sdv-serve-svg__label">
              Slot {slot + 1}
            </text>
            <rect
              x={GRID_X}
              y={y + 2}
              width={WINDOW * COL}
              height={ROW - 4}
              rx={3}
              className="sdv-serve-grid__lane-bg"
            />
            <text x={SIDE_X} y={y + 12} className="sdv-serve-svg__label">
              {id ?? '\u00a0'}
            </text>
            <text x={SIDE_X} y={y + 23} className="sdv-serve-svg__muted">
              {cell ? kindWords[cell.kind] : 'free'}
            </text>
          </g>
        );
      })}
      <g clipPath={`url(#${clipId})`}>
        {shown.map((record, col) => (
          <m.g
            key={record.step}
            initial={false}
            animate={{ x: GRID_X + (offset + col) * COL }}
            transition={slide}
          >
            <m.g initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={slide}>
              {slotKeys.map((slotKey, slot) => {
                const cell = record.slots[slot];
                const y = HEAD + slot * ROW + 3;
                if (cell?.kind === 'prefill') {
                  return (
                    <rect
                      key={slotKey}
                      x={1}
                      y={y}
                      width={COL - 2}
                      height={ROW - 6}
                      rx={2}
                      className="sdv-serve-grid__prefill"
                    />
                  );
                }
                if (cell?.kind === 'decode') {
                  return (
                    <circle
                      key={slotKey}
                      cx={COL / 2}
                      cy={y + (ROW - 6) / 2}
                      r={4}
                      className={`sdv-serve-grid__token sdv-serve-grid__token--${variant}`}
                    />
                  );
                }
                if (cell?.kind === 'held') {
                  return (
                    <rect
                      key={slotKey}
                      x={1}
                      y={y}
                      width={COL - 2}
                      height={ROW - 6}
                      rx={2}
                      fill={`url(#${hatchId})`}
                      className="sdv-serve-grid__held"
                    />
                  );
                }
                return null;
              })}
            </m.g>
          </m.g>
        ))}
      </g>
    </svg>
  );
}

function LaneView({ lane, variant }: { lane: ServeLane; variant: SeriesVariant }) {
  const waitingIds = lane.waiting.map((seq) => seq.req.id);
  const finished = lane.results.length;
  return (
    <LanePane label={lane.config.label} variant={variant}>
      <SlotGrid lane={lane} variant={variant} />
      <p className="sdv-serve-meta">
        Step <strong>{lane.history.length}</strong>, clock <strong>{formatMs(lane.clockMs)}</strong>. Finished{' '}
        <strong>
          {finished} of {lane.requests.length}
        </strong>
        .
      </p>
      <p className="sdv-serve-meta">
        Waiting:{' '}
        <strong>{waitingIds.length > 0 ? `${joinIds(waitingIds)} (${waitingIds.length})` : 'nobody'}</strong>
      </p>
    </LanePane>
  );
}

export default function ServingBatchWidget({
  title = 'Static batching against continuous batching',
  instructions = 'Both servers get the same seeded requests and four batch slots. Press Play or Step, and watch the hatched slots: a finished request still holds its slot until the longest request in its batch is done. Switch scenarios to see when the gap closes.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<BatchScenarioId>('mixed');
  const runRef = useRef<ServeDuel | null>(null);
  if (!runRef.current) runRef.current = createBatchDuel(scenarioId);
  const duel = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: BatchScenarioId) => {
    runRef.current = createBatchDuel(id);
    rerender();
  };
  const chooseScenario = (id: BatchScenarioId) => {
    setScenarioId(id);
    restart(id);
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeLane(first), summarizeLane(second)] as const;
  const done = duel.done;
  const latency = (value: number) => formatMs(value);
  const anyFinished = sums[0].finished > 0 && sums[1].finished > 0;
  const rows: CompareRow[] = [
    { label: 'Requests (same for both)', values: [sums[0].total, sums[1].total] },
    { label: 'Finished', values: [sums[0].finished, sums[1].finished] },
    {
      label: 'Time to first token, median',
      values: [sums[0].ttftP50, sums[1].ttftP50],
      format: latency,
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Time to first token, p95',
      values: [sums[0].ttftP95, sums[1].ttftP95],
      format: latency,
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Time per output token, mean',
      values: [sums[0].tpotMean, sums[1].tpotMean],
      format: (value) => `${value.toFixed(2)} ms`,
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Tokens per step',
      values: [sums[0].tokensPerStep, sums[1].tokensPerStep],
      format: (value) => value.toFixed(2),
      better: done ? 'higher' : undefined,
    },
    {
      label: 'Tokens per second',
      values: [sums[0].tokensPerSecond, sums[1].tokensPerSecond],
      format: (value) => Math.round(value).toLocaleString('en-US'),
      better: done ? 'higher' : undefined,
    },
    {
      label: 'Idle slot steps while requests wait',
      values: [sums[0].idleWhileWaiting, sums[1].idleWhileWaiting],
      better: done ? 'lower' : undefined,
    },
  ];

  const laneWords = (index: 0 | 1) => {
    const sum = sums[index];
    const ttft =
      sum.finished > 0 ? `median time to first token ${formatMs(sum.ttftP50)}` : 'no request finished yet';
    return `${sum.label}: step ${sum.steps}, ${sum.finished} of ${sum.total} finished, ${ttft}, ${sum.idleWhileWaiting} idle slot steps while requests wait`;
  };
  const summary = `${batchScenarios[scenarioId].label}. ${laneWords(0)}. ${laneWords(1)}.`;

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={duelStatus(duel)}
      finished={done}
      resetKey={scenarioId}
      ticksPerSecond={6}
      controls={<SkipButton onSkip={skipToEnd} disabled={!hydrated || done} />}
      readout={
        <CompareTable
          caption={
            done
              ? 'Whole run, toy model, illustrative ms'
              : anyFinished
                ? 'So far, finished requests only (toy model, illustrative ms)'
                : 'So far (toy model, illustrative ms)'
          }
          columns={[first.config.label, second.config.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarioIds.map((id) => ({
          value: id,
          label: batchScenarios[id].label,
          diff: batchScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-duel__lanes sdv-serve-lanes sdv-serve-batch__lanes">
          {duel.lanes.map((lane, index) => (
            <LaneView key={lane.config.label} lane={lane} variant={laneVariants[index] ?? 'a'} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the batch slots">
        <li>
          <span className="sdv-serve-swatch sdv-serve-batch__key--prefill" aria-hidden="true" /> Prefill: the
          whole prompt in one step
        </li>
        <li>
          <span className="sdv-serve-batch__key--token" aria-hidden="true" /> Decode: one token for that
          request
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-batch__key--held" aria-hidden="true" /> Held: finished,
          slot idle until the batch ends
        </li>
        <li>
          <span className="sdv-serve-swatch" aria-hidden="true" /> Blank: free slot
        </li>
        <li>{toyNote}</li>
      </ul>
      <EventLog
        duel={duel}
        tags={['Static', 'Continuous']}
        kinds={['batch', 'held', 'join']}
        empty="Press Play or Step. Batch starts, held slots, and joins appear here."
      />
    </SimulationShell>
  );
}
