import { createRng, createZipf, type Rng } from '../rng';

/**
 * An LRU cache in front of a database. Requests pick links with a Zipf
 * popularity curve: a few links get most of the clicks, like real traffic.
 */
export interface CacheConfig {
  /** Number of distinct short links people click. */
  keys: number;
  /** How many links fit in the cache. 0 means no cache. */
  capacity: number;
  /** Zipf exponent. 0 = every link equally popular; 1.2 = a few links dominate. */
  skew: number;
  requestsPerTick: number;
  /** Entries older than this many ticks count as expired. 0 = never expire. */
  ttlTicks: number;
  hitMs: number;
  missMs: number;
  seed: number;
}

export const defaultCacheConfig: CacheConfig = {
  keys: 1_000,
  capacity: 100,
  skew: 1,
  requestsPerTick: 40,
  ttlTicks: 0,
  hitMs: 1,
  missMs: 12,
  seed: 7,
};

export interface CacheEvent {
  key: number;
  hit: boolean;
}

export interface CacheTick {
  tick: number;
  requests: number;
  hits: number;
  misses: number;
  /** The first few requests of the tick, for animation. */
  sample: CacheEvent[];
}

export interface CacheStats {
  hitRatio: number;
  databaseReadsPerTick: number;
  averageLatencyMs: number;
  totalRequests: number;
}

const WINDOW_TICKS = 20;
const SAMPLE_SIZE = 6;

export class CacheSim {
  private config: CacheConfig;
  private rng: Rng;
  private pick: (rng: Rng) => number;
  /** Map iteration order doubles as recency order: first entry = least recent. */
  private entries = new Map<number, number>();
  private tick = 0;
  private window: CacheTick[] = [];
  private totals = { requests: 0, hits: 0 };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...defaultCacheConfig, ...config };
    this.rng = createRng(this.config.seed);
    this.pick = createZipf(this.config.keys, this.config.skew);
  }

  get cachedKeys(): number[] {
    return [...this.entries.keys()];
  }

  get settings(): Readonly<CacheConfig> {
    return this.config;
  }

  setCapacity(capacity: number): void {
    this.config.capacity = Math.max(0, Math.floor(capacity));
    while (this.entries.size > this.config.capacity) this.evictOldest();
  }

  setTtl(ttlTicks: number): void {
    this.config.ttlTicks = Math.max(0, Math.floor(ttlTicks));
  }

  setSkew(skew: number): void {
    this.config.skew = skew;
    this.pick = createZipf(this.config.keys, skew);
  }

  /** Simulates a cache restart: every entry disappears at once. */
  flush(): void {
    this.entries.clear();
  }

  step(): CacheTick {
    this.tick += 1;
    let hits = 0;
    const sample: CacheEvent[] = [];
    for (let i = 0; i < this.config.requestsPerTick; i += 1) {
      const key = this.pick(this.rng);
      const hit = this.lookup(key);
      if (hit) hits += 1;
      if (sample.length < SAMPLE_SIZE) sample.push({ key, hit });
    }
    const result: CacheTick = {
      tick: this.tick,
      requests: this.config.requestsPerTick,
      hits,
      misses: this.config.requestsPerTick - hits,
      sample,
    };
    this.window.push(result);
    if (this.window.length > WINDOW_TICKS) this.window.shift();
    this.totals.requests += result.requests;
    this.totals.hits += hits;
    return result;
  }

  stats(): CacheStats {
    const requests = this.window.reduce((sum, tick) => sum + tick.requests, 0);
    const hits = this.window.reduce((sum, tick) => sum + tick.hits, 0);
    const misses = requests - hits;
    const hitRatio = requests === 0 ? 0 : hits / requests;
    return {
      hitRatio,
      databaseReadsPerTick: this.window.length === 0 ? 0 : misses / this.window.length,
      averageLatencyMs:
        requests === 0 ? 0 : (hits * this.config.hitMs + misses * this.config.missMs) / requests,
      totalRequests: this.totals.requests,
    };
  }

  private lookup(key: number): boolean {
    if (this.config.capacity === 0) return false;
    const storedAt = this.entries.get(key);
    const fresh =
      storedAt !== undefined && (this.config.ttlTicks === 0 || this.tick - storedAt < this.config.ttlTicks);
    if (fresh) {
      // Re-insert to mark as most recently used without changing its age.
      this.entries.delete(key);
      this.entries.set(key, storedAt);
      return true;
    }
    this.entries.delete(key);
    if (this.entries.size >= this.config.capacity) this.evictOldest();
    this.entries.set(key, this.tick);
    return false;
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}

/** Share of all clicks that go to the `top` most popular of `keys` links. */
export function topShare(keys: number, top: number, skew: number): number {
  let total = 0;
  let head = 0;
  for (let k = 0; k < keys; k += 1) {
    const weight = 1 / (k + 1) ** skew;
    total += weight;
    if (k < top) head += weight;
  }
  return total === 0 ? 0 : head / total;
}
