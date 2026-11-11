import { describe, expect, it } from 'vitest';
import {
  ConsistencyLadder,
  chatMessages,
  createWorkload,
  DEFAULT_WORKLOAD_SEED,
  guarantees,
  HORIZON,
  REPLICAS,
  runGuarantee,
  tallyRun,
} from '../../src/lib/models/consistencyModels';

const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

describe('consistency ladder model', () => {
  it('never shows an anomaly that a guarantee rules out, over many workloads', () => {
    for (const seed of seeds) {
      const workload = createWorkload(seed);
      for (const { id, rulesOut } of guarantees) {
        const tally = tallyRun(runGuarantee(workload, id), HORIZON);
        for (const kind of rulesOut) expect(tally.anomalies[kind], `${id} ${kind} seed ${seed}`).toBe(0);
      }
    }
  });

  it('writes every message once and lands it on every replica before the horizon', () => {
    for (const seed of seeds) {
      const workload = createWorkload(seed);
      for (const { id } of guarantees) {
        const run = runGuarantee(workload, id);
        expect(run.unfinished, `${id} seed ${seed}`).toBe(0);
        for (const { id: message } of chatMessages) {
          const writes = run.requests.filter((r) => r.kind === 'write' && r.message === message);
          expect(writes, `${id} m${message} seed ${seed}`).toHaveLength(1);
          const landed = run.copies.filter((c) => c.message === message && c.apply <= HORIZON);
          expect(new Set(landed.map((c) => c.replica)).size).toBe(REPLICAS);
        }
      }
    }
  });

  it('only lets a reply exist after its author saw the question', () => {
    for (const seed of seeds.slice(0, 50)) {
      const workload = createWorkload(seed);
      for (const { id } of guarantees) {
        const run = runGuarantee(workload, id);
        for (const message of chatMessages) {
          if (message.after === null) continue;
          const write = run.requests.find((r) => r.kind === 'write' && r.message === message.id);
          const sawQuestion = run.requests.some(
            (r) =>
              r.kind === 'read' &&
              r.person === message.author &&
              r.sees.includes(message.after ?? 0) &&
              r.end <= (write?.start ?? -1),
          );
          expect(sawQuestion, `${id} m${message.id} seed ${seed}`).toBe(true);
        }
      }
    }
  });

  it('replays the same workload identically', () => {
    const a = new ConsistencyLadder(7);
    const b = new ConsistencyLadder(7);
    expect(a.runs).toEqual(b.runs);
    expect(new ConsistencyLadder(8).workload).not.toEqual(a.workload);
  });

  it('returns to tick zero on reset with the same results', () => {
    const ladder = new ConsistencyLadder();
    const before = guarantees.map(({ id }) => ladder.tally(id));
    while (!ladder.done) ladder.step();
    const after = ladder.tally('eventual');
    ladder.step();
    expect(ladder.tick).toBe(HORIZON);
    expect(ladder.tally('eventual')).toEqual(after);
    ladder.reset();
    expect(ladder.tick).toBe(0);
    expect(guarantees.map(({ id }) => ladder.tally(id))).toEqual(before);
  });

  it('counts a request as waiting until it finishes', () => {
    const run = runGuarantee(createWorkload(DEFAULT_WORKLOAD_SEED), 'linearizable');
    const firstWrite = run.requests.find((r) => r.kind === 'write');
    expect(firstWrite).toMatchObject({ start: 1, end: 7 });
    expect(tallyRun(run, 4).waitTicks).toBe(3);
  });

  it('pins the default workload numbers the lesson quotes', () => {
    const ladder = new ConsistencyLadder();
    while (!ladder.done) ladder.step();
    const pick = (id: (typeof guarantees)[number]['id']) => {
      const t = ladder.tally(id);
      return [
        t.anomalousReads,
        t.reads,
        t.anomalies.stale,
        t.anomalies.ownMissing,
        t.anomalies.backwards,
        t.anomalies.outOfOrder,
        t.waitTicks,
      ];
    };
    expect(pick('eventual')).toEqual([7, 38, 7, 3, 4, 4, 0]);
    expect(pick('monotonic')).toEqual([3, 35, 3, 2, 0, 2, 6]);
    expect(pick('readYourWrites')).toEqual([4, 36, 4, 0, 2, 2, 5]);
    expect(pick('causal')).toEqual([3, 33, 3, 0, 0, 0, 10]);
    expect(pick('linearizable')).toEqual([0, 31, 0, 0, 0, 0, 14]);
    expect(ladder.tally('linearizable').busiestShare).toBe(1);
    expect(ladder.tally('eventual').busiestShare).toBeLessThan(0.5);

    const carla = ladder.runs.eventual.requests.find((r) => r.kind === 'read' && r.person === 2);
    expect(carla).toMatchObject({ replica: 2, start: 3, sees: [2] });
    expect(carla?.kind === 'read' && carla.anomalies).toEqual(['stale', 'outOfOrder']);
  });
});
