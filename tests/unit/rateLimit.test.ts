import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  bucketScenarios,
  duelScenarios,
  LimiterRun,
  type RateLimitCommand,
  type RateLimitConfig,
  RateLimitModel,
  type RateLimitTick,
  type RunScenario,
  summarize,
} from '../../src/lib/models/rateLimit';

const config: Partial<RateLimitConfig> = {
  clients: [
    { id: 'a', label: 'A', rate: 120, polite: false },
    { id: 'b', label: 'B', rate: 40, polite: true },
    { id: 'c', label: 'C', rate: 0, polite: true, edges: { burst: 30, periodTicks: 20, offsets: [9, 10] } },
  ],
  limiter: { kind: 'tokenBucket', rate: 60, burst: 20 },
  retry: 'retryAfter',
  capacity: 150,
  queueLimit: 25,
  seed: 7,
};

const schedule: ScheduledCommand<RateLimitCommand>[] = [
  { at: 20, command: { type: 'setRate', client: 0, rate: 300 } },
  {
    at: 50,
    command: { type: 'setLimiter', limiter: { kind: 'slidingWindow', limit: 50, windowSeconds: 1 } },
  },
  {
    at: 90,
    command: { type: 'setLimiter', limiter: { kind: 'fixedWindow', limit: 40, windowSeconds: 0.5 } },
  },
  { at: 120, command: { type: 'setRate', client: 0, rate: 20 } },
];

function play(model: RateLimitModel, ticks: number): RateLimitTick[] {
  const out: RateLimitTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(model, schedule));
  return out;
}

const run = (limiterRun: LimiterRun) => {
  while (!limiterRun.done) limiterRun.step();
  return limiterRun;
};

const summaries = (scenario: RunScenario, seed = 42) =>
  run(new LimiterRun(scenario, seed)).lanes.map(summarize);

describe('RateLimitModel', () => {
  it('replays a scripted run exactly', () => {
    expect(play(new RateLimitModel(config), 160)).toEqual(play(new RateLimitModel(config), 160));
  });

  it('feeds every limiter and retry policy the same arrivals', () => {
    const arrivals = (overrides: Partial<RateLimitConfig>) =>
      play(new RateLimitModel({ ...config, ...overrides }), 160).map((tick) =>
        tick.clients.map((c) => c.arrived),
      );
    const base = arrivals({});
    expect(arrivals({ limiter: { kind: 'none' }, retry: 'none' })).toEqual(base);
    expect(
      arrivals({ limiter: { kind: 'fixedWindow', limit: 10, windowSeconds: 1 }, retry: 'immediate' }),
    ).toEqual(base);
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const model = new RateLimitModel(config);
    const start = model.checkpoint();
    const first = play(model, 160);
    model.restore(start);
    expect(model.ticks).toBe(0);
    expect(play(model, 160)).toEqual(first);
  });

  it('resumes from a checkpoint midway, in the same or a fresh model', () => {
    const model = new RateLimitModel(config);
    play(model, 70);
    const saved = model.checkpoint();
    const rest = play(model, 90);

    model.restore(saved);
    expect(play(model, 90)).toEqual(rest);

    const fresh = new RateLimitModel({ ...config, seed: 999 });
    fresh.restore(saved);
    expect(play(fresh, 90)).toEqual(rest);
  });

  it('keeps checkpoints independent of later changes', () => {
    const model = new RateLimitModel(config);
    play(model, 40);
    const saved = model.checkpoint();
    const copy = structuredClone(saved);
    play(model, 40);
    expect(saved).toEqual(copy);
  });

  it('accounts for every request: arrived = served + limited + failed + in flight', () => {
    for (const retry of ['none', 'immediate', 'retryAfter'] as const) {
      const model = new RateLimitModel({ ...config, retry });
      for (let i = 0; i < 160; i += 1) {
        stepScheduled(model, schedule);
        model.clientTotals().forEach((totals, client) => {
          expect(totals.arrived).toBe(
            totals.served + totals.limited + totals.failed + model.inFlight(client),
          );
        });
      }
    }
  });

  it('lets a full token bucket absorb a burst, then admits only the refill rate', () => {
    const model = new RateLimitModel({
      clients: [
        { id: 'a', label: 'A', rate: 0, polite: true, edges: { burst: 40, periodTicks: 1000, offsets: [0] } },
      ],
      limiter: { kind: 'tokenBucket', rate: 10, burst: 20 },
    });
    const first = model.step();
    expect(first.admitted).toBe(20);
    expect(first.limited).toBe(20);
    for (let i = 0; i < 9; i += 1) model.step();
    expect(model.step().allowance[0]).toBeCloseTo(10);
  });

  it('lets a fixed window admit twice its limit across a boundary, unlike a sliding window', () => {
    const edge = { burst: 100, periodTicks: 1000, offsets: [9, 10] };
    const busiest = (limiter: RateLimitConfig['limiter']) => {
      const model = new RateLimitModel({
        clients: [{ id: 'a', label: 'A', rate: 0, polite: true, edges: edge }],
        limiter,
      });
      for (let i = 0; i < 20; i += 1) model.step();
      return model.peakLoad;
    };
    expect(busiest({ kind: 'fixedWindow', limit: 100, windowSeconds: 1 })).toBe(200);
    expect(busiest({ kind: 'slidingWindow', limit: 100, windowSeconds: 1 })).toBe(100);
  });

  it('waits at least the advertised Retry-After before retrying', () => {
    const model = new RateLimitModel({
      clients: [
        { id: 'a', label: 'A', rate: 0, polite: true, edges: { burst: 5, periodTicks: 1000, offsets: [0] } },
      ],
      limiter: { kind: 'fixedWindow', limit: 1, windowSeconds: 2 },
      retry: 'retryAfter',
    });
    const attempts = Array.from({ length: 30 }, () => model.step().attempts);
    expect(attempts[0]).toBe(5);
    expect(attempts.slice(1, 20).every((count) => count === 0)).toBe(true);
    expect(attempts.slice(20).reduce((sum, count) => sum + count, 0)).toBe(4);
  });
});

describe('Rate limit duels', () => {
  it('ties when every client stays under its limit, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [open, limited] = summaries(duelScenarios.calm, seed);
      expect(limited).toEqual(open);
    }
  });

  it('protects polite clients from a noisy neighbor, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [open, limited] = summaries(duelScenarios.noisy, seed);
      expect(open?.politeFailed ?? 0).toBeGreaterThan(500);
      expect(limited?.politeFailed).toBe(0);
      expect(limited?.politeLimited).toBe(0);
    }
  });

  it('shows the fixed window boundary burst, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [fixed, sliding] = summaries(duelScenarios.edges, seed);
      expect(fixed?.peakLoad ?? 0).toBeGreaterThan((sliding?.peakLoad ?? 0) + 70);
      expect(fixed?.politeFailed ?? 0).toBeGreaterThan(0);
      expect(sliding?.politeFailed).toBe(0);
    }
  });

  it('shows Retry-After with jitter saving work and requests, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [eager, patient] = summaries(duelScenarios.retries, seed);
      expect(patient?.limited ?? 0).toBeLessThan((eager?.limited ?? 0) / 2);
      expect(patient?.rejections ?? 0).toBeLessThan(eager?.rejections ?? 0);
    }
  });

  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const [open, limited] = summaries(duelScenarios.noisy);
    expect(open?.politeServed).toBe(2001);
    expect(open?.politeArrived).toBe(2992);
    expect(limited?.politeServed).toBe(2992);
    const [fixed, sliding] = summaries(duelScenarios.edges);
    expect(fixed?.peakLoad).toBe(295);
    expect(sliding?.peakLoad).toBe(195);
    const [eager, patient] = summaries(duelScenarios.retries);
    expect(eager?.limited).toBe(181);
    expect(patient?.limited).toBe(32);
    expect(eager?.rejections).toBe(1126);
    expect(patient?.rejections).toBe(721);
    const [bucket] = summaries(bucketScenarios.burst);
    expect(bucket?.limited).toBe(22);
  });

  it('annotates the change, the first 429, and the first 503', () => {
    const noisy = run(new LimiterRun(duelScenarios.noisy));
    const texts = noisy.events.map((event) => `${(event.tick * noisy.tickSeconds).toFixed(1)} ${event.text}`);
    expect(texts[0]).toBe('5.0 Client A jumps from 50 to 400 req/s');
    expect(texts).toContain('5.0 Token bucket per client: first 429 for client A');
    expect(texts.some((text) => text.includes('No limit: server queue full, client B gets 503'))).toBe(true);
    expect(texts.at(-1)).toBe(
      '20.0 Run complete. Polite clients got No limit 67% served, Token bucket per client 100% served.',
    );
  });

  it('marks when the playground bucket runs dry and fills again', () => {
    const burst = run(new LimiterRun(bucketScenarios.burst));
    const texts = burst.events.map((event) => event.text);
    expect(texts).toContain('Bucket empty: requests now get 429');
    expect(texts).toContain('Bucket full again');
    expect(burst.series[0]).toHaveLength(120);
  });

  it('stops after the run length', () => {
    const noisy = run(new LimiterRun(duelScenarios.noisy));
    expect(noisy.ticks).toBe(200);
    expect(noisy.step()).toEqual([]);
    expect(noisy.ticks).toBe(200);
    expect(noisy.series[1]).toHaveLength(200);
  });
});
