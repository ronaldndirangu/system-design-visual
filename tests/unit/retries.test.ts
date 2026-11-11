import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  attemptDraws,
  HERD_CAPACITY,
  HERD_CLIENTS,
  HerdDuel,
  jitterWaitMs,
  type RetryCommand,
  RetryDuel,
  RetryHerd,
  type RetryPolicy,
  type RetryScenarioId,
  RetryServer,
  type RetryTick,
  retryScenarios,
  summarizeRetries,
} from '../../src/lib/models/retries';

const policies: RetryPolicy[] = ['none', 'immediate', 'jitter', 'budget'];
const scenarioIds = Object.keys(retryScenarios) as RetryScenarioId[];
const storm = retryScenarios.storm.schedule;

function play(
  server: RetryServer,
  ticks: number,
  schedule: ScheduledCommand<RetryCommand>[] = storm,
): RetryTick[] {
  const out: RetryTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(server, schedule));
  return out;
}

const run = <T extends { done: boolean; step(): void }>(duel: T): T => {
  while (!duel.done) duel.step();
  return duel;
};

const summaries = (id: RetryScenarioId, seed = 42) =>
  run(new RetryDuel(retryScenarios[id], seed)).lanes.map(summarizeRetries);

describe('RetryServer playback', () => {
  it('feeds every policy the same clicks', () => {
    const arrived = policies.map((policy) => {
      const server = new RetryServer({ policy });
      return play(server, 200).map(() => server.totals.arrived);
    });
    for (const other of arrived.slice(1)) expect(other).toEqual(arrived[0]);
  });

  it('replays a scripted run exactly', () => {
    for (const policy of policies) {
      const a = play(new RetryServer({ policy, seed: 7 }), 200);
      const b = play(new RetryServer({ policy, seed: 7 }), 200);
      expect(b).toEqual(a);
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const server = new RetryServer({ policy: 'budget' });
    const start = server.checkpoint();
    const first = play(server, 200);
    server.restore(start);
    expect(server.ticks).toBe(0);
    expect(play(server, 200)).toEqual(first);
  });

  it('resumes from a checkpoint taken mid run, in the same or a fresh server', () => {
    const server = new RetryServer({ policy: 'jitter' });
    play(server, 45);
    const saved = server.checkpoint();
    const rest = play(server, 155);

    server.restore(saved);
    expect(play(server, 155)).toEqual(rest);

    const fresh = new RetryServer({ policy: 'jitter' });
    fresh.restore(saved);
    expect(play(fresh, 155)).toEqual(rest);
  });

  it('accounts for every click and attempt at every tick', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      for (const id of scenarioIds) {
        const { schedule } = retryScenarios[id];
        for (const policy of policies) {
          const server = new RetryServer({ policy, seed });
          for (let i = 0; i < 200; i += 1) {
            stepScheduled(server, schedule);
            const t = server.totals;
            expect(t.arrived).toBe(t.confirmed + t.gaveUp + server.inFlight);
            expect(t.attempts).toBe(t.rejected + t.finished + server.inService);
            expect(t.attempts).toBe(t.arrived + t.retries);
            expect(t.finished).toBe(t.transient + t.recorded + t.duplicates);
            expect(t.confirmed).toBeLessThanOrEqual(t.recorded);
            expect(t.recorded).toBeLessThanOrEqual(t.arrived);
            if (policy === 'none') expect(t.retries).toBe(0);
            if (policy !== 'budget') expect(t.budgetDenied).toBe(0);
          }
        }
      }
    }
  });

  it('never lets a budget spend more retries than fresh clicks refill', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      for (const id of scenarioIds) {
        const server = new RetryServer({ policy: 'budget', seed });
        play(server, 200, retryScenarios[id].schedule);
        const t = server.totals;
        expect(t.retries).toBeLessThanOrEqual(10 + t.arrived * 0.1);
      }
    }
  });
});

describe('Retry duels on the same clicks', () => {
  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const [healthyNone, healthyJitter] = summaries('healthy');
    expect(healthyNone).toMatchObject({ arrived: 3018, confirmed: 2963, gaveUp: 52, attempts: 3018 });
    expect(healthyJitter).toMatchObject({ arrived: 3018, confirmed: 3015, gaveUp: 0, attempts: 3072 });

    const [stormNone, stormJitter] = summaries('storm');
    expect(stormNone).toMatchObject({
      confirmed: 2485,
      gaveUp: 530,
      attempts: 3018,
      timedOut: 484,
      recoverySeconds: 1.8,
    });
    expect(stormJitter).toMatchObject({
      confirmed: 574,
      gaveUp: 2245,
      attempts: 10002,
      rejected: 6288,
      timedOut: 3034,
      wasted: 2972,
      duplicates: 1198,
      peakAttemptsPerSecond: 720,
      recoverySeconds: null,
    });
    expect(stormJitter?.amplification).toBeCloseTo(3.31, 2);

    const [blipNow, blipJitter] = summaries('blip');
    expect(blipNow).toMatchObject({
      confirmed: 2939,
      gaveUp: 76,
      attempts: 3312,
      peakAttemptsPerSecond: 403,
    });
    expect(blipJitter).toMatchObject({
      confirmed: 3012,
      gaveUp: 3,
      attempts: 3248,
      peakAttemptsPerSecond: 333,
    });
    expect(blipNow?.recoverySeconds).toBe(0.1);
    expect(blipJitter?.recoverySeconds).toBe(0.1);

    const [budgetJitter, budget] = summaries('budget');
    expect(budgetJitter).toEqual(stormJitter);
    expect(budget).toMatchObject({
      confirmed: 2489,
      gaveUp: 526,
      attempts: 3121,
      duplicates: 54,
      peakAttemptsPerSecond: 179,
    });
    expect(budget?.recoverySeconds).toBe(2.2);
    expect(budget?.amplification).toBeCloseTo(1.03, 2);
  });

  it('keys each try by click and try number, so every policy meets the same luck', () => {
    expect(attemptDraws(42, 17, 2)).toEqual(attemptDraws(42, 17, 2));
    expect(jitterWaitMs(42, 17, 2)).toBe(jitterWaitMs(42, 17, 2));
    const service = new Set(Array.from({ length: 60 }, (_, id) => attemptDraws(42, id, 1).serviceMs));
    expect([...service].sort((a, b) => a - b)).toEqual([30, 40, 50]);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      for (let id = 0; id < 50; id += 1) {
        const wait = jitterWaitMs(42, id, attempt);
        expect(wait).toBeGreaterThanOrEqual(10);
        expect(wait).toBeLessThanOrEqual(200 * 2 ** (attempt - 1));
      }
    }
  });

  it('keeps a budget lane out of the metastable failure for other seeds', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const [jitter, budget] = summaries('budget', seed);
      expect(budget?.recoverySeconds).not.toBeNull();
      expect(budget?.confirmed).toBeGreaterThan(jitter?.confirmed ?? 0);
      expect(budget?.amplification).toBeLessThan(1.2);
    }
  });

  it('lets a budget retry every transient error on a normal day', () => {
    const healthy = {
      ...retryScenarios.healthy,
      policies: ['jitter', 'budget'] as [RetryPolicy, RetryPolicy],
    };
    const duel = run(new RetryDuel(healthy, 42));
    const [jitter, budget] = duel.lanes.map(summarizeRetries);
    expect(budget).toEqual(jitter);
    expect(budget).toMatchObject({ confirmed: 3015, gaveUp: 0 });
    expect(duel.lanes[1].server.totals.budgetDenied).toBe(0);
  });

  it('annotates the run in order and ends with a wrap up note', () => {
    const texts = (id: RetryScenarioId) => {
      const duel = run(new RetryDuel(retryScenarios[id]));
      expect(duel.events.at(-1)?.marker).toBe(false);
      return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
    };
    expect(texts('storm')).toEqual([
      '3.0 The ingest service slows down: attempts take twice as long.',
      '4.3 No retries: the first attempt times out after 500 ms.',
      '4.3 Backoff with jitter: the first attempt times out after 500 ms.',
      '4.7 Backoff with jitter: the queue is full, so new attempts get a 503.',
      '6.0 The ingest service runs at full speed again.',
      '6.1 No retries: the queue is full, so new attempts get a 503.',
      '7.8 No retries: attempts stop failing, 1.8 s after the service is healthy again.',
      '20.0 Run ends. Clicks confirmed: No retries 2485, Backoff with jitter 574. Attempts sent: 3018 and 10002. Backoff with jitter is still failing when the run ends.',
    ]);
    expect(texts('budget')).toContain(
      '4.4 Jitter and a budget: the retry budget runs dry, so failed clicks stop retrying.',
    );
    expect(texts('blip').slice(1, 3)).toEqual([
      '3.1 Retry at once: the first click gives up during the restart, because the service refused its attempts.',
      '3.4 Backoff with jitter: the first click gives up during the restart, because the service refused its attempts.',
    ]);
  });

  it('stops after the run length', () => {
    const duel = run(new RetryDuel(retryScenarios.healthy));
    expect(duel.ticks).toBe(200);
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes[0].series).toHaveLength(200);
  });
});

describe('RetryHerd after a restart', () => {
  const playHerd = (herd: RetryHerd, steps: number) => {
    const out = [];
    for (let i = 0; i < steps; i += 1) out.push(herd.step());
    return out;
  };

  it('replays and resets exactly', () => {
    for (const policy of ['backoff', 'jitter'] as const) {
      const herd = new RetryHerd(policy, 9);
      const start = herd.checkpoint();
      const first = playHerd(herd, 120);
      expect(playHerd(new RetryHerd(policy, 9), 120)).toEqual(first);
      herd.restore(start);
      expect(playHerd(herd, 120)).toEqual(first);
    }
  });

  it('accounts for every attempt and never serves more than capacity in a step', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const policy of ['backoff', 'jitter'] as const) {
        const herd = new RetryHerd(policy, seed);
        for (const tick of playHerd(herd, 120)) {
          expect(tick.served).toBeLessThanOrEqual(HERD_CAPACITY);
          const t = herd.totals;
          expect(t.attempts).toBe(t.served + t.rejected + t.refused);
          expect(t.served + herd.waiting).toBe(HERD_CLIENTS);
        }
      }
    }
  });

  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const duel = run(new HerdDuel(42));
    const [backoff, jitter] = duel.lanes;
    expect(backoff.herd.totals).toMatchObject({ attempts: 222, served: 12 });
    expect(backoff.herd.waiting).toBe(28);
    expect(backoff.peakAttempts).toBe(40);
    expect(backoff.idleSteps).toBe(106);
    const waves = backoff.series.flatMap((count, step) => (count > 0 ? [[step, count]] : []));
    expect(waves).toEqual([
      [2, 40],
      [6, 40],
      [14, 40],
      [30, 37],
      [62, 34],
      [94, 31],
    ]);

    expect(jitter.herd.totals).toMatchObject({ attempts: 163, served: 40 });
    expect(jitter.herd.allServedAt).toBe(2000);
    expect(jitter.peakAttempts).toBe(26);
    expect(jitter.idleSteps).toBe(12);
    expect(duel.events.at(-1)?.text).toBe(
      'Run ends. Backoff, no jitter still has 28 of 40 waiting after 222 attempts; Backoff with full jitter used 163 attempts.',
    );
  });

  it('connects every jittered sender sooner, across seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [backoff, jitter] = run(new HerdDuel(seed)).lanes;
      expect(jitter.herd.waiting).toBe(0);
      expect(backoff.herd.waiting).toBeGreaterThan(0);
      expect(jitter.peakAttempts).toBeLessThan(backoff.peakAttempts);
    }
  });
});
