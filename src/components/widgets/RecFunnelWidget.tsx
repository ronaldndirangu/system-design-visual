import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import {
  CATALOG_SIZE,
  count,
  crowdDotCount,
  crowdDots,
  dropLabels,
  type FunnelResult,
  finishedResults,
  formatMs,
  isKnownGood,
  items,
  REC_BUDGET_MS,
  RELEVANT_TOTAL,
  RecRun,
  type RecScenarioId,
  recScenarioIds,
  recScenarios,
  request,
  SHOWN,
  type StageId,
  type StageResult,
  sourceInfo,
  stageInfo,
  stageOrder,
} from '../../lib/models/recFunnel';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { safeId } from '../viz/SystemNode';
import './RecFunnelWidget.css';

interface Props {
  initial?: RecScenarioId;
  title?: string;
  instructions?: string;
}

const allResults = finishedResults();
const fixtureOrder = new Map(items.map((item, index) => [item.id, index]));
const itemLookup = new Map(items.map((item) => [item.id, item]));
const allIds = items.map((item) => item.id);
const knownGood = items.filter(isKnownGood);

const COL_X = [56, 188, 320, 452, 584] as const;
const BAND_W = 70;
const MID_Y = 118;
const NAME_Y = 226;
const DOT_Y = 244;
const DOT_GAP = 12;
const DOTS_PER_ROW = 6;
const LOG_MAX = Math.log10(CATALOG_SIZE);
const bandHeight = (n: number) => 24 + (156 * Math.log10(Math.max(n, 1))) / LOG_MAX;
const columnNames = ['Catalog', ...stageOrder.map((id) => stageInfo[id].column)];

const LAT_LEFT = 96;
const LAT_RIGHT = 560;
const LAT_MAX = 60;
const latX = (ms: number) => LAT_LEFT + (Math.min(ms, LAT_MAX) / LAT_MAX) * (LAT_RIGHT - LAT_LEFT);

const percent = (value: number) => `${Math.round(value * 100)}%`;
const nameOf = (id: string) => itemLookup.get(id)?.name ?? id;
const inFixtureOrder = (ids: string[]) =>
  [...ids].sort((a, b) => (fixtureOrder.get(a) ?? 0) - (fixtureOrder.get(b) ?? 0));

interface Column {
  name: string;
  revealed: boolean;
  count: number;
  anonymous: number;
  dots: string[];
  dropped: Set<string>;
  stage?: StageResult;
}

function buildColumns(run: RecRun): Column[] {
  const catalog: Column = {
    name: 'Catalog',
    revealed: true,
    count: CATALOG_SIZE,
    anonymous: CATALOG_SIZE - allIds.length,
    dots: [],
    dropped: new Set(),
  };
  const rest = run.result.stages.map((stage, index): Column => {
    const revealed = index < run.ticks;
    return {
      name: columnNames[index + 1] ?? '',
      revealed,
      count: stage.passed,
      anonymous: Math.max(0, stage.passed - stage.namedPassed.length),
      dots: revealed ? inFixtureOrder(stage.namedIn) : [],
      dropped: new Set(stage.namedDropped.map((drop) => drop.id)),
      stage,
    };
  });
  return [catalog, ...rest];
}

function fate(run: RecRun, id: string): { tone: Tone; text: string } {
  for (const stage of run.stages) {
    const drop = stage.namedDropped.find((entry) => entry.id === id);
    if (!drop) continue;
    const tone: Tone = drop.reason === 'missed' ? 'bad' : drop.reason === 'belowRanker' ? 'warn' : 'neutral';
    return { tone, text: dropLabels[drop.reason] };
  }
  if (run.done && run.result.shown.includes(id)) return { tone: 'ok', text: 'Shown' };
  return { tone: 'neutral', text: run.ticks === 0 ? 'Waiting' : 'Still in' };
}

function runVerdict(result: FunnelResult): { tone: Tone; text: string } {
  if (result.overBudget) return { tone: 'bad', text: `Over budget: ${formatMs(result.totalMs)}` };
  if (result.goodShown < SHOWN)
    return { tone: 'warn', text: `Fast, but ${result.goodShown} of ${SHOWN} good` };
  return { tone: 'ok', text: `Fits ${REC_BUDGET_MS} ms, ${result.goodShown} of ${SHOWN} good` };
}

function FunnelChart({ run }: { run: RecRun }) {
  const reduced = usePrefersReducedMotion();
  const fade = reduced ? { duration: 0 } : { duration: 0.4 };
  const columns = buildColumns(run);
  const markers = run.events.filter((event) => event.marker);
  const label = `Funnel from ${count(CATALOG_SIZE)} catalog items to the items shown. ${columns
    .map((col) => `${col.name}: ${col.revealed ? count(col.count) : 'not run yet'}`)
    .join('. ')}. The stage table below lists the same numbers.`;

  return (
    <DiagramScroll label="Recommendation funnel, scrollable">
      <svg className="sdv-rec-funnel__svg" viewBox="0 0 640 312" role="img" aria-label={label}>
        {columns.slice(1).map((col, index) => {
          const prev = columns[index];
          const stage = col.stage;
          if (!prev || !stage) return null;
          const x1 = (COL_X[index] ?? 0) + BAND_W / 2;
          const x2 = (COL_X[index + 1] ?? 0) - BAND_W / 2;
          const h1 = bandHeight(prev.count);
          const h2 = bandHeight(col.count);
          const gapX = (x1 + x2) / 2;
          const over = stage.ms > REC_BUDGET_MS;
          return (
            <g key={stage.stage}>
              {col.revealed && (
                <m.polygon
                  className={`sdv-rec-funnel__flow${stage.skipped ? ' sdv-rec-funnel__flow--skipped' : ''}`}
                  points={`${x1},${MID_Y - h1 / 2} ${x2},${MID_Y - h2 / 2} ${x2},${MID_Y + h2 / 2} ${x1},${MID_Y + h1 / 2}`}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={fade}
                />
              )}
              {col.revealed && (
                <text
                  className={`sdv-rec-funnel__gap${over ? ' sdv-rec-funnel__gap--over' : ''}`}
                  x={gapX}
                  y={MID_Y + 4}
                  textAnchor="middle"
                >
                  {stage.skipped ? 'skipped' : formatMs(stage.ms)}
                </text>
              )}
            </g>
          );
        })}
        {columns.map((col, index) => {
          const cx = COL_X[index] ?? 0;
          const left = cx - BAND_W / 2;
          if (!col.revealed) {
            return (
              <g key={col.name}>
                <rect
                  className="sdv-rec-funnel__band--pending"
                  x={left}
                  y={MID_Y - 28}
                  width={BAND_W}
                  height={56}
                  rx={4}
                />
                <text className="sdv-rec-funnel__pending" x={cx} y={MID_Y + 5} textAnchor="middle">
                  ?
                </text>
                <text className="sdv-rec-funnel__col" x={cx} y={NAME_Y} textAnchor="middle">
                  {col.name}
                </text>
              </g>
            );
          }
          const h = bandHeight(col.count);
          const top = MID_Y - h / 2;
          const crowd = crowdDots(`${run.scenario.id}-${index}`, crowdDotCount(col.anonymous));
          return (
            <m.g
              key={col.name}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={fade}
            >
              <rect className="sdv-rec-funnel__band" x={left} y={top} width={BAND_W} height={h} rx={4} />
              {crowd.map((dot) => (
                <circle
                  key={`${dot.x}-${dot.y}`}
                  className="sdv-rec-funnel__crowd"
                  cx={left + 6 + dot.x * (BAND_W - 12)}
                  cy={top + 5 + dot.y * Math.max(0, h - 10)}
                  r={1.8}
                />
              ))}
              <text className="sdv-rec-funnel__count" x={cx} y={top - 7} textAnchor="middle">
                {count(col.count)}
              </text>
              <text className="sdv-rec-funnel__col" x={cx} y={NAME_Y} textAnchor="middle">
                {col.name}
              </text>
              {(index === 0 ? allIds : col.dots).map((id, n) => {
                const item = itemLookup.get(id);
                const x = cx - ((DOTS_PER_ROW - 1) * DOT_GAP) / 2 + (n % DOTS_PER_ROW) * DOT_GAP;
                const y = DOT_Y + Math.floor(n / DOTS_PER_ROW) * DOT_GAP;
                const dropped = col.dropped.has(id);
                return (
                  <g key={id}>
                    <g className={dropped ? 'sdv-rec-funnel__dot--dropped' : undefined}>
                      {item?.best && <circle className="sdv-rec-funnel__best" cx={x} cy={y} r={6.2} />}
                      <circle
                        className={
                          item && isKnownGood(item)
                            ? 'sdv-rec-funnel__dot--good'
                            : 'sdv-rec-funnel__dot--other'
                        }
                        cx={x}
                        cy={y}
                        r={3.6}
                      />
                    </g>
                    {dropped && (
                      <path
                        className="sdv-rec-funnel__x"
                        d={`M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`}
                      />
                    )}
                  </g>
                );
              })}
            </m.g>
          );
        })}
        {markers.map((event, index) => {
          const stageIndex = stageOrder.indexOf(event.stage);
          const x =
            ((COL_X[stageIndex] ?? 0) + (COL_X[stageIndex + 1] ?? 0)) / 2 +
            markers.slice(0, index).filter((e) => e.stage === event.stage).length * 20;
          return (
            <m.g
              key={`${event.tick}-${event.text}`}
              className="sdv-trace__marker"
              initial={reduced ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={fade}
            >
              <circle cx={x} cy={14} r={9} />
              <text x={x} y={18} textAnchor="middle">
                {index + 1}
              </text>
            </m.g>
          );
        })}
      </svg>
    </DiagramScroll>
  );
}

function LatencyLane({ run }: { run: RecRun }) {
  const reduced = usePrefersReducedMotion();
  const grow = reduced ? { duration: 0 } : { duration: 0.5 };
  const elapsed = run.elapsedMs;
  const overflow = elapsed > LAT_MAX;
  const budgetX = latX(REC_BUDGET_MS);
  let start = 0;
  const segments = run.stages
    .filter((stage) => stage.ms > 0)
    .map((stage) => {
      const from = start;
      start += stage.ms;
      return { stage: stage.stage, x: latX(from), width: Math.max(0, latX(start) - latX(from)) };
    })
    .filter((segment) => segment.width > 0);

  return (
    <DiagramScroll label="Time spent so far, scrollable">
      <svg
        className="sdv-rec-lat"
        viewBox="0 0 640 84"
        role="img"
        aria-label={`Time spent so far: ${formatMs(elapsed)} against a ${REC_BUDGET_MS} ms budget. The axis runs from 0 to ${LAT_MAX} ms${overflow ? ', and the bar runs off the end' : ''}.`}
      >
        <text className="sdv-rec-lat__label" x={8} y={30}>
          <tspan x={8} dy="-0.2em">
            Time
          </tspan>
          <tspan x={8} dy="1.1em">
            so far
          </tspan>
        </text>
        <rect
          className="sdv-rec-lat__track"
          x={LAT_LEFT}
          y={20}
          width={LAT_RIGHT - LAT_LEFT}
          height={20}
          rx={3}
        />
        {segments.map((segment) => (
          <m.rect
            key={segment.stage}
            className={`sdv-rec-lat__seg sdv-rec-lat__seg--${segment.stage}`}
            x={segment.x}
            y={20}
            height={20}
            initial={reduced ? false : { width: 0 }}
            animate={{ width: segment.width }}
            transition={grow}
          />
        ))}
        {overflow && (
          <g className="sdv-rec-lat__overflow">
            <path d={`M${LAT_RIGHT - 6} 16L${LAT_RIGHT + 2} 30L${LAT_RIGHT - 6} 44`} />
            <text x={LAT_RIGHT + 6} y={34}>
              {formatMs(elapsed)}
            </text>
          </g>
        )}
        <line className="sdv-rec-lat__budget" x1={budgetX} x2={budgetX} y1={10} y2={50} />
        <text className="sdv-rec-lat__budget-label" x={budgetX} y={8} textAnchor="middle">
          {REC_BUDGET_MS} ms budget
        </text>
        <g className="sdv-axis">
          <line x1={LAT_LEFT} x2={LAT_RIGHT} y1={56} y2={56} />
          {[0, 10, 20, 30, 40, 50, 60].map((tick) => (
            <g key={tick}>
              <line x1={latX(tick)} x2={latX(tick)} y1={56} y2={61} />
              <text x={latX(tick)} y={75} textAnchor="middle">
                {tick} ms
              </text>
            </g>
          ))}
        </g>
      </svg>
    </DiagramScroll>
  );
}

function NowCard({ run }: { run: RecRun }) {
  const reduced = usePrefersReducedMotion();
  const stage = run.stages.at(-1);
  return (
    <div className="sdv-rec-funnel__now">
      <p className="sdv-rec-funnel__now-title">Last stage</p>
      {stage ? (
        <m.div
          key={`${run.scenario.id}-${stage.stage}`}
          className="sdv-rec-funnel__now-body"
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <p className="sdv-rec-funnel__now-line">
            <strong>{stageInfo[stage.stage].label}</strong>
            {stage.skipped
              ? `: skipped, so all ${count(stage.in)} items pass straight through.`
              : `: ${count(stage.in)} in, ${count(stage.passed)} passed, ${count(stage.dropped)} dropped, ${formatMs(stage.ms)}.`}
          </p>
          {stage.stage === 'candidates' && run.result.sources.length > 0 && (
            <ul className="sdv-rec-funnel__sources" aria-label="Candidate sources">
              {run.result.sources.map((source) => (
                <li key={source.source}>
                  {`${sourceInfo[source.source].label}: ${count(source.returned)} items, ${formatMs(source.ms)}`}
                </li>
              ))}
            </ul>
          )}
        </m.div>
      ) : (
        <p className="sdv-trace__empty">Press Play or Step to run the first stage.</p>
      )}
    </div>
  );
}

function StageTable({ run }: { run: RecRun }) {
  const reached = run.ticks >= 1;
  const finished = run.done;
  return (
    <DiagramScroll label="Stage by stage counts, scrollable">
      <table className="sdv-stats sdv-compare sdv-rec-funnel__table">
        <caption>
          Every stage: items in = items passed + items dropped. Counts use the illustrative{' '}
          {count(CATALOG_SIZE)} item catalog. Times are illustrative; the budget is {REC_BUDGET_MS} ms.
        </caption>
        <thead>
          <tr>
            <td />
            <th scope="col">In</th>
            <th scope="col">Passed</th>
            <th scope="col">Dropped</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {run.result.stages.map((stage, index) => {
            const shown = index < run.ticks;
            const cells = [
              { key: 'in', text: shown ? count(stage.in) : 'not yet' },
              { key: 'passed', text: shown ? count(stage.passed) : 'not yet' },
              { key: 'dropped', text: shown ? count(stage.dropped) : 'not yet' },
              {
                key: 'time',
                text: shown ? (stage.skipped ? 'skipped' : formatMs(stage.ms)) : 'not yet',
              },
            ];
            return (
              <tr key={stage.stage}>
                <th scope="row">{stageInfo[stage.stage].label}</th>
                {cells.map((cell) => (
                  <td key={cell.key}>
                    <span className="sdv-stats__value">{cell.text}</span>
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <th scope="row">Total time so far</th>
            <td colSpan={4}>
              {run.ticks > 0 ? (
                <ToneBadge tone={run.elapsedMs > REC_BUDGET_MS ? 'bad' : 'ok'}>
                  {`${formatMs(run.elapsedMs)} of ${REC_BUDGET_MS} ms`}
                </ToneBadge>
              ) : (
                <span className="sdv-stats__value">not yet</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Known good items that reached the ranker</th>
            <td colSpan={4}>
              <span className="sdv-stats__value">
                {reached
                  ? `${run.result.relevantReached} of ${RELEVANT_TOTAL} (${percent(run.result.recall)} recall)`
                  : 'not yet'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">Good replacements among the {SHOWN} shown</th>
            <td colSpan={4}>
              <span className="sdv-stats__value">
                {finished ? `${run.result.goodShown} of ${SHOWN}` : 'not yet'}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </DiagramScroll>
  );
}

function Scoreboard({ finished }: { finished: RecScenarioId[] }) {
  const ids = recScenarioIds.filter((id) => finished.includes(id));
  if (ids.length === 0) {
    return (
      <p className="sdv-trace__empty">
        Finish a run to add it to the scoreboard. Finish two to compare them on the same request.
      </p>
    );
  }
  const rows: { label: string; cell: (r: FunnelResult) => string }[] = [
    { label: 'Total time', cell: (r) => formatMs(r.totalMs) },
    {
      label: 'Known good items that reached the ranker',
      cell: (r) => `${r.relevantReached} of ${RELEVANT_TOTAL}`,
    },
    { label: `Good replacements among the ${SHOWN} shown`, cell: (r) => `${r.goodShown} of ${SHOWN}` },
  ];
  return (
    <DiagramScroll label="Scenarios you have finished, scrollable">
      <table className="sdv-stats sdv-compare sdv-rec-funnel__table">
        <caption>Scenarios you have finished, on the same out of stock hose request.</caption>
        <thead>
          <tr>
            <td />
            {ids.map((id) => (
              <th key={id} scope="col">
                {recScenarios[id].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {ids.map((id) => (
                <td key={id}>
                  <span className="sdv-stats__value">{row.cell(allResults[id])}</span>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">Verdict</th>
            {ids.map((id) => {
              const verdict = runVerdict(allResults[id]);
              return (
                <td key={id}>
                  <ToneBadge tone={verdict.tone}>{verdict.text}</ToneBadge>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </DiagramScroll>
  );
}

export default function RecFunnelWidget({
  initial = 'score',
  title = 'Narrow 3,000,000 items to five replacements',
  instructions = 'Pick a pipeline, predict the result, then press Play. Each step runs one stage of the funnel on the same request.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const baseId = safeId(useId(), 'rec');
  const [scenarioId, setScenarioId] = useState<RecScenarioId>(initial);
  const [finished, setFinished] = useState<RecScenarioId[]>([]);
  const runRef = useRef<RecRun | null>(null);
  runRef.current ??= new RecRun(scenarioId);
  const run = runRef.current;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const recordIfDone = () => {
    if (!run.done) return;
    const id = run.scenario.id;
    setFinished((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };
  const restart = (id: RecScenarioId) => {
    runRef.current = new RecRun(id);
    rerender();
  };
  const onTick = () => {
    run.step();
    recordIfDone();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    recordIfDone();
    rerender();
  };
  const chooseScenario = (id: RecScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const result = run.result;
  const started = run.ticks > 0;
  const lastStage: StageId | undefined = run.stages.at(-1)?.stage;
  const markerEvents = run.events.filter((event) => event.marker);
  const knownId = `${baseId}-known`;
  const shownId = `${baseId}-shown`;

  const summary = started
    ? `${run.ticks} of ${run.length} stages run, last ${lastStage ? stageInfo[lastStage].label : ''}. ${run.stages
        .map((stage) =>
          stage.skipped
            ? `${stageInfo[stage.stage].label} skipped`
            : `${stageInfo[stage.stage].label}: ${count(stage.in)} in, ${count(stage.passed)} passed`,
        )
        .join('. ')}. Time so far ${formatMs(run.elapsedMs)} of a ${REC_BUDGET_MS} ms budget.${
        run.done
          ? ` ${result.relevantReached} of ${RELEVANT_TOTAL} known good items reached the ranker; ${result.goodShown} of ${SHOWN} shown items are good.`
          : ''
      }`
    : `No stages run yet. The pipeline is ${recScenarios[scenarioId].label}.`;

  const status = run.done
    ? runVerdict(result)
    : started
      ? ({ tone: 'neutral', text: `Stage ${run.ticks} of ${run.length}` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={scenarioId}
      ticksPerSecond={1}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <>
          <StageTable run={run} />
          <Scoreboard finished={finished} />
        </>
      }
    >
      <ScenarioChips
        label="Pipeline"
        value={scenarioId}
        options={recScenarioIds.map((id) => ({
          value: id,
          label: recScenarios[id].label,
          diff: recScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <p className="sdv-rec-funnel__request">
        Out of stock: <strong>{request.name}</strong> ({request.brand}). The assistant suggests {SHOWN}{' '}
        replacements from a catalog of {count(CATALOG_SIZE)} items.
      </p>
      <MotionRoot>
        <NowCard run={run} />
        <FunnelChart run={run} />
        <LatencyLane run={run} />
        <div className="sdv-rec-funnel__panels">
          <section className="sdv-rec-funnel__panel" aria-labelledby={knownId}>
            <h4 className="sdv-rec-funnel__panel-title" id={knownId}>
              Known good replacements ({RELEVANT_TOTAL}, fixture)
            </h4>
            <ul className="sdv-rec-funnel__known">
              {knownGood.map((item) => {
                const itemFate = fate(run, item.id);
                return (
                  <li key={item.id}>
                    <span className="sdv-rec-funnel__known-name">
                      {item.name}
                      {item.best ? ' (best)' : ''}
                    </span>
                    <ToneBadge tone={itemFate.tone}>{itemFate.text}</ToneBadge>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="sdv-rec-funnel__panel" aria-labelledby={shownId}>
            <h4 className="sdv-rec-funnel__panel-title" id={shownId}>
              The handful shown
            </h4>
            {run.done ? (
              <ol className="sdv-rec-funnel__shown">
                {result.shown.map((id, index) => {
                  const item = itemLookup.get(id);
                  return (
                    <m.li
                      key={`${scenarioId}-${id}`}
                      initial={reduced ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reduced ? { duration: 0 } : { duration: 0.25, delay: index * 0.08 }}
                    >
                      <span className="sdv-rec-funnel__shown-rank" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="sdv-rec-funnel__shown-name">
                        {nameOf(id)}
                        <span className="sdv-rec-funnel__shown-brand">{item?.brand}</span>
                      </span>
                      <ToneBadge tone={item?.relevant ? 'ok' : 'bad'}>
                        {item?.relevant ? 'Good replacement' : 'Not a replacement'}
                      </ToneBadge>
                    </m.li>
                  );
                })}
                {result.shownOther > 0 && (
                  <li>{`${result.shownOther} other catalog ${result.shownOther === 1 ? 'item' : 'items'}`}</li>
                )}
              </ol>
            ) : (
              <p className="sdv-trace__empty">The handful appears after the last stage.</p>
            )}
          </section>
        </div>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the funnel">
        <li>
          <span className="sdv-rec-funnel__key sdv-rec-funnel__key--good" aria-hidden="true" /> Known good
          replacement
        </li>
        <li>
          <span className="sdv-rec-funnel__key sdv-rec-funnel__key--other" aria-hidden="true" /> Other named
          item
        </li>
        <li>
          <span className="sdv-rec-funnel__key sdv-rec-funnel__key--best" aria-hidden="true" /> Best
          replacement
        </li>
        <li>
          <span className="sdv-rec-funnel__key-x" aria-hidden="true">
            ×
          </span>{' '}
          Dropped by that stage
        </li>
        <li>
          <span className="sdv-rec-funnel__key sdv-rec-funnel__key--crowd" aria-hidden="true" /> A scaled
          sample of anonymous catalog items
        </li>
        <li>
          Toy model: the 26 named items and their relevance are fixtures. Counts use the illustrative catalog
          size, and every time is illustrative.
        </li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {run.events.length === 0 ? (
          <p className="sdv-trace__empty">
            Each stage adds a line here. Numbered lines match the funnel markers.
          </p>
        ) : (
          <ol>
            {run.events.map((event) => {
              const markerNumber = markerEvents.indexOf(event) + 1;
              return (
                <li key={`${event.tick}-${event.text}`}>
                  {markerNumber > 0 ? (
                    <span className="sdv-trace__num" aria-hidden="true">
                      {markerNumber}
                    </span>
                  ) : (
                    <span className="sdv-rec-funnel__num-blank" aria-hidden="true" />
                  )}
                  <span className="sdv-rec-funnel__log-stage">{stageInfo[event.stage].label}</span>
                  <span>{event.text}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </SimulationShell>
  );
}
