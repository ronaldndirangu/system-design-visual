/**
 * Seeded randomness so every simulation replays the same way for the same
 * inputs. Learners can compare settings without luck changing the result.
 */
export type Rng = () => number;

/** mulberry32: tiny, fast, and good enough for teaching simulations. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Number of events in one interval when events arrive independently at
 * `mean` per interval. Uses Knuth's method for small means and a normal
 * approximation for large ones.
 */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 50) {
    const u1 = Math.max(rng(), Number.EPSILON);
    const u2 = rng();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal));
  }
  const limit = Math.exp(-mean);
  let count = 0;
  let product = rng();
  while (product > limit) {
    count += 1;
    product *= rng();
  }
  return count;
}

/**
 * Returns a sampler for keys 0..n-1 where key k has weight 1 / (k + 1)^s.
 * s = 0 is uniform; s around 1 matches real traffic where a few links are
 * far more popular than the rest.
 */
export function createZipf(n: number, s: number): (rng: Rng) => number {
  const cdf = new Float64Array(n);
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    total += 1 / (k + 1) ** s;
    cdf[k] = total;
  }
  for (let k = 0; k < n; k += 1) cdf[k] = (cdf[k] ?? 0) / total;
  return (rng) => {
    const target = rng();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((cdf[mid] ?? 1) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

/** FNV-1a 32-bit hash with a final mix. Stable across runs and platforms. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Similar strings such as "server-1" and "server-2" must land far apart.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
