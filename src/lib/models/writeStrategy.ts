import { createRng, createZipf, poisson, type Rng } from '../rng';

/**
 * Three write strategies side by side on identical traffic. One seeded workload
 * drives every lane, so the only difference between lanes is where a write goes
 * and when it reaches the database.
 */
export type WriteStrategy = 'write-through' | 'write-behind' | 'write-around';
export type WriteScenarioId = 'steady' | 'clicks' | 'import' | 'crash';
export type WriteMetric = 'db-writes' | 'hit-ratio' | 'pending';

export interface WriteScenario {
  id: WriteScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  readsPerSecond: number;
  /** Edits to existing links per second, mostly to popular links. */
  editsPerSecond: number;
  /** Every read also adds 1 to that link's click count. */
  countClicks: boolean;
  /** New links per second that nobody reads during the run. */
  importsPerSecond: number;
  /** Tick at which the cache crashes and restarts empty. */
  crashAt?: number;
  metric: WriteMetric;
}

export interface WriteEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const WRITE_SECONDS = 20;
export const TICK_SECONDS = 0.1;
export const LINKS = 300;
export const CACHE_CAPACITY = 150;
/** Write-behind saves its buffered changes to the database every 2 s. */
export const FLUSH_TICKS = 20;
export const CACHE_MS = 1;
export const DB_MS = 10;
/** Imported links get ids far above the popular ones, so they never collide. */
const IMPORT_BASE = 10_000;
const READ_SKEW = 1;
/** The import marker fires the first time a lane's last second hit ratio falls below this. */
const DROP_PERCENT = 70;

const baseline = {
  readsPerSecond: 200,
  editsPerSecond: 20,
  countClicks: false,
  importsPerSecond: 0,
} as const;

export const writeScenarios: Record<WriteScenarioId, WriteScenario> = {
  steady: {
    id: 'steady',
    label: 'Link edits',
    diff: 'Baseline: 200 reads/s and 20 edits/s, mostly to popular links. The cache holds 150 of 300 links.',
    ...baseline,
    metric: 'db-writes',
  },
  clicks: {
    id: 'clicks',
    label: 'Count every click',
    diff: 'Edits: 20/s to none. Instead, every read adds 1 to the click count of its link: 200 writes/s.',
    ...baseline,
    editsPerSecond: 0,
    countClicks: true,
    metric: 'db-writes',
  },
  import: {
    id: 'import',
    label: 'Bulk import',
    diff: 'Edits: 20/s to none. Instead, a partner imports 200 new links/s that nobody reads yet.',
    ...baseline,
    editsPerSecond: 0,
    importsPerSecond: 200,
    metric: 'hit-ratio',
  },
  crash: {
    id: 'crash',
    label: 'Cache crashes',
    diff: 'Baseline traffic. The cache crashes at 13.5 s and restarts empty.',
    ...baseline,
    crashAt: 135,
    metric: 'pending',
  },
};

export const writeStrategies: readonly WriteStrategy[] = ['write-through', 'write-behind', 'write-around'];

export const strategyLabels: Record<WriteStrategy, string> = {
  'write-through': 'Write-through',
  'write-behind': 'Write-behind',
  'write-around': 'Write-around',
};

export const strategyPaths: Record<WriteStrategy, string> = {
  'write-through': 'Each write updates the database and the cache before it returns.',
  'write-behind':
    'Each write updates only the cache and returns. Every 2 s the cache saves its changes to the database.',
  'write-around':
    'Each write updates the database and deletes the cached copy. The next read loads it again.',
};

export interface LaneTotals {
  writes: number;
  /** Writes that reached the database. */
  dbWrites: number;
  /** Buffered writes merged into a later write of the same link. */
  coalesced: number;
  /** Writes the caller saw succeed that never reached the database. */
  lost: number;
  writeMs: number;
  reads: number;
  hits: number;
  readMs: number;
  /** Reads that were the first read of a link since its last write. */
  firstReads: number;
  firstReadHits: number;
}

interface Window {
  reads: number;
  hits: number;
}

export class WriteLane {
  readonly strategy: WriteStrategy;
  readonly label: string;
  readonly capacity: number;
  readonly totals: LaneTotals = {
    writes: 0,
    dbWrites: 0,
    coalesced: 0,
    lost: 0,
    writeMs: 0,
    reads: 0,
    hits: 0,
    readMs: 0,
    firstReads: 0,
    firstReadHits: 0,
  };
  /** One value per tick for the scenario's metric. */
  readonly series: number[] = [];
  /** Writes held in the cache that the database has not seen yet. */
  pending = 0;
  peakPending = 0;
  /** Key order is recency: the first key is the least recently used. */
  private readonly cache = new Map<number, true>();
  /** Write-behind only: buffered writes per link. */
  private readonly dirty = new Map<number, number>();
  private readonly unread = new Set<number>();
  private readonly recent: Window[] = [];

  constructor(strategy: WriteStrategy, capacity = CACHE_CAPACITY, warm: readonly number[] = []) {
    this.strategy = strategy;
    this.label = strategyLabels[strategy];
    this.capacity = capacity;
    for (const key of warm) this.touch(key);
  }

  get cached(): number {
    return this.cache.size;
  }

  get dirtyLinks(): number {
    return this.dirty.size;
  }

  /** Hits as a share of reads over the last second, or null before any reads. */
  get recentHitRatio(): number | null {
    const reads = this.recent.reduce((sum, window) => sum + window.reads, 0);
    if (reads === 0) return null;
    return this.recent.reduce((sum, window) => sum + window.hits, 0) / reads;
  }

  write(key: number): void {
    this.totals.writes += 1;
    this.unread.add(key);
    switch (this.strategy) {
      case 'write-through':
        this.totals.dbWrites += 1;
        this.totals.writeMs += DB_MS + CACHE_MS;
        this.touch(key);
        break;
      case 'write-behind':
        this.totals.writeMs += CACHE_MS;
        this.pending += 1;
        this.peakPending = Math.max(this.peakPending, this.pending);
        this.dirty.set(key, (this.dirty.get(key) ?? 0) + 1);
        this.touch(key);
        break;
      case 'write-around':
        this.totals.dbWrites += 1;
        this.totals.writeMs += DB_MS + CACHE_MS;
        this.cache.delete(key);
        break;
    }
  }

  /** Cache-aside read: a miss loads the link from the database and caches it. */
  read(key: number): void {
    const hit = this.cache.has(key);
    this.totals.reads += 1;
    if (hit) this.totals.hits += 1;
    this.totals.readMs += hit ? CACHE_MS : CACHE_MS + DB_MS;
    if (this.unread.delete(key)) {
      this.totals.firstReads += 1;
      if (hit) this.totals.firstReadHits += 1;
    }
    this.touch(key);
  }

  /** Saves every buffered change. Returns the writes buffered and the database writes made. */
  flush(): { buffered: number; dbWrites: number } {
    const buffered = this.pending;
    const before = this.totals.dbWrites;
    for (const key of [...this.dirty.keys()]) this.save(key);
    return { buffered, dbWrites: this.totals.dbWrites - before };
  }

  /** Empties the cache. Returns how many buffered writes were lost. */
  crash(): number {
    const lost = this.pending;
    this.totals.lost += lost;
    this.pending = 0;
    this.dirty.clear();
    this.cache.clear();
    return lost;
  }

  recordWindow(window: Window, size: number): void {
    this.recent.push(window);
    if (this.recent.length > size) this.recent.shift();
  }

  private touch(key: number): void {
    this.cache.delete(key);
    this.cache.set(key, true);
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
      // A write-back cache must save a changed link before it can drop it.
      this.save(oldest);
    }
  }

  private save(key: number): void {
    const count = this.dirty.get(key);
    if (!count) return;
    this.dirty.delete(key);
    this.totals.dbWrites += 1;
    this.totals.coalesced += count - 1;
    this.pending -= count;
  }
}

type Op = { kind: 'read' | 'write'; key: number };

export class WriteDuel {
  readonly scenario: WriteScenario;
  readonly tickSeconds = TICK_SECONDS;
  readonly length = Math.round(WRITE_SECONDS / TICK_SECONDS);
  readonly lanes: WriteLane[];
  readonly events: WriteEvent[] = [];
  private readonly rng: Rng;
  private readonly readKey: (rng: Rng) => number;
  private nextImport = IMPORT_BASE;
  private tickCount = 0;
  private flushNoted = false;
  private readonly dropNoted = new Set<WriteStrategy>();

  constructor(scenario: WriteScenario, seed = 42) {
    this.scenario = scenario;
    this.rng = createRng(seed);
    this.readKey = createZipf(LINKS, READ_SKEW);
    // Start warm: the most popular links are already cached, most recent first.
    const warm = Array.from({ length: CACHE_CAPACITY }, (_, index) => CACHE_CAPACITY - 1 - index);
    this.lanes = writeStrategies.map((strategy) => new WriteLane(strategy, CACHE_CAPACITY, warm));
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (this.scenario.crashAt === tick) this.crash(tick);
    const ops = this.workload();
    const windowTicks = Math.round(1 / this.tickSeconds);
    for (const lane of this.lanes) {
      const before = { reads: lane.totals.reads, hits: lane.totals.hits };
      for (const op of ops) {
        if (op.kind === 'read') lane.read(op.key);
        else lane.write(op.key);
      }
      lane.recordWindow(
        { reads: lane.totals.reads - before.reads, hits: lane.totals.hits - before.hits },
        windowTicks,
      );
    }
    if ((tick + 1) % FLUSH_TICKS === 0) this.flush(tick + 1);
    for (const lane of this.lanes) lane.series.push(this.metricValue(lane));
    this.noteDrops(tick + 1);
    this.tickCount += 1;
    if (this.done) this.wrapUp();
  }

  /** One tick of traffic, generated once and replayed in every lane. */
  private workload(): Op[] {
    const { readsPerSecond, editsPerSecond, importsPerSecond, countClicks } = this.scenario;
    const ops: Op[][] = [];
    const reads = poisson(this.rng, readsPerSecond * this.tickSeconds);
    for (let index = 0; index < reads; index += 1) {
      const key = this.readKey(this.rng);
      ops.push(
        countClicks
          ? [
              { kind: 'read', key },
              { kind: 'write', key },
            ]
          : [{ kind: 'read', key }],
      );
    }
    const edits = poisson(this.rng, editsPerSecond * this.tickSeconds);
    for (let index = 0; index < edits; index += 1) ops.push([{ kind: 'write', key: this.readKey(this.rng) }]);
    const imports = poisson(this.rng, importsPerSecond * this.tickSeconds);
    for (let index = 0; index < imports; index += 1) {
      ops.push([{ kind: 'write', key: this.nextImport }]);
      this.nextImport += 1;
    }
    for (let index = ops.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.rng() * (index + 1));
      const swap = ops[index];
      ops[index] = ops[other] as Op[];
      ops[other] = swap as Op[];
    }
    return ops.flat();
  }

  private crash(tick: number): void {
    const lost = this.lanes.map((lane) => ({ lane, lost: lane.crash() }));
    const losers = lost.filter((entry) => entry.lost > 0);
    const keepers = lost.filter((entry) => entry.lost === 0).map((entry) => entry.lane.label.toLowerCase());
    const losses = losers.map(
      (entry) => `${entry.lane.label} loses ${entry.lost} writes it had already confirmed.`,
    );
    const kept = keepers.length > 0 ? ` ${capitalize(joinWords(keepers))} lose none.` : '';
    this.events.push({
      tick,
      text: `The cache crashes and restarts empty. ${losses.join(' ')}${kept}`.trim(),
      marker: true,
    });
  }

  private flush(tick: number): void {
    for (const lane of this.lanes) {
      const result = lane.flush();
      if (this.flushNoted || result.buffered === 0 || this.scenario.importsPerSecond > 0) continue;
      this.flushNoted = true;
      this.events.push({
        tick,
        text: `${lane.label} saves its buffer: ${result.buffered} writes reach the database as ${result.dbWrites}.`,
        marker: true,
      });
    }
  }

  /** In the import scenario, mark the moment lanes first lose their popular links. */
  private noteDrops(tick: number): void {
    // Wait for a full one second window so a noisy first tick never fires the marker.
    if (this.scenario.metric !== 'hit-ratio' || tick < Math.round(1 / this.tickSeconds)) return;
    const dropped = this.lanes.filter(
      (lane) => !this.dropNoted.has(lane.strategy) && (lane.series.at(-1) ?? 100) < DROP_PERCENT,
    );
    if (dropped.length === 0) return;
    for (const lane of dropped) this.dropNoted.add(lane.strategy);
    const names = joinWords(dropped.map((lane) => lane.label.toLowerCase()));
    const percents = dropped.map((lane) => lane.series.at(-1) ?? 0);
    const hits = percents.every((percent) => percent === percents[0])
      ? `${percents[0]}%`
      : joinWords(dropped.map((lane, index) => `${lane.label.toLowerCase()} ${percents[index]}%`));
    this.events.push({
      tick,
      text: `Imported links push popular links out of the ${names} cache${dropped.length > 1 ? 's' : ''}. Hits over the last second: ${hits}.`,
      marker: true,
    });
  }

  private metricValue(lane: WriteLane): number {
    switch (this.scenario.metric) {
      case 'db-writes':
        return lane.totals.dbWrites;
      case 'hit-ratio': {
        const ratio = lane.recentHitRatio;
        return ratio === null ? (lane.series.at(-1) ?? 100) : Math.round(ratio * 100);
      }
      case 'pending':
        return lane.pending;
    }
  }

  private wrapUp(): void {
    const list = (pick: (lane: WriteLane) => string) =>
      this.lanes.map((lane) => `${lane.label.toLowerCase()} ${pick(lane)}`).join(', ');
    const writes = this.lanes[0]?.totals.writes ?? 0;
    const text =
      this.scenario.metric === 'db-writes'
        ? `Run ends. Database writes for the same ${writes} writes: ${list((lane) => String(lane.totals.dbWrites))}.`
        : this.scenario.metric === 'hit-ratio'
          ? `Run ends. Read hit ratio for the whole run: ${list((lane) => `${Math.round(summarize(lane).hitRatio * 100)}%`)}.`
          : `Run ends. Writes lost: ${list((lane) => String(lane.totals.lost))}.`;
    this.events.push({ tick: this.tickCount, text, marker: false });
  }
}

export interface WriteSummary {
  writes: number;
  dbWrites: number;
  coalesced: number;
  lost: number;
  pending: number;
  peakPending: number;
  /** Average time a caller waits for a write, or 0 before any writes. */
  writeMs: number;
  reads: number;
  dbReads: number;
  hitRatio: number;
  readMs: number;
  firstReads: number;
  /** Share of first reads after a write that the cache answered, or 0 before any. */
  firstReadHitRatio: number;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarize(lane: WriteLane): WriteSummary {
  const totals = lane.totals;
  return {
    writes: totals.writes,
    dbWrites: totals.dbWrites,
    coalesced: totals.coalesced,
    lost: totals.lost,
    pending: lane.pending,
    peakPending: lane.peakPending,
    writeMs: totals.writes > 0 ? totals.writeMs / totals.writes : 0,
    reads: totals.reads,
    dbReads: totals.reads - totals.hits,
    hitRatio: totals.reads > 0 ? totals.hits / totals.reads : 0,
    readMs: totals.reads > 0 ? totals.readMs / totals.reads : 0,
    firstReads: totals.firstReads,
    firstReadHitRatio: totals.firstReads > 0 ? totals.firstReadHits / totals.firstReads : 0,
  };
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
