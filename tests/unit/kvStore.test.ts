import { describe, expect, it } from 'vitest';
import { KV_RING, KvStoreRun, kvStoreScenarios, kvWorkload } from '../../src/lib/models/kvStore';

function finish(run: KvStoreRun) {
  while (!run.done) run.step();
  return run;
}

const lastHintTicks = (run: KvStoreRun) =>
  run.events.filter((event) => event.text.includes('last hint')).map((event) => event.tick);

describe('key-value store quorum duel', () => {
  it('trades refused requests for stale reads when two neighbours fail', () => {
    const run = finish(new KvStoreRun(kvStoreScenarios['two-down']));
    const [strict, sloppy] = run.totals();
    expect(strict).toMatchObject({
      writes: 1012,
      writesRefused: 189,
      reads: 993,
      readsRefused: 183,
      staleReads: 0,
      hintsPending: 0,
      hintsDelivered: 315,
      readRepairs: 11,
    });
    expect(sloppy).toMatchObject({
      writes: 1201,
      writesRefused: 0,
      reads: 1176,
      readsRefused: 0,
      staleReads: 33,
      staleAfterReturn: 9,
      hintsPending: 0,
      hintsDelivered: 693,
      readRepairs: 139,
    });
    expect(lastHintTicks(run)).toEqual([28, 31]);
    expect(run.series[0].slice(0, 5).every((value) => value === 0)).toBe(true);
    expect(Math.min(...run.series[0].slice(5, 25))).toBeGreaterThan(0);
    expect(run.series[0].slice(25).every((value) => value === 0)).toBe(true);
  });

  it('rides out a single failure in both lanes', () => {
    const [strict, sloppy] = finish(new KvStoreRun(kvStoreScenarios['one-down'])).totals();
    for (const lane of [strict, sloppy]) {
      expect(lane).toMatchObject({
        writes: 1201,
        writesRefused: 0,
        readsRefused: 0,
        staleReads: 0,
        hintsPending: 0,
        hintsDelivered: 330,
      });
    }
    expect([strict.readRepairs, sloppy.readRepairs]).toEqual([16, 72]);
  });

  it('serves more stale reads after the return when handoff is throttled', () => {
    const run = finish(new KvStoreRun(kvStoreScenarios['slow-handoff']));
    const [strict, sloppy] = run.totals();
    expect(strict).toMatchObject({ staleReads: 0, hintsDelivered: 315, hintsPending: 0, readRepairs: 45 });
    expect(sloppy).toMatchObject({
      staleReads: 39,
      staleAfterReturn: 15,
      hintsDelivered: 350,
      hintsPending: 343,
      readRepairs: 183,
    });
    expect(lastHintTicks(run)).toEqual([56]);
  });

  it('marks the down nodes and replays the same seed', () => {
    const run = new KvStoreRun(kvStoreScenarios['two-down'], 7);
    for (let tick = 0; tick < 10; tick += 1) run.step();
    const down = run
      .totals()[1]
      .nodes.filter((node) => node.down)
      .map((node) => node.label);
    expect(down).toEqual(['D', 'B']);
    expect(KV_RING).toHaveLength(5);
    const a = finish(run);
    const b = finish(new KvStoreRun(kvStoreScenarios['two-down'], 7));
    expect(b.series).toEqual(a.series);
    expect(b.events).toEqual(a.events);
    expect(kvWorkload(20, 7)).not.toEqual(kvWorkload(20, 42));
    expect(a.events.at(-1)).toMatchObject({ tick: a.length, marker: false });
  });
});
