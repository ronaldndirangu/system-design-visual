import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  type ClickKind,
  clickV1,
  clickV2,
  MAX_MANUAL_MALFORMED,
  PartitionReader,
  PoisonDuel,
  type ReaderCommand,
  type ReaderMode,
  type ReaderTick,
  readError,
  type SchemaChange,
  type SchemaCommand,
  SchemaDuel,
  SchemaReader,
  type SchemaTick,
  type TryLimit,
} from '../../src/lib/models/eventDesign';

const workload: ClickKind[][] = Array.from({ length: 100 }, (_, tick) =>
  Array.from(
    { length: 2 + (tick % 4) },
    (_, index): ClickKind => (index === 0 && tick % 9 === 0 ? 'timeout' : 'ok'),
  ),
);
const poison: ScheduledCommand<ReaderCommand>[] = [
  { at: 15, command: { type: 'malformed' } },
  { at: 55, command: { type: 'malformed' } },
];

function readAll(reader: PartitionReader, ticks: number): ReaderTick[] {
  const out: ReaderTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(reader, poison));
  return out;
}

const arrivals = Array.from({ length: 80 }, (_, tick) => 3 + (tick % 3));
const deploy = (change: SchemaChange): ScheduledCommand<SchemaCommand>[] => [
  { at: 30, command: { type: 'deploy', change } },
];

function readSchema(reader: SchemaReader, change: SchemaChange, ticks: number): SchemaTick[] {
  const out: SchemaTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(reader, deploy(change)));
  return out;
}

function finish(run: PoisonDuel | SchemaDuel): void {
  while (!run.done) run.step();
}

function checkReaderConservation(reader: PartitionReader): void {
  const t = reader.totals;
  expect(t.processed + t.parked + t.waiting).toBe(t.arrived);
  expect(reader.headId).toBe(t.processed + t.parked);
}

describe('PartitionReader', () => {
  it('replays a scripted run exactly in both modes', () => {
    for (const mode of ['retry', 'dead-letter'] as ReaderMode[]) {
      expect(readAll(new PartitionReader(mode, workload), 100)).toEqual(
        readAll(new PartitionReader(mode, workload), 100),
      );
    }
  });

  it('resets to the start and resumes midway from a checkpoint', () => {
    const reader = new PartitionReader('dead-letter', workload);
    const start = reader.checkpoint();
    const first = readAll(reader, 100);
    const firstNotes = reader.notes;
    reader.restore(start);
    expect(reader.notes).toEqual([]);
    expect(readAll(reader, 100)).toEqual(first);
    expect(reader.notes).toEqual(firstNotes);

    const again = new PartitionReader('dead-letter', workload);
    readAll(again, 17);
    const saved = again.checkpoint();
    const rest = readAll(again, 83);
    const fresh = new PartitionReader('dead-letter', workload);
    fresh.restore(saved);
    expect(readAll(fresh, 83)).toEqual(rest);
    expect(fresh.totals).toEqual(again.totals);
  });

  it('accounts for every event at every tick', () => {
    for (const mode of ['retry', 'dead-letter'] as ReaderMode[]) {
      const reader = new PartitionReader(mode, workload);
      for (let tick = 0; tick < 100; tick += 1) {
        stepScheduled(reader, poison);
        checkReaderConservation(reader);
      }
    }
  });

  it('retries a timeout once and parks only what keeps failing', () => {
    const reader = new PartitionReader('dead-letter', [['timeout', 'ok'], [], [], [], []]);
    reader.step();
    expect(reader.stateOf(0)).toBe('retrying');
    expect(reader.stateOf(1)).toBe('waiting');
    for (let i = 0; i < 4; i += 1) reader.step();
    expect(reader.totals).toMatchObject({ processed: 2, parked: 0, failures: 1, tries: 3 });
    expect(reader.stateOf(0)).toBe('processed');

    const strict = new PartitionReader('dead-letter', [['timeout', 'ok'], [], [], [], []], { maxTries: 1 });
    strict.step();
    expect(strict.totals).toMatchObject({ processed: 1, parked: 1, parkedTimeouts: 1 });
    expect(strict.stateOf(0)).toBe('parked');
  });

  it('never gets past a malformed event when it retries forever', () => {
    const reader = new PartitionReader('retry', [
      ['ok', 'ok'],
      ...Array.from({ length: 60 }, () => ['ok'] as ClickKind[]),
    ]);
    reader.apply({ type: 'malformed' });
    for (let i = 0; i < 61; i += 1) reader.step();
    expect(reader.headKind).toBe('malformed');
    expect(reader.totals).toMatchObject({ arrived: 63, processed: 0, parked: 0, waiting: 63 });
    expect(reader.headTryCount).toBe(21);
  });
});

describe('PoisonDuel', () => {
  it('replays the same run for the same seed and try limit', () => {
    const a = new PoisonDuel('three', 7);
    const b = new PoisonDuel('three', 7);
    finish(a);
    finish(b);
    expect(a.events).toEqual(b.events);
    expect(a.lanes[0].series).toEqual(b.lanes[0].series);
    expect(a.lanes[1].series).toEqual(b.lanes[1].series);
  });

  it('feeds both lanes the same clicks across seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const limit of ['one', 'three', 'ten'] as TryLimit[]) {
        const run = new PoisonDuel(limit, seed);
        finish(run);
        const [retry, park] = run.lanes;
        expect(retry.model.totals.arrived).toBe(park.model.totals.arrived);
        checkReaderConservation(retry.model);
        checkReaderConservation(park.model);
        expect(retry.model.totals.parked).toBe(0);
      }
    }
  });

  it('pins the numbers the lesson quotes', () => {
    const three = new PoisonDuel('three');
    finish(three);
    expect(three.lanes[0].model.totals).toMatchObject({
      arrived: 423,
      processed: 88,
      parked: 0,
      waiting: 335,
    });
    expect(three.lanes[1].model.totals).toMatchObject({
      processed: 416,
      parked: 2,
      parkedTimeouts: 0,
      waiting: 5,
    });
    expect(Math.max(...three.lanes[1].series)).toBe(52);
    expect(Math.max(...three.lanes[0].series)).toBe(335);

    const one = new PoisonDuel('one');
    finish(one);
    expect(one.lanes[1].model.totals).toMatchObject({
      processed: 411,
      parked: 12,
      parkedTimeouts: 10,
      waiting: 0,
    });

    const ten = new PoisonDuel('ten');
    finish(ten);
    expect(ten.lanes[1].model.totals).toMatchObject({ processed: 265, parked: 1, waiting: 157 });
  });

  it('tells the default run as numbered events in time order', () => {
    const run = new PoisonDuel();
    finish(run);
    const malformed =
      'A buggy producer release publishes a malformed click. No number of retries can read it.';
    const parked =
      'Dead-letter queue: parks the malformed click after 3 tries (0.6 s of retries). The partition moves again.';
    expect(run.events).toEqual([
      { tick: 20, text: malformed, marker: true },
      {
        tick: 20,
        text: 'Retry: the malformed click fails. The consumer waits 0.3 s and tries the same click again, and every click behind it waits.',
        marker: true,
      },
      { tick: 26, text: parked, marker: true },
      {
        tick: 47,
        text: 'Retry: try 10 on the same malformed click. 128 clicks wait behind it.',
        marker: true,
      },
      { tick: 60, text: malformed, marker: true },
      { tick: 68, text: parked, marker: true },
      {
        tick: 100,
        text: 'Run ends. Retry until it works: try 27 on the first malformed click, with 334 clicks stuck behind it. Dead-letter queue: 2 parked, 5 waiting.',
        marker: false,
      },
    ]);
    const ticks = run.events.map((event) => event.tick);
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y));
  });

  it('notes the timeouts that a one-try limit parks', () => {
    const run = new PoisonDuel('one');
    finish(run);
    expect(run.events[0]).toEqual({
      tick: 1,
      text: 'Dead-letter queue: parks a click that hit a timeout. One more try would have worked, so someone has to replay it.',
      marker: true,
    });
    expect(run.events.at(-1)?.text).toBe(
      'Run ends. Retry until it works: try 27 on the first malformed click, with 334 clicks stuck behind it. Dead-letter queue: 12 parked, 10 of them clicks that one more try would have saved, 0 waiting.',
    );
  });

  it('sends hand-made malformed clicks to both lanes, up to a cap', () => {
    const run = new PoisonDuel();
    for (let i = 0; i < 5; i += 1) run.step();
    for (let i = 0; i < MAX_MANUAL_MALFORMED + 2; i += 1) run.sendMalformed();
    expect(run.manualLeft).toBe(0);
    const sent = run.events.filter((event) => event.text === 'You send a malformed click to both lanes.');
    expect(sent).toHaveLength(MAX_MANUAL_MALFORMED);
    expect(sent.every((event) => event.tick === 5)).toBe(true);
    finish(run);
    const [retry, park] = run.lanes;
    expect(retry.model.totals.arrived).toBe(423 + MAX_MANUAL_MALFORMED);
    expect(park.model.totals.arrived).toBe(423 + MAX_MANUAL_MALFORMED);
    expect(park.model.totals.parked).toBe(2 + MAX_MANUAL_MALFORMED);
    const ticks = run.events.map((event) => event.tick);
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y));
  });

  it('ignores steps and sends after the end', () => {
    const run = new PoisonDuel();
    finish(run);
    const events = run.events.length;
    const totals = run.lanes[1].model.totals;
    run.step();
    run.sendMalformed();
    expect(run.ticks).toBe(run.length);
    expect(run.events).toHaveLength(events);
    expect(run.lanes[1].model.totals).toEqual(totals);
  });
});

describe('readError', () => {
  it('reads v1 in both styles', () => {
    expect(readError(clickV1, 'strict')).toBeNull();
    expect(readError(clickV1, 'tolerant')).toBeNull();
  });

  it('breaks only the strict reader on an added field', () => {
    expect(readError(clickV2['add-field'], 'strict')).toBe('unknown field country');
    expect(readError(clickV2['add-field'], 'tolerant')).toBeNull();
  });

  it('breaks both readers on a rename or a type change', () => {
    expect(readError(clickV2.rename, 'strict')).toBe('missing field code');
    expect(readError(clickV2.rename, 'tolerant')).toBe('missing field code');
    const typed = { ...clickV1, clickedAt: 'number' } as const;
    expect(readError(typed, 'strict')).toBe('clickedAt is a number, expected a string');
    expect(readError(typed, 'tolerant')).toBe('clickedAt is a number, expected a string');
  });

  it('lets a tolerant reader survive the removal of a field it never reads', () => {
    const { referrer: _unused, ...withoutReferrer } = clickV1;
    expect(readError(withoutReferrer, 'strict')).toBe('missing field referrer');
    expect(readError(withoutReferrer, 'tolerant')).toBeNull();
  });
});

describe('SchemaReader', () => {
  it('replays, resets, and resumes midway from a checkpoint', () => {
    const reader = new SchemaReader('strict', arrivals);
    const start = reader.checkpoint();
    const first = readSchema(reader, 'add-field', 80);
    expect(readSchema(new SchemaReader('strict', arrivals), 'add-field', 80)).toEqual(first);
    reader.restore(start);
    expect(readSchema(reader, 'add-field', 80)).toEqual(first);

    const again = new SchemaReader('tolerant', arrivals);
    readSchema(again, 'rename', 40);
    const saved = again.checkpoint();
    const rest = readSchema(again, 'rename', 40);
    const fresh = new SchemaReader('tolerant', arrivals);
    fresh.restore(saved);
    expect(readSchema(fresh, 'rename', 40)).toEqual(rest);
    expect(fresh.totals).toEqual(again.totals);
  });

  it('counts or parks every click, and publishes twice per click after a versioned deploy', () => {
    for (const change of ['add-field', 'rename', 'version'] as SchemaChange[]) {
      for (const style of ['strict', 'tolerant'] as const) {
        const reader = new SchemaReader(style, arrivals);
        for (let tick = 0; tick < 80; tick += 1) {
          stepScheduled(reader, deploy(change));
          const t = reader.totals;
          expect(t.counted + t.parked).toBe(t.clicks);
          expect(t.published).toBe(t.clicks + t.v2Only);
        }
      }
    }
  });
});

describe('SchemaDuel', () => {
  it('feeds both readers the same clicks across seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const change of ['add-field', 'rename', 'version'] as SchemaChange[]) {
        const run = new SchemaDuel(change, seed);
        finish(run);
        const [strict, tolerant] = run.lanes;
        expect(strict.model.totals.clicks).toBe(tolerant.model.totals.clicks);
        expect(strict.model.totals.published).toBe(tolerant.model.totals.published);
      }
    }
  });

  it('pins the numbers the lesson quotes', () => {
    const totals = (change: SchemaChange) => {
      const run = new SchemaDuel(change);
      finish(run);
      return run.lanes.map((lane) => lane.model.totals);
    };
    const [addStrict, addTolerant] = totals('add-field');
    expect(addStrict).toMatchObject({ clicks: 311, counted: 106, parked: 205 });
    expect(addTolerant).toMatchObject({ clicks: 311, counted: 311, parked: 0 });
    const [renameStrict, renameTolerant] = totals('rename');
    expect(renameStrict).toMatchObject({ parked: 205 });
    expect(renameTolerant).toMatchObject({ parked: 205 });
    const [versionStrict, versionTolerant] = totals('version');
    expect(versionStrict).toMatchObject({ counted: 311, parked: 0, published: 516, v2Only: 205 });
    expect(versionTolerant).toMatchObject({ counted: 311, parked: 0 });
  });

  it('tells each change as numbered events in time order', () => {
    const run = new SchemaDuel('rename');
    finish(run);
    expect(run.events).toEqual([
      {
        tick: 30,
        text: 'The click service deploys. The click event renames code to shortCode.',
        marker: true,
      },
      { tick: 30, text: 'Strict reader: parks the first new click: missing field code.', marker: true },
      { tick: 30, text: 'Tolerant reader: parks the first new click: missing field code.', marker: true },
      {
        tick: 80,
        text: 'Run ends. Strict reader: 205 clicks parked. Tolerant reader: 205 parked.',
        marker: false,
      },
    ]);

    const version = new SchemaDuel('version');
    finish(version);
    expect(version.events.at(-1)?.text).toBe(
      'Run ends. Strict reader: 0 clicks parked. Tolerant reader: 0 parked. The v2 topic holds 205 events for consumers that upgrade.',
    );
  });

  it('ignores steps after the end', () => {
    const run = new SchemaDuel();
    finish(run);
    const events = run.events.length;
    run.step();
    expect(run.ticks).toBe(run.length);
    expect(run.events).toHaveLength(events);
  });
});
