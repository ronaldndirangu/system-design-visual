import { describe, expect, it } from 'vitest';
import {
  assignKeys,
  countMoved,
  HashRing,
  keyPosition,
  makeShortCodes,
  moduloOwner,
  summarizeLoad,
} from '../../src/lib/models/hashing';

const shardNames = (count: number) => Array.from({ length: count }, (_, i) => `S${i}`);
const keys = makeShortCodes(2_000);

function movedShare(placement: 'modulo' | 'ring', from: number, to: number, virtualNodes = 1) {
  const before = assignKeys(keys, shardNames(from), placement, virtualNodes);
  const after = assignKeys(keys, shardNames(to), placement, virtualNodes);
  return countMoved(before, after) / keys.length;
}

describe('makeShortCodes', () => {
  it('returns unique, deterministic codes', () => {
    const codes = makeShortCodes(240);
    expect(new Set(codes).size).toBe(240);
    expect(makeShortCodes(240)).toEqual(codes);
    expect(codes.every((code) => /^[0-9a-zA-Z]{6}$/.test(code))).toBe(true);
  });
});

describe('hash mod N', () => {
  it('always returns one of the shards', () => {
    const shards = shardNames(5);
    for (const key of keys.slice(0, 100)) expect(shards).toContain(moduloOwner(key, shards));
  });

  it('moves about 80% of keys going from 4 to 5 shards, as the lesson claims', () => {
    const share = movedShare('modulo', 4, 5);
    expect(share).toBeGreaterThan(0.72);
    expect(share).toBeLessThan(0.88);
  });

  it('moves about 90% of keys going from 9 to 10 shards, as the quiz claims', () => {
    expect(movedShare('modulo', 9, 10)).toBeGreaterThan(0.84);
  });
});

describe('consistent hashing ring', () => {
  it('only moves keys onto the new shard when a shard joins', () => {
    const before = assignKeys(keys, shardNames(4), 'ring', 16);
    const after = assignKeys(keys, shardNames(5), 'ring', 16);
    for (const [key, shard] of before) {
      const next = after.get(key);
      if (next !== shard) expect(next).toBe('S4');
    }
  });

  it('moves close to 1/N of keys with virtual nodes', () => {
    const share = movedShare('ring', 4, 5, 64);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
  });

  it('moves far fewer keys than mod N', () => {
    expect(movedShare('ring', 4, 5, 16)).toBeLessThan(movedShare('modulo', 4, 5) / 2);
  });

  it('evens out the load as virtual nodes grow', () => {
    const shards = shardNames(6);
    const lumpy = summarizeLoad(assignKeys(keys, shards, 'ring', 1), shards).imbalance;
    const even = summarizeLoad(assignKeys(keys, shards, 'ring', 64), shards).imbalance;
    expect(even).toBeLessThan(lumpy);
    expect(even).toBeLessThan(1.35);
  });

  it('matches a linear clockwise walk, including wraparound past the last point', () => {
    const ring = new HashRing(['A', 'B', 'C'], 4);
    for (const key of keys.slice(0, 500)) {
      const position = keyPosition(key);
      const expected = ring.points.find((point) => point.position >= position) ?? ring.points[0];
      expect(ring.owner(key)).toBe(expected?.shard);
    }
  });

  it('rejects an empty shard list', () => {
    expect(() => new HashRing([])).toThrow();
    expect(() => moduloOwner('x', [])).toThrow();
  });
});

describe('summarizeLoad', () => {
  it('counts every key once and reports 1.0 for a perfect split', () => {
    const assignment = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    const load = summarizeLoad(assignment, ['A', 'B']);
    expect(load.counts).toEqual({ A: 1, B: 1 });
    expect(load.imbalance).toBe(1);
  });
});

describe('sharding widget walkthrough', () => {
  const codes = makeShortCodes(240);
  const abcd = ['A', 'B', 'C', 'D'];

  it('compares a vnode change against the layout before it', () => {
    const before = assignKeys(codes, abcd, 'ring', 1);
    const after = assignKeys(codes, abcd, 'ring', 64);
    expect(countMoved(before, after)).toBe(177);
    expect(summarizeLoad(before, abcd).imbalance.toFixed(2)).toBe('2.08');
    expect(summarizeLoad(after, abcd).imbalance.toFixed(2)).toBe('1.07');
  });

  it('moves under a fifth of the keys when shard E joins at 64 vnodes', () => {
    const before = assignKeys(codes, abcd, 'ring', 64);
    const after = assignKeys(codes, [...abcd, 'E'], 'ring', 64);
    expect(countMoved(before, after)).toBe(47);
  });
});
