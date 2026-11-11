import { useId, useReducer, useRef, useState } from 'react';
import {
  type Breakdown,
  FIX_AT,
  type Percentiles,
  SLO_SECONDS,
  SLO_TARGET,
  SLO_THRESHOLD_MS,
  type SloLane,
  SloRun,
  type SloScenarioId,
  type Stage,
  sliPercent,
  sloScenarios,
  stageLabels,
  stages,
  summarizeLane,
  TICK_SECONDS,
} from '../../lib/models/slos';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useElementWidth } from '../sim/useElementWidth';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import './SloWidget.css';

interface Props {
  scenarios?: SloScenarioId[];
  initial?: SloScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const ms = (value: number) => `${Math.round(value)} ms`;
const count = (value: number) => value.toLocaleString('en-US');
const fixSeconds = FIX_AT * TICK_SECONDS;
const allowedShare = 1 - SLO_TARGET;

const stageKinds: Record<Stage, ComponentKind> = {
  network: 'client',
  app: 'server',
  cache: 'cache',
  database: 'database',
};

type LastSecond = Percentiles & { slowShare: number; values: number[] };

const BIN_MS = 10;
const MAX_MS = 250;
const BINS = MAX_MS / BIN_MS;
const HIST_HEIGHT = 196;
const ROW = 12;
const PAD = { top: ROW * 5 + 8, right: 8, bottom: 24, left: 8 };
const axisTicks = [0, 50, 100, 150, 200];

interface MarkLine {
  key: string;
  label: string;
  value: number;
  row: number;
  kind: 'slo' | 'mean' | 'percentile';
}

function Histogram({ lane, last, variant }: { lane: SloLane; last: LastSecond; variant: SeriesVariant }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef, 320);
  const patternId = `sdv-slo-slow-${useId().replace(/:/g, '')}`;
  const counts = Array.from({ length: BINS + 1 }, () => 0);
  for (const value of last.values) {
    const bin = Math.min(BINS, Math.floor(value / BIN_MS));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  const most = Math.max(1, ...counts);
  const innerWidth = Math.max(10, width - PAD.left - PAD.right);
  const innerHeight = HIST_HEIGHT - PAD.top - PAD.bottom;
  const binWidth = innerWidth / (BINS + 1);
  const baseline = PAD.top + innerHeight;
  const x = (value: number) => PAD.left + Math.min(value / BIN_MS, BINS + 0.5) * binWidth;
  const empty = last.count === 0;
  const lines: MarkLine[] = [
    { key: 'slo', label: `SLO ${SLO_THRESHOLD_MS}`, value: SLO_THRESHOLD_MS, row: 0, kind: 'slo' },
  ];
  if (!empty) {
    lines.push(
      { key: 'p99', label: `p99 ${Math.round(last.p99)}`, value: last.p99, row: 1, kind: 'percentile' },
      { key: 'p95', label: `p95 ${Math.round(last.p95)}`, value: last.p95, row: 2, kind: 'percentile' },
      { key: 'p50', label: `p50 ${Math.round(last.p50)}`, value: last.p50, row: 3, kind: 'percentile' },
      { key: 'mean', label: `mean ${Math.round(last.mean)}`, value: last.mean, row: 4, kind: 'mean' },
    );
  }
  const slowCount = last.values.filter((value) => value >= SLO_THRESHOLD_MS).length;
  const label = empty
    ? `${lane.label}: no redirects yet. Press Play to fill the histogram.`
    : `${lane.label}: last second, ${last.count} redirects in 10 ms bands. Mean ${ms(last.mean)}, p50 ${ms(last.p50)}, p95 ${ms(last.p95)}, p99 ${ms(last.p99)}. ${slowCount} took ${SLO_THRESHOLD_MS} ms or longer.`;

  return (
    <div ref={frameRef} className="sdv-trace__frame sdv-slo__hist">
      <svg
        width={width}
        height={HIST_HEIGHT}
        viewBox={`0 0 ${width} ${HIST_HEIGHT}`}
        role="img"
        aria-label={label}
        data-variant={variant}
      >
        <defs>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" className="sdv-slo__slow-bg" />
            <rect width="2.5" height="6" className="sdv-slo__slow-stripe" />
          </pattern>
        </defs>
        {counts.map((count, bin) => {
          if (count === 0) return null;
          const height = Math.max(3, (count / most) * innerHeight);
          const slow = bin * BIN_MS >= SLO_THRESHOLD_MS;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: bins are fixed 10 ms bands in a fixed order
              key={bin}
              x={PAD.left + bin * binWidth + 0.5}
              y={baseline - height}
              width={Math.max(1, binWidth - 1)}
              height={height}
              className={slow ? 'sdv-slo__bin sdv-slo__bin--slow' : 'sdv-slo__bin'}
              style={slow ? { fill: `url(#${patternId})` } : undefined}
            />
          );
        })}
        <line
          x1={PAD.left}
          x2={PAD.left + innerWidth}
          y1={baseline}
          y2={baseline}
          className="sdv-trace__grid"
        />
        {axisTicks
          .filter((tick) => x(MAX_MS + BIN_MS / 2) - x(tick) >= 62)
          .map((tick) => (
            <text key={tick} x={x(tick)} y={HIST_HEIGHT - 8} textAnchor="middle" className="sdv-trace__tick">
              {tick}
            </text>
          ))}
        <text x={x(MAX_MS + BIN_MS / 2)} y={HIST_HEIGHT - 8} textAnchor="end" className="sdv-trace__tick">
          {MAX_MS}+ ms
        </text>
        {lines.map((line) => {
          const lineX = x(line.value);
          const labelY = 10 + line.row * ROW;
          const flip = lineX > PAD.left + innerWidth * 0.68;
          return (
            <g key={line.key} className={`sdv-slo__mark sdv-slo__mark--${line.kind}`}>
              <line x1={lineX} x2={lineX} y1={labelY + 3} y2={baseline} />
              <text x={flip ? lineX - 3 : lineX + 3} y={labelY} textAnchor={flip ? 'end' : 'start'}>
                {line.label}
              </text>
            </g>
          );
        })}
        {empty && (
          <text
            x={x(SLO_THRESHOLD_MS) + 6}
            y={PAD.top + innerHeight / 2}
            textAnchor="start"
            className="sdv-trace__tick"
          >
            Press Play to fill
          </text>
        )}
      </svg>
    </div>
  );
}

function budgetBadge(left: number, budget: number) {
  if (left <= 0) return <ToneBadge tone="bad">Budget spent: SLO missed</ToneBadge>;
  if (left <= budget / 2) return <ToneBadge tone="warn">Over half the budget spent</ToneBadge>;
  return <ToneBadge tone="ok">Budget mostly intact</ToneBadge>;
}

function LanePane({ run, lane, variant }: { run: SloRun; lane: SloLane; variant: SeriesVariant }) {
  const last = run.window(lane);
  const sum = summarizeLane(lane, run.budget);
  const has = last.count > 0;
  const burn = last.slowShare / allowedShare;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-slo__note">
        {run.fixed
          ? lane.fix === 'app'
            ? 'Shipped: app code takes half as long on every redirect.'
            : 'Shipped: the database read takes half as long, on cache misses only.'
          : `Ships at ${fixSeconds.toFixed(1)} s. Until then both lanes time the same redirects identically.`}
      </p>
      <Histogram lane={lane} last={last} variant={variant} />
      <dl className="sdv-slo__facts">
        <div>
          <dt>p99, last second</dt>
          <dd>{has ? ms(last.p99) : 'none yet'}</dd>
        </div>
        <div>
          <dt>Mean, last second</dt>
          <dd>{has ? ms(last.mean) : 'none yet'}</dd>
        </div>
        <div>
          <dt>Burn rate, last second</dt>
          <dd>{has ? `${burn.toFixed(1)}x` : 'none yet'}</dd>
        </div>
        <div>
          <dt>Error budget left</dt>
          <dd>
            {sum.budgetLeft} of {run.budget}
          </dd>
        </div>
      </dl>
      {budgetBadge(sum.budgetLeft, run.budget)}
    </section>
  );
}

function BreakdownPanel({ breakdown, ticks }: { breakdown: Breakdown; ticks: number }) {
  if (breakdown.count === 0) {
    return (
      <section className="sdv-slo__panel" aria-label="Where the time goes">
        <h4 className="sdv-slo__heading">Where the time goes</h4>
        <p className="sdv-slo__empty">
          Press Play. Tracing splits each redirect from the first {fixSeconds.toFixed(0)} s, before either fix
          ships, into its stages here.
        </p>
      </section>
    );
  }
  const totals = {
    average: stages.reduce((total, stage) => total + breakdown.average[stage], 0),
    tail: stages.reduce((total, stage) => total + breakdown.tail[stage], 0),
  };
  const cell = (value: number, total: number) => {
    const share = total > 0 ? value / total : 0;
    return (
      <div className="sdv-slo__cell">
        <span className="sdv-slo__track" aria-hidden="true">
          <span className="sdv-slo__fill" style={{ width: `${(share * 100).toFixed(1)}%` }} />
        </span>
        <span className="sdv-slo__value">
          {ms(value)}, {Math.round(share * 100)}%
        </span>
      </div>
    );
  };
  return (
    <section className="sdv-slo__panel" aria-label="Where the time goes">
      <h4 className="sdv-slo__heading">Where the time goes</h4>
      <table className="sdv-slo__breakdown">
        <caption>
          {ticks < FIX_AT ? 'Tracing so far: ' : 'Traced before the fixes: '}
          {count(breakdown.count)} redirects. The slowest 1% is the {breakdown.tailCount} slowest of them.
          Bars show each stage's share of the column total.
        </caption>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Average redirect</th>
            <th scope="col">Slowest 1%</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => (
            <tr key={stage} className={`sdv-slo__stage sdv-slo__stage--${stage}`}>
              <th scope="row">
                <span className="sdv-slo__stage-name">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="sdv-slo__icon">
                    <KindIcon kind={stageKinds[stage]} size={24} />
                  </svg>
                  {stageLabels[stage]}
                </span>
              </th>
              <td>{cell(breakdown.average[stage], totals.average)}</td>
              <td>{cell(breakdown.tail[stage], totals.tail)}</td>
            </tr>
          ))}
          <tr className="sdv-slo__total">
            <th scope="row">Whole redirect</th>
            <td>{ms(totals.average)}</td>
            <td>{ms(totals.tail)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export default function SloWidget({
  scenarios = ['healthy', 'slow-misses', 'slow-app'],
  initial,
  title = 'Two fixes, one SLO: 99% of redirects under 100 ms',
  instructions = `About 1,000 redirects a second for ${SLO_SECONDS} s. At ${fixSeconds.toFixed(0)} s one lane halves the app code and the other halves the database read on cache misses. Pick a scenario and press Play. Both lanes time the exact same redirects.`,
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<SloScenarioId>(initial ?? scenarios[0] ?? 'slow-misses');
  const runRef = useRef<SloRun | null>(null);
  if (!runRef.current) runRef.current = new SloRun(sloScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: SloScenarioId) => {
    runRef.current = new SloRun(sloScenarios[id]);
    rerender();
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    rerender();
  };
  const chooseScenario = (id: SloScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = run.lanes;
  const sums = [summarizeLane(first, run.budget), summarizeLane(second, run.budget)] as const;
  const seconds = run.ticks * run.tickSeconds;
  const started = sums[0].arrived > 0;
  const timing = (value: number) => (started ? ms(value) : 'none yet');
  const better = (direction: 'lower' | 'higher') => (started ? direction : undefined);

  const rows: CompareRow[] = [
    { label: 'Redirects in (same for both)', values: [sums[0].arrived, sums[1].arrived], format: count },
    { label: 'Mean', values: [sums[0].mean, sums[1].mean], format: timing, better: better('lower') },
    { label: 'p50', values: [sums[0].p50, sums[1].p50], format: timing, better: better('lower') },
    { label: 'p95', values: [sums[0].p95, sums[1].p95], format: timing, better: better('lower') },
    { label: 'p99', values: [sums[0].p99, sums[1].p99], format: timing, better: better('lower') },
    {
      // Both lanes see the same redirects, so ranking by slow count ranks the SLI without the tie margin.
      label: `Under ${SLO_THRESHOLD_MS} ms (the SLI)`,
      values: [sums[0].slow, sums[1].slow],
      format: (slow) =>
        started ? `${sliPercent(sums[0].arrived - slow, sums[0].arrived).toFixed(1)}%` : 'none yet',
      better: better('lower'),
    },
    {
      label: `Slow redirects (${SLO_THRESHOLD_MS} ms or more)`,
      values: [sums[0].slow, sums[1].slow],
      better: better('lower'),
    },
    {
      label: 'Error budget left',
      values: [sums[0].budgetLeft, sums[1].budgetLeft],
      format: (value) => `${value} of ${run.budget}`,
      better: better('higher'),
    },
  ];

  const latest = (lane: SloLane) => lane.series.at(-1) ?? 0;
  const laneText = (lane: SloLane, index: 0 | 1) =>
    started
      ? `${lane.label}: p99 over the last second ${ms(latest(lane))}, ${sums[index].slow} slow redirects, error budget left ${sums[index].budgetLeft} of ${run.budget}`
      : `${lane.label}: no redirects yet`;
  const summary = `${seconds.toFixed(1)} s of ${SLO_SECONDS} s. ${laneText(first, 0)}. ${laneText(second, 1)}.`;
  const chartTitle = `p99 over the last second, ms (SLO limit: the ${SLO_THRESHOLD_MS} ms gridline)`;
  const chartSummary = started
    ? `${chartTitle}. ${first.label} now ${ms(latest(first))}. ${second.label} now ${ms(latest(second))}.`
    : `${chartTitle}. No redirects yet.`;

  const markerEvents = run.events.filter((event) => event.marker);
  const notes = run.events.filter((event) => !event.marker);

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${SLO_SECONDS} s` } as const);

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
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption={`Whole run so far, same redirects for both. Error budget: 1% of the ${count(run.total)} redirects in the run.`}
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
          label: sloScenarios[id].label,
          diff: sloScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <BreakdownPanel breakdown={run.breakdown()} ticks={run.ticks} />
      <div className="sdv-duel__lanes sdv-slo__lanes">
        {run.lanes.map((lane, index) => (
          <LanePane key={lane.fix} run={run} lane={lane} variant={variants[index] ?? 'a'} />
        ))}
      </div>
      <ul className="sdv-legend sdv-slo__legend" aria-label="How to read the histograms">
        <li>
          Bar height: redirects in each 10 ms band over the last second. Any band with a redirect shows.
        </li>
        <li>
          <span className="sdv-slo__sample sdv-slo__sample--slow" aria-hidden="true" />
          Striped bars: {SLO_THRESHOLD_MS} ms or slower. Each one spends the error budget.
        </li>
        <li>
          <span className="sdv-slo__sample sdv-slo__sample--slo" aria-hidden="true" />
          Solid line: the {SLO_THRESHOLD_MS} ms SLO limit
        </li>
        <li>
          <span className="sdv-slo__sample sdv-slo__sample--percentile" aria-hidden="true" />
          Dashed lines: p50, p95, p99. Dotted line: mean.
        </li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={run.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={150}
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
                <time>{(event.tick * run.tickSeconds).toFixed(1)} s</time> {event.text}
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
