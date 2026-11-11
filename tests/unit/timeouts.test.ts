import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  HANG_TICK,
  planDeadline,
  RECOVER_TICK,
  summarizeTimeouts,
  type TimeoutCommand,
  TimeoutDuel,
  type TimeoutPolicy,
  TimeoutServer,
  type TimeoutTick,
  timeoutScenarios,
} from '../../src/lib/models/timeouts';

const policies: TimeoutPolicy[] = ['none', 'cancel-150', 'nocancel-150', 'cancel-2000'];

const hang: ScheduledCommand<TimeoutCommand>[] = [
  { at: HANG_TICK, command: { type: 'hang', replica: 2 } },
  { at: RECOVER_TICK, command: { type: 'recover', replica: 2 } },
];

function play(server: TimeoutServer, ticks: number, schedule = hang): TimeoutTick[] {
  const out: TimeoutTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(server, schedule));
  return out;
}

const run = (duel: TimeoutDuel) => {
  while (!duel.done) duel.step();
  return duel;
};

describe('TimeoutServer playback', () => {
  it('feeds every policy the same arrivals', () => {
    const runs = policies.map((policy) => play(new TimeoutServer({ policy }), 200));
    const arrivals = runs.map((ticks) => ticks.map((tick) => tick.arrived));
    for (const other of arrivals.slice(1)) expect(other).toEqual(arrivals[0]);
  });

  it('replays a scripted run exactly', () => {
    for (const policy of policies) {
      const a = play(new TimeoutServer({ policy, seed: 7 }), 200);
      const b = play(new TimeoutServer({ policy, seed: 7 }), 200);
      expect(b).toEqual(a);
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const server = new TimeoutServer({ policy: 'nocancel-150' });
    const start = server.checkpoint();
    const first = play(server, 200);
    server.restore(start);
    expect(server.ticks).toBe(0);
    expect(play(server, 200)).toEqual(first);
  });

  it('resumes from a checkpoint taken during the hang, in the same or a fresh server', () => {
    const server = new TimeoutServer({ policy: 'nocancel-150' });
    play(server, 60);
    const saved = server.checkpoint();
    const rest = play(server, 140);

    server.restore(saved);
    expect(play(server, 140)).toEqual(rest);

    const fresh = new TimeoutServer({ policy: 'nocancel-150', seed: 999 });
    fresh.restore(saved);
    expect(play(fresh, 140)).toEqual(rest);
  });

  it('keeps checkpoints independent of later changes', () => {
    const server = new TimeoutServer();
    play(server, 50);
    const saved = server.checkpoint();
    const working = saved.state.working.length;
    const served = saved.state.totals.served;
    play(server, 50);
    expect(saved.state.working).toHaveLength(working);
    expect(saved.state.totals.served).toBe(served);
  });

  it('accounts for every request: arrived = served + rejected + failed + in flight', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const policy of policies) {
        const server = new TimeoutServer({ policy, seed });
        for (let i = 0; i < 200; i += 1) {
          stepScheduled(server, hang);
          const { arrived, served, rejected, failed } = server.totals;
          expect(arrived).toBe(served + rejected + failed + server.inFlight);
        }
      }
    }
  });

  it('counts every abandoned query exactly once, as cancelled or run for nobody', () => {
    for (const policy of policies) {
      const server = new TimeoutServer({ policy });
      play(server, 200);
      const snap = server.snapshot();
      const { failed, cancelled, ranForNobody } = server.totals;
      const stillAbandoned =
        snap.connections.filter((cell) => cell === 'nobody').length + snap.poolWaitingForNobody;
      if (policy === 'nocancel-150') expect(ranForNobody + stillAbandoned).toBe(failed);
      else expect(ranForNobody).toBe(0);
      expect(cancelled).toBeLessThanOrEqual(failed);
    }
  });

  it('never times out a healthy lookup', () => {
    for (const policy of policies) {
      const server = new TimeoutServer({ policy });
      play(server, 200, []);
      expect(server.totals.failed).toBe(0);
      expect(server.totals.rejected).toBe(0);
    }
  });
});

describe('Timeout duel', () => {
  it('ties when every replica is healthy', () => {
    const [none, short] = run(new TimeoutDuel(timeoutScenarios.healthy)).lanes.map(summarizeTimeouts);
    expect(short).toEqual(none);
  });

  it('shows a hung replica using up every worker without a timeout, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [none, short] = run(new TimeoutDuel(timeoutScenarios.hang, seed)).lanes.map(summarizeTimeouts);
      expect(none?.peakWorkers).toBe(16);
      expect(none?.rejected ?? 0).toBeGreaterThan(200);
      expect(short?.rejected).toBe(0);
      expect(short?.peakWorkers ?? 99).toBeLessThan(16);
      expect(short?.served ?? 0).toBeGreaterThan((none?.served ?? 0) * 1.2);
    }
  });

  it('shows a 2 s timeout still filling every worker, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [long, short] = run(new TimeoutDuel(timeoutScenarios.long, seed)).lanes.map(summarizeTimeouts);
      expect(long?.peakWorkers).toBe(16);
      expect(long?.rejected ?? 0).toBeGreaterThan(0);
      expect(short?.served ?? 0).toBeGreaterThan(long?.served ?? 0);
    }
  });

  it('shows abandoned queries holding every connection without cancel, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [orphan, cancel] = run(new TimeoutDuel(timeoutScenarios.nocancel, seed)).lanes.map(
        summarizeTimeouts,
      );
      expect(orphan?.peakConnections).toBe(16);
      expect(orphan?.ranForNobody ?? 0).toBeGreaterThan(100);
      expect(cancel?.ranForNobody).toBe(0);
      expect(cancel?.served ?? 0).toBeGreaterThan((orphan?.served ?? 0) * 1.2);
    }
  });

  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const healthy = run(new TimeoutDuel(timeoutScenarios.healthy)).lanes.map(summarizeTimeouts);
    expect(healthy[0]).toMatchObject({ arrived: 1007, served: 1007, p95Ms: 30 });

    const hung = run(new TimeoutDuel(timeoutScenarios.hang)).lanes.map(summarizeTimeouts);
    expect(hung[0]).toMatchObject({ served: 615, rejected: 392, failed: 0, peakWorkers: 16 });
    expect(hung[1]).toMatchObject({ served: 853, rejected: 0, failed: 154, peakWorkers: 9 });

    const long = run(new TimeoutDuel(timeoutScenarios.long)).lanes.map(summarizeTimeouts);
    expect(long[0]).toMatchObject({ served: 752, rejected: 192, failed: 63, peakWorkers: 16 });

    const orphan = run(new TimeoutDuel(timeoutScenarios.nocancel)).lanes.map(summarizeTimeouts);
    expect(orphan[0]).toMatchObject({ served: 558, failed: 449, ranForNobody: 449, peakConnections: 16 });
  });

  it('annotates the hang, the first errors, and the slow recovery', () => {
    const hangDuel = run(new TimeoutDuel(timeoutScenarios.hang));
    const hangTexts = hangDuel.events.map(
      (event) => `${(event.tick * hangDuel.tickSeconds).toFixed(1)} ${event.text}`,
    );
    expect(hangTexts).toEqual([
      '3.0 Replica C stops answering.',
      '3.3 150 ms timeout: the first request times out with a 504.',
      '3.8 No timeout: all 16 workers are busy.',
      '4.1 No timeout: the server queue is full, so new requests get a 503.',
      '12.0 Replica C answers again.',
      '20.0 Run ends. Served: No timeout 615, 150 ms timeout 853.',
    ]);
    expect(hangDuel.events.at(-1)?.marker).toBe(false);

    const orphan = run(new TimeoutDuel(timeoutScenarios.nocancel));
    expect(orphan.events.map((event) => event.text)).toContain(
      '150 ms, no cancel: requests succeed again, 0.7 s after replica C recovered.',
    );
  });

  it('stops after the run length', () => {
    const duel = run(new TimeoutDuel(timeoutScenarios.healthy));
    expect(duel.ticks).toBe(200);
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes[0].series).toHaveLength(200);
  });
});

describe('Deadline budget', () => {
  it('lets every hop answer when the query is fast', () => {
    for (const mode of ['fixed', 'propagate'] as const) {
      const plan = planDeadline(500, mode);
      expect(plan.clientAnswered).toBe(true);
      expect(plan.clientDoneMs).toBe(540);
      expect(plan.lateMs).toBe(0);
      expect(plan.hops.every((hop) => hop.outcome === 'answered')).toBe(true);
    }
  });

  it('keeps three hops working for nobody with fixed timeouts', () => {
    const plan = planDeadline(2500, 'fixed');
    expect(plan.clientAnswered).toBe(false);
    expect(plan.clientDoneMs).toBe(1000);
    expect(plan.lastStopMs).toBe(2540);
    expect(plan.lateMs).toBe(1540);
    expect(plan.lateHops).toBe(3);
  });

  it('stops every hop at the deadline when the deadline travels with the request', () => {
    const plan = planDeadline(2500, 'propagate');
    expect(plan.clientDoneMs).toBe(1000);
    expect(plan.lastStopMs).toBe(1000);
    expect(plan.lateHops).toBe(0);
    expect(plan.hops.map((hop) => hop.outcome)).toEqual(['timed-out', 'cancelled', 'cancelled', 'cancelled']);
    expect(plan.hops.map((hop) => hop.allowanceMs)).toEqual([1000, 1000, 990, 960]);
  });

  it('lets the gateway give up before the server when its fixed timeout is shorter', () => {
    const plan = planDeadline(4000, 'fixed');
    expect(plan.hops.map((hop) => [hop.id, hop.outcome, hop.endMs])).toEqual([
      ['client', 'timed-out', 1000],
      ['gateway', 'timed-out', 3010],
      ['server', 'answered', 4040],
      ['database', 'answered', 4040],
    ]);
  });

  it('switches from answered to timed out exactly at the deadline', () => {
    expect(planDeadline(960, 'propagate').clientAnswered).toBe(true);
    expect(planDeadline(970, 'propagate').clientAnswered).toBe(false);
    expect(planDeadline(970, 'fixed').lateMs).toBe(10);
  });
});
