import { createRng, poisson } from '../rng';

/**
 * Toy model of the redirect lookup `SELECT long_url FROM links WHERE code = ?`.
 * Two lanes replay the same pre-generated lookups against the same table: one
 * scans every page, the other walks a B-tree index on code. Each lane has one
 * worker that reads pages for the oldest waiting lookup first. Page sizes,
 * fanout, and read costs are illustrative round numbers.
 */
export type IxScenarioId = 'small' | 'medium' | 'huge';
export type IxLaneKind = 'scan' | 'index';

/** Rows that fit in one table page: an 8 KB page of rows about 80 bytes wide. */
export const ROWS_PER_PAGE = 100;
/** Keys that fit in one index page, so each level narrows the search 500 ways. */
export const FANOUT = 500;
/** A scan reads pages in order, which storage serves faster than random hops. */
export const SCAN_PAGE_US = 10;
/** Each step down the tree is a random page read. */
export const INDEX_PAGE_US = 100;

export const IX_SECONDS = 10;
export const IX_TICK_SECONDS = 0.1;
export const IX_TICKS = Math.round(IX_SECONDS / IX_TICK_SECONDS);
const TICK_US = Math.round(IX_TICK_SECONDS * 1_000_000);
export const LOOKUPS_PER_SECOND = 5;

export interface IxScenario {
  id: IxScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  rows: number;
}

export interface IxLookup {
  id: number;
  /** Tick when the redirect asks for this code. */
  at: number;
  code: string;
  /** Where the code falls in sorted order, 0 to 1. Picks the path through the toy tree. */
  keyAt: number;
  /** Where the matching row sits in the table, 0 to 1. The scan passes it and keeps reading. */
  rowAt: number;
}

export interface IxWaiting {
  id: number;
  remainingUs: number;
}

export interface IxLane {
  kind: IxLaneKind;
  label: string;
  statement: string;
  pagesPerLookup: number;
  pageUs: number;
  /** Lookups in arrival order; the worker reads pages for the first one. */
  waiting: IxWaiting[];
  answered: number;
  pagesRead: number;
  /** Longest wait of any answered lookup, arrival to answer. */
  slowestUs: number;
  /** Id of the most recently answered lookup, or 0 before the first answer. */
  lastAnswered: number;
  /** One value per tick: lookups still waiting when the tick ends. */
  series: number[];
}

export interface IxEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

interface IxState {
  tick: number;
  issued: number;
  lanes: [IxLane, IxLane];
  events: IxEvent[];
  queueNoted: boolean;
}

export function scanPages(rows: number): number {
  return Math.ceil(rows / ROWS_PER_PAGE);
}

/** Smallest number of levels whose fanout covers every key: root, branches, then leaves. */
export function btreeLevels(rows: number): number {
  let levels = 1;
  let reach = FANOUT;
  while (reach < rows) {
    reach *= FANOUT;
    levels += 1;
  }
  return levels;
}

/** One page per tree level, then the table page that holds the row. */
export function indexLookupPages(rows: number): number {
  return btreeLevels(rows) + 1;
}

/** Pages on each level of the index, root first and leaves last. */
export function levelPages(rows: number): number[] {
  const levels = [Math.ceil(Math.max(1, rows) / FANOUT)];
  while ((levels[0] ?? 1) > 1) levels.unshift(Math.ceil((levels[0] ?? 1) / FANOUT));
  return levels;
}

/** Pages the whole index occupies: every leaf plus every page above it. */
export function indexPages(rows: number): number {
  return levelPages(rows).reduce((sum, pages) => sum + pages, 0);
}

const counter = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return counter.format(Math.round(value));
}

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function formatDuration(us: number): string {
  if (us < 1000) return `${trim(us / 1000, 2)} ms`;
  if (us < 1_000_000) return `${trim(us / 1000, 1)} ms`;
  const seconds = us / 1_000_000;
  if (seconds < 60) return `${trim(seconds, 1)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${trim(seconds / 3600, 1)} h`;
}

export const ixScenarios: Record<IxScenarioId, IxScenario> = {
  small: {
    id: 'small',
    label: '10 thousand links',
    diff: 'Baseline: a young service. The links table fills 100 pages.',
    rows: 10_000,
  },
  medium: {
    id: 'medium',
    label: '10 million links',
    diff: '1,000 times more rows: 100,000 table pages. Same lookups.',
    rows: 10_000_000,
  },
  huge: {
    id: 'huge',
    label: '10 billion links',
    diff: '1,000 times more again: 100 million table pages. Same lookups.',
    rows: 10_000_000_000,
  },
};

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** About five redirects a second for ten seconds. Every scenario replays the same list. */
export function lookupWorkload(seed: number): IxLookup[] {
  const rng = createRng(seed);
  const lookups: IxLookup[] = [];
  for (let tick = 0; tick < IX_TICKS; tick += 1) {
    const arrivals = poisson(rng, LOOKUPS_PER_SECOND * IX_TICK_SECONDS);
    for (let n = 0; n < arrivals; n += 1) {
      const code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(rng() * ALPHABET.length)]).join('');
      lookups.push({ id: lookups.length + 1, at: tick, code, keyAt: rng(), rowAt: rng() });
    }
  }
  return lookups;
}

function blankLane(kind: IxLaneKind, rows: number): IxLane {
  const scan = kind === 'scan';
  return {
    kind,
    label: scan ? 'Full scan' : 'B-tree index on code',
    statement: scan ? 'No index: read every page' : 'Root to leaf, then one table page',
    pagesPerLookup: scan ? scanPages(rows) : indexLookupPages(rows),
    pageUs: scan ? SCAN_PAGE_US : INDEX_PAGE_US,
    waiting: [],
    answered: 0,
    pagesRead: 0,
    slowestUs: 0,
    lastAnswered: 0,
    series: [],
  };
}

export class IxDuel {
  readonly scenario: IxScenario;
  readonly lookups: IxLookup[];
  readonly length = IX_TICKS;
  readonly tickSeconds = IX_TICK_SECONDS;
  private state: IxState;

  constructor(scenario: IxScenario, seed = 42) {
    this.scenario = scenario;
    this.lookups = lookupWorkload(seed);
    this.state = this.initial();
  }

  private initial(): IxState {
    return {
      tick: 0,
      issued: 0,
      lanes: [blankLane('scan', this.scenario.rows), blankLane('index', this.scenario.rows)],
      events: [],
      queueNoted: false,
    };
  }

  get ticks(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.tick >= this.length;
  }

  /** Lookups that have arrived so far. Every lane sees the same ones. */
  get issued(): number {
    return this.state.issued;
  }

  get lanes(): readonly [IxLane, IxLane] {
    return this.state.lanes;
  }

  get events(): readonly IxEvent[] {
    return this.state.events;
  }

  lookup(id: number): IxLookup | undefined {
    return this.lookups[id - 1];
  }

  /** Pages the lane has read for the lookup it is working on now. */
  headPagesRead(lane: IxLane): number {
    const head = lane.waiting[0];
    if (!head) return 0;
    return lane.pagesPerLookup - head.remainingUs / lane.pageUs;
  }

  /** Longest wait so far, counting lookups still waiting. */
  longestWaitUs(lane: IxLane): number {
    const head = lane.waiting[0];
    const lookup = head ? this.lookup(head.id) : undefined;
    const age = lookup ? (this.state.tick - lookup.at) * TICK_US : 0;
    return Math.max(lane.slowestUs, age);
  }

  step(): void {
    if (this.done) return;
    const tick = this.state.tick;
    const arrivals = this.lookups.filter((lookup) => lookup.at === tick);
    this.state.issued += arrivals.length;
    for (const lane of this.state.lanes) {
      for (const lookup of arrivals) {
        lane.waiting.push({ id: lookup.id, remainingUs: lane.pagesPerLookup * lane.pageUs });
      }
      this.serve(lane, tick);
      lane.series.push(lane.waiting.length);
    }
    this.noteScan(tick);
    this.state.tick += 1;
    if (this.done) this.state.events.push({ tick: this.length, text: this.wrapUp(), marker: false });
  }

  checkpoint(): IxState {
    return structuredClone(this.state);
  }

  restore(state: IxState): void {
    this.state = structuredClone(state);
  }

  private serve(lane: IxLane, tick: number): void {
    let budget = TICK_US;
    while (budget > 0) {
      const head = lane.waiting[0];
      if (!head) return;
      const spend = Math.min(budget, head.remainingUs);
      head.remainingUs -= spend;
      budget -= spend;
      lane.pagesRead += spend / lane.pageUs;
      if (head.remainingUs > 0) return;
      lane.waiting.shift();
      lane.answered += 1;
      lane.lastAnswered = head.id;
      const lookup = this.lookup(head.id);
      if (!lookup) continue;
      const waitUs = (tick - lookup.at) * TICK_US + (TICK_US - budget);
      lane.slowestUs = Math.max(lane.slowestUs, waitUs);
      if (lane.answered === 1) this.noteFirstAnswer(lane, lookup, tick);
    }
  }

  private noteFirstAnswer(lane: IxLane, lookup: IxLookup, tick: number): void {
    const pages = formatCount(lane.pagesPerLookup);
    const time = formatDuration(lane.pagesPerLookup * lane.pageUs);
    const text =
      lane.kind === 'index'
        ? `The B-tree finds code ${lookup.code} in ${pages} page reads: ${lane.pagesPerLookup - 1} index pages from root to leaf, then the table page that holds the row. That takes ${time}.`
        : `The full scan answers code ${lookup.code} after reading all ${pages} pages (${time}). The match sat on page ${formatCount(Math.floor(lookup.rowAt * lane.pagesPerLookup) + 1)}. Without an index, nothing tells the database that no other row has that code, so it reads to the end.`;
    this.state.events.push({ tick, text, marker: true });
  }

  private noteScan(tick: number): void {
    const [scan] = this.state.lanes;
    const perLookup = formatDuration(scan.pagesPerLookup * scan.pageUs);
    if (!this.state.queueNoted && scan.waiting.length >= 10) {
      this.state.queueNoted = true;
      this.state.events.push({
        tick,
        text: `10 lookups now wait behind the scan. Each one needs ${perLookup} of page reads, and about ${LOOKUPS_PER_SECOND} arrive every second.`,
        marker: true,
      });
    }
    if (tick + 1 === this.length / 2 && scan.answered === 0 && scan.waiting.length > 0) {
      const read = this.headPagesRead(scan);
      const share = (read / scan.pagesPerLookup) * 100;
      this.state.events.push({
        tick,
        text: `Halfway: the scan has read ${formatCount(read)} of ${formatCount(scan.pagesPerLookup)} pages (${trim(share, 1)}%) for its first lookup. At this pace that one lookup takes ${perLookup}.`,
        marker: true,
      });
    }
  }

  private wrapUp(): string {
    const [scan, index] = this.state.lanes;
    return `Run ends. ${this.state.issued} lookups arrived. The B-tree answered ${index.answered} and read ${formatCount(index.pagesRead)} pages in total. The full scan answered ${scan.answered} and read ${formatCount(scan.pagesRead)} pages.`;
  }
}

/** Write cost: every INSERT into links also inserts one entry into each index. */
export const WRITE_ROWS = 10_000_000;
/** Illustrative cost to log and later flush one changed page. */
export const WRITE_PAGE_US = 100;

export type IxIndexId = 'code' | 'user' | 'created' | 'userCreated';

export interface IxIndex {
  id: IxIndexId;
  columns: string;
  /** The query this index serves on the shortener, or why it serves none. */
  serves: string;
}

export const ixIndexes: IxIndex[] = [
  {
    id: 'code',
    columns: 'UNIQUE (code)',
    serves: 'Serves the redirect, WHERE code = ?, and rejects a second link with the same code.',
  },
  {
    id: 'user',
    columns: '(user_id)',
    serves: "Finds one user's links, in no particular order.",
  },
  {
    id: 'created',
    columns: '(created_at)',
    serves: 'No query on the shortener filters or sorts every link by date, so it serves nothing here.',
  },
  {
    id: 'userCreated',
    columns: '(user_id, created_at)',
    serves: "Serves the dashboard: one user's links, newest first, already in order.",
  },
];

export interface IxInsertCost {
  /** The table plus one B-tree per index. */
  structures: number;
  /** One leaf or table page changes in each structure. */
  pagesWritten: number;
  /** Pages the insert reads on the way down: the table page plus root to leaf in each index. */
  pagesVisited: number;
  writeUs: number;
  tablePages: number;
  /** Extra pages every index adds on disk, on top of the table. */
  indexPagesTotal: number;
}

export function insertCost(indexCount: number, rows = WRITE_ROWS): IxInsertCost {
  return {
    structures: 1 + indexCount,
    pagesWritten: 1 + indexCount,
    pagesVisited: 1 + indexCount * btreeLevels(rows),
    writeUs: (1 + indexCount) * WRITE_PAGE_US,
    tablePages: scanPages(rows),
    indexPagesTotal: indexCount * indexPages(rows),
  };
}

/** Indexes another enabled index already covers through its leftmost column. */
export function redundantIndexes(enabled: readonly IxIndexId[]): IxIndexId[] {
  return enabled.includes('user') && enabled.includes('userCreated') ? ['user'] : [];
}
