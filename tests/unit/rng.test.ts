import { describe, expect, it } from 'vitest';
import { createRng, createZipf, hashString, poisson } from '../../src/lib/rng';

describe('createRng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1_000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('poisson', () => {
  it.each([0.5, 4, 120])('averages close to the mean %d', (mean) => {
    const rng = createRng(1);
    const samples = 4_000;
    let total = 0;
    for (let i = 0; i < samples; i += 1) total += poisson(rng, mean);
    expect(total / samples).toBeCloseTo(mean, mean > 10 ? -1 : 0);
  });

  it('returns zero for a zero mean', () => {
    expect(poisson(createRng(1), 0)).toBe(0);
  });
});

describe('createZipf', () => {
  it('sends far more traffic to the first key than to the last', () => {
    const rng = createRng(5);
    const pick = createZipf(100, 1);
    const counts = new Array<number>(100).fill(0);
    for (let i = 0; i < 20_000; i += 1) {
      const key = pick(rng);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts[0]).toBeGreaterThan((counts[99] ?? 0) * 20);
  });

  it('is roughly uniform when skew is zero', () => {
    const rng = createRng(5);
    const pick = createZipf(4, 0);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8_000; i += 1) {
      const key = pick(rng);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const count of counts) expect(count).toBeGreaterThan(1_800);
  });
});

describe('hashString', () => {
  it('is stable and spreads similar inputs apart', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(Math.abs(hashString('server-1') - hashString('server-2'))).toBeGreaterThan(1_000_000);
  });
});
