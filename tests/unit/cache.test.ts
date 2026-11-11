import { describe, expect, it } from 'vitest';
import { CacheSim, topShare } from '../../src/lib/models/cache';

function warm(sim: CacheSim, ticks = 200) {
  for (let i = 0; i < ticks; i += 1) sim.step();
  return sim.stats();
}

describe('CacheSim', () => {
  it('never hits with no cache', () => {
    expect(warm(new CacheSim({ capacity: 0 })).hitRatio).toBe(0);
  });

  it('reaches roughly the 69% hit ratio the lesson quotes for 100 of 1,000 links', () => {
    const { hitRatio } = warm(new CacheSim({ capacity: 100 }), 400);
    expect(hitRatio).toBeGreaterThan(0.6);
    expect(hitRatio).toBeLessThan(0.75);
  });

  it('hits more with a bigger cache and with more skew', () => {
    const small = warm(new CacheSim({ capacity: 50 })).hitRatio;
    const big = warm(new CacheSim({ capacity: 300 })).hitRatio;
    const flat = warm(new CacheSim({ capacity: 100, skew: 0 })).hitRatio;
    const skewed = warm(new CacheSim({ capacity: 100, skew: 1.2 })).hitRatio;
    expect(big).toBeGreaterThan(small);
    expect(skewed).toBeGreaterThan(flat);
    expect(flat).toBeLessThan(0.15);
  });

  it('never holds more entries than its capacity', () => {
    const sim = new CacheSim({ capacity: 25 });
    warm(sim, 50);
    expect(sim.cachedKeys.length).toBeLessThanOrEqual(25);
    sim.setCapacity(10);
    expect(sim.cachedKeys.length).toBeLessThanOrEqual(10);
  });

  it('a short TTL lowers the hit ratio', () => {
    const forever = warm(new CacheSim({ capacity: 100, ttlTicks: 0 })).hitRatio;
    const short = warm(new CacheSim({ capacity: 100, ttlTicks: 5 })).hitRatio;
    expect(short).toBeLessThan(forever);
  });

  it('a flush sends the next requests to the database', () => {
    const sim = new CacheSim({ capacity: 100 });
    warm(sim);
    sim.flush();
    const tick = sim.step();
    expect(tick.misses).toBeGreaterThan(tick.requests / 2);
  });

  it('replays the same run for the same seed', () => {
    expect(warm(new CacheSim({ seed: 3 }))).toEqual(warm(new CacheSim({ seed: 3 })));
  });
});

describe('topShare', () => {
  it('gives an even share when skew is 0', () => {
    expect(topShare(1_000, 100, 0)).toBeCloseTo(0.1, 5);
  });

  it('puts most clicks on the top 10% when skew is 1', () => {
    expect(topShare(1_000, 100, 1)).toBeGreaterThan(0.65);
  });
});
