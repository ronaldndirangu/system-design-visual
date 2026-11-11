/**
 * Lesson-specific toy models for event-driven design.
 *
 * PartitionReader reads one partition of click events in order. When an event
 * fails, it waits and tries the same event again, so every event behind it
 * waits too. In 'retry' mode it retries forever. In 'dead-letter' mode it parks
 * the event in a dead-letter queue after a set number of tries and moves on.
 * PoisonDuel runs both on the same clicks and the same malformed events.
 *
 * SchemaReader checks each click event against the fields it needs. A strict
 * reader also rejects fields it does not know; a tolerant reader ignores them.
 * SchemaDuel ships one schema change mid run and feeds both readers the same
 * clicks.
 *
 * Every number these models produce is illustrative. Neither model describes a
 * real broker or consumer library.
 */
import { createRng, poisson } from '../rng';
import type { ModelAdapter, ScheduledCommand } from './adapter';
import { stepScheduled } from './adapter';
import type { DuelEvent, RunEvent } from './deliveryOutbox';

/* ------------------------------------------------------------------ */
/* Poison messages: retry forever versus a dead-letter queue           */
/* ------------------------------------------------------------------ */

export type ReaderMode = 'retry' | 'dead-letter';
/** ok works on the first try, timeout fails once and then works, malformed never works. */
export type ClickKind = 'ok' | 'timeout' | 'malformed';
export type EventState = 'processed' | 'parked' | 'retrying' | 'waiting';

export type ReaderCommand = { type: 'malformed' };

export interface ReaderConfig {
  tickSeconds: number;
  /** Tries the consumer can make per tick. */
  capacity: number;
  /** Ticks the consumer waits before it tries a failed event again. */
  retryDelayTicks: number;
  /** Tries before a dead-letter reader parks an event. */
  maxTries: number;
}

export const defaultReaderConfig: ReaderConfig = {
  tickSeconds: 0.1,
  capacity: 10,
  retryDelayTicks: 3,
  maxTries: 3,
};

export interface ReaderTotals {
  arrived: number;
  processed: number;
  /** Events moved to the dead-letter queue. */
  parked: number;
  /** Parked events that hit a timeout, so another try would have worked. */
  parkedTimeouts: number;
  /** Events still in the partition, including the one being retried. */
  waiting: number;
  tries: number;
  failures: number;
}

export interface ReaderTick {
  tick: number;
  arrived: number;
  processed: number;
  parked: number;
  waiting: number;
}

export interface ReaderCheckpoint {
  tickCount: number;
  kinds: ClickKind[];
  parkedFlags: boolean[];
  head: number;
  headTries: number;
  retryAt: number;
  totals: ReaderTotals;
  notes: RunEvent[];
}

function emptyReaderTotals(): ReaderTotals {
  return { arrived: 0, processed: 0, parked: 0, parkedTimeouts: 0, waiting: 0, tries: 0, failures: 0 };
}

/** One consumer reading one partition in order. Workload entries list the kinds that arrive each tick. */
export class PartitionReader implements ModelAdapter<ReaderCommand, ReaderTick, ReaderCheckpoint> {
  readonly mode: ReaderMode;
  readonly config: ReaderConfig;
  private readonly workload: readonly (readonly ClickKind[])[];
  private tickCount = 0;
  private kinds: ClickKind[] = [];
  private parkedFlags: boolean[] = [];
  private head = 0;
  private headTries = 0;
  private retryAt = 0;
  private counts: ReaderTotals = emptyReaderTotals();
  private noteLog: RunEvent[] = [];

  constructor(
    mode: ReaderMode,
    workload: readonly (readonly ClickKind[])[],
    config: Partial<ReaderConfig> = {},
  ) {
    this.mode = mode;
    this.workload = workload;
    this.config = { ...defaultReaderConfig, ...config };
  }

  get ticks(): number {
    return this.tickCount;
  }

  get totals(): ReaderTotals {
    return { ...this.counts };
  }

  get notes(): RunEvent[] {
    return this.noteLog.map((note) => ({ ...note }));
  }

  /** The id of the oldest event still in the partition. Equals the arrival count when it is empty. */
  get headId(): number {
    return this.head;
  }

  /** Failed tries so far on the event at the head. */
  get headTryCount(): number {
    return this.headTries;
  }

  get headKind(): ClickKind | undefined {
    return this.kinds[this.head];
  }

  kindOf(id: number): ClickKind | undefined {
    return this.kinds[id];
  }

  stateOf(id: number): EventState {
    if (id < this.head) return this.parkedFlags[id] ? 'parked' : 'processed';
    if (id === this.head && this.headTries > 0) return 'retrying';
    return 'waiting';
  }

  /** Puts a malformed event at the tail of the partition before the next tick's clicks. */
  apply(command: ReaderCommand): void {
    if (command.type === 'malformed') this.append('malformed');
  }

  step(): ReaderTick {
    const tick = this.tickCount;
    const incoming = this.workload[tick] ?? [];
    for (const kind of incoming) this.append(kind);
    const before = { processed: this.counts.processed, parked: this.counts.parked };
    let budget = this.config.capacity;
    while (budget > 0 && this.head < this.kinds.length && tick >= this.retryAt) {
      budget -= 1;
      this.tryHead(tick);
    }
    this.tickCount += 1;
    return {
      tick,
      arrived: incoming.length,
      processed: this.counts.processed - before.processed,
      parked: this.counts.parked - before.parked,
      waiting: this.counts.waiting,
    };
  }

  private append(kind: ClickKind): void {
    this.kinds.push(kind);
    this.parkedFlags.push(false);
    this.counts.arrived += 1;
    this.counts.waiting += 1;
  }

  private tryHead(tick: number): void {
    const kind = this.kinds[this.head];
    this.headTries += 1;
    this.counts.tries += 1;
    const works = kind === 'ok' || (kind === 'timeout' && this.headTries > 1);
    if (works) {
      this.counts.processed += 1;
      this.advance();
      return;
    }
    this.counts.failures += 1;
    if (this.mode === 'dead-letter' && this.headTries >= this.config.maxTries) {
      this.park(tick, kind);
      return;
    }
    this.retryAt = tick + this.config.retryDelayTicks;
  }

  private park(tick: number, kind: ClickKind | undefined): void {
    const tries = this.headTries;
    this.parkedFlags[this.head] = true;
    this.counts.parked += 1;
    if (kind === 'timeout') {
      this.counts.parkedTimeouts += 1;
      if (this.counts.parkedTimeouts === 1) {
        this.note(
          tick,
          'Dead-letter queue: parks a click that hit a timeout. One more try would have worked, so someone has to replay it.',
        );
      }
    } else if (tries === 1) {
      this.note(
        tick,
        'Dead-letter queue: parks the malformed click on its first failure. The partition keeps moving.',
      );
    } else {
      const waited = ((tries - 1) * this.config.retryDelayTicks * this.config.tickSeconds).toFixed(1);
      this.note(
        tick,
        `Dead-letter queue: parks the malformed click after ${tries} tries (${waited} s of retries). The partition moves again.`,
      );
    }
    this.advance();
  }

  private advance(): void {
    this.head += 1;
    this.headTries = 0;
    this.counts.waiting -= 1;
  }

  private note(tick: number, text: string): void {
    this.noteLog.push({ tick, text });
  }

  checkpoint(): ReaderCheckpoint {
    return {
      tickCount: this.tickCount,
      kinds: [...this.kinds],
      parkedFlags: [...this.parkedFlags],
      head: this.head,
      headTries: this.headTries,
      retryAt: this.retryAt,
      totals: { ...this.counts },
      notes: this.notes,
    };
  }

  restore(checkpoint: ReaderCheckpoint): void {
    this.tickCount = checkpoint.tickCount;
    this.kinds = [...checkpoint.kinds];
    this.parkedFlags = [...checkpoint.parkedFlags];
    this.head = checkpoint.head;
    this.headTries = checkpoint.headTries;
    this.retryAt = checkpoint.retryAt;
    this.counts = { ...checkpoint.totals };
    this.noteLog = checkpoint.notes.map((note) => ({ ...note }));
  }
}

export const POISON_SECONDS = 10;
export const POISON_CLICKS_PER_SECOND = 40;
/** Share of clicks whose first try hits a downstream timeout. */
export const TIMEOUT_SHARE = 0.02;
export const MALFORMED_AT_SECONDS = [2, 6] as const;

export type TryLimit = 'one' | 'three' | 'ten';

export const tryLimits: Record<TryLimit, { maxTries: number; label: string; diff: string }> = {
  one: {
    maxTries: 1,
    label: 'Park after 1 try',
    diff: 'Dead-letter lane: maxTries 1, parks on the first failure',
  },
  three: {
    maxTries: 3,
    label: 'Park after 3 tries',
    diff: 'Dead-letter lane: maxTries 3, two retries, then parks',
  },
  ten: {
    maxTries: 10,
    label: 'Park after 10 tries',
    diff: 'Dead-letter lane: maxTries 10, nine retries, then parks',
  },
};

/** Malformed clicks a learner can send by hand in one run. */
export const MAX_MANUAL_MALFORMED = 5;

export interface ReaderLane {
  mode: ReaderMode;
  label: string;
  model: PartitionReader;
  /** Clicks waiting in the partition after each tick. */
  series: number[];
}

/** The same clicks and the same malformed events through a reader that retries forever and one that parks. */
export class PoisonDuel {
  readonly length: number;
  readonly tickSeconds = defaultReaderConfig.tickSeconds;
  readonly tryLimit: TryLimit;
  readonly lanes: [ReaderLane, ReaderLane];
  readonly events: DuelEvent[] = [];
  private readonly schedule: ScheduledCommand<ReaderCommand>[];
  private readonly malformedTicks: Set<number>;
  private manualSent = 0;
  private stuckNoted = false;
  private stuckLongNoted = false;

  constructor(tryLimit: TryLimit = 'three', seed = 42) {
    this.tryLimit = tryLimit;
    this.length = Math.round(POISON_SECONDS / this.tickSeconds);
    const rng = createRng(seed);
    const mean = POISON_CLICKS_PER_SECOND * this.tickSeconds;
    const workload = Array.from({ length: this.length }, () =>
      Array.from({ length: poisson(rng, mean) }, (): ClickKind => (rng() < TIMEOUT_SHARE ? 'timeout' : 'ok')),
    );
    this.lanes = [
      {
        mode: 'retry',
        label: 'Retry until it works',
        model: new PartitionReader('retry', workload),
        series: [],
      },
      {
        mode: 'dead-letter',
        label: 'Dead-letter queue',
        model: new PartitionReader('dead-letter', workload, { maxTries: tryLimits[tryLimit].maxTries }),
        series: [],
      },
    ];
    const at = (seconds: number) => Math.round(seconds / this.tickSeconds);
    this.schedule = MALFORMED_AT_SECONDS.map((seconds) => ({
      at: at(seconds),
      command: { type: 'malformed' },
    }));
    this.malformedTicks = new Set(this.schedule.map((entry) => entry.at));
  }

  get ticks(): number {
    return this.lanes[0].model.ticks;
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  get manualLeft(): number {
    return MAX_MANUAL_MALFORMED - this.manualSent;
  }

  /** Sends one malformed click to both lanes, ahead of the next tick's clicks. */
  sendMalformed(): void {
    if (this.done || this.manualLeft <= 0) return;
    this.manualSent += 1;
    for (const lane of this.lanes) lane.model.apply({ type: 'malformed' });
    this.events.push({ tick: this.ticks, text: 'You send a malformed click to both lanes.', marker: true });
  }

  step(): void {
    if (this.done) return;
    const tick = this.ticks;
    if (this.malformedTicks.has(tick)) {
      this.events.push({
        tick,
        text: 'A buggy producer release publishes a malformed click. No number of retries can read it.',
        marker: true,
      });
    }
    const [retry, park] = this.lanes;
    const parkNotes = park.model.notes.length;
    const a = stepScheduled(retry.model, this.schedule);
    const b = stepScheduled(park.model, this.schedule);
    retry.series.push(a.waiting);
    park.series.push(b.waiting);

    const head = retry.model.headTryCount;
    if (!this.stuckNoted && retry.model.headKind === 'malformed' && head > 0) {
      this.stuckNoted = true;
      this.events.push({
        tick,
        text: `Retry: the malformed click fails. The consumer waits ${(defaultReaderConfig.retryDelayTicks * this.tickSeconds).toFixed(1)} s and tries the same click again, and every click behind it waits.`,
        marker: true,
      });
    }
    if (!this.stuckLongNoted && retry.model.headKind === 'malformed' && head >= 10) {
      this.stuckLongNoted = true;
      this.events.push({
        tick,
        text: `Retry: try ${head} on the same malformed click. ${a.waiting - 1} clicks wait behind it.`,
        marker: true,
      });
    }
    for (const note of park.model.notes.slice(parkNotes)) this.events.push({ ...note, marker: true });

    if (this.done) {
      const r = retry.model.totals;
      const p = park.model.totals;
      const timeouts =
        p.parkedTimeouts > 0 ? `, ${p.parkedTimeouts} of them clicks that one more try would have saved` : '';
      this.events.push({
        tick: this.length,
        text: `Run ends. Retry until it works: try ${retry.model.headTryCount} on the first malformed click, with ${r.waiting - 1} clicks stuck behind it. Dead-letter queue: ${p.parked} parked${timeouts}, ${p.waiting} waiting.`,
        marker: false,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Schema evolution: strict versus tolerant readers                    */
/* ------------------------------------------------------------------ */

export type FieldType = 'string' | 'number';
export type EventShape = Readonly<Record<string, FieldType>>;
export type SchemaChange = 'add-field' | 'rename' | 'version';
export type ReaderStyle = 'strict' | 'tolerant';
export type ReadOutcome = 'counted' | 'parked';

/** Version 1 of the click event: the contract every consumer was written against. */
export const clickV1: EventShape = { code: 'string', clickedAt: 'string', referrer: 'string' };

/** The click event after each change. The version change leaves v1 alone and adds a v2 topic. */
export const clickV2: Record<SchemaChange, EventShape> = {
  'add-field': { ...clickV1, country: 'string' },
  rename: { shortCode: 'string', clickedAt: 'string', referrer: 'string' },
  version: { shortCode: 'string', clickedAt: 'string', referrer: 'string' },
};

/** The fields the analytics consumer reads. A tolerant reader checks only these. */
export const fieldsUsed: EventShape = { code: 'string', clickedAt: 'string' };

/** Returns why the reader rejects the event, or null when it reads. */
export function readError(shape: EventShape, style: ReaderStyle): string | null {
  const expected = style === 'strict' ? clickV1 : fieldsUsed;
  for (const [field, type] of Object.entries(expected)) {
    const actual = shape[field];
    if (actual === undefined) return `missing field ${field}`;
    if (actual !== type) return `${field} is a ${actual}, expected a ${type}`;
  }
  if (style === 'strict') {
    const unknown = Object.keys(shape).find((field) => !(field in clickV1));
    if (unknown) return `unknown field ${unknown}`;
  }
  return null;
}

export type SchemaCommand = { type: 'deploy'; change: SchemaChange };

export interface SchemaTotals {
  clicks: number;
  /** Events the producer published, across every topic. */
  published: number;
  counted: number;
  /** Events the reader rejected and parked in the dead-letter queue. */
  parked: number;
  /** Events on a v2 topic that no consumer reads yet. */
  v2Only: number;
}

export interface SchemaTick {
  tick: number;
  clicks: number;
  parked: number;
}

export interface SchemaCheckpoint {
  tickCount: number;
  change: SchemaChange | null;
  outcomes: ReadOutcome[];
  totals: SchemaTotals;
  notes: RunEvent[];
}

/** A consumer that reads the v1 click topic and parks events it rejects, since no retry fixes a schema error. */
export class SchemaReader implements ModelAdapter<SchemaCommand, SchemaTick, SchemaCheckpoint> {
  readonly style: ReaderStyle;
  private readonly arrivals: readonly number[];
  private tickCount = 0;
  private change: SchemaChange | null = null;
  private outcomes: ReadOutcome[] = [];
  private counts: SchemaTotals = { clicks: 0, published: 0, counted: 0, parked: 0, v2Only: 0 };
  private noteLog: RunEvent[] = [];

  constructor(style: ReaderStyle, arrivals: readonly number[]) {
    this.style = style;
    this.arrivals = arrivals;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get totals(): SchemaTotals {
    return { ...this.counts };
  }

  get notes(): RunEvent[] {
    return this.noteLog.map((note) => ({ ...note }));
  }

  get deployed(): SchemaChange | null {
    return this.change;
  }

  /** The shape of events on the v1 topic right now. */
  get topicShape(): EventShape {
    if (this.change === null || this.change === 'version') return clickV1;
    return clickV2[this.change];
  }

  /** The latest outcomes, oldest first. */
  recent(count: number): ReadOutcome[] {
    return this.outcomes.slice(Math.max(0, this.outcomes.length - count));
  }

  apply(command: SchemaCommand): void {
    if (command.type === 'deploy') this.change = command.change;
  }

  step(): SchemaTick {
    const tick = this.tickCount;
    const clicks = this.arrivals[tick] ?? 0;
    const error = readError(this.topicShape, this.style);
    const extraTopic = this.change === 'version' ? 1 : 0;
    for (let index = 0; index < clicks; index += 1) {
      this.counts.clicks += 1;
      this.counts.published += 1 + extraTopic;
      this.counts.v2Only += extraTopic;
      if (error) {
        if (this.counts.parked === 0) this.note(tick, `parks the first new click: ${error}.`);
        this.counts.parked += 1;
        this.outcomes.push('parked');
      } else {
        this.counts.counted += 1;
        this.outcomes.push('counted');
      }
    }
    this.tickCount += 1;
    return { tick, clicks, parked: this.counts.parked };
  }

  private note(tick: number, text: string): void {
    this.noteLog.push({ tick, text });
  }

  checkpoint(): SchemaCheckpoint {
    return {
      tickCount: this.tickCount,
      change: this.change,
      outcomes: [...this.outcomes],
      totals: { ...this.counts },
      notes: this.notes,
    };
  }

  restore(checkpoint: SchemaCheckpoint): void {
    this.tickCount = checkpoint.tickCount;
    this.change = checkpoint.change;
    this.outcomes = [...checkpoint.outcomes];
    this.counts = { ...checkpoint.totals };
    this.noteLog = checkpoint.notes.map((note) => ({ ...note }));
  }
}

export const SCHEMA_SECONDS = 8;
export const SCHEMA_CLICKS_PER_SECOND = 40;
export const DEPLOY_AT_SECONDS = 3;

export const schemaChangeOptions: Record<SchemaChange, { label: string; diff: string }> = {
  'add-field': { label: 'Add an optional field', diff: 'v1 gains country' },
  rename: { label: 'Rename a field in place', diff: 'v1 renames code to shortCode' },
  version: { label: 'Publish the rename as v2', diff: 'v1 stays, v2 gets shortCode' },
};

export interface SchemaLane {
  style: ReaderStyle;
  label: string;
  model: SchemaReader;
  /** Events in the dead-letter queue after each tick. */
  series: number[];
}

/** One schema change, shipped mid run, read by a strict and a tolerant consumer on the same clicks. */
export class SchemaDuel {
  readonly length: number;
  readonly tickSeconds = 0.1;
  readonly change: SchemaChange;
  readonly lanes: [SchemaLane, SchemaLane];
  readonly events: DuelEvent[] = [];
  private readonly schedule: ScheduledCommand<SchemaCommand>[];
  private readonly deployTick: number;

  constructor(change: SchemaChange = 'add-field', seed = 42) {
    this.change = change;
    this.length = Math.round(SCHEMA_SECONDS / this.tickSeconds);
    const rng = createRng(seed);
    const mean = SCHEMA_CLICKS_PER_SECOND * this.tickSeconds;
    const arrivals = Array.from({ length: this.length }, () => poisson(rng, mean));
    this.lanes = [
      { style: 'strict', label: 'Strict reader', model: new SchemaReader('strict', arrivals), series: [] },
      {
        style: 'tolerant',
        label: 'Tolerant reader',
        model: new SchemaReader('tolerant', arrivals),
        series: [],
      },
    ];
    this.deployTick = Math.round(DEPLOY_AT_SECONDS / this.tickSeconds);
    this.schedule = [{ at: this.deployTick, command: { type: 'deploy', change } }];
  }

  get ticks(): number {
    return this.lanes[0].model.ticks;
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.ticks;
    if (tick === this.deployTick) {
      this.events.push({ tick, text: deployText[this.change], marker: true });
    }
    for (const lane of this.lanes) {
      const before = lane.model.notes.length;
      const result = stepScheduled(lane.model, this.schedule);
      lane.series.push(result.parked);
      for (const note of lane.model.notes.slice(before)) {
        this.events.push({ tick: note.tick, text: `${lane.label}: ${note.text}`, marker: true });
      }
    }
    if (this.done) this.events.push({ tick: this.length, text: this.wrapUp(), marker: false });
  }

  private wrapUp(): string {
    const strict = this.lanes[0].model.totals;
    const tolerant = this.lanes[1].model.totals;
    const v2 =
      this.change === 'version'
        ? ` The v2 topic holds ${strict.v2Only} events for consumers that upgrade.`
        : '';
    return `Run ends. Strict reader: ${strict.parked} clicks parked. Tolerant reader: ${tolerant.parked} parked.${v2}`;
  }
}

const deployText: Record<SchemaChange, string> = {
  'add-field': 'The click service deploys. Every click event now carries a country field.',
  rename: 'The click service deploys. The click event renames code to shortCode.',
  version:
    'The click service deploys. It keeps publishing v1 and also publishes v2, with shortCode, to a new topic.',
};
