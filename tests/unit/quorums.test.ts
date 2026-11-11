import { describe, expect, it } from 'vitest';
import {
  confirmedVersion,
  type FailureId,
  failureOrder,
  failureScenarios,
  generateWorkload,
  overlaps,
  PREFERENCE,
  preferenceList,
  QUORUM_SECONDS,
  type QuorumSettingId,
  QuorumSim,
  quorumSettingOrder,
  quorumSettings,
  replicaVersion,
  runQuorum,
  summarize,
  WORKLOAD_SEED,
} from '../../src/lib/models/quorums';

const END = QUORUM_SECONDS * 1000;

const finish = (setting: QuorumSettingId, failure: FailureId, seed = WORKLOAD_SEED) => {
  const sim = new QuorumSim(setting, failure, seed);
  while (!sim.done) sim.step();
  return sim;
};

const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

describe('quorum cart model', () => {
  it('places the cart on the ring and keeps copies on A, D, B, E, then C', () => {
    expect(PREFERENCE).toEqual(['replica-a', 'replica-d', 'replica-b', 'replica-e', 'replica-c']);
    expect(preferenceList('cart:sam', 3)).toEqual(['replica-a', 'replica-d', 'replica-b']);
  });

  it('flags the settings whose read and write sets must overlap', () => {
    expect(quorumSettingOrder.map((id) => overlaps(quorumSettings[id]))).toEqual([false, true, true, true]);
  });

  it('replays the same requests, events, and series for the same seed', () => {
    for (const failure of failureOrder) {
      for (const setting of quorumSettingOrder) {
        const a = finish(setting, failure);
        const b = finish(setting, failure);
        expect(b.workload).toEqual(a.workload);
        expect(b.run).toEqual(a.run);
        expect(b.events).toEqual(a.events);
        expect(b.staleSeries).toEqual(a.staleSeries);
        expect(b.failedSeries).toEqual(a.failedSeries);
      }
    }
    expect(generateWorkload(29)).not.toEqual(generateWorkload(28));
  });

  it('matches a fresh run after a reset', () => {
    const first = new QuorumSim('n3r2w2', 'two');
    for (let i = 0; i < 30; i += 1) first.step();
    const fresh = new QuorumSim('n3r2w2', 'two');
    expect(fresh.ticks).toBe(0);
    expect(fresh.events).toEqual([]);
    for (let i = 0; i < 30; i += 1) fresh.step();
    expect(fresh.events).toEqual(first.events);
    expect(fresh.staleSeries).toEqual(first.staleSeries);
    expect(fresh.failedSeries).toEqual(first.failedSeries);
  });

  it('accounts for every request at every tick: issued = ok + stale + failed + in flight', () => {
    for (const failure of failureOrder) {
      const sim = new QuorumSim('n3r1w1', failure);
      while (!sim.done) {
        sim.step();
        for (const setting of quorumSettingOrder) {
          const sum = summarize(sim.runs[setting], sim.now);
          expect(sum.issued).toBe(sum.ok + sum.stale + sum.failed + sum.inFlight);
          expect(sum.issued).toBe(sum.writes + sum.reads);
          expect(sum.failed).toBe(sum.failedWrites + sum.failedReads);
        }
      }
      for (const setting of quorumSettingOrder) {
        expect(summarize(sim.runs[setting], sim.now).inFlight, `${setting} ${failure}`).toBe(0);
      }
    }
  });

  it('answers every request inside the run', () => {
    for (const seed of seeds) {
      const workload = generateWorkload(seed);
      workload.forEach((op, index) => {
        expect(op.id).toBe(index);
        if (index > 0) expect(op.at).toBeGreaterThanOrEqual(workload[index - 1]?.at ?? 0);
      });
      for (const failure of failureOrder) {
        for (const setting of quorumSettingOrder) {
          const run = runQuorum(quorumSettings[setting], failureScenarios[failure], workload);
          for (const result of run.results) expect(result.replyAt).toBeLessThan(END);
        }
      }
    }
  });

  it('runs every setting on the same requests', () => {
    const sim = new QuorumSim('n3r2w2', 'one');
    for (const setting of quorumSettingOrder) {
      expect(sim.runs[setting].results.map((result) => result.op)).toEqual(sim.workload);
    }
  });

  it('never returns a stale read when R + W > N, on any seed or failure', () => {
    for (const seed of seeds) {
      const workload = generateWorkload(seed);
      for (const failure of failureOrder) {
        for (const setting of quorumSettingOrder) {
          if (!overlaps(quorumSettings[setting])) continue;
          const run = runQuorum(quorumSettings[setting], failureScenarios[failure], workload);
          expect(summarize(run, END).stale, `seed ${seed} ${setting} ${failure}`).toBe(0);
        }
      }
    }
  });

  it('keeps a down replica frozen until the next write reaches it', () => {
    const sim = finish('n3r1w1', 'one');
    const atOutage = replicaVersion(sim.run, 'replica-d', 1000);
    expect(replicaVersion(sim.run, 'replica-d', 3500)).toBe(atOutage);
    expect(confirmedVersion(sim.run, 3500)).toBeGreaterThan(atOutage);
  });

  it('pins the illustrative numbers the lesson quotes', () => {
    const row = (setting: QuorumSettingId, failure: FailureId) => {
      const sum = summarize(finish(setting, failure).run, END);
      return {
        stale: sum.stale,
        failedWrites: sum.failedWrites,
        failedReads: sum.failedReads,
        writeMs: Math.round(sum.averageWriteMs),
      };
    };
    const none = summarize(finish('n3r1w1', 'none').run, END);
    expect([none.issued, none.writes, none.reads]).toEqual([29, 12, 17]);
    expect(row('n3r1w1', 'none')).toEqual({ stale: 6, failedWrites: 0, failedReads: 0, writeMs: 25 });
    expect(row('n3r2w2', 'none')).toEqual({ stale: 0, failedWrites: 0, failedReads: 0, writeMs: 68 });
    expect(row('n3r1w3', 'none')).toEqual({ stale: 0, failedWrites: 0, failedReads: 0, writeMs: 222 });
    expect(row('n5r3w3', 'none')).toEqual({ stale: 0, failedWrites: 0, failedReads: 0, writeMs: 70 });
    expect(row('n3r1w1', 'one')).toEqual({ stale: 7, failedWrites: 0, failedReads: 0, writeMs: 26 });
    expect(row('n3r2w2', 'one')).toEqual({ stale: 0, failedWrites: 0, failedReads: 0, writeMs: 86 });
    expect(row('n3r1w3', 'one')).toEqual({ stale: 0, failedWrites: 4, failedReads: 0, writeMs: 253 });
    expect(row('n5r3w3', 'one')).toEqual({ stale: 0, failedWrites: 0, failedReads: 0, writeMs: 71 });
    expect(row('n3r1w1', 'two')).toEqual({ stale: 5, failedWrites: 0, failedReads: 0, writeMs: 46 });
    expect(row('n3r2w2', 'two')).toEqual({ stale: 0, failedWrites: 4, failedReads: 7, writeMs: 61 });
    expect(row('n5r3w3', 'two')).toEqual({ stale: 0, failedWrites: 0, failedReads: 0, writeMs: 114 });
  });

  it('writes event text without dash stand-ins', () => {
    for (const failure of failureOrder) {
      for (const setting of quorumSettingOrder) {
        for (const event of finish(setting, failure).events) {
          expect(event.text).not.toMatch(/\u2014|\u2013|--| - /);
        }
      }
    }
  });
});
