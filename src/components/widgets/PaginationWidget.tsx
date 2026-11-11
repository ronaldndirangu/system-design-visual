import { m } from 'motion/react';
import { useReducer, useRef, useState } from 'react';
import {
  liveLinks,
  PG_PAGE_SIZE,
  PG_TICKS,
  type PgCellState,
  PgDuel,
  type PgLane,
  type PgLink,
  type PgScenarioId,
  pgCellState,
  pgScenarios,
} from '../../lib/models/apis';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './PaginationWidget.css';

const COLUMNS = 10;
/** One grid step as a share of a cell, so a moved cell can start from its old slot. */
const STEP_PERCENT = 112;

interface Props {
  scenarios?: PgScenarioId[];
  initial?: PgScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

/** The list as it stood one tick earlier, so each cell knows where it came from. */
function previousPositions(links: readonly PgLink[], ticks: number): Map<number, number> {
  const before = Math.max(ticks - 2, -1);
  const earlier = links.filter(
    (link) => link.createdAt <= before && (link.deletedAt === null || link.deletedAt > before),
  );
  return new Map(liveLinks(earlier).map((link, index) => [link.id, index]));
}

function cellCounts(lane: PgLane, list: readonly PgLink[]): Record<PgCellState, number> {
  const counts: Record<PgCellState, number> = { unseen: 0, once: 0, multi: 0, skipped: 0, new: 0 };
  list.forEach((link, index) => {
    counts[pgCellState(lane, link, index)] += 1;
  });
  return counts;
}

function gridLabel(lane: PgLane, list: readonly PgLink[], next: readonly number[]): string {
  const counts = cellCounts(lane, list);
  const upcoming =
    next.length > 0 ? `The next page would return #${next[0]} to #${next.at(-1)}.` : 'No more pages to load.';
  return `${list.length} links, newest first. ${counts.once} shown once, ${counts.multi} shown twice or more, ${counts.skipped} skipped, ${counts.new} new and not shown, ${counts.unseen} not reached yet. ${upcoming}`;
}

function ListGrid({
  lane,
  list,
  nextPage,
  previous,
}: {
  lane: PgLane;
  list: readonly PgLink[];
  nextPage: readonly number[];
  previous: Map<number, number>;
}) {
  const next = new Set(nextPage);
  return (
    <div className="sdv-pg__grid" role="img" aria-label={gridLabel(lane, list, nextPage)}>
      {list.map((link, index) => {
        const count = lane.shown[link.id] ?? 0;
        const from = previous.get(link.id);
        const moved = from !== undefined && from !== index;
        const dx = moved ? (from % COLUMNS) - (index % COLUMNS) : 0;
        const dy = moved ? Math.floor(from / COLUMNS) - Math.floor(index / COLUMNS) : 0;
        const initial =
          from === undefined
            ? { opacity: 0, scale: 0.5 }
            : moved
              ? { x: `${dx * STEP_PERCENT}%`, y: `${dy * STEP_PERCENT}%` }
              : false;
        return (
          <m.span
            // biome-ignore lint/suspicious/noArrayIndexKey: the slot is in the key so a moved link remounts and slides from its old slot
            key={`${link.id}:${index}`}
            className="sdv-pg__cell"
            data-state={pgCellState(lane, link, index)}
            data-next={next.has(link.id) ? '' : undefined}
            initial={initial}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            aria-hidden="true"
          >
            {link.id}
            {count > 1 && <span className="sdv-pg__times">×{count}</span>}
          </m.span>
        );
      })}
    </div>
  );
}

function LanePane({
  duel,
  lane,
  variant,
  list,
  previous,
}: {
  duel: PgDuel;
  lane: PgLane;
  variant: SeriesVariant;
  list: readonly PgLink[];
  previous: Map<number, number>;
}) {
  const totals = duel.totals(lane);
  return (
    <section className="sdv-duel__lane sdv-pg__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <div className="sdv-pg__exchange">
        <p className="sdv-pg__label">Last request</p>
        <code className="sdv-pg__request">{lane.request}</code>
        <p className="sdv-pg__response">{lane.response}</p>
      </div>
      <ListGrid lane={lane} list={list} nextPage={duel.nextWindow(lane)} previous={previous} />
      <p className="sdv-pg__tally">
        <strong>{totals.stable}</strong> original links = {totals.once} shown once + {totals.multi} shown
        twice or more + {totals.skipped} skipped
        {totals.ahead > 0 && ` + ${totals.ahead} not reached yet`}
      </p>
      <p className="sdv-pg__muted">
        {totals.missedNew} new links not shown. The database walked {lane.rowsScanned} rows (illustrative).
      </p>
    </section>
  );
}

function compareRows(duel: PgDuel): CompareRow[] {
  const [a, b] = duel.lanes;
  const first = duel.totals(a);
  const second = duel.totals(b);
  return [
    { label: 'Pages fetched', values: [a.pages, b.pages] },
    { label: 'Rows shown', values: [a.rowsShown, b.rowsShown] },
    { label: 'Repeated rows', values: [first.duplicates, second.duplicates], better: 'lower' },
    { label: 'Links skipped', values: [first.skipped, second.skipped], better: 'lower' },
    { label: 'New links not shown yet', values: [first.missedNew, second.missedNew] },
    {
      label: 'Rows the database walked (illustrative)',
      values: [a.rowsScanned, b.rowsScanned],
      better: 'lower',
    },
  ];
}

function latestChange(duel: PgDuel): string {
  const applied = duel.mutations.filter((mutation) => mutation.tick < duel.ticks);
  const last = applied.at(-1);
  if (!last) {
    const changes = duel.scenario.createRate + duel.scenario.deleteRate > 0;
    return changes ? 'none yet' : 'none in this scenario';
  }
  const verb = last.kind === 'create' ? 'created' : 'deleted';
  return `#${last.id} ${verb} at ${(last.tick * duel.tickSeconds).toFixed(0)} s`;
}

function laneSentence(duel: PgDuel, lane: PgLane): string {
  const totals = duel.totals(lane);
  const state = lane.finishedAt === null ? '' : ', finished';
  return `${lane.label}: ${lane.pages} pages${state}, ${totals.duplicates} repeated rows, ${totals.skipped} links skipped`;
}

const CHART_TITLE = 'Repeated rows plus links skipped, running total';

export default function PaginationWidget({
  scenarios = ['busy', 'cleanup', 'both', 'quiet'],
  initial,
  title = 'Same list, two ways to ask for the next page',
  instructions = 'Pick a scenario, then press Play. Both clients page through the same links while the same creates and deletes happen; only the request for the next page differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<PgScenarioId>(initial ?? scenarios[0] ?? 'busy');
  const duelRef = useRef<PgDuel | null>(null);
  if (!duelRef.current) duelRef.current = new PgDuel(pgScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: PgScenarioId) => {
    duelRef.current = new PgDuel(pgScenarios[id]);
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
  const chooseScenario = (id: PgScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const list = duel.list;
  const previous = previousPositions(duel.links, duel.ticks);
  const created = duel.links.filter((link) => link.createdAt >= 0).length;
  const deleted = duel.links.filter((link) => link.deletedAt !== null).length;
  const seconds = duel.ticks * duel.tickSeconds;
  const summary = `${seconds.toFixed(0)} s of ${PG_TICKS} s. ${list.length} links in the list. ${laneSentence(duel, first)}. ${laneSentence(duel, second)}.`;
  const latestHarm = (lane: PgLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${CHART_TITLE}. ${first.label} ${latestHarm(first)}, ${second.label.toLowerCase()} ${latestHarm(second)}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(0)} s of ${PG_TICKS} s` } as const);

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
      ticksPerSecond={2}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same list and same changes for both"
          columns={[first.label, second.label]}
          rows={compareRows(duel)}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: pgScenarios[id].label,
          diff: pgScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <p className="sdv-pg__changes">
        <strong>{list.length} links</strong> in the list now. Created so far: {created}. Deleted so far:{' '}
        {deleted}. Latest change: {latestChange(duel)}.
      </p>
      <MotionRoot>
        <div className="sdv-duel__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane
              key={lane.label}
              duel={duel}
              lane={lane}
              variant={variants[index] ?? 'a'}
              list={list}
              previous={previous}
            />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-pg__legend" aria-label="How to read the link grids">
        <li>Each square is one link, labeled with its id, newest first. A page holds {PG_PAGE_SIZE}.</li>
        <li>
          <span className="sdv-pg__key" data-state="unseen" aria-hidden="true" /> Not reached yet
        </li>
        <li>
          <span className="sdv-pg__key" data-state="once" aria-hidden="true" /> Shown once
        </li>
        <li>
          <span className="sdv-pg__key" data-state="multi" aria-hidden="true" /> Shown twice or more
        </li>
        <li>
          <span className="sdv-pg__key" data-state="skipped" aria-hidden="true" /> Skipped: paged past, never
          shown
        </li>
        <li>
          <span className="sdv-pg__key" data-state="new" aria-hidden="true" /> Created during the run
        </li>
        <li>
          <span className="sdv-pg__key" data-state="unseen" data-next="" aria-hidden="true" /> What the next
          request would return now
        </li>
      </ul>
      <TraceChart
        title={CHART_TITLE}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={5}
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
                <time>{(event.tick * duel.tickSeconds).toFixed(0)} s</time> {event.text}
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
