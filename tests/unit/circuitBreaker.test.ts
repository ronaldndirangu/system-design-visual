import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  type BreakerCommand,
  BreakerDuel,
  type BreakerPolicy,
  type BreakerScenarioId,
  BreakerServer,
  type BreakerTick,
  breakerScenarios,
  COOLDOWN_MS,
  FAULT_TICK,
  PROBES,
  summarizeBreaker,
} from '../../src/lib/models/circuitBreaker';

const policies: BreakerPolicy[] = ['none', 'breaker', 'flood'];
const scenarioIds = Object.keys(breakerScenarios) as BreakerScenarioId[];
const hang = breakerScenarios.hang.schedule;

function play(
  server: BreakerServer,
  ticks: number,
  schedule: ScheduledCommand<BreakerCommand>[] = hang,
): BreakerTick[] {
  const out: BreakerTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(server, schedule));
  return out;
}

const run = (duel: BreakerDuel): BreakerDuel => {
  while (!duel.done) duel.step();
  return duel;
};

const summaries = (id: BreakerScenarioId, seed = 42) =>
  run(new BreakerDuel(breakerScenarios[id], seed)).lanes.map(summarizeBreaker);

describe('BreakerServer playback', () => {
  it('feeds every policy the same redirects', () => {
    const arrived = policies.map((policy) => {
      const server = new BreakerServer({ policy });
      return play(server, 200).map(() => server.totals.arrived);
    });
    for (const other of arrived.slice(1)) expect(other).toEqual(arrived[0]);
  });

  it('replays a scripted run exactly', () => {
    for (const policy of policies) {
      const a = play(new BreakerServer({ policy, seed: 7 }), 200);
      const b = play(new BreakerServer({ policy, seed: 7 }), 200);
      expect(b).toEqual(a);
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const server = new BreakerServer({ policy: 'breaker' });
    const start = server.checkpoint();
    const first = play(server, 200);
    server.restore(start);
    expect(server.ticks).toBe(0);
    expect(server.breakerState).toBe('closed');
    expect(play(server, 200)).toEqual(first);
  });

  it('resumes from a checkpoint taken mid run, in the same or a fresh server', () => {
    const server = new BreakerServer({ policy: 'breaker' });
    play(server, 63);
    expect(server.breakerState).toBe('half-open');
    const saved = server.checkpoint();
    const rest = play(server, 137);

    server.restore(saved);
    expect(play(server, 137)).toEqual(rest);

    const fresh = new BreakerServer({ policy: 'breaker' });
    fresh.restore(saved);
    expect(play(fresh, 137)).toEqual(rest);
  });

  it('accounts for every redirect at every tick', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      for (const id of scenarioIds) {
        const { schedule } = breakerScenarios[id];
        for (const policy of policies) {
          const server = new BreakerServer({ policy, seed });
          for (let i = 0; i < 200; i += 1) {
            stepScheduled(server, schedule);
            const t = server.totals;
            expect(t.arrived).toBe(t.answered + t.rejected + server.inFlight);
            expect(t.answered).toBe(t.recorded + t.buffered);
            expect(t.timedOut).toBeLessThanOrEqual(t.callFailures);
            if (policy === 'none') {
              expect(t.shortCircuited + t.opens + t.probes).toBe(0);
              expect(server.breakerState).toBe('closed');
            }
            if (policy === 'breaker') expect(t.probes).toBeLessThanOrEqual(PROBES * t.opens);
          }
        }
      }
    }
  });
});

describe('Breaker states', () => {
  it('opens on failures, waits out the cooldown, and reopens when a probe fails', () => {
    const server = new BreakerServer({ policy: 'breaker' });
    const states = play(server, 200).map((tick) => tick.state);
    const opened = states.indexOf('open');
    expect(opened).toBeGreaterThan(FAULT_TICK);
    expect(server.lastTrip.failures / server.lastTrip.calls).toBeGreaterThanOrEqual(0.5);
    const cooldownTicks = COOLDOWN_MS / 100;
    expect(states.slice(opened, opened + cooldownTicks - 1).every((state) => state === 'open')).toBe(true);
    expect(states.indexOf('half-open')).toBe(opened + cooldownTicks);
    expect(server.totals).toMatchObject({ opens: 4, failedProbes: 3, closes: 1 });
    expect(states.at(-1)).toBe('closed');
  });

  it('sends at most 3 probes per half-open round, while a flood sends everyone', () => {
    const gentle = new BreakerServer({ policy: 'breaker' });
    const flood = new BreakerServer({ policy: 'flood' });
    let gentlePeak = 0;
    let floodPeak = 0;
    for (let i = 0; i < 200; i += 1) {
      stepScheduled(gentle, hang);
      stepScheduled(flood, hang);
      gentlePeak = Math.max(gentlePeak, gentle.snapshot().probesSent);
      floodPeak = Math.max(floodPeak, flood.snapshot().probesSent);
    }
    expect(gentlePeak).toBe(PROBES);
    expect(floodPeak).toBe(16);
  });

  it('never opens on a normal day with 2% transient errors', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const server = new BreakerServer({ policy: 'breaker', seed });
      play(server, 200, []);
      expect(server.totals.opens).toBe(0);
    }
  });

  it('keeps answering redirects through the hang for other seeds', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const [none, breaker] = summaries('hang', seed);
      expect(breaker?.rejected).toBeLessThan((none?.rejected ?? 0) / 5);
      expect(breaker?.answered).toBeGreaterThan(none?.answered ?? 0);
      expect(breaker?.recoverySeconds).toBeGreaterThan(none?.recoverySeconds ?? 0);
    }
  });
});

describe('Breaker duels on the same redirects', () => {
  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const [hangNone, hangBreaker] = summaries('hang');
    expect(hangNone).toMatchObject({
      arrived: 3018,
      answered: 1998,
      recorded: 1665,
      rejected: 1016,
      calls: 2002,
      timedOut: 288,
      p95Ms: 2530,
      recoverySeconds: 0.4,
    });
    expect(hangBreaker).toMatchObject({
      answered: 2944,
      recorded: 1391,
      buffered: 1553,
      rejected: 70,
      calls: 1469,
      timedOut: 41,
      shortCircuited: 1479,
      opens: 4,
      probes: 12,
      openSeconds: 8,
      p95Ms: 60,
      recoverySeconds: 1.8,
    });

    const [refusedNone, refusedBreaker] = summaries('refused');
    expect(refusedNone).toMatchObject({ answered: 3014, rejected: 0, calls: 3018, p95Ms: 60 });
    expect(refusedBreaker).toMatchObject({
      answered: 3014,
      rejected: 0,
      calls: 1514,
      opens: 5,
      probes: 13,
      openSeconds: 10,
      recoverySeconds: 1.8,
    });

    const [flood, gentle] = summaries('probe');
    expect(gentle).toEqual(hangBreaker);
    expect(flood).toMatchObject({ probes: 61, timedOut: 80, p95Ms: 460, rejected: 72, opens: 4 });

    const [normalNone, normalBreaker] = summaries('normal');
    expect(normalBreaker).toEqual(normalNone);
    expect(normalNone).toMatchObject({ answered: 3013, recorded: 2944, buffered: 69, opens: 0 });
  });

  it('annotates the run in order and ends with a wrap up note', () => {
    const texts = (id: BreakerScenarioId) => {
      const duel = run(new BreakerDuel(breakerScenarios[id]));
      expect(duel.events.at(-1)?.marker).toBe(false);
      return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
    };
    expect(texts('hang')).toEqual([
      '3.0 The analytics ingest service hangs: calls get no answer.',
      '3.6 No breaker: every worker is waiting on ingest and the queue is full, so new redirects get a 503.',
      '3.6 Breaker, 3 probes: every worker is waiting on ingest and the queue is full, so new redirects get a 503.',
      '4.1 Breaker, 3 probes: the breaker opens after 18 of the last 20 calls failed. Redirects skip ingest and buffer the click.',
      '6.1 Breaker, 3 probes: the 2 s cooldown ends, so the half-open breaker lets 3 probe calls through.',
      '6.6 Breaker, 3 probes: a probe times out, so the breaker opens again for another 2 s.',
      '12.0 The analytics ingest service is healthy again.',
      '12.4 No breaker: clicks reach ingest again, 0.4 s after it heals.',
      '13.7 Breaker, 3 probes: 3 probes succeed, so the breaker closes and redirects call ingest again.',
      '13.8 Breaker, 3 probes: clicks reach ingest again, 1.8 s after it heals.',
      '20.0 Run ends. Redirects answered: No breaker 1998, Breaker, 3 probes 2944. Turned away with 503: 1016 and 70. Calls sent to ingest: 2002 and 1469. Breaker, 3 probes opened 4 times, sent 12 probes, and stayed open 8.0 s.',
    ]);
    expect(texts('refused')).toContain(
      '5.6 Breaker, 3 probes: a probe is refused, so the breaker opens again for another 2 s.',
    );
    expect(texts('normal')).toHaveLength(1);
  });

  it('stops after the run length', () => {
    const duel = run(new BreakerDuel(breakerScenarios.normal));
    expect(duel.ticks).toBe(200);
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes[0].series).toHaveLength(200);
    expect(duel.lanes[0].states).toHaveLength(200);
  });
});
