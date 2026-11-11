import { createRng, hashString } from '../rng';

/**
 * Two ways to decide which shard stores a key, so learners can compare how
 * many keys move when a shard joins or leaves.
 */
export type Placement = 'modulo' | 'ring';

const RING_SIZE = 2 ** 32;
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Deterministic short codes such as "aZ3k9Q". */
export function makeShortCodes(count: number, seed = 3, length = 6): string[] {
  const rng = createRng(seed);
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = '';
    for (let i = 0; i < length; i += 1) code += BASE62[Math.floor(rng() * BASE62.length)];
    codes.add(code);
  }
  return [...codes];
}

export function moduloOwner(key: string, shards: readonly string[]): string {
  if (shards.length === 0) throw new Error('At least one shard is required');
  return shards[hashString(key) % shards.length] as string;
}

export interface RingPoint {
  shard: string;
  /** Position on the ring as a fraction of a full turn, from 0 up to 1. */
  position: number;
}

export class HashRing {
  readonly shards: readonly string[];
  readonly points: RingPoint[];

  constructor(shards: readonly string[], virtualNodes = 1) {
    if (shards.length === 0) throw new Error('At least one shard is required');
    this.shards = shards;
    this.points = shards
      .flatMap((shard) =>
        Array.from({ length: Math.max(1, virtualNodes) }, (_, i) => ({
          shard,
          position: hashString(`${shard}#${i}`) / RING_SIZE,
        })),
      )
      .sort((a, b) => a.position - b.position || a.shard.localeCompare(b.shard));
  }

  /** Walk clockwise from the key's position to the first shard point. */
  owner(key: string): string {
    const position = keyPosition(key);
    let lo = 0;
    let hi = this.points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.points[mid]?.position ?? 1) < position) lo = mid + 1;
      else hi = mid;
    }
    const point = this.points[lo % this.points.length];
    return point?.shard ?? (this.shards[0] as string);
  }
}

export function keyPosition(key: string): number {
  return hashString(key) / RING_SIZE;
}

export function assignKeys(
  keys: readonly string[],
  shards: readonly string[],
  placement: Placement,
  virtualNodes = 1,
): Map<string, string> {
  const ring = placement === 'ring' ? new HashRing(shards, virtualNodes) : undefined;
  return new Map(keys.map((key) => [key, ring ? ring.owner(key) : moduloOwner(key, shards)] as const));
}

export function countMoved(before: Map<string, string>, after: Map<string, string>): number {
  let moved = 0;
  for (const [key, shard] of before) if (after.get(key) !== shard) moved += 1;
  return moved;
}

export interface LoadSummary {
  counts: Record<string, number>;
  /** Busiest shard divided by the average; 1.0 is perfectly even. */
  imbalance: number;
}

export function summarizeLoad(assignment: Map<string, string>, shards: readonly string[]): LoadSummary {
  const counts: Record<string, number> = Object.fromEntries(shards.map((shard) => [shard, 0]));
  for (const shard of assignment.values()) counts[shard] = (counts[shard] ?? 0) + 1;
  const average = assignment.size / shards.length;
  const busiest = Math.max(...Object.values(counts));
  return { counts, imbalance: average === 0 ? 1 : busiest / average };
}
