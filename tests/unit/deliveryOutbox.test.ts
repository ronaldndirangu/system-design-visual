import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  type AckMode,
  AckModeRun,
  ClickWriter,
  type ConsumerCommand,
  type ConsumerTick,
  OffsetConsumer,
  OutboxDuel,
  type WriterCommand,
  type WriterMode,
  type WriterTick,
} from '../../src/lib/models/deliveryOutbox';

const arrivals = Array.from({ length: 100 }, (_, tick) => 2 + (tick % 5));

const faults: ScheduledCommand<WriterCommand>[] = [
  { at: 10, command: { type: 'broker-down' } },
  { at: 25, command: { type: 'broker-up' } },
  { at: 40, command: { type: 'db-down' } },
  { at: 50, command: { type: 'db-up' } },
  { at: 70, command: { type: 'relay-crash' } },
];

function writeAll(writer: ClickWriter, ticks: number): WriterTick[] {
  const out: WriterTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(writer, faults));
  return out;
}

const crashes: ScheduledCommand<ConsumerCommand>[] = [
  { at: 32, command: { type: 'crash' } },
  { at: 71, command: { type: 'crash' } },
];

function readAll(consumer: OffsetConsumer, ticks: number): ConsumerTick[] {
  const out: ConsumerTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(consumer, crashes));
  return out;
}

function finish(run: OutboxDuel | AckModeRun): void {
  while (!run.done) run.step();
}

function checkWriterConservation(writer: ClickWriter): void {
  const t = writer.totals;
  expect(t.both + t.rejected + t.lost + t.phantom + t.waiting).toBe(t.arrived);
  expect(writer.outOfSync).toBe(t.lost + t.phantom + t.waiting);
}

function inHandCount(consumer: OffsetConsumer): number {
  const [from, to] = consumer.inHand;
  return to - from;
}

describe('ClickWriter', () => {
  it('replays a scripted run exactly in every mode', () => {
    for (const mode of ['commit-first', 'publish-first', 'outbox'] as WriterMode[]) {
      expect(writeAll(new ClickWriter(mode, arrivals), 100)).toEqual(
        writeAll(new ClickWriter(mode, arrivals), 100),
      );
    }
  });

  it('resets to the start and resumes midway from a checkpoint', () => {
    const writer = new ClickWriter('outbox', arrivals);
    const start = writer.checkpoint();
    const first = writeAll(writer, 100);
    writer.restore(start);
    expect(writeAll(writer, 100)).toEqual(first);

    const again = new ClickWriter('outbox', arrivals);
    writeAll(again, 72);
    const saved = again.checkpoint();
    const rest = writeAll(again, 28);
    const fresh = new ClickWriter('outbox', arrivals);
    fresh.restore(saved);
    expect(writeAll(fresh, 28)).toEqual(rest);
  });

  it('accounts for every click in every mode at every tick', () => {
    for (const mode of ['commit-first', 'publish-first', 'outbox'] as WriterMode[]) {
      const writer = new ClickWriter(mode, arrivals);
      for (let i = 0; i < 100; i += 1) {
        stepScheduled(writer, faults);
        checkWriterConservation(writer);
      }
    }
  });

  it('loses events when it commits first and invents them when it publishes first', () => {
    const commitFirst = new ClickWriter('commit-first', arrivals);
    const publishFirst = new ClickWriter('publish-first', arrivals);
    writeAll(commitFirst, 100);
    writeAll(publishFirst, 100);
    expect(commitFirst.totals.lost).toBeGreaterThan(0);
    expect(commitFirst.totals.phantom).toBe(0);
    expect(publishFirst.totals.phantom).toBeGreaterThan(0);
    expect(publishFirst.totals.lost).toBe(0);
    for (const writer of [commitFirst, publishFirst]) {
      expect(writer.totals.waiting).toBe(0);
      expect(writer.totals.duplicates).toBe(0);
      expect(writer.hasRelay).toBe(false);
    }
  });

  it('never loses or invents an event through the outbox, and duplicates only after a relay crash', () => {
    const writer = new ClickWriter('outbox', arrivals);
    const ticks = writeAll(writer, 100);
    const t = writer.totals;
    expect(t.lost).toBe(0);
    expect(t.phantom).toBe(0);
    expect(t.waiting).toBe(0);
    expect(t.duplicates).toBeGreaterThan(0);
    expect(t.published).toBe(t.both + t.duplicates);
    expect(ticks.slice(0, 70).every((tick) => tick.newDuplicates === 0)).toBe(true);
  });

  it('holds saved clicks in the outbox while the broker is down', () => {
    const writer = new ClickWriter('outbox', arrivals);
    writeAll(writer, 20);
    expect(writer.brokerUp).toBe(false);
    expect(writer.totals.waiting).toBeGreaterThan(0);
    expect(writer.outboxLength).toBe(writer.totals.waiting);
  });

  it('ignores a relay crash in the dual write lanes and while the relay is already down', () => {
    const dual = new ClickWriter('commit-first', arrivals);
    const before = dual.checkpoint();
    dual.apply({ type: 'relay-crash' });
    expect(dual.checkpoint()).toEqual(before);

    const outbox = new ClickWriter('outbox', arrivals);
    outbox.apply({ type: 'relay-crash' });
    outbox.step();
    expect(outbox.relayUp).toBe(false);
    const down = outbox.checkpoint();
    outbox.apply({ type: 'relay-crash' });
    expect(outbox.checkpoint()).toEqual(down);
  });

  it('returns the latest clicks oldest first', () => {
    const writer = new ClickWriter('commit-first', [3, 2]);
    writer.step();
    writer.apply({ type: 'broker-down' });
    writer.step();
    expect(writer.recent(3)).toEqual(['both', 'lost', 'lost']);
    expect(writer.recent(10)).toHaveLength(5);
  });
});

describe('OutboxDuel', () => {
  it('replays the same run for the same seed', () => {
    for (const order of ['commit-first', 'publish-first'] as const) {
      const a = new OutboxDuel(order);
      const b = new OutboxDuel(order);
      finish(a);
      finish(b);
      expect(a.events).toEqual(b.events);
      expect(a.lanes.map((lane) => lane.series)).toEqual(b.lanes.map((lane) => lane.series));
    }
  });

  it('feeds both lanes the same clicks', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const duel = new OutboxDuel('commit-first', seed);
      finish(duel);
      const [dual, outbox] = duel.lanes;
      expect(dual.model.totals.arrived).toBe(outbox.model.totals.arrived);
      checkWriterConservation(dual.model);
      checkWriterConservation(outbox.model);
      expect(outbox.model.totals.lost + outbox.model.totals.phantom).toBe(0);
    }
  });

  it('pins the commit first numbers the lesson quotes', () => {
    const duel = new OutboxDuel('commit-first');
    finish(duel);
    const [dual, outbox] = duel.lanes;
    expect(dual.model.totals).toMatchObject({ arrived: 385, both: 274, rejected: 49, lost: 62, phantom: 0 });
    expect(outbox.model.totals).toMatchObject({
      both: 336,
      rejected: 49,
      lost: 0,
      waiting: 0,
      duplicates: 5,
    });
    expect(Math.max(...outbox.series.slice(20, 40))).toBe(62);
    expect(outbox.series.indexOf(0, 35)).toBe(46);
    expect(duel.events.map((event) => event.text)).toContain(
      'Outbox: the relay publishes 5 events, then crashes before marking them sent. It is down for 0.5 s.',
    );
    expect(duel.events.at(-1)).toEqual({
      tick: 100,
      text: 'Run ends. Dual write: 62 clicks out of sync for good. Transactional outbox: none out of sync, 5 duplicate events for the consumer to skip.',
      marker: false,
    });
  });

  it('pins the publish first numbers the lesson quotes', () => {
    const duel = new OutboxDuel('publish-first');
    finish(duel);
    expect(duel.lanes[0].model.totals).toMatchObject({ rejected: 62, lost: 0, phantom: 49 });
    expect(duel.events.map((event) => event.text)).toContain(
      'Dual write: the first phantom event. Analytics counts a click the database never saved.',
    );
  });

  it('numbers its markers in time order and ignores steps after the end', () => {
    const duel = new OutboxDuel();
    finish(duel);
    const ticks = duel.events.map((event) => event.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    const count = duel.events.length;
    duel.step();
    expect(duel.events).toHaveLength(count);
    expect(duel.ticks).toBe(100);
  });
});

describe('OffsetConsumer', () => {
  it('replays, resets, and resumes from a checkpoint exactly', () => {
    for (const mode of ['ack-first', 'ack-after', 'dedupe'] as AckMode[]) {
      const consumer = new OffsetConsumer(mode);
      const start = consumer.checkpoint();
      const first = readAll(consumer, 100);
      consumer.restore(start);
      expect(readAll(consumer, 100)).toEqual(first);
      expect(readAll(new OffsetConsumer(mode), 100)).toEqual(first);

      const again = new OffsetConsumer(mode);
      readAll(again, 50);
      const saved = again.checkpoint();
      const rest = readAll(again, 50);
      const fresh = new OffsetConsumer(mode);
      fresh.restore(saved);
      expect(readAll(fresh, 50)).toEqual(rest);
    }
  });

  it('starts with a backlog so the first crash lands mid batch', () => {
    const consumer = new OffsetConsumer('ack-after');
    expect(consumer.totals.produced).toBe(150);
    expect(consumer.lag).toBe(150);
    readAll(consumer, 32);
    expect(inHandCount(consumer)).toBeGreaterThan(0);
    expect(consumer.committed).toBeLessThan(consumer.inHand[0]);
  });

  it('accounts for every click across seeds and modes', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const mode of ['ack-first', 'ack-after', 'dedupe'] as AckMode[]) {
        const consumer = new OffsetConsumer(mode, { seed });
        for (let i = 0; i < 100; i += 1) {
          stepScheduled(consumer, crashes);
          const t = consumer.totals;
          expect(t.counted).toBe(t.unique + t.doubleCounted);
          const states = { waiting: 0, 'in-hand': 0, counted: 0, double: 0, lost: 0 };
          for (let offset = 0; offset < t.produced; offset += 1) states[consumer.offsetState(offset)] += 1;
          expect(states.counted + states.double).toBe(t.unique);
          expect(states.lost).toBe(t.lost);
          expect(states.waiting + states['in-hand']).toBe(consumer.uncounted);
          expect(consumer.committed).toBeLessThanOrEqual(t.produced);
        }
        const t = consumer.totals;
        if (mode !== 'ack-after') expect(t.doubleCounted).toBe(0);
        if (mode !== 'ack-first') expect(t.lost).toBe(0);
        if (mode !== 'dedupe') expect(t.skipped).toBe(0);
      }
    }
  });

  it('ignores a crash while it is already down', () => {
    const consumer = new OffsetConsumer('ack-first');
    readAll(consumer, 10);
    consumer.apply({ type: 'crash' });
    consumer.step();
    expect(consumer.up).toBe(false);
    const down = consumer.checkpoint();
    consumer.apply({ type: 'crash' });
    expect(consumer.checkpoint()).toEqual(down);
  });

  it('marks each offset in the strip by what happened to it', () => {
    const consumer = new OffsetConsumer('ack-first');
    readAll(consumer, 33);
    expect(consumer.offsetState(180)).toBe('counted');
    expect(consumer.offsetState(195)).toBe('lost');
    expect(consumer.offsetState(consumer.totals.produced - 1)).toBe('waiting');
    const twice = new OffsetConsumer('ack-after');
    readAll(twice, 45);
    expect(twice.offsetState(185)).toBe('double');
  });
});

describe('AckModeRun', () => {
  it('pins the numbers the lesson quotes for the same two crashes', () => {
    const runs = Object.fromEntries(
      (['ack-first', 'ack-after', 'dedupe'] as AckMode[]).map((mode) => {
        const run = new AckModeRun(mode);
        finish(run);
        return [mode, run];
      }),
    ) as Record<AckMode, AckModeRun>;
    expect(runs['ack-first'].model.totals).toMatchObject({ produced: 535, lost: 24, doubleCounted: 0 });
    expect(runs['ack-after'].model.totals).toMatchObject({ produced: 535, lost: 0, doubleCounted: 16 });
    expect(runs.dedupe.model.totals).toMatchObject({ produced: 535, lost: 0, doubleCounted: 0, skipped: 16 });
    expect(runs['ack-first'].model.uncounted).toBe(0);
    expect(runs.dedupe.model.uncounted).toBe(11);
    expect(runs['ack-first'].events[0]).toEqual({
      tick: 32,
      text: 'The consumer crashes with 8 clicks in hand. Their offsets are already committed, so nobody will count them.',
    });
    expect(runs['ack-after'].events[0]).toEqual({
      tick: 32,
      text: 'The consumer crashes after counting 12 clicks it has not committed yet. It will count them again.',
    });
    expect(runs.dedupe.events[0]?.text).toBe(
      'The consumer crashes after counting 12 clicks it has not committed yet. It will read them again and skip them.',
    );
    expect(runs['ack-first'].series.at(-1)).toBe(24);
    expect(runs.dedupe.series.every((value) => value === 0)).toBe(true);
  });

  it('ignores commands and steps after the run ends', () => {
    const run = new AckModeRun('ack-after');
    finish(run);
    const saved = run.model.checkpoint();
    run.apply({ type: 'crash' });
    run.step();
    expect(run.model.checkpoint()).toEqual(saved);
    expect(run.series).toHaveLength(100);
  });
});
