import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  GroupRun,
  groupScenarios,
  type LogCommand,
  type LogTick,
  OrderingDuel,
  PartitionedLog,
  partitionOf,
  SHORT_CODES,
} from '../../src/lib/models/partitionedLog';

const busySchedule: ScheduledCommand<LogCommand>[] = [
  { at: 20, command: { type: 'stall', consumer: 3, seconds: 1 } },
  { at: 50, command: { type: 'crash', consumer: 2 } },
  { at: 90, command: { type: 'join' } },
];

function play(log: PartitionedLog, ticks: number, schedule = busySchedule): LogTick[] {
  const out: LogTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(log, schedule));
  return out;
}

function finish(run: GroupRun | OrderingDuel): void {
  while (!run.done) run.step();
}

function checkConservation(log: PartitionedLog): void {
  const totals = log.totals;
  const stored = log.partitions.reduce((sum, part) => sum + part.events.length, 0);
  const neverRead = log.partitions.reduce((sum, part) => sum + part.events.length - part.highWater, 0);
  const processed = log.consumers.reduce((sum, member) => sum + member.processed, 0);
  expect(stored).toBe(totals.produced);
  expect(totals.firstReads + neverRead).toBe(totals.produced);
  expect(processed).toBe(totals.firstReads + totals.rereads);
  for (const part of log.partitions) {
    expect(part.committed).toBeLessThanOrEqual(part.position);
    expect(part.position).toBeLessThanOrEqual(part.highWater);
  }
}

describe('PartitionedLog', () => {
  it('hashes the eight short codes two to a partition', () => {
    const counts = [0, 0, 0, 0];
    for (const code of SHORT_CODES) counts[partitionOf(code, 4)] = (counts[partitionOf(code, 4)] ?? 0) + 1;
    expect(counts).toEqual([2, 2, 2, 2]);
    expect(partitionOf('cat', 4)).toBe(0);
  });

  it('replays a scripted run exactly', () => {
    expect(play(new PartitionedLog(), 150)).toEqual(play(new PartitionedLog(), 150));
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const log = new PartitionedLog();
    const start = log.checkpoint();
    const first = play(log, 150);
    log.restore(start);
    expect(log.ticks).toBe(0);
    expect(play(log, 150)).toEqual(first);
  });

  it('resumes from a checkpoint midway, in the same or a fresh log', () => {
    const log = new PartitionedLog();
    play(log, 60);
    const saved = log.checkpoint();
    const rest = play(log, 90);
    log.restore(saved);
    expect(play(log, 90)).toEqual(rest);
    const fresh = new PartitionedLog();
    fresh.restore(saved);
    expect(play(fresh, 90)).toEqual(rest);
  });

  it('accounts for every event: stored, read once, read again, or still unread', () => {
    for (const partitioner of ['key', 'round-robin'] as const) {
      const log = new PartitionedLog({ partitioner, seed: 9 });
      for (let i = 0; i < 150; i += 1) {
        stepScheduled(log, busySchedule);
        checkConservation(log);
      }
    }
  });

  it('pauses every consumer while the group rebalances', () => {
    const log = new PartitionedLog();
    play(log, 30, []);
    log.apply({ type: 'join' });
    const during = play(log, 20, []);
    expect(during.every((tick) => tick.firstReads === 0 && tick.rereads === 0)).toBe(true);
    const after = play(log, 10, []);
    expect(after.some((tick) => tick.firstReads > 0)).toBe(true);
    expect(log.consumers.filter((member) => member.partitions.length > 0)).toHaveLength(4);
  });

  it('ignores commands that do not apply', () => {
    const log = new PartitionedLog({ consumers: 6 });
    const before = log.checkpoint();
    log.apply({ type: 'join' });
    log.apply({ type: 'crash', consumer: 9 });
    log.apply({ type: 'stall', consumer: 9, seconds: 1 });
    expect(log.checkpoint()).toEqual(before);
  });
});

describe('GroupRun scenarios (seed 42, quoted in the lesson)', () => {
  it('one consumer falls behind and lag keeps growing', () => {
    const run = new GroupRun(groupScenarios.one);
    finish(run);
    expect(run.ticks).toBe(200);
    expect(run.log.lag).toBe(637);
    expect(run.peakLag).toBe(637);
    expect(run.series[79]).toBe(276);
    expect(run.series[149]).toBe(467);
  });

  it('four consumers keep up, one per partition', () => {
    const run = new GroupRun(groupScenarios.four);
    finish(run);
    expect(run.peakLag).toBeLessThanOrEqual(1);
    expect(run.log.lag).toBe(0);
    expect(run.log.totals.rereads).toBe(0);
  });

  it('a crash rewinds to the last saved position and replays those events', () => {
    const run = new GroupRun(groupScenarios.crash);
    finish(run);
    expect(run.log.totals.rereads).toBe(58);
    expect(run.peakLag).toBe(222);
    expect(run.series[99]).toBe(222);
    expect(run.log.lag).toBeLessThanOrEqual(1);
    expect(run.events.map((event) => event.text)).toEqual([
      'Consumer 2 crashes while reading P2. 58 events it read are not saved yet.',
      'Rebalance done: consumer 1 reads P1 and P4, consumer 3 reads P2 and consumer 4 reads P3.',
    ]);
    checkConservation(run.log);
  });

  it('six consumers leave two idle because a partition has one owner', () => {
    const run = new GroupRun(groupScenarios.six);
    finish(run);
    expect(run.log.consumers.filter((member) => member.partitions.length === 0)).toHaveLength(2);
    expect(run.peakLag).toBeLessThanOrEqual(1);
  });

  it('stops at the run length and ignores commands after it', () => {
    const run = new GroupRun(groupScenarios.four);
    finish(run);
    run.step();
    run.apply({ type: 'crash', consumer: 1 });
    expect(run.ticks).toBe(run.length);
    expect(run.series).toHaveLength(run.length);
    expect(run.log.aliveCount).toBe(4);
  });
});

describe('OrderingDuel', () => {
  it('feeds both lanes the same clicks', () => {
    const duel = new OrderingDuel();
    finish(duel);
    const [keyed, spread] = duel.lanes;
    expect(keyed.log.totals.produced).toBe(spread.log.totals.produced);
    expect(keyed.log.totals.produced).toBe(840);
  });

  it('keeps per-key order when the short code picks the partition, for any seed', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const duel = new OrderingDuel(seed);
      finish(duel);
      expect(duel.lanes[0].log.totals.outOfOrder).toBe(0);
      expect(duel.lanes[1].log.totals.outOfOrder).toBeGreaterThan(0);
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const duel = new OrderingDuel();
    finish(duel);
    const spread = duel.lanes[1];
    expect(spread.log.totals.outOfOrder).toBe(104);
    expect(spread.series[44]).toBe(23);
    expect(spread.series).toHaveLength(100);
    const texts = duel.events.map((event) => event.text);
    expect(texts.at(-1)).toBe(
      'Run ends. Clicks counted out of order: keyed by short code 0, round robin 104, out of 840 clicks.',
    );
    expect(texts).toContain(
      'Consumer 2 resumes. Out of order so far: keyed by short code 0, round robin 23.',
    );
  });

  it('replays exactly', () => {
    const a = new OrderingDuel(5);
    const b = new OrderingDuel(5);
    finish(a);
    finish(b);
    expect(b.events).toEqual(a.events);
    expect(b.lanes[1].series).toEqual(a.lanes[1].series);
  });
});
