import { m } from 'motion/react';
import { useReducer, useRef, useState } from 'react';
import {
  FANOUT,
  formatCount,
  formatDuration,
  IX_SECONDS,
  IxDuel,
  type IxLane,
  type IxLookup,
  type IxScenarioId,
  ixScenarios,
  levelPages,
} from '../../lib/models/indexes';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { UiIcon } from '../viz/icons';
import './IndexesWidget.css';

interface Props {
  scenarios?: IxScenarioId[];
  initial?: IxScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const TILES = 50;
const QUEUE_SHOWN = 12;
const TOY_FANOUT = 3;
const CHART_TITLE = 'Lookups waiting for an answer';

/** The lookup a lane is reading for now, or the one it answered last, with how far it got. */
function focus(duel: IxDuel, lane: IxLane): { lookup?: IxLookup; progress: number; live: boolean } {
  const head = lane.waiting[0];
  if (head)
    return {
      lookup: duel.lookup(head.id),
      progress: duel.headPagesRead(lane) / lane.pagesPerLookup,
      live: true,
    };
  if (lane.lastAnswered > 0) return { lookup: duel.lookup(lane.lastAnswered), progress: 1, live: false };
  return { progress: 0, live: false };
}

function listJoin(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function levelNames(levels: number): string[] {
  return Array.from({ length: levels }, (_, level) =>
    level === 0 ? 'Root' : level === levels - 1 ? 'Leaf' : 'Branch',
  );
}

function ScanPages({ duel, lane }: { duel: IxDuel; lane: IxLane }) {
  const { lookup, progress, live } = focus(duel, lane);
  const filled = progress * TILES;
  const matchTile = lookup ? Math.floor(lookup.rowAt * TILES) : -1;
  const read = progress * lane.pagesPerLookup;
  const caption = lookup
    ? live
      ? `Code ${lookup.code}: read ${formatCount(read)} of ${formatCount(lane.pagesPerLookup)} pages (${(progress * 100).toFixed(progress < 0.1 ? 2 : 0)}%)`
      : `Code ${lookup.code}: read all ${formatCount(lane.pagesPerLookup)} pages, then answered`
    : 'No lookup yet';
  return (
    <div className="sdv-ix__scan">
      <p className="sdv-ix__label">Table pages, read in order</p>
      <div className="sdv-ix__tiles" role="img" aria-label={caption}>
        {Array.from({ length: TILES }, (_, tile) => {
          const fill = Math.min(1, Math.max(0, filled - tile));
          const passed = tile === matchTile && fill > 0;
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: tiles are fixed slots of the table
              key={tile}
              className="sdv-ix__tile"
              data-state={fill >= 1 ? 'read' : fill > 0 ? 'reading' : 'unread'}
              data-match={passed || undefined}
            >
              <span className="sdv-ix__tile-fill" style={{ transform: `scaleX(${fill})` }} />
              {passed && <UiIcon name="check" />}
            </span>
          );
        })}
      </div>
      <p className="sdv-ix__muted">{caption}.</p>
      <p className="sdv-ix__muted">
        Each tile stands for {formatCount(lane.pagesPerLookup / TILES)} pages.
        {lookup && matchTile >= 0 && progress * TILES > matchTile
          ? ` The check marks the page that held the match; the scan keeps reading because nothing proves it is the only one.`
          : ''}
      </p>
    </div>
  );
}

function ToyTree({ duel, lane }: { duel: IxDuel; lane: IxLane }) {
  const reduced = usePrefersReducedMotion();
  const { lookup } = focus(duel, lane);
  const levels = levelPages(duel.scenario.rows).length;
  const names = [...levelNames(levels), 'Table'];
  const rows = names.map((name, row) => ({ name, row, id: `level-${row}` }));
  const boxW = 46;
  const boxH = 22;
  const gap = 10;
  const left = 54;
  const pitch = 38;
  const width = left + TOY_FANOUT * boxW + (TOY_FANOUT - 1) * gap + 2;
  const height = (names.length - 1) * pitch + boxH + 4;
  const bx = (slot: number) => left + slot * (boxW + gap);
  const by = (row: number) => 2 + row * pitch;
  const slots = (row: number) => (row === 0 ? [1] : Array.from({ length: TOY_FANOUT }, (_, slot) => slot));
  const path = names.map((_, row) => {
    if (row === 0 || !lookup) return 1;
    if (row === levels) return Math.min(TOY_FANOUT - 1, Math.floor(lookup.rowAt * TOY_FANOUT));
    return Math.floor(lookup.keyAt * TOY_FANOUT ** row) % TOY_FANOUT;
  });
  const steps = names
    .slice(1)
    .map((name, index) => `${name.toLowerCase()} page ${(path[index + 1] ?? 1) + 1} of ${TOY_FANOUT}`);
  const label = lookup
    ? `Toy tree for code ${lookup.code}: root, then ${steps.join(', then ')}.`
    : 'Toy tree with no lookup yet.';
  return (
    <svg className="sdv-ix__tree" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {rows.slice(0, -1).map(({ row, id }) => {
        const from = path[row] ?? 1;
        const targets = row === levels - 1 ? [path[row + 1] ?? 1] : slots(row + 1);
        return targets.map((slot) => (
          <line
            key={`${id}-${slot}`}
            className="sdv-ix__edge"
            data-path={(Boolean(lookup) && slot === path[row + 1]) || undefined}
            x1={bx(from) + boxW / 2}
            y1={by(row) + boxH}
            x2={bx(slot) + boxW / 2}
            y2={by(row + 1)}
          />
        ));
      })}
      {rows.map(({ name, row, id }) => (
        <g key={id}>
          <text className="sdv-ix__tree-label" x={0} y={by(row) + boxH / 2 + 4}>
            {name}
          </text>
          {slots(row).map((slot) => {
            const onPath = Boolean(lookup) && slot === path[row];
            const box = { x: bx(slot), y: by(row), width: boxW, height: boxH, rx: 4 };
            return (
              <g key={slot}>
                {onPath ? (
                  <m.rect
                    key={`${lane.lastAnswered}-${id}`}
                    className="sdv-ix__page"
                    data-path
                    {...box}
                    initial={{ opacity: reduced ? 1 : 0.2 }}
                    animate={{ opacity: 1 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.2, delay: row * 0.06 }}
                  />
                ) : (
                  <rect className="sdv-ix__page" data-table={row === levels || undefined} {...box} />
                )}
                {onPath && (
                  <text className="sdv-ix__page-step" x={bx(slot) + boxW / 2} y={by(row) + boxH / 2 + 4}>
                    {row + 1}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

function IndexPath({ duel, lane }: { duel: IxDuel; lane: IxLane }) {
  const pages = levelPages(duel.scenario.rows);
  const counts = pages.map((count) => formatCount(count));
  return (
    <div className="sdv-ix__index">
      <p className="sdv-ix__label">Pages read, numbered in order (toy tree, 3 children per page)</p>
      <ToyTree duel={duel} lane={lane} />
      <p className="sdv-ix__muted">
        Real tree at this size: {pages.length} levels holding {listJoin(counts)} pages, {FANOUT} keys per page
        (illustrative). Each lookup reads one page per level, then one table page.
      </p>
    </div>
  );
}

function LanePane({ duel, lane, variant }: { duel: IxDuel; lane: IxLane; variant: SeriesVariant }) {
  const { lookup, live } = focus(duel, lane);
  const waiting = lane.waiting.length;
  return (
    <section className="sdv-duel__lane sdv-ix__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <code className="sdv-ix__statement">{lane.statement}</code>
      <dl className="sdv-ix__facts">
        <div>
          <dt>Pages per lookup</dt>
          <dd>{formatCount(lane.pagesPerLookup)}</dd>
        </div>
        <div>
          <dt>Time per lookup</dt>
          <dd>{formatDuration(lane.pagesPerLookup * lane.pageUs)}</dd>
        </div>
        <div>
          <dt>Answered</dt>
          <dd>
            <m.strong
              key={lane.answered}
              initial={{ scale: 1.25, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              {lane.answered}
            </m.strong>{' '}
            of {duel.issued}
          </dd>
        </div>
        <div>
          <dt>{live ? 'Reading for' : 'Last answered'}</dt>
          <dd>{lookup ? <code>{lookup.code}</code> : 'None yet'}</dd>
        </div>
      </dl>
      {lane.kind === 'scan' ? <ScanPages duel={duel} lane={lane} /> : <IndexPath duel={duel} lane={lane} />}
      <div className="sdv-ix__queue-wrap">
        <p className="sdv-ix__label">Waiting for an answer ({waiting})</p>
        {waiting === 0 ? (
          <p className="sdv-ix__muted">Nobody waiting</p>
        ) : (
          <p className="sdv-ix__queue">
            {lane.waiting.slice(0, QUEUE_SHOWN).map((item) => (
              <span key={item.id} className="sdv-ix__dot" aria-hidden="true" />
            ))}
            {waiting > QUEUE_SHOWN && <span>+{waiting - QUEUE_SHOWN} more</span>}
          </p>
        )}
      </div>
    </section>
  );
}

function compareRows(duel: IxDuel): CompareRow[] {
  const [scan, index] = duel.lanes;
  const count = (value: number) => formatCount(value);
  return [
    { label: 'Lookups so far (same for both)', values: [duel.issued, duel.issued] },
    {
      label: 'Pages per lookup (illustrative)',
      values: [scan.pagesPerLookup, index.pagesPerLookup],
      format: count,
      better: 'lower',
    },
    {
      label: 'Time per lookup (illustrative)',
      values: [scan.pagesPerLookup * scan.pageUs, index.pagesPerLookup * index.pageUs],
      format: formatDuration,
      better: 'lower',
    },
    { label: 'Answered', values: [scan.answered, index.answered], better: 'higher' },
    { label: 'Still waiting', values: [scan.waiting.length, index.waiting.length], better: 'lower' },
    { label: 'Pages read so far', values: [scan.pagesRead, index.pagesRead], format: count, better: 'lower' },
    {
      label: 'Longest wait',
      values: [duel.longestWaitUs(scan), duel.longestWaitUs(index)],
      format: formatDuration,
      better: 'lower',
    },
  ];
}

function laneSentence(lane: IxLane): string {
  return `${lane.label}: ${lane.answered} answered, ${lane.waiting.length} waiting, ${formatCount(lane.pagesRead)} pages read`;
}

export default function IndexesWidget({
  scenarios = ['small', 'medium', 'huge'],
  initial,
  title = 'Same lookups, scan versus index',
  instructions = 'Pick a table size, then press Play. Both lanes replay the same 43 redirect lookups against the same table; only the index differs. Page counts and times are illustrative.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<IxScenarioId>(initial ?? scenarios[0] ?? 'small');
  const duelRef = useRef<IxDuel | null>(null);
  if (!duelRef.current) duelRef.current = new IxDuel(ixScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: IxScenarioId) => {
    duelRef.current = new IxDuel(ixScenarios[id]);
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
  const chooseScenario = (id: IxScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const seconds = duel.ticks * duel.tickSeconds;
  const summary = `${seconds.toFixed(1)} s of ${IX_SECONDS} s, ${duel.issued} lookups so far. ${laneSentence(first)}. ${laneSentence(second)}.`;
  const latest = (lane: IxLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${CHART_TITLE}. ${first.label} ${latest(first)}, ${second.label} ${latest(second)}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${IX_SECONDS} s` } as const);

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
          caption="Whole run so far, same lookups for both (illustrative)"
          columns={[first.label, second.label]}
          rows={compareRows(duel)}
        />
      }
    >
      <ScenarioChips
        label="Table size"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: ixScenarios[id].label,
          diff: ixScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <code className="sdv-ix__statement sdv-ix__query">SELECT long_url FROM links WHERE code = ?</code>
      <MotionRoot>
        <div className="sdv-duel__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane key={lane.label} duel={duel} lane={lane} variant={variants[index] ?? 'a'} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-ix__legend" aria-label="How to read the lanes">
        <li>
          <span className="sdv-ix__key" data-state="read" aria-hidden="true" /> Table page read
        </li>
        <li>
          <span className="sdv-ix__key" data-state="unread" aria-hidden="true" /> Table page not read yet
        </li>
        <li>
          <span className="sdv-ix__key" data-state="match" aria-hidden="true">
            <UiIcon name="check" />
          </span>{' '}
          Page that held the match
        </li>
        <li>
          <span className="sdv-ix__key" data-state="path" aria-hidden="true" /> Page on the lookup's path,
          numbered in read order
        </li>
        <li>
          <span className="sdv-ix__dot" aria-hidden="true" /> One lookup waiting
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
        minMax={10}
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
