import { useReducer, useRef, useState } from 'react';
import {
  BUILD_START_TICK,
  BUILD_TICKS,
  clock,
  DAY_TICKS,
  formatDelay,
  SearchDuel,
  type SearchLane,
  type SearchScenarioId,
  type SearchSummary,
  searchScenarios,
} from '../../lib/models/search';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './SearchFreshnessWidget.css';

/** Four ticks per second at 1× speed, so one playback second is one simulated hour. */
const TICKS_PER_SECOND = 4;
const PLAYBACK_SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;
const MAX_SEGMENT_CHIPS = 12;

interface Props {
  scenarios?: SearchScenarioId[];
  initial?: SearchScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const count = (value: number) => Math.round(value).toLocaleString('en-US');
const percent = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;

function nextBuildStart(lane: SearchLane, tick: number): number | null {
  for (let start = BUILD_START_TICK; start < DAY_TICKS; start += lane.rebuildEveryTicks) {
    if (start >= tick) return start;
  }
  return null;
}

function BuildLine({ lane, tick }: { lane: SearchLane; tick: number }) {
  if (lane.build !== null) {
    const done = Math.min(1, (tick - lane.build.snapshot) / BUILD_TICKS);
    return (
      <div className="sdv-search__build">
        <p className="sdv-search__line">
          Building the {clock(lane.build.snapshot)} snapshot with full signals: {Math.round(done * 100)}%
          done, publishes at {clock(lane.build.publishAt)}
        </p>
        <span className="sdv-search__bar" aria-hidden="true">
          <span style={{ width: `${done * 100}%` }} />
        </span>
      </div>
    );
  }
  const next = nextBuildStart(lane, tick);
  return (
    <p className="sdv-search__line">
      {next === null ? 'No more builds start today' : `Next full build starts at ${clock(next)}`}
    </p>
  );
}

function LanePane({
  duel,
  lane,
  summary,
  variant,
}: {
  duel: SearchDuel;
  lane: SearchLane;
  summary: SearchSummary;
  variant: SeriesVariant;
}) {
  const shown = lane.segments.slice(0, MAX_SEGMENT_CHIPS);
  const hidden = lane.segments.length - shown.length;
  const searched = 1 + lane.segments.length;
  return (
    <section className="sdv-duel__lane sdv-search__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <div className="sdv-search__index">
        <p className="sdv-search__index-name">Main index, full ranking signals</p>
        <p className="sdv-search__line">
          {count(lane.mainDocs)} documents, everything published before {clock(lane.snapshot)}
        </p>
      </div>
      <BuildLine lane={lane} tick={duel.ticks} />
      {lane.liveTier && (
        <div className="sdv-search__live">
          <p className="sdv-search__index-name">Live segments, text match only</p>
          {shown.length === 0 ? (
            <p className="sdv-search__line">None yet. New documents land here within 1 s.</p>
          ) : (
            <ul className="sdv-search__segments" aria-label="Live segments">
              {shown.map((segment) => (
                <li key={segment.id} className="sdv-search__seg" data-level={Math.min(segment.level, 3)}>
                  L{segment.level}: {segment.docs.length}
                </li>
              ))}
              {hidden > 0 && <li className="sdv-search__seg sdv-search__seg--more">+{hidden} more</li>}
            </ul>
          )}
          <p className="sdv-search__line">
            {count(summary.liveDocs)} live documents in {lane.segments.length} segments
          </p>
        </div>
      )}
      <p className="sdv-search__line">
        {lane.liveTier ? (
          <ToneBadge tone="ok">Every new document searchable within 1 s</ToneBadge>
        ) : summary.pendingAdded > 0 ? (
          <ToneBadge tone="warn">{`${count(summary.pendingAdded)} new documents not searchable yet`}</ToneBadge>
        ) : (
          <ToneBadge tone="neutral">No new documents waiting</ToneBadge>
        )}
      </p>
      <p className="sdv-search__line">
        Each query now searches{' '}
        {searched === 1 ? 'the main index only' : `${searched} segments and merges them`}
      </p>
    </section>
  );
}

export default function SearchFreshnessWidget({
  scenarios = ['breaking', 'evergreen', 'rebuild4h'],
  initial,
  title = 'One day of search: nightly rebuild versus a real-time tier',
  instructions = 'Toy model of one news day. Pick a scenario, then press Play. Both lanes index the same new documents and answer the same queries; only the indexing strategy differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<SearchScenarioId>(initial ?? scenarios[0] ?? 'breaking');
  const duelRef = useRef<SearchDuel | null>(null);
  if (!duelRef.current) duelRef.current = new SearchDuel(searchScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const restart = (id: SearchScenarioId) => {
    duelRef.current = new SearchDuel(searchScenarios[id]);
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
  const chooseScenario = (id: SearchScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [duel.summary(0), duel.summary(1)] as const;
  const started = duel.ticks > 0;
  const anyAdded = sums[0].searchableAdded + sums[0].pendingAdded > 0;
  const delay = (value: number) => (anyAdded ? formatDelay(value) : 'none yet');

  const rows: CompareRow[] = [
    {
      label: 'Recall@10 against the ideal ranking',
      values: [sums[0].recall, sums[1].recall],
      format: (value) => (started ? `${Math.round(value)}%` : 'none yet'),
      better: started ? 'higher' : undefined,
    },
    {
      label: 'Queries missing the ideal top result',
      values: [sums[0].missedBestShare, sums[1].missedBestShare],
      format: (value) => (started ? percent(value) : 'none yet'),
      better: started ? 'lower' : undefined,
    },
    {
      label: 'Average time a new document has spent unsearchable so far',
      values: [sums[0].unsearchableSeconds, sums[1].unsearchableSeconds],
      format: delay,
      better: anyAdded ? 'lower' : undefined,
    },
    {
      label: 'New documents still unsearchable',
      values: [sums[0].pendingAdded, sums[1].pendingAdded],
      format: (value) => (anyAdded ? count(value) : 'none yet'),
      better: anyAdded ? 'lower' : undefined,
    },
    {
      label: 'Index segments searched per query',
      values: [sums[0].segmentsPerQuery, sums[1].segmentsPerQuery],
      format: (value) => value.toFixed(1),
      better: 'lower',
    },
    { label: 'Full index builds started', values: [sums[0].builds, sums[1].builds], better: 'lower' },
    {
      label: 'Documents written by builds, flushes, and merges',
      values: [sums[0].writes, sums[1].writes],
      format: count,
      better: 'lower',
    },
  ];

  const now = clock(duel.ticks);
  const describeLane = (lane: SearchLane, sum: SearchSummary) =>
    lane.liveTier
      ? `${lane.label}: recall@10 ${Math.round(sum.recall)}%, ${sum.segmentsPerQuery.toFixed(1)} segments searched per query`
      : `${lane.label}: recall@10 ${Math.round(sum.recall)}%, ${count(sum.pendingAdded)} new documents not yet searchable`;
  const summary = started
    ? `${now} of 24:00 simulated. ${describeLane(first, sums[0])}. ${describeLane(second, sums[1])}.`
    : `00:00 of 24:00 simulated. ${searchScenarios[scenarioId].label}. No queries yet.`;

  const chartTitle = 'Recall@10 (%) per 15 minutes; at 1× speed each axis second is one simulated hour';
  const latest = (lane: SearchLane) => Math.round(lane.recall.at(-1) ?? 100);
  const chartSummary = started
    ? `Recall@10 at ${now}. ${first.label} ${latest(first)}%, ${second.label} ${latest(second)}%.`
    : 'Recall@10 chart, empty until the run starts.';

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${now} of 24:00` } as const)
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
      ticksPerSecond={TICKS_PER_SECOND}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole day so far, same documents and queries for both"
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
          label: searchScenarios[id].label,
          diff: searchScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.label}
            duel={duel}
            lane={lane}
            summary={sums[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
          />
        ))}
      </div>
      <ul className="sdv-legend" aria-label="How to read the lanes">
        <li>Full signals: text match plus offline quality and click scores</li>
        <li>Text match only: a neutral quality guess until the next build</li>
        <li>L0 to L3: merge level of a live segment, then its document count</li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.recall,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={PLAYBACK_SECONDS_PER_TICK}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={100}
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
                <time>{event.clock}</time> {event.text}
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
