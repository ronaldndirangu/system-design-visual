import { createRng, type SeededRng } from '../rng';
import type { DuelEvent } from './balancerDuel';
import { SECONDS_PER_DAY } from './estimates';
import { decodeGeohash, encodeGeohash, geohashRing, KM_PER_DEGREE } from './geohash';

/**
 * Ride sharing toy model. Back of envelope estimates first, then a seeded
 * duel: one city of moving drivers and one list of ride requests, matched two
 * ways. The scan measures the distance to every free driver. The cell search
 * looks up the rider's geohash cell and its 8 neighbors, widening ring by ring
 * only when it cannot yet be sure it holds the nearest driver. Both always
 * pick the same driver; only the work differs.
 */

// Illustrative estimates. Every figure is a round assumption for teaching.
export const rideEstimates = {
  onlineDrivers: 200_000,
  pingSeconds: 4,
  bytesPerIndexEntry: 100,
  ridesPerDay: 10_000_000,
  peakFactor: 3,
  bytesPerHistoryPoint: 40,
  speedKmh: 36,
  cellKm: 0.61,
} as const;

export function locationWritesPerSecond(drivers: number, pingSeconds: number): number {
  return drivers / pingSeconds;
}

export function indexMemoryBytes(drivers: number, bytesPerEntry: number): number {
  return drivers * bytesPerEntry;
}

export function rideRequestsPerSecond(ridesPerDay: number, peakFactor: number) {
  const average = ridesPerDay / SECONDS_PER_DAY;
  return { average, peak: average * peakFactor };
}

/** The naive design measures the distance to every online driver for every request. */
export function naiveChecksPerSecond(drivers: number, requestsPerSecond: number): number {
  return drivers * requestsPerSecond;
}

export function historyBytesPerDay(writesPerSecond: number, bytesPerPoint: number): number {
  return writesPerSecond * bytesPerPoint * SECONDS_PER_DAY;
}

/**
 * Share of pings that cross a cell edge, for a short hop of `stepKm` in a
 * random direction inside a square cell of side `cellKm`. Averaging the hop's
 * horizontal and vertical reach over every direction gives the 4/π factor.
 */
export function cellChangeShare(stepKm: number, cellKm: number): number {
  return Math.min(1, (4 / Math.PI) * (stepKm / cellKm));
}

// The toy city: a 10 × 10 block of precision 6 cells inside the precision 4
// cell u4pr, which holds the classic test point at 57.6° N. Cells there are
// close to square, so kilometers map neatly onto the grid.
export const CITY_PREFIX = 'u4pr';
export const CITY_PRECISION = 6;
export const CITY_COLUMNS = 10;
export const CITY_ROWS = 10;
/** Columns and rows between the south west corner of u4pr and the city. */
const CITY_OFFSET = 11;
/** A precision 4 cell holds 32 × 32 precision 6 cells. */
const CELLS_PER_PREFIX_SIDE = 32;

const prefixBox = decodeGeohash(CITY_PREFIX);
const cellLngDegrees = (prefixBox.maxLng - prefixBox.minLng) / CELLS_PER_PREFIX_SIDE;
const cellLatDegrees = (prefixBox.maxLat - prefixBox.minLat) / CELLS_PER_PREFIX_SIDE;
const originLng = prefixBox.minLng + CITY_OFFSET * cellLngDegrees;
const originLat = prefixBox.minLat + CITY_OFFSET * cellLatDegrees;
const kmPerLngDegree =
  KM_PER_DEGREE * Math.cos(((originLat + (CITY_ROWS * cellLatDegrees) / 2) * Math.PI) / 180);

export const CELL_WIDTH_KM = cellLngDegrees * kmPerLngDegree;
export const CELL_HEIGHT_KM = cellLatDegrees * KM_PER_DEGREE;
export const CITY_WIDTH_KM = CITY_COLUMNS * CELL_WIDTH_KM;
export const CITY_HEIGHT_KM = CITY_ROWS * CELL_HEIGHT_KM;

/** City positions are kilometers east and north of the south west corner. */
export function toLatLng(x: number, y: number) {
  return { lat: originLat + y / KM_PER_DEGREE, lng: originLng + x / kmPerLngDegree };
}

export function cellHashAt(x: number, y: number): string {
  const { lat, lng } = toLatLng(x, y);
  return encodeGeohash(lat, lng, CITY_PRECISION);
}

export interface CityCell {
  hash: string;
  col: number;
  /** 0 is the southern row. */
  row: number;
  /** The last 2 characters; every city cell starts with CITY_PREFIX. */
  label: string;
}

export const cityCells: CityCell[] = [];
for (let row = 0; row < CITY_ROWS; row += 1) {
  for (let col = 0; col < CITY_COLUMNS; col += 1) {
    const hash = cellHashAt((col + 0.5) * CELL_WIDTH_KM, (row + 0.5) * CELL_HEIGHT_KM);
    cityCells.push({ hash, col, row, label: hash.slice(CITY_PREFIX.length) });
  }
}
export const cellByHash = new Map(cityCells.map((cell) => [cell.hash, cell]));

// The duel.
export const DUEL_SECONDS = 30;
export const PING_SECONDS = 4;
/** 36 km/h for 4 s. */
export const PING_STEP_KM = 0.04;
/** Toy trip length; real trips last minutes. */
export const TRIP_SECONDS = 12;
export const REQUEST_EVERY_SECONDS = 2;
export const EDGE_RIDER_KM = 0.04;
const MAX_MARKERS = 8;
const MAX_WIDEN_MARKERS = 3;
const MAX_MISS_MARKERS = 3;

export const laneLabels = ['Scan every driver', 'Geohash cell + 8 neighbors'] as const;

export type RideScenarioId = 'dense' | 'edge' | 'sparse';
type RiderPlacement = 'anywhere' | 'edge' | 'outer';

export interface RideScenario {
  id: RideScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  drivers: number;
  riders: RiderPlacement;
}

export const rideScenarios: Record<RideScenarioId, RideScenario> = {
  dense: {
    id: 'dense',
    label: 'Dense downtown',
    diff: 'Baseline: 600 drivers spread across a downtown of 10 × 10 cells, about 6 per cell. Riders appear anywhere.',
    drivers: 600,
    riders: 'anywhere',
  },
  edge: {
    id: 'edge',
    label: 'Rider near a cell edge',
    diff: 'Drivers: 600 to 150. Every rider stands within 40 m of the edge of their cell.',
    drivers: 150,
    riders: 'edge',
  },
  sparse: {
    id: 'sparse',
    label: 'Sparse suburbs',
    diff: 'Drivers: 600 to 20. Riders appear in the outer 2 rings of cells, near the city limits.',
    drivers: 20,
    riders: 'outer',
  },
};

export interface Driver {
  id: number;
  /** Last reported position, in km from the south west corner. */
  x: number;
  y: number;
  heading: number;
  /** The cell the index files this driver under. */
  cell: string;
  /** Tick when the current trip ends, or null when free. */
  busyUntil: number | null;
}

export interface RideRequest {
  id: number;
  tick: number;
  x: number;
  y: number;
}

export type WidenReason = 'empty' | 'too-far';

export interface RequestResult {
  request: RideRequest;
  riderCell: string;
  /** Null when no driver was free anywhere. */
  driverId: number | null;
  /** Where the chosen driver stood at match time; drivers keep moving afterward. */
  driverAt: { x: number; y: number } | null;
  distanceKm: number;
  /** Distance checks per lane: the scan, then the cell search. */
  checks: [number, number];
  /** Rings searched by the cell search: 1 means the cell and its 8 neighbors. */
  radius: number;
  searchedCells: string[];
  widenReason: WidenReason | null;
  /** What a search of the rider's cell alone would have picked. */
  sameCellDriverId: number | null;
  sameCellDistanceKm: number;
  /** The driver each lane picked, kept separately so tests can prove they agree. */
  laneDriverIds: [number | null, number | null];
}

export interface LaneTotals {
  checks: number;
  matched: number;
  unmatched: number;
  distanceKm: number;
}

interface Candidate {
  id: number;
  distanceKm: number;
}

function closer(best: Candidate | null, driver: Driver, x: number, y: number): Candidate | null {
  const distanceKm = Math.hypot(driver.x - x, driver.y - y);
  if (!best || distanceKm < best.distanceKm || (distanceKm === best.distanceKm && driver.id < best.id)) {
    return { id: driver.id, distanceKm };
  }
  return best;
}

/** Short distances in meters, longer ones in kilometers. */
export function formatDistance(km: number): string {
  return km >= 1 ? `${km.toFixed(2)} km` : `${Math.round(km * 1000)} m`;
}

function clamp(value: number, max: number): number {
  return Math.min(max - 1e-9, Math.max(1e-9, value));
}

function anywhere(rng: SeededRng) {
  return { x: rng() * CITY_WIDTH_KM, y: rng() * CITY_HEIGHT_KM };
}

function riderPosition(rng: SeededRng, placement: RiderPlacement) {
  if (placement === 'anywhere') return anywhere(rng);
  if (placement === 'outer') {
    let col = 0;
    let row = 0;
    do {
      col = Math.floor(rng() * CITY_COLUMNS);
      row = Math.floor(rng() * CITY_ROWS);
    } while (Math.min(col, row, CITY_COLUMNS - 1 - col, CITY_ROWS - 1 - row) > 1);
    return { x: (col + rng()) * CELL_WIDTH_KM, y: (row + rng()) * CELL_HEIGHT_KM };
  }
  // Interior cells only, so the cell across the edge is always inside the city.
  const col = 1 + Math.floor(rng() * (CITY_COLUMNS - 2));
  const row = 1 + Math.floor(rng() * (CITY_ROWS - 2));
  const side = Math.floor(rng() * 4);
  const along = rng();
  const inset = 0.005 + rng() * (EDGE_RIDER_KM - 0.005);
  const left = col * CELL_WIDTH_KM;
  const bottom = row * CELL_HEIGHT_KM;
  if (side === 0) return { x: left + along * CELL_WIDTH_KM, y: bottom + CELL_HEIGHT_KM - inset };
  if (side === 1) return { x: left + CELL_WIDTH_KM - inset, y: bottom + along * CELL_HEIGHT_KM };
  if (side === 2) return { x: left + along * CELL_WIDTH_KM, y: bottom + inset };
  return { x: left + inset, y: bottom + along * CELL_HEIGHT_KM };
}

export class RideMatchDuel {
  readonly scenario: RideScenario;
  readonly seed: number;
  rng: SeededRng = createRng(0);
  drivers: Driver[] = [];
  requests: RideRequest[] = [];
  /** The geo index: cell hash to the ids of the drivers filed under it. */
  index = new Map<string, Set<number>>();
  ticks = 0;
  /** Location writes: every ping overwrites a driver's last position. */
  pings = 0;
  /** Pings that crossed a cell edge and moved the driver to another cell's set. */
  cellMoves = 0;
  lanes: [LaneTotals, LaneTotals] = [this.emptyLane(), this.emptyLane()];
  /** Requests where a search of the rider's cell alone would pick a worse driver or none. */
  sameCellMisses = 0;
  /** Requests where the cell search had to look past the first 9 cells. */
  widened = 0;
  /** Cells the cell search looked up, including empty ones and ones past the city limits. */
  cellLookups = 0;
  results: RequestResult[] = [];
  /** Cumulative distance checks after each tick, per lane. */
  trace: [number[], number[]] = [[], []];
  events: DuelEvent[] = [];
  private nextRequest = 0;
  private widenMarkers = 0;
  private missMarkers = 0;

  constructor(scenario: RideScenario, seed = 42) {
    this.scenario = scenario;
    this.seed = seed;
    this.reset();
  }

  get done(): boolean {
    return this.ticks >= DUEL_SECONDS;
  }

  get lastResult(): RequestResult | null {
    return this.results[this.results.length - 1] ?? null;
  }

  reset() {
    this.rng = createRng(this.seed);
    this.drivers = [];
    this.index = new Map();
    for (let id = 0; id < this.scenario.drivers; id += 1) {
      const { x, y } = anywhere(this.rng);
      const driver: Driver = {
        id,
        x,
        y,
        heading: this.rng() * 2 * Math.PI,
        cell: cellHashAt(x, y),
        busyUntil: null,
      };
      this.drivers.push(driver);
      this.file(driver);
    }
    this.requests = [];
    for (let tick = REQUEST_EVERY_SECONDS; tick <= DUEL_SECONDS; tick += REQUEST_EVERY_SECONDS) {
      this.requests.push({
        id: this.requests.length + 1,
        tick,
        ...riderPosition(this.rng, this.scenario.riders),
      });
    }
    this.ticks = 0;
    this.pings = 0;
    this.cellMoves = 0;
    this.lanes = [this.emptyLane(), this.emptyLane()];
    this.sameCellMisses = 0;
    this.widened = 0;
    this.cellLookups = 0;
    this.results = [];
    this.trace = [[], []];
    this.events = [];
    this.nextRequest = 0;
    this.widenMarkers = 0;
    this.missMarkers = 0;
  }

  step() {
    if (this.done) return;
    this.ticks += 1;
    const tick = this.ticks;
    for (const driver of this.drivers) {
      if ((tick + driver.id) % PING_SECONDS === 0) this.ping(driver);
    }
    for (const driver of this.drivers) {
      if (driver.busyUntil !== null && driver.busyUntil <= tick) driver.busyUntil = null;
    }
    const request = this.requests[this.nextRequest];
    if (request && request.tick === tick) {
      this.nextRequest += 1;
      this.match(request);
    }
    this.trace[0].push(this.lanes[0].checks);
    this.trace[1].push(this.lanes[1].checks);
    if (this.done) this.wrapUp();
  }

  private emptyLane(): LaneTotals {
    return { checks: 0, matched: 0, unmatched: 0, distanceKm: 0 };
  }

  private file(driver: Driver) {
    const members = this.index.get(driver.cell) ?? new Set<number>();
    members.add(driver.id);
    this.index.set(driver.cell, members);
  }

  private ping(driver: Driver) {
    driver.heading += (this.rng() - 0.5) * 0.8;
    let x = driver.x + Math.cos(driver.heading) * PING_STEP_KM;
    let y = driver.y + Math.sin(driver.heading) * PING_STEP_KM;
    if (x < 0 || x > CITY_WIDTH_KM) {
      x = x < 0 ? -x : 2 * CITY_WIDTH_KM - x;
      driver.heading = Math.PI - driver.heading;
    }
    if (y < 0 || y > CITY_HEIGHT_KM) {
      y = y < 0 ? -y : 2 * CITY_HEIGHT_KM - y;
      driver.heading = -driver.heading;
    }
    driver.x = clamp(x, CITY_WIDTH_KM);
    driver.y = clamp(y, CITY_HEIGHT_KM);
    this.pings += 1;
    const cell = cellHashAt(driver.x, driver.y);
    if (cell !== driver.cell) {
      this.index.get(driver.cell)?.delete(driver.id);
      driver.cell = cell;
      this.file(driver);
      this.cellMoves += 1;
    }
  }

  private scan(request: RideRequest) {
    let best: Candidate | null = null;
    let checks = 0;
    for (const driver of this.drivers) {
      if (driver.busyUntil !== null) continue;
      checks += 1;
      best = closer(best, driver, request.x, request.y);
    }
    return { best, checks };
  }

  private searchCells(cells: string[], request: RideRequest, best: Candidate | null) {
    let checks = 0;
    let found = best;
    for (const cell of cells) {
      for (const id of this.index.get(cell) ?? []) {
        const driver = this.drivers[id];
        if (!driver || driver.busyUntil !== null) continue;
        checks += 1;
        found = closer(found, driver, request.x, request.y);
      }
    }
    return { best: found, checks };
  }

  /**
   * How far the rider is from the nearest edge of the searched square. Any
   * driver outside the square is at least this far away, so a candidate
   * closer than this is the true nearest. Edges past the city limits have no
   * drivers beyond them and never count.
   */
  private margin(request: RideRequest, cell: CityCell, radius: number): number {
    const left = cell.col - radius;
    const right = cell.col + radius;
    const bottom = cell.row - radius;
    const top = cell.row + radius;
    return Math.min(
      left <= 0 ? Number.POSITIVE_INFINITY : request.x - left * CELL_WIDTH_KM,
      right >= CITY_COLUMNS - 1 ? Number.POSITIVE_INFINITY : (right + 1) * CELL_WIDTH_KM - request.x,
      bottom <= 0 ? Number.POSITIVE_INFINITY : request.y - bottom * CELL_HEIGHT_KM,
      top >= CITY_ROWS - 1 ? Number.POSITIVE_INFINITY : (top + 1) * CELL_HEIGHT_KM - request.y,
    );
  }

  private cellSearch(request: RideRequest, riderCell: string) {
    const home = cellByHash.get(riderCell);
    const searchedCells = [riderCell, ...geohashRing(riderCell, 1)];
    let { best, checks } = this.searchCells(searchedCells, request, null);
    let radius = 1;
    let widenReason: WidenReason | null = null;
    const maxRadius = Math.max(CITY_COLUMNS, CITY_ROWS);
    while (home && radius < maxRadius && (!best || best.distanceKm > this.margin(request, home, radius))) {
      widenReason ??= best ? 'too-far' : 'empty';
      radius += 1;
      const ring = geohashRing(riderCell, radius);
      searchedCells.push(...ring);
      const next = this.searchCells(ring, request, best);
      best = next.best;
      checks += next.checks;
    }
    return { best, checks, radius, searchedCells, widenReason };
  }

  private sameCell(request: RideRequest, riderCell: string): Candidate | null {
    return this.searchCells([riderCell], request, null).best;
  }

  private match(request: RideRequest) {
    const riderCell = cellHashAt(request.x, request.y);
    const scan = this.scan(request);
    const cells = this.cellSearch(request, riderCell);
    const same = this.sameCell(request, riderCell);
    const best = scan.best;
    const chosen = best ? this.drivers[best.id] : undefined;
    const result: RequestResult = {
      request,
      riderCell,
      driverId: best?.id ?? null,
      driverAt: chosen ? { x: chosen.x, y: chosen.y } : null,
      distanceKm: best?.distanceKm ?? 0,
      checks: [scan.checks, cells.checks],
      radius: cells.radius,
      searchedCells: cells.searchedCells,
      widenReason: cells.widenReason,
      sameCellDriverId: same?.id ?? null,
      sameCellDistanceKm: same?.distanceKm ?? 0,
      laneDriverIds: [scan.best?.id ?? null, cells.best?.id ?? null],
    };
    this.results.push(result);
    for (const [lane, found] of [scan.best, cells.best].entries()) {
      const totals = this.lanes[lane as 0 | 1];
      totals.checks += result.checks[lane as 0 | 1];
      if (found) {
        totals.matched += 1;
        totals.distanceKm += found.distanceKm;
      } else {
        totals.unmatched += 1;
      }
    }
    if (chosen) chosen.busyUntil = request.tick + TRIP_SECONDS;
    if (cells.widenReason) this.widened += 1;
    this.cellLookups += cells.searchedCells.length;
    const missed = best !== null && same?.id !== best.id;
    if (missed) this.sameCellMisses += 1;
    this.annotate(result, missed);
  }

  private mark(text: string) {
    if (this.events.filter((event) => event.marker).length >= MAX_MARKERS) return;
    this.events.push({ tick: this.ticks, text, marker: true });
  }

  private annotate(result: RequestResult, missed: boolean) {
    const n = result.request.id;
    const [scanChecks, cellChecks] = result.checks;
    if (result.driverId === null) {
      this.mark(`Request ${n}: no free driver anywhere in the city. Both searches came back empty.`);
      return;
    }
    const away = formatDistance(result.distanceKm);
    if (n === 1) {
      this.mark(
        `Request 1: the scan measured ${scanChecks} drivers; the cell search measured ${cellChecks} in ${result.searchedCells.length} cells. Both chose driver ${result.driverId}, ${away} away.`,
      );
      return;
    }
    if (result.widenReason && this.widenMarkers < MAX_WIDEN_MARKERS) {
      this.widenMarkers += 1;
      const why =
        result.widenReason === 'empty'
          ? 'the 9 cells held no free driver'
          : 'the best driver in the 9 cells sat farther away than the edge of the searched square, so a closer one could hide outside it';
      this.mark(
        `Request ${n}: ${why}. The search widened ring by ring to ${result.searchedCells.length} cells and measured ${cellChecks} drivers, against ${scanChecks} for the scan.`,
      );
      return;
    }
    if (missed && this.missMarkers < MAX_MISS_MARKERS) {
      this.missMarkers += 1;
      const cell = this.drivers[result.driverId]?.cell ?? 'another cell';
      const sameCell =
        result.sameCellDriverId === null
          ? 'found no driver at all'
          : `sent driver ${result.sameCellDriverId}, ${formatDistance(result.sameCellDistanceKm)} away`;
      this.mark(
        `Request ${n}: the nearest driver, ${result.driverId}, waited ${away} away in cell ${cell}, outside the rider's cell ${result.riderCell}. A search of the rider's cell alone would have ${sameCell}.`,
      );
    }
  }

  private wrapUp() {
    const [scan, cells] = this.lanes;
    const ratio = cells.checks > 0 ? (scan.checks / cells.checks).toFixed(1) : '0';
    const count = (value: number) => value.toLocaleString('en-US');
    this.events.push({
      tick: this.ticks,
      text: `Run complete: the scan made ${count(scan.checks)} distance checks and the cell search made ${count(cells.checks)}, ${ratio}× fewer. ${count(this.pings)} location writes moved a driver to a new cell ${count(this.cellMoves)} times.`,
      marker: false,
    });
  }
}
