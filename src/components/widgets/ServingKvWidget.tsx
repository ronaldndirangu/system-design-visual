import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import {
  BLOCK_TOKENS,
  type BlockCell,
  createKvDuel,
  formatMs,
  joinIds,
  KV_BLOCKS,
  KV_SEQS,
  type KvScenarioId,
  kvScenarios,
  RESERVE_TOKENS,
  type ServeDuel,
  type ServeLane,
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
import './ServingKvWidget.css';

interface Props {
  title?: string;
  instructions?: string;
}

const scenarioIds: KvScenarioId[] = ['chat', 'squeeze'];
const COLS = 12;
const CELL = 23;
const GAP = 3;
const ROWS = Math.ceil(KV_BLOCKS / COLS);
const WIDTH = COLS * CELL + (COLS - 1) * GAP;
const HEIGHT = ROWS * CELL + (ROWS - 1) * GAP;
const blockKeys = Array.from({ length: KV_BLOCKS }, (_, block) => `block-${block + 1}`);

interface PoolCounts {
  used: number;
  free: number;
  stored: number;
  emptyReserved: number;
}

function countPool(cells: BlockCell[]): PoolCounts {
  let used = 0;
  let stored = 0;
  let emptyReserved = 0;
  for (const cell of cells) {
    if (cell.owner === null) continue;
    used += 1;
    stored += cell.tokens;
    if (cell.tokens === 0) emptyReserved += 1;
  }
  return { used, free: cells.length - used, stored, emptyReserved };
}

function BlockPool({ lane, cells, counts }: { lane: ServeLane; cells: BlockCell[]; counts: PoolCounts }) {
  const reduced = usePrefersReducedMotion();
  const hatchId = `${safeId(useId(), 'serve-kv')}-hatch`;
  const grow = reduced ? { duration: 0 } : { duration: 0.18 };
  const label = `Block pool for ${lane.config.label}: ${counts.used} of ${KV_BLOCKS} blocks in use, ${counts.free} free. They hold ${counts.stored} token states in ${counts.used * BLOCK_TOKENS} slots. ${counts.emptyReserved} blocks are reserved and still empty.`;

  return (
    <svg
      className="sdv-serve-svg sdv-serve-kv__pool"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <pattern
          id={hatchId}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="5" className="sdv-serve-kv__hatch" />
        </pattern>
      </defs>
      {blockKeys.map((blockKey, block) => {
        const cell = cells[block];
        const x = (block % COLS) * (CELL + GAP);
        const y = Math.floor(block / COLS) * (CELL + GAP);
        if (!cell || cell.owner === null) {
          return (
            <rect
              key={blockKey}
              x={x + 0.5}
              y={y + 0.5}
              width={CELL - 1}
              height={CELL - 1}
              rx={3}
              className="sdv-serve-kv__free"
            />
          );
        }
        const filled = (CELL * cell.tokens) / BLOCK_TOKENS;
        const owner = lane.requests[cell.owner]?.id ?? '';
        return (
          <g key={blockKey}>
            <rect
              x={x + 0.5}
              y={y + 0.5}
              width={CELL - 1}
              height={CELL - 1}
              rx={3}
              fill={`url(#${hatchId})`}
              className="sdv-serve-kv__owned"
            />
            <m.rect
              x={x + 0.5}
              width={CELL - 1}
              rx={2}
              initial={false}
              animate={{ y: y + CELL - filled, height: filled }}
              transition={grow}
              className="sdv-serve-kv__fill"
            />
            <text x={x + CELL / 2} y={y + 15} textAnchor="middle" className="sdv-serve-kv__owner">
              {owner}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LaneView({ lane, variant }: { lane: ServeLane; variant: SeriesVariant }) {
  const cells = lane.blockMap();
  const counts = countPool(cells);
  const runningIds = lane.running.map((seq) => seq.req.id);
  const waitingIds = lane.waiting.map((seq) =>
    seq.generated > 0 ? `${seq.req.id} (preempted)` : seq.req.id,
  );
  return (
    <LanePane label={lane.config.label} variant={variant}>
      <BlockPool lane={lane} cells={cells} counts={counts} />
      <p className="sdv-serve-meta">
        Blocks used <strong>{counts.used}</strong> + free <strong>{counts.free}</strong> ={' '}
        <strong>{KV_BLOCKS}</strong>. Slots holding tokens:{' '}
        <strong>
          {counts.stored} of {counts.used * BLOCK_TOKENS}
        </strong>
        .
      </p>
      <p className="sdv-serve-meta">
        Running{' '}
        <strong>
          {runningIds.length} of {KV_SEQS}
        </strong>
        : {runningIds.length > 0 ? joinIds(runningIds) : 'nobody'}.
      </p>
      <p className="sdv-serve-meta">
        Waiting: <strong>{waitingIds.length > 0 ? joinIds(waitingIds) : 'nobody'}</strong>. Clock{' '}
        <strong>{formatMs(lane.clockMs)}</strong>.
      </p>
    </LanePane>
  );
}

export default function ServingKvWidget({
  title = 'Reserving the maximum against paged blocks',
  instructions = `Each square is one KV cache block of ${BLOCK_TOKENS} token slots, ${KV_BLOCKS} in all. The left server reserves room for the prompt plus a ${RESERVE_TOKENS} token answer before it admits a request. The right server takes the prompt blocks only and adds blocks as tokens arrive. Press Play or Step and compare who gets a seat.`,
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<KvScenarioId>('chat');
  const runRef = useRef<ServeDuel | null>(null);
  if (!runRef.current) runRef.current = createKvDuel(scenarioId);
  const duel = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: KvScenarioId) => {
    runRef.current = createKvDuel(id);
    rerender();
  };
  const chooseScenario = (id: KvScenarioId) => {
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
      label: 'Tokens per second',
      values: [sums[0].tokensPerSecond, sums[1].tokensPerSecond],
      format: (value) => Math.round(value).toLocaleString('en-US'),
      better: done ? 'higher' : undefined,
    },
    {
      label: 'Requests running, peak',
      values: [sums[0].peakRunning, sums[1].peakRunning],
      better: done ? 'higher' : undefined,
    },
    {
      label: 'Requests running, mean',
      values: [sums[0].meanRunning, sums[1].meanRunning],
      format: (value) => value.toFixed(2),
      better: done ? 'higher' : undefined,
    },
    {
      label: 'Allocated slots holding tokens',
      values: [sums[0].tokenShare, sums[1].tokenShare],
      format: (value) => `${(value * 100).toFixed(1)}%`,
      better: done ? 'higher' : undefined,
    },
    {
      label: 'Preemptions',
      values: [sums[0].preemptions, sums[1].preemptions],
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Tokens recomputed after preemption',
      values: [sums[0].recomputedTokens, sums[1].recomputedTokens],
      better: done ? 'lower' : undefined,
    },
    {
      label: 'Idle seats while requests wait (seat steps)',
      values: [sums[0].idleWhileWaiting, sums[1].idleWhileWaiting],
      better: done ? 'lower' : undefined,
    },
  ];

  const laneWords = (index: 0 | 1) => {
    const sum = sums[index];
    const lane = duel.lanes[index];
    const ttft =
      sum.finished > 0 ? `median time to first token ${formatMs(sum.ttftP50)}` : 'no request finished yet';
    return `${sum.label}: ${lane.usedBlocks} of ${KV_BLOCKS} blocks used, ${sum.running} running, ${sum.waiting} waiting, ${sum.finished} of ${sum.total} finished, ${ttft}, ${sum.preemptions} preemptions`;
  };
  const summary = `${kvScenarios[scenarioId].label}. ${laneWords(0)}. ${laneWords(1)}.`;

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
      ticksPerSecond={8}
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
          label: kvScenarios[id].label,
          diff: kvScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-duel__lanes sdv-serve-lanes">
          {duel.lanes.map((lane, index) => (
            <LaneView key={lane.config.label} lane={lane} variant={laneVariants[index] ?? 'a'} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the block pool">
        <li>
          <span className="sdv-serve-swatch sdv-serve-kv__key--fill" aria-hidden="true" /> Filled: token
          states stored (height shows how full)
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-kv__key--reserved" aria-hidden="true" /> Hatched: owned
          but still empty
        </li>
        <li>
          <span className="sdv-serve-swatch sdv-serve-kv__key--free" aria-hidden="true" /> Dashed: free block
        </li>
        <li>{toyNote}</li>
      </ul>
      <EventLog
        duel={duel}
        tags={['Reserve', 'Paged']}
        kinds={['wait', 'join', 'preempt', 'rejoin', 'resume']}
        empty="Press Play or Step. Admissions, waits, and preemptions appear here."
      />
    </SimulationShell>
  );
}
