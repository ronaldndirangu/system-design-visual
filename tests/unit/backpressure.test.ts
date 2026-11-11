import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  generateWorkload,
  type QueueCommand,
  QueueDuel,
  type QueuePolicy,
  QueueServer,
  type QueueTick,
  queueScenarios,
  SLOW_RECOVER_TICK,
  SLOW_TICK,
  summarizeQueue,
  WORKERS,
} from '../../src/lib/models/backpressure';

const policies: QueuePolicy[] = ['none', 'bounded', 'unbounded', 'shed'];

const slow: ScheduledCommand<QueueCommand>[] = [
  { at: SLOW_TICK, command: { type: 'slow', factor: 2 } },
  { at: SLOW_RECOVER_TICK, command: { type: 'recover' } },
];

const viral = generateWorkload('viral', 42, 20);

function play(server: QueueServer, ticks: number, schedule = slow): QueueTick[] {
  const out: QueueTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(server, schedule));
  return out;
}

const run = (duel: QueueDuel) => {
  while (!duel.done) duel.step();
  return duel;
};

const summaries = (id: keyof typeof queueScenarios, seed = 42) =>
  run(new QueueDuel(queueScenarios[id], seed)).lanes.map(summarizeQueue);

describe('QueueServer playback', () => {
  it('feeds every policy the same arrivals', () => {
    const runs = policies.map((policy) => play(new QueueServer(policy, viral), 200));
    const arrivals = runs.map((ticks) => ticks.map((tick) => tick.arrived));
    for (const other of arrivals.slice(1)) expect(other).toEqual(arrivals[0]);
  });

  it('keeps work sizes when only the traffic shape changes', () => {
    const steady = generateWorkload('steady', 7, 20).map((arrival) => arrival.workMs);
    const burst = generateWorkload('burst', 7, 20).map((arrival) => arrival.workMs);
    const shared = Math.min(steady.length, burst.length);
    expect(burst.slice(0, shared)).toEqual(steady.slice(0, shared));
  });

  it('replays a scripted run exactly', () => {
    for (const policy of policies) {
      const a = play(new QueueServer(policy, generateWorkload('viral', 7, 20)), 200);
      const b = play(new QueueServer(policy, generateWorkload('viral', 7, 20)), 200);
      expect(b).toEqual(a);
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const server = new QueueServer('shed', viral);
    const start = server.checkpoint();
    const first = play(server, 200);
    server.restore(start);
    expect(server.ticks).toBe(0);
    expect(play(server, 200)).toEqual(first);
  });

  it('resumes from a checkpoint taken mid run, in the same or a fresh server', () => {
    const server = new QueueServer('shed', viral);
    play(server, 70);
    const saved = server.checkpoint();
    const rest = play(server, 130);

    server.restore(saved);
    expect(play(server, 130)).toEqual(rest);

    const fresh = new QueueServer('shed', viral);
    fresh.restore(saved);
    expect(play(fresh, 130)).toEqual(rest);
  });

  it('keeps checkpoints independent of later changes', () => {
    const server = new QueueServer('unbounded', viral);
    play(server, 80);
    const saved = server.checkpoint();
    const queued = saved.state.queue.length;
    const served = saved.state.totals.served;
    play(server, 50);
    expect(saved.state.queue).toHaveLength(queued);
    expect(saved.state.totals.served).toBe(served);
  });

  it('accounts for every request: arrived = served + late + rejected + dropped + inside', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const shape of ['steady', 'burst', 'viral'] as const) {
        const workload = generateWorkload(shape, seed, 20);
        for (const policy of policies) {
          const server = new QueueServer(policy, workload);
          for (let i = 0; i < 200; i += 1) {
            const tick = stepScheduled(server, slow);
            const { arrived, served, late, rejected, dropped } = server.totals;
            expect(arrived).toBe(served + late + rejected + dropped + server.inFlight);
            expect(tick.busy).toBeLessThanOrEqual(WORKERS);
          }
        }
      }
    }
  });

  it("keeps Little's law exact: time spent waiting equals the area under the line", () => {
    for (const policy of policies) {
      const server = new QueueServer(policy, viral);
      for (let i = 0; i < 200; i += 1) {
        stepScheduled(server, slow);
        const { waitingArea, waitSum } = server.totals;
        expect(waitingArea).toBe(waitSum + server.pendingWaitMs());
      }
    }
    for (const id of ['steady', 'burst', 'viral', 'slow'] as const) {
      for (const lane of summaries(id)) {
        expect(lane.averageLine).toBeCloseTo((lane.admittedPerSecond * lane.averageWaitMs) / 1000, 6);
      }
    }
  });

  it('never holds a line without a queue, and never lets a bounded line pass 40', () => {
    for (const policy of policies) {
      const server = new QueueServer(policy, viral);
      for (const tick of play(server, 200)) {
        if (policy === 'none') expect(tick.queued).toBe(0);
        if (policy !== 'unbounded') expect(tick.queued).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('Queue duel', () => {
  it('ties when traffic stays below capacity', () => {
    const [unbounded, bounded] = summaries('steady');
    expect(bounded).toEqual(unbounded);
  });

  it('shows a short queue absorbing a burst that a server with no line rejects, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [none, bounded] = summaries('burst', seed);
      expect(none?.rejected ?? 0).toBeGreaterThan((none?.arrived ?? 0) * 0.18);
      expect(bounded?.rejected ?? 999).toBeLessThan((bounded?.arrived ?? 0) * 0.03);
      expect(bounded?.served ?? 0).toBeGreaterThan(none?.served ?? 0);
      expect(bounded?.late).toBe(0);
    }
  });

  it('shows an unbounded line answering most requests too late, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [unbounded, bounded] = summaries('viral', seed);
      expect(unbounded?.rejected).toBe(0);
      expect(unbounded?.late ?? 0).toBeGreaterThan(unbounded?.served ?? 0);
      expect(unbounded?.peakQueue ?? 0).toBeGreaterThan(200);
      expect(unbounded?.p95WaitMs ?? 0).toBeGreaterThan(4000);
      expect(bounded?.served ?? 0).toBeGreaterThan((unbounded?.served ?? 0) * 2.5);
      expect(bounded?.late ?? 99).toBeLessThan(10);
      expect(bounded?.p95WaitMs ?? 9999).toBeLessThan(900);
    }
  });

  it('shows shedding by wait answering more in time while rejecting more, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [bounded, shed] = summaries('slow', seed);
      expect(bounded?.late ?? 0).toBeGreaterThan(200);
      expect(shed?.late ?? 99).toBeLessThanOrEqual(1);
      expect(shed?.served ?? 0).toBeGreaterThan((bounded?.served ?? 0) * 1.2);
      expect(shed?.rejected ?? 0).toBeGreaterThan(bounded?.rejected ?? 0);
      expect(shed?.p95WaitMs ?? 9999).toBeLessThan(700);
    }
  });

  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const [steadyA] = summaries('steady');
    expect(steadyA).toMatchObject({ arrived: 804, served: 800, late: 0, rejected: 0, peakQueue: 7 });

    const [none, bounded] = summaries('burst');
    expect(none).toMatchObject({ arrived: 866, served: 677, rejected: 187 });
    expect(bounded).toMatchObject({ served: 845, rejected: 10, late: 0, peakQueue: 40, p95WaitMs: 710 });

    const [unbounded, capped] = summaries('viral');
    expect(unbounded).toMatchObject({
      arrived: 1222,
      served: 265,
      late: 691,
      rejected: 0,
      inside: 266,
      peakQueue: 308,
      p95WaitMs: 5050,
    });
    expect(unbounded?.averageLine).toBeCloseTo(152.4, 1);
    expect(unbounded?.admittedPerSecond).toBeCloseTo(61.1, 1);
    expect(Math.round(unbounded?.averageWaitMs ?? 0)).toBe(2495);
    expect(capped).toMatchObject({ served: 946, late: 1, rejected: 268, inside: 7, p95WaitMs: 820 });

    const [line, shed] = summaries('slow');
    expect(line).toMatchObject({ served: 456, late: 230, rejected: 114, p95WaitMs: 1570, peakQueue: 40 });
    expect(shed).toMatchObject({
      served: 657,
      late: 0,
      rejected: 143,
      dropped: 0,
      p95WaitMs: 600,
      peakQueue: 16,
    });
  });

  it('annotates the spikes, the first 503s, and the first late answers', () => {
    const texts = (id: keyof typeof queueScenarios) => {
      const duel = run(new QueueDuel(queueScenarios[id]));
      expect(duel.events.at(-1)?.marker).toBe(false);
      return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
    };
    expect(texts('steady')).toEqual([
      '20.0 Run ends. Answered in time: Unbounded queue 800, Queue of 40 800.',
    ]);
    expect(texts('burst')).toEqual([
      '0.6 No queue: all 5 workers are busy and there is no line, so a request gets a 503.',
      '4.0 Traffic jumps to 90 req/s.',
      '4.9 Queue of 40: the line is full, so new requests get a 503 with Retry-After.',
      '5.0 Traffic falls back to 40 req/s.',
      '20.0 Run ends. Answered in time: No queue 677, Queue of 40 845.',
    ]);
    expect(texts('viral')).toEqual([
      '4.0 A link goes viral: traffic jumps to 75 req/s.',
      '5.2 Queue of 40: the line is full, so new requests get a 503 with Retry-After.',
      '6.4 Unbounded queue: the first answer arrives after its client gave up.',
      '7.1 Unbounded queue: 100 requests are waiting, about 2 s of work for 5 workers.',
      '7.3 Unbounded queue: every worker is busy, yet no answer has arrived in time for a full second.',
      '12.3 Queue of 40: the first answer arrives after its client gave up.',
      '16.0 Traffic falls back to 40 req/s.',
      '20.0 Run ends. Answered in time: Unbounded queue 265, Queue of 40 946. Still inside the server: Unbounded queue 266, Queue of 40 7.',
    ]);
    expect(texts('slow')).toEqual([
      '4.0 Every redirect starts taking 2 times as long.',
      '5.2 Shed by wait: the expected wait passes 600 ms, so new requests get a 503 with Retry-After.',
      '6.5 Queue of 40: the line is full, so new requests get a 503 with Retry-After.',
      '6.6 Queue of 40: the first answer arrives after its client gave up.',
      '7.6 Queue of 40: every worker is busy, yet no answer has arrived in time for a full second.',
      '14.0 Redirects take their normal time again.',
      '20.0 Run ends. Answered in time: Queue of 40 456, Shed by wait 657.',
    ]);
  });

  it('stops after the run length', () => {
    const duel = run(new QueueDuel(queueScenarios.steady));
    expect(duel.ticks).toBe(200);
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes[0].series).toHaveLength(200);
  });
});
