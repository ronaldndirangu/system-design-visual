import { describe, expect, it } from 'vitest';
import { percentile, ServerFarm } from '../../src/lib/models/serverFarm';
import { niceScale } from '../../src/lib/niceScale';

function run(farm: ServerFarm, seconds: number) {
  const ticks = Math.round(seconds / 0.1);
  for (let i = 0; i < ticks; i += 1) farm.step();
  return farm.stats();
}

describe('ServerFarm', () => {
  it('serves everything with no errors below capacity', () => {
    const stats = run(new ServerFarm({ capacities: [100], arrivalRate: 50 }), 20);
    expect(stats.errorRate).toBe(0);
    expect(stats.servedPerSecond).toBeGreaterThan(40);
    expect(stats.utilization).toBeLessThan(0.7);
  });

  it('melts one server at 150 req/s: errors climb and latency explodes', () => {
    const stats = run(new ServerFarm({ capacities: [100], arrivalRate: 150, queueLimit: 60 }), 20);
    expect(stats.errorRate).toBeGreaterThan(0.25);
    expect(stats.servedPerSecond).toBeLessThanOrEqual(101);
    expect(stats.p95Ms).toBeGreaterThan(400);
  });

  it('recovers when a second server joins', () => {
    const farm = new ServerFarm({ capacities: [100], arrivalRate: 150, queueLimit: 60 });
    run(farm, 10);
    farm.setCapacities([100, 100]);
    const stats = run(farm, 20);
    expect(stats.errorRate).toBe(0);
  });

  it('replays the same run for the same seed', () => {
    const a = run(new ServerFarm({ arrivalRate: 90, seed: 5 }), 10);
    const b = run(new ServerFarm({ arrivalRate: 90, seed: 5 }), 10);
    expect(a).toEqual(b);
  });

  it('keeps the mean load the same when some requests are heavy', () => {
    const light = run(new ServerFarm({ capacities: [100], arrivalRate: 60, heavyShare: 0 }), 60);
    const mixed = run(new ServerFarm({ capacities: [100], arrivalRate: 60, heavyShare: 0.1 }), 60);
    expect(Math.abs(light.utilization - mixed.utilization)).toBeLessThan(0.08);
  });

  it('balances heavy requests better with least connections than round robin', () => {
    const config = { capacities: [100, 100, 100], arrivalRate: 240, heavyShare: 0.1, queueLimit: 60 };
    const roundRobin = run(new ServerFarm({ ...config, strategy: 'round-robin' }), 30);
    const least = run(new ServerFarm({ ...config, strategy: 'least-connections' }), 30);
    expect(least.p95Ms).toBeLessThanOrEqual(roundRobin.p95Ms);
  });

  it('fails requests to a crashed server until the health check removes it', () => {
    const farm = new ServerFarm({ capacities: [100, 100], arrivalRate: 100, healthCheckSeconds: 2 });
    run(farm, 2);
    farm.crash(0);
    const during = farm.step();
    expect(during.failed).toBeGreaterThan(0);
    run(farm, 2.5);
    const after = farm.step();
    expect(after.servers.find((server) => server.id === 0)?.inPool).toBe(false);
    expect(after.failed).toBe(0);
  });

  it('drains removed servers before dropping them', () => {
    const farm = new ServerFarm({ capacities: [100, 100], arrivalRate: 150 });
    run(farm, 2);
    farm.setCapacities([100]);
    expect(farm.serverStates.some((server) => server.draining)).toBe(true);
    run(farm, 5);
    expect(farm.serverStates).toHaveLength(1);
  });

  it('gives random routing a worse p95 than round robin at the lab settings', () => {
    const p95 = (strategy: 'round-robin' | 'random', seed: number) => {
      const farm = new ServerFarm({
        capacities: [100, 100, 100],
        arrivalRate: 210,
        heavyShare: 0.1,
        queueLimit: 60,
        strategy,
        seed,
      });
      const latencies: number[] = [];
      for (let tick = 0; tick < 300; tick += 1) latencies.push(...farm.step().latencies);
      return percentile(
        latencies.sort((a, b) => a - b),
        0.95,
      );
    };
    for (let seed = 1; seed <= 12; seed += 1) {
      expect(p95('random', seed)).toBeGreaterThan(p95('round-robin', seed));
    }
  });
});

describe('niceScale', () => {
  it('rounds axis maximums up to whole steps of 1, 2, or 5', () => {
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
    expect(niceScale(3)).toEqual({ max: 3, step: 1 });
    expect(niceScale(21)).toEqual({ max: 30, step: 10 });
    expect(niceScale(333)).toEqual({ max: 400, step: 100 });
    expect(niceScale(100)).toEqual({ max: 100, step: 50 });
  });
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
  });
});
