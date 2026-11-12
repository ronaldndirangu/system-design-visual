import { useId, useReducer, useRef, useState } from 'react';
import {
  CELL_HEIGHT_KM,
  CELL_WIDTH_KM,
  CITY_COLUMNS,
  CITY_HEIGHT_KM,
  CITY_PRECISION,
  CITY_PREFIX,
  CITY_ROWS,
  CITY_WIDTH_KM,
  cellByHash,
  cellHashAt,
  cityCells,
  type Driver,
  DUEL_SECONDS,
  formatDistance,
  laneLabels,
  type RequestResult,
  RideMatchDuel,
  type RideScenarioId,
  rideScenarios,
} from '../../lib/models/rideSharing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { safeId } from '../viz/SystemNode';
import './DriverMatchWidget.css';

interface Props {
  scenarios?: RideScenarioId[];
  initial?: RideScenarioId;
  title?: string;
  instructions?: string;
}

const TICKS_PER_SECOND = 2;
/** SVG units per kilometer; the whole city fits a 375 px phone at this scale. */
const SCALE = 48;
const PAD = 4;
const MAP_WIDTH = Math.round(CITY_WIDTH_KM * SCALE + PAD * 2);
const MAP_HEIGHT = Math.round(CITY_HEIGHT_KM * SCALE + PAD * 2);
const CELL_W = CELL_WIDTH_KM * SCALE;
const CELL_H = CELL_HEIGHT_KM * SCALE;
const MAX_DRAWN = 120;

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const sx = (x: number) => PAD + x * SCALE;
// North is up, so larger y in the city means a smaller SVG y.
const sy = (y: number) => PAD + (CITY_HEIGHT_KM - y) * SCALE;
const count = (value: number) => value.toLocaleString('en-US');
const cellLabel = (hash: string) => cellByHash.get(hash)?.label ?? hash;

function drawnDrivers(drivers: Driver[], keep: (number | null)[]): Driver[] {
  const stride = Math.ceil(drivers.length / MAX_DRAWN);
  return drivers.filter((driver) => driver.id % stride === 0 || keep.includes(driver.id));
}

function scanText(result: RequestResult): string[] {
  const lines = [
    `Request ${result.request.id}: measured the distance to all ${result.checks[0]} free drivers in the city.`,
  ];
  lines.push(
    result.driverId === null
      ? 'No free driver anywhere.'
      : `Chose driver ${result.driverId}, ${formatDistance(result.distanceKm)} away.`,
  );
  return lines;
}

function cellText(result: RequestResult): string[] {
  const cells = result.searchedCells.length;
  const lines = [
    `Request ${result.request.id}: rider in cell ${cellLabel(result.riderCell)}. Looked up ${cells} cells and measured ${result.checks[1]} free drivers.`,
  ];
  if (result.widenReason === 'empty') {
    lines.push(
      `None of the first 9 cells held a free driver, so the search widened ring by ring to ${cells}.`,
    );
  } else if (result.widenReason === 'too-far') {
    lines.push(
      `The best driver in the first 9 cells sat farther away than the edge of the searched square, so a closer driver could wait one ring out. The search widened to ${cells} cells.`,
    );
  }
  if (result.driverId === null || !result.driverAt) {
    lines.push('No free driver anywhere.');
    return lines;
  }
  lines.push(`Chose driver ${result.driverId}, ${formatDistance(result.distanceKm)} away.`);
  const matchCell = cellHashAt(result.driverAt.x, result.driverAt.y);
  if (matchCell !== result.riderCell) {
    const alone =
      result.sameCellDriverId === null
        ? 'found nobody'
        : `sent driver ${result.sameCellDriverId}, ${formatDistance(result.sameCellDistanceKm)} away`;
    lines.push(
      `That driver waits in cell ${cellLabel(matchCell)}, outside the rider's cell. A search of the rider's cell alone would have ${alone}.`,
    );
  }
  return lines;
}

function mapLabel(duel: RideMatchDuel, lane: 0 | 1): string {
  const base = `City map: ${CITY_COLUMNS} × ${CITY_ROWS} geohash cells under ${CITY_PREFIX}, ${duel.drivers.length} drivers.`;
  const result = duel.lastResult;
  if (!result) return `${base} No ride request yet.`;
  const searched =
    lane === 0
      ? 'The whole city is hatched because the scan measures every free driver.'
      : `${result.searchedCells.length} cells around the rider are hatched.`;
  const match =
    result.driverId === null
      ? 'No driver matched.'
      : `The matched driver is ${formatDistance(result.distanceKm)} away.`;
  return `${base} The rider waits in cell ${cellLabel(result.riderCell)}. ${searched} ${match}`;
}

function CityMap({ duel, lane, variant }: { duel: RideMatchDuel; lane: 0 | 1; variant: SeriesVariant }) {
  const hatchId = safeId(useId(), `ride-hatch-${variant}`);
  const result = duel.lastResult;
  const shown = drawnDrivers(duel.drivers, [result?.driverId ?? null, result?.sameCellDriverId ?? null]);
  const riderCell = result ? cellByHash.get(result.riderCell) : undefined;
  const searched =
    result && lane === 1
      ? result.searchedCells.flatMap((hash) => {
          const cell = cellByHash.get(hash);
          return cell ? [cell] : [];
        })
      : [];
  const riderX = result ? sx(result.request.x) : 0;
  const riderY = result ? sy(result.request.y) : 0;
  return (
    <figure className="sdv-ride__figure">
      <svg
        className="sdv-ride__map"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label={mapLabel(duel, lane)}
      >
        <defs>
          <pattern
            id={hatchId}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <line className={`sdv-ride__hatch sdv-ride__hatch--${variant}`} x1="0" y1="0" x2="0" y2="6" />
          </pattern>
        </defs>
        {result && lane === 0 && (
          <rect
            className="sdv-ride__searched"
            x={PAD}
            y={PAD}
            width={CITY_WIDTH_KM * SCALE}
            height={CITY_HEIGHT_KM * SCALE}
            fill={`url(#${hatchId})`}
          />
        )}
        {searched.map((cell) => (
          <rect
            key={cell.hash}
            className="sdv-ride__searched"
            x={sx(cell.col * CELL_WIDTH_KM)}
            y={sy((cell.row + 1) * CELL_HEIGHT_KM)}
            width={CELL_W}
            height={CELL_H}
            fill={`url(#${hatchId})`}
          />
        ))}
        {cityCells.map((cell) => {
          const x = sx(cell.col * CELL_WIDTH_KM);
          const y = sy((cell.row + 1) * CELL_HEIGHT_KM);
          return (
            <g key={cell.hash}>
              <rect className="sdv-ride__cell" x={x} y={y} width={CELL_W} height={CELL_H} />
              <text className="sdv-ride__label" x={x + 2} y={y + 2}>
                {cell.label}
              </text>
            </g>
          );
        })}
        {riderCell && (
          <rect
            className="sdv-ride__home"
            x={sx(riderCell.col * CELL_WIDTH_KM)}
            y={sy((riderCell.row + 1) * CELL_HEIGHT_KM)}
            width={CELL_W}
            height={CELL_H}
          />
        )}
        {shown.map((driver) => (
          <circle
            key={driver.id}
            className="sdv-ride__driver"
            data-busy={driver.busyUntil !== null ? '' : undefined}
            cx={sx(driver.x)}
            cy={sy(driver.y)}
            r="2.6"
          />
        ))}
        {result?.driverAt && (
          <g>
            <line
              className="sdv-ride__link"
              x1={riderX}
              y1={riderY}
              x2={sx(result.driverAt.x)}
              y2={sy(result.driverAt.y)}
            />
            <circle
              className={`sdv-ride__match sdv-ride__match--${variant}`}
              cx={sx(result.driverAt.x)}
              cy={sy(result.driverAt.y)}
              r="7"
            />
          </g>
        )}
        {result && (
          <path
            className="sdv-ride__rider"
            d={`M ${riderX} ${riderY - 6} L ${riderX + 6} ${riderY} L ${riderX} ${riderY + 6} L ${riderX - 6} ${riderY} Z`}
          />
        )}
      </svg>
      <figcaption className="sdv-ride__caption">
        Cells are precision {CITY_PRECISION} geohashes; every label continues the prefix {CITY_PREFIX}.{' '}
        {shown.length < duel.drivers.length
          ? `Map shows ${shown.length} of ${duel.drivers.length} drivers.`
          : `Map shows all ${duel.drivers.length} drivers.`}
      </figcaption>
    </figure>
  );
}

function LanePane({ duel, lane, variant }: { duel: RideMatchDuel; lane: 0 | 1; variant: SeriesVariant }) {
  const label = laneLabels[lane];
  const result = duel.lastResult;
  const totals = duel.lanes[lane];
  const lines = result
    ? lane === 0
      ? scanText(result)
      : cellText(result)
    : ['Waiting for the first ride request.'];
  return (
    <section className="sdv-duel__lane" aria-label={label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {label}
      </h4>
      <CityMap duel={duel} lane={lane} variant={variant} />
      <div className="sdv-ride__notes">
        {lines.map((line) => (
          <p key={line} className="sdv-ride__note">
            {line}
          </p>
        ))}
        <p className="sdv-ride__note sdv-ride__note--total">
          So far: {count(totals.checks)} distance checks for {duel.results.length}{' '}
          {duel.results.length === 1 ? 'request' : 'requests'}.
        </p>
      </div>
    </section>
  );
}

function LegendGlyph({ kind }: { kind: 'free' | 'busy' | 'rider' | 'match' | 'hatch' | 'home' }) {
  return (
    <svg className="sdv-ride__glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === 'free' && <circle className="sdv-ride__driver" cx="8" cy="8" r="3.5" />}
      {kind === 'busy' && <circle className="sdv-ride__driver" data-busy="" cx="8" cy="8" r="3.5" />}
      {kind === 'rider' && <path className="sdv-ride__rider" d="M 8 2 L 14 8 L 8 14 L 2 8 Z" />}
      {kind === 'match' && <circle className="sdv-ride__match sdv-ride__match--b" cx="8" cy="8" r="5.5" />}
      {kind === 'hatch' && (
        <>
          <rect className="sdv-ride__cell" x="1" y="1" width="14" height="14" />
          <path className="sdv-ride__hatch sdv-ride__hatch--b" d="M 1 9 L 9 1 M 1 15 L 15 1 M 7 15 L 15 7" />
        </>
      )}
      {kind === 'home' && <rect className="sdv-ride__home" x="2" y="2" width="12" height="12" />}
    </svg>
  );
}

export default function DriverMatchWidget({
  scenarios = ['dense', 'edge', 'sparse'],
  initial,
  title = 'Same city, two ways to find a driver',
  instructions = 'A toy city of 10 × 10 geohash cells. Pick a scenario, then press Play. Both lanes watch the same drivers move and answer the same ride requests; only the way they search differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<RideScenarioId>(initial ?? scenarios[0] ?? 'dense');
  const duelRef = useRef<RideMatchDuel | null>(null);
  if (!duelRef.current) duelRef.current = new RideMatchDuel(rideScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const restart = (id: RideScenarioId) => {
    duelRef.current = new RideMatchDuel(rideScenarios[id]);
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
  const chooseScenario = (id: RideScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [scan, cells] = duel.lanes;
  const requests = duel.results.length;
  const perRequest = (value: number) => (requests > 0 ? value / requests : 0);
  const average = (lane: 0 | 1) => {
    const totals = duel.lanes[lane];
    return totals.matched > 0 ? totals.distanceKm / totals.matched : 0;
  };
  const distance = (value: number, column: number) =>
    (duel.lanes[column as 0 | 1]?.matched ?? 0) > 0 ? formatDistance(value) : 'none yet';

  const rows: CompareRow[] = [
    {
      label: 'Distance checks per request',
      values: [perRequest(scan.checks), perRequest(cells.checks)],
      format: (value) => count(Math.round(value)),
      better: 'lower',
    },
    {
      label: 'Distance checks, total',
      values: [scan.checks, cells.checks],
      format: count,
      better: 'lower',
    },
    { label: 'Location writes (same pings for both)', values: [duel.pings, duel.pings], format: count },
    {
      label: 'Index updates (a driver changed cell)',
      values: [0, duel.cellMoves],
      format: (value, column) => (column === 0 ? 'no index' : count(value)),
    },
    { label: 'Average match distance', values: [average(0), average(1)], format: distance },
    {
      label: 'Riders matched',
      values: [scan.matched, cells.matched],
      format: (value) => `${value} of ${requests}`,
      better: 'higher',
    },
  ];

  const summary = `${duel.ticks} s of ${DUEL_SECONDS} s. ${laneLabels[0]}: ${count(scan.checks)} distance checks. ${laneLabels[1]}: ${count(cells.checks)} distance checks. ${cells.matched} of ${requests} riders matched.`;
  const chartTitle = 'Distance checks, running total';
  const chartSummary = `${chartTitle} after ${duel.ticks} s. ${laneLabels[0]} ${count(scan.checks)}, ${laneLabels[1].toLowerCase()} ${count(cells.checks)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${duel.ticks} s of ${DUEL_SECONDS} s` } as const);

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
          caption="Whole run so far, same drivers and riders for both"
          columns={[laneLabels[0], laneLabels[1]]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: rideScenarios[id].label,
          diff: rideScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {variants.map((variant, index) => (
          <LanePane key={variant} duel={duel} lane={index as 0 | 1} variant={variant} />
        ))}
      </div>
      <ul className="sdv-legend sdv-ride__legend" aria-label="How to read the maps">
        <li>
          <LegendGlyph kind="free" /> Free driver
        </li>
        <li>
          <LegendGlyph kind="busy" /> Driver on a trip
        </li>
        <li>
          <LegendGlyph kind="rider" /> Rider
        </li>
        <li>
          <LegendGlyph kind="match" /> Matched driver, where it stood at match time
        </li>
        <li>
          <LegendGlyph kind="hatch" /> Hatched: cells the lane searched
        </li>
        <li>
          <LegendGlyph kind="home" /> Thick outline: the rider's cell
        </li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={variants.map((variant, index) => ({
          label: laneLabels[index as 0 | 1],
          values: duel.trace[index as 0 | 1],
          variant,
        }))}
        length={DUEL_SECONDS}
        tickSeconds={1}
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
                <time>{event.tick} s</time> {event.text}
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
