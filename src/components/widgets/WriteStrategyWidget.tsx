import { useReducer, useRef, useState } from 'react';
import {
  strategyPaths,
  summarize,
  WRITE_SECONDS,
  WriteDuel,
  type WriteLane,
  type WriteScenarioId,
  type WriteSummary,
  writeScenarios,
} from '../../lib/models/writeStrategy';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, seriesVariants, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './WriteStrategyWidget.css';

interface Props {
  scenarios?: WriteScenarioId[];
  initial?: WriteScenarioId;
  title?: string;
  instructions?: string;
}

/** The buffer track grows in steps of this many writes, so it never rescales on every tick. */
const BUFFER_STEP = 50;

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function LanePane({
  lane,
  summary,
  index,
  bufferScale,
}: {
  lane: WriteLane;
  summary: WriteSummary;
  index: number;
  bufferScale: number;
}) {
  const dirty = lane.dirtyLinks;
  const clean = lane.cached - dirty;
  const recent = lane.recentHitRatio;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={seriesVariants[index] ?? 'a'} />
        {lane.label}
      </h4>
      <p className="sdv-wstrat__path">{strategyPaths[lane.strategy]}</p>
      <div className="sdv-wstrat__gauge">
        <p className="sdv-wstrat__label">
          Cache: {lane.cached} of {lane.capacity} entries
          {dirty > 0 && `, ${dirty} changed and not saved`}
        </p>
        <div className="sdv-wstrat__track" aria-hidden="true">
          <span className="sdv-wstrat__fill" style={{ width: `${(clean / lane.capacity) * 100}%` }} />
          <span
            className="sdv-wstrat__fill"
            data-dirty=""
            style={{ width: `${(dirty / lane.capacity) * 100}%` }}
          />
        </div>
      </div>
      <div className="sdv-wstrat__gauge">
        <p className="sdv-wstrat__label">Waiting for the database: {lane.pending} writes</p>
        <div className="sdv-wstrat__track" aria-hidden="true">
          <span
            className="sdv-wstrat__fill"
            data-pending=""
            style={{ width: `${Math.min(1, lane.pending / bufferScale) * 100}%` }}
          />
        </div>
      </div>
      <dl className="sdv-wstrat__stats">
        <div>
          <dt>Database writes</dt>
          <dd>{summary.dbWrites}</dd>
        </div>
        <div>
          <dt>Read hits, last second</dt>
          <dd>{recent === null ? 'none yet' : percent(recent)}</dd>
        </div>
      </dl>
      {summary.lost > 0 && <ToneBadge tone="bad">{`${summary.lost} writes lost`}</ToneBadge>}
    </section>
  );
}

export default function WriteStrategyWidget({
  scenarios = ['steady', 'clicks', 'import', 'crash'],
  initial,
  title = 'Same writes, three cache strategies',
  instructions = 'Pick a scenario, then press Play. All three caches receive the exact same reads and writes; only the write path differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<WriteScenarioId>(initial ?? scenarios[0] ?? 'steady');
  const duelRef = useRef<WriteDuel | null>(null);
  if (!duelRef.current) duelRef.current = new WriteDuel(writeScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: WriteScenarioId) => {
    duelRef.current = new WriteDuel(writeScenarios[id]);
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
  const chooseScenario = (id: WriteScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const sums = duel.lanes.map(summarize);
  const values = (pick: (sum: WriteSummary) => number) => sums.map(pick);
  const seconds = duel.ticks * duel.tickSeconds;
  const nothing = duel.done ? 'none' : 'none yet';
  const anyLost = sums.some((sum) => sum.lost > 0);
  const allFirstReads = sums.every((sum) => sum.firstReads > 0);
  const bufferScale = Math.max(
    BUFFER_STEP,
    Math.ceil(Math.max(...duel.lanes.map((lane) => lane.peakPending)) / BUFFER_STEP) * BUFFER_STEP,
  );

  const rows: CompareRow[] = [
    { label: 'Writes (same traffic)', values: values((sum) => sum.writes) },
    {
      label: 'Average wait per write',
      values: values((sum) => sum.writeMs),
      format: (value, column) => ((sums[column]?.writes ?? 0) > 0 ? `${Math.round(value)} ms` : nothing),
      better: 'lower',
    },
    {
      label: 'Database writes',
      values: values((sum) => sum.dbWrites),
      better: anyLost ? undefined : 'lower',
    },
    { label: 'Writes lost', values: values((sum) => sum.lost), better: 'lower' },
    { label: 'Waiting for the database now', values: values((sum) => sum.pending), better: 'lower' },
    { label: 'Most waiting at once', values: values((sum) => sum.peakPending), better: 'lower' },
    {
      label: 'Read hit ratio',
      values: values((sum) => sum.hitRatio),
      format: (value, column) => ((sums[column]?.reads ?? 0) > 0 ? percent(value) : nothing),
      better: 'higher',
    },
    {
      label: 'First read after a write, from cache',
      values: values((sum) => sum.firstReadHitRatio),
      format: (value, column) => ((sums[column]?.firstReads ?? 0) > 0 ? percent(value) : nothing),
      better: allFirstReads ? 'higher' : undefined,
    },
  ];

  const describeLane = (lane: WriteLane, index: number) => {
    const sum = sums[index];
    if (!sum) return lane.label;
    const hits = sum.reads > 0 ? percent(sum.hitRatio) : nothing;
    return `${lane.label}: ${sum.dbWrites} database writes, ${sum.lost} lost, ${hits} read hits`;
  };
  const summary = `${seconds.toFixed(1)} s of ${WRITE_SECONDS} s. ${duel.lanes.map(describeLane).join('. ')}.`;

  const metric = duel.scenario.metric;
  const chartTitle =
    metric === 'db-writes'
      ? 'Database writes, running total'
      : metric === 'hit-ratio'
        ? 'Read hits over the last second (%)'
        : 'Writes waiting for the database';
  const latest = duel.lanes.map((lane) => `${lane.label} ${lane.series.at(-1) ?? 0}`).join(', ');
  const chartSummary = `${chartTitle}. Now: ${latest}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);
  const sameLines = duel.lanes.flatMap((lane, index) =>
    duel.lanes
      .slice(index + 1)
      .filter(
        (other) =>
          lane.series.length > 0 &&
          other.series.length === lane.series.length &&
          other.series.every((value, at) => value === lane.series[at]),
      )
      .map((other) => `${lane.label} and ${other.label} draw the same line, so one hides the other.`),
  );

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${WRITE_SECONDS} s` } as const);

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
          caption="Whole run so far, same reads and writes for all three"
          columns={duel.lanes.map((lane) => lane.label)}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: writeScenarios[id].label,
          diff: writeScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.strategy}
            lane={lane}
            summary={sums[index] ?? summarize(lane)}
            index={index}
            bufferScale={bufferScale}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the gauges">
        <li>
          <span className="sdv-wstrat__key" aria-hidden="true" /> A cached entry: a link, or a click count
        </li>
        <li>
          <span className="sdv-wstrat__key" data-dirty="" aria-hidden="true" /> Changed in the cache, not
          saved yet
        </li>
        <li>
          <span className="sdv-wstrat__key" data-pending="" aria-hidden="true" /> Waiting writes; the track
          holds {bufferScale}
        </li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: seriesVariants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={metric === 'pending' ? 10 : 100}
        summary={chartSummary}
      />
      {sameLines.map((text) => (
        <p key={text} className="sdv-trace__note">
          {text}
        </p>
      ))}
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
