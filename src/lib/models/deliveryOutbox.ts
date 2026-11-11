/**
 * Lesson-specific toy models for delivery semantics and the transactional outbox.
 *
 * ClickWriter saves each click to the database and tells analytics about it,
 * in one of three ways: a dual write that commits first, a dual write that
 * publishes first, or a transactional outbox with a relay. OutboxDuel runs the
 * same clicks and the same faults through a dual write and an outbox.
 *
 * OffsetConsumer reads the click log in batches and commits its offset before
 * or after counting, optionally skipping click ids it has already counted.
 * AckModeRun crashes it mid batch on a fixed schedule.
 *
 * Every number these models produce is illustrative. Neither model describes a
 * real broker or database.
 */
import { createRng, poisson, type SeededRng } from '../rng';
import type { ModelAdapter, ScheduledCommand } from './adapter';
import { stepScheduled } from './adapter';

export interface RunEvent {
  tick: number;
  text: string;
}

/* ------------------------------------------------------------------ */
/* Writing a click: dual write versus transactional outbox             */
/* ------------------------------------------------------------------ */

export type DualOrder = 'commit-first' | 'publish-first';
export type WriterMode = DualOrder | 'outbox';

/**
 * Where one click ended up.
 * both: the row is saved and analytics has the event.
 * rejected: the request failed and nothing was written.
 * lost: the row is saved and the event will never be published.
 * phantom: analytics has the event and the row was never saved.
 * waiting: the row and its outbox entry are saved and the relay has not published it yet.
 */
export type ClickState = 'both' | 'rejected' | 'lost' | 'phantom' | 'waiting';

export type WriterCommand =
  | { type: 'broker-down' }
  | { type: 'broker-up' }
  | { type: 'db-down' }
  | { type: 'db-up' }
  | { type: 'relay-crash' };

export interface WriterConfig {
  tickSeconds: number;
  /** The most outbox entries the relay publishes in one tick. */
  relayBatch: number;
  /** Ticks the relay stays down after it crashes. */
  relayRestartTicks: number;
}

export const defaultWriterConfig: WriterConfig = {
  tickSeconds: 0.1,
  relayBatch: 10,
  relayRestartTicks: 5,
};

export interface WriterTotals {
  arrived: number;
  both: number;
  rejected: number;
  lost: number;
  phantom: number;
  waiting: number;
  /** Events the broker accepted, copies included. */
  published: number;
  /** Copies of events analytics had already received. */
  duplicates: number;
}

export interface WriterTick {
  tick: number;
  arrived: number;
  newLost: number;
  newPhantom: number;
  newDuplicates: number;
  /** Clicks where the database and analytics disagree after this tick. */
  outOfSync: number;
}

interface WriterCheckpoint {
  tickCount: number;
  dbUp: boolean;
  brokerUp: boolean;
  relayDownUntil: number;
  relayRestarting: boolean;
  crashPending: boolean;
  states: ClickState[];
  outbox: number[];
  totals: WriterTotals;
  notes: RunEvent[];
}

function emptyWriterTotals(): WriterTotals {
  return { arrived: 0, both: 0, rejected: 0, lost: 0, phantom: 0, waiting: 0, published: 0, duplicates: 0 };
}

/** Saves clicks and publishes click events, one tick at a time, from a fixed list of arrivals. */
export class ClickWriter implements ModelAdapter<WriterCommand, WriterTick, WriterCheckpoint> {
  readonly mode: WriterMode;
  readonly config: WriterConfig;
  private readonly arrivals: readonly number[];
  private tickCount = 0;
  private dbIsUp = true;
  private brokerIsUp = true;
  private relayDownUntil = 0;
  private relayRestarting = false;
  private crashPending = false;
  private states: ClickState[] = [];
  private outboxIds: number[] = [];
  private counts: WriterTotals = emptyWriterTotals();
  private noteLog: RunEvent[] = [];

  constructor(mode: WriterMode, arrivals: readonly number[], config: Partial<WriterConfig> = {}) {
    this.mode = mode;
    this.arrivals = arrivals;
    this.config = { ...defaultWriterConfig, ...config };
  }

  get ticks(): number {
    return this.tickCount;
  }

  get totals(): WriterTotals {
    return { ...this.counts };
  }

  get notes(): RunEvent[] {
    return this.noteLog.map((note) => ({ ...note }));
  }

  get dbUp(): boolean {
    return this.dbIsUp;
  }

  get brokerUp(): boolean {
    return this.brokerIsUp;
  }

  /** False for the dual write lanes, which have no relay. */
  get hasRelay(): boolean {
    return this.mode === 'outbox';
  }

  get relayUp(): boolean {
    return this.tickCount >= this.relayDownUntil;
  }

  /** Outbox entries not yet marked sent, including any the relay published right before a crash. */
  get outboxLength(): number {
    return this.outboxIds.length;
  }

  get outOfSync(): number {
    return this.counts.lost + this.counts.phantom + this.counts.waiting;
  }

  /** The latest clicks, oldest first. */
  recent(count: number): ClickState[] {
    return this.states.slice(Math.max(0, this.states.length - count));
  }

  apply(command: WriterCommand): void {
    switch (command.type) {
      case 'broker-down':
        this.brokerIsUp = false;
        break;
      case 'broker-up':
        this.brokerIsUp = true;
        break;
      case 'db-down':
        this.dbIsUp = false;
        break;
      case 'db-up':
        this.dbIsUp = true;
        break;
      case 'relay-crash':
        if (this.hasRelay && this.relayUp) this.crashPending = true;
        break;
    }
  }

  step(): WriterTick {
    const tick = this.tickCount;
    const arrived = this.arrivals[tick] ?? 0;
    let newLost = 0;
    let newPhantom = 0;
    for (let index = 0; index < arrived; index += 1) {
      const state = this.writeClick();
      if (state === 'lost') newLost += 1;
      if (state === 'phantom') newPhantom += 1;
      if (state === 'waiting') this.outboxIds.push(this.states.length);
      this.states.push(state);
      this.counts.arrived += 1;
      this.counts[state] += 1;
    }
    const newDuplicates = this.hasRelay ? this.runRelay(tick) : 0;
    this.tickCount += 1;
    return { tick, arrived, newLost, newPhantom, newDuplicates, outOfSync: this.outOfSync };
  }

  private writeClick(): ClickState {
    if (this.mode === 'outbox') return this.dbIsUp ? 'waiting' : 'rejected';
    if (this.mode === 'commit-first') {
      if (!this.dbIsUp) return 'rejected';
      this.publishOnce();
      return this.brokerIsUp ? 'both' : 'lost';
    }
    if (!this.brokerIsUp) return 'rejected';
    this.publishOnce();
    return this.dbIsUp ? 'both' : 'phantom';
  }

  /** Counts the publish only when the broker accepts it. */
  private publishOnce(): void {
    if (this.brokerIsUp) this.counts.published += 1;
  }

  /** Publishes the oldest outbox entries, then marks them sent. Returns copies sent this tick. */
  private runRelay(tick: number): number {
    if (tick < this.relayDownUntil) return 0;
    const canPublish = this.dbIsUp && this.brokerIsUp;
    const batch = canPublish ? this.outboxIds.slice(0, this.config.relayBatch) : [];
    let copies = 0;
    for (const id of batch) {
      this.counts.published += 1;
      if (this.states[id] === 'waiting') {
        this.states[id] = 'both';
        this.counts.waiting -= 1;
        this.counts.both += 1;
      } else {
        copies += 1;
      }
    }
    const sent = batch.length;
    this.counts.duplicates += copies;
    if (this.relayRestarting && canPublish) {
      this.relayRestarting = false;
      this.note(
        tick,
        copies > 0
          ? `Outbox: the relay restarts and publishes the ${copies} events it never marked sent. Analytics receives them twice.`
          : 'Outbox: the relay restarts. It had nothing unmarked, so nothing goes out twice.',
      );
    }
    if (this.crashPending) {
      this.crashPending = false;
      this.relayDownUntil = tick + 1 + this.config.relayRestartTicks;
      this.relayRestarting = true;
      const downFor = (this.config.relayRestartTicks * this.config.tickSeconds).toFixed(1);
      this.note(
        tick,
        sent > 0
          ? `Outbox: the relay publishes ${sent} events, then crashes before marking them sent. It is down for ${downFor} s.`
          : `Outbox: the relay crashes with nothing in flight. It is down for ${downFor} s.`,
      );
      return copies;
    }
    this.outboxIds.splice(0, sent);
    return copies;
  }

  private note(tick: number, text: string): void {
    this.noteLog.push({ tick, text });
  }

  checkpoint(): WriterCheckpoint {
    return {
      tickCount: this.tickCount,
      dbUp: this.dbIsUp,
      brokerUp: this.brokerIsUp,
      relayDownUntil: this.relayDownUntil,
      relayRestarting: this.relayRestarting,
      crashPending: this.crashPending,
      states: [...this.states],
      outbox: [...this.outboxIds],
      totals: { ...this.counts },
      notes: this.notes,
    };
  }

  restore(checkpoint: WriterCheckpoint): void {
    this.tickCount = checkpoint.tickCount;
    this.dbIsUp = checkpoint.dbUp;
    this.brokerIsUp = checkpoint.brokerUp;
    this.relayDownUntil = checkpoint.relayDownUntil;
    this.relayRestarting = checkpoint.relayRestarting;
    this.crashPending = checkpoint.crashPending;
    this.states = [...checkpoint.states];
    this.outboxIds = [...checkpoint.outbox];
    this.counts = { ...checkpoint.totals };
    this.noteLog = checkpoint.notes.map((note) => ({ ...note }));
  }
}

export const OUTBOX_SECONDS = 10;
export const OUTBOX_CLICKS_PER_SECOND = 40;
export const BROKER_DOWN_AT_SECONDS = 2;
export const BROKER_DOWN_SECONDS = 1.5;
export const DB_DOWN_AT_SECONDS = 5.5;
export const DB_DOWN_SECONDS = 1;
export const RELAY_CRASH_AT_SECONDS = 8;

export const dualOrderOptions: Record<DualOrder, { label: string; diff: string }> = {
  'commit-first': { label: 'Commit, then publish', diff: 'Dual write saves the row first' },
  'publish-first': { label: 'Publish, then commit', diff: 'Dual write publishes the event first' },
};

export interface WriterLane {
  mode: WriterMode;
  label: string;
  model: ClickWriter;
  /** Clicks out of sync after each tick. */
  series: number[];
}

export interface DuelEvent extends RunEvent {
  /** False for the wrap up note, which gets no number on the chart. */
  marker: boolean;
}

/** The same clicks and the same faults through a dual write and a transactional outbox. */
export class OutboxDuel {
  readonly length: number;
  readonly tickSeconds = defaultWriterConfig.tickSeconds;
  readonly order: DualOrder;
  readonly lanes: [WriterLane, WriterLane];
  readonly events: DuelEvent[] = [];
  private readonly schedule: ScheduledCommand<WriterCommand>[];
  private readonly scheduleText = new Map<number, string>();
  private outboxBacklogSeen = false;
  private outboxDrained = false;

  constructor(order: DualOrder = 'commit-first', seed = 42) {
    this.order = order;
    this.length = Math.round(OUTBOX_SECONDS / this.tickSeconds);
    const rng = createRng(seed);
    const mean = OUTBOX_CLICKS_PER_SECOND * this.tickSeconds;
    const arrivals = Array.from({ length: this.length }, () => poisson(rng, mean));
    this.lanes = [
      { mode: order, label: 'Dual write', model: new ClickWriter(order, arrivals), series: [] },
      {
        mode: 'outbox',
        label: 'Transactional outbox',
        model: new ClickWriter('outbox', arrivals),
        series: [],
      },
    ];
    const at = (seconds: number) => Math.round(seconds / this.tickSeconds);
    this.schedule = [
      { at: at(BROKER_DOWN_AT_SECONDS), command: { type: 'broker-down' } },
      { at: at(BROKER_DOWN_AT_SECONDS + BROKER_DOWN_SECONDS), command: { type: 'broker-up' } },
      { at: at(DB_DOWN_AT_SECONDS), command: { type: 'db-down' } },
      { at: at(DB_DOWN_AT_SECONDS + DB_DOWN_SECONDS), command: { type: 'db-up' } },
      { at: at(RELAY_CRASH_AT_SECONDS), command: { type: 'relay-crash' } },
    ];
    this.scheduleText.set(at(BROKER_DOWN_AT_SECONDS), `The broker goes down for ${BROKER_DOWN_SECONDS} s.`);
    this.scheduleText.set(at(BROKER_DOWN_AT_SECONDS + BROKER_DOWN_SECONDS), 'The broker is back.');
    this.scheduleText.set(at(DB_DOWN_AT_SECONDS), `The database goes down for ${DB_DOWN_SECONDS} s.`);
    this.scheduleText.set(at(DB_DOWN_AT_SECONDS + DB_DOWN_SECONDS), 'The database is back.');
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
    const scheduled = this.scheduleText.get(tick);
    if (scheduled) this.events.push({ tick, text: scheduled, marker: true });
    const [dual, outbox] = this.lanes;
    const dualNotes = dual.model.notes.length;
    const outboxNotes = outbox.model.notes.length;
    const a = stepScheduled(dual.model, this.schedule);
    const b = stepScheduled(outbox.model, this.schedule);
    dual.series.push(a.outOfSync);
    outbox.series.push(b.outOfSync);
    for (const note of dual.model.notes.slice(dualNotes)) this.events.push({ ...note, marker: true });
    for (const note of outbox.model.notes.slice(outboxNotes)) this.events.push({ ...note, marker: true });

    const dualTotals = dual.model.totals;
    if (a.newLost > 0 && dualTotals.lost === a.newLost) {
      this.events.push({
        tick: tick + 1,
        text: 'Dual write: the first lost event. The row is saved, the publish fails, and analytics never hears about the click.',
        marker: true,
      });
    }
    if (a.newPhantom > 0 && dualTotals.phantom === a.newPhantom) {
      this.events.push({
        tick: tick + 1,
        text: 'Dual write: the first phantom event. Analytics counts a click the database never saved.',
        marker: true,
      });
    }
    const waiting = outbox.model.totals.waiting;
    if (!this.outboxBacklogSeen && waiting > 0 && !outbox.model.brokerUp) {
      this.outboxBacklogSeen = true;
      this.events.push({
        tick: tick + 1,
        text: 'Outbox: the relay cannot publish, so saved clicks wait in the outbox.',
        marker: true,
      });
    }
    if (this.outboxBacklogSeen && !this.outboxDrained && waiting === 0) {
      this.outboxDrained = true;
      this.events.push({
        tick: tick + 1,
        text: 'Outbox: the relay drains the backlog. Every saved click has reached analytics.',
        marker: true,
      });
    }
    if (this.done) this.events.push({ tick: this.ticks, text: this.wrapUp(), marker: false });
  }

  private wrapUp(): string {
    const dual = this.lanes[0].model.totals;
    const outbox = this.lanes[1].model.totals;
    const broken = dual.lost + dual.phantom;
    const dualText =
      broken === 0
        ? 'Dual write: every click in sync.'
        : `Dual write: ${broken} clicks out of sync for good.`;
    const outboxSync =
      outbox.waiting === 0 ? 'none out of sync' : `${outbox.waiting} clicks still waiting in the outbox`;
    return `Run ends. ${dualText} Transactional outbox: ${outboxSync}, ${outbox.duplicates} duplicate events for the consumer to skip.`;
  }
}

/* ------------------------------------------------------------------ */
/* Reading a click: when the consumer commits its offset               */
/* ------------------------------------------------------------------ */

export type AckMode = 'ack-first' | 'ack-after' | 'dedupe';

export type ConsumerCommand = { type: 'crash' };

export interface ConsumerConfig {
  tickSeconds: number;
  clicksPerSecond: number;
  /** Events the consumer takes from the log in one poll. */
  batchSize: number;
  /** Events the consumer reads per tick, counted or skipped. */
  readPerTick: number;
  /** Ticks the consumer stays down after it crashes. */
  restartTicks: number;
  /** Clicks already in the log when the run starts, so the consumer always has a batch in hand. */
  initialBacklog: number;
  seed: number;
}

export const defaultConsumerConfig: ConsumerConfig = {
  tickSeconds: 0.1,
  clicksPerSecond: 40,
  batchSize: 20,
  readPerTick: 6,
  restartTicks: 5,
  initialBacklog: 150,
  seed: 42,
};

export interface ConsumerTotals {
  produced: number;
  /** The analytics count, with every double count included. */
  counted: number;
  /** Clicks counted at least once. */
  unique: number;
  /** Clicks whose offset was committed and that nobody will ever count. */
  lost: number;
  /** Extra counts of clicks already counted. */
  doubleCounted: number;
  /** Rereads the consumer recognized and skipped. */
  skipped: number;
  crashes: number;
}

export interface ConsumerTick {
  tick: number;
  produced: number;
  /** Lost plus double counted, so far. */
  miscounted: number;
}

/** What the log strip shows for one offset. */
export type OffsetState = 'waiting' | 'in-hand' | 'counted' | 'double' | 'lost';

interface ConsumerCheckpoint {
  tickCount: number;
  rngState: number;
  committed: number;
  position: number;
  cursor: number;
  batchEnd: number;
  downUntil: number;
  restarting: boolean;
  timesCounted: number[];
  lostFlags: boolean[];
  totals: ConsumerTotals;
  notes: RunEvent[];
}

/** One consumer counting clicks from a growing log under one offset commit policy. */
export class OffsetConsumer implements ModelAdapter<ConsumerCommand, ConsumerTick, ConsumerCheckpoint> {
  readonly mode: AckMode;
  readonly config: ConsumerConfig;
  private readonly rng: SeededRng;
  private tickCount = 0;
  private committedOffset = 0;
  private position = 0;
  private cursorOffset = 0;
  private batchEndOffset = 0;
  private downUntil = 0;
  private restarting = false;
  private timesCounted: number[] = [];
  private lostFlags: boolean[] = [];
  private counts: ConsumerTotals = {
    produced: 0,
    counted: 0,
    unique: 0,
    lost: 0,
    doubleCounted: 0,
    skipped: 0,
    crashes: 0,
  };
  private noteLog: RunEvent[] = [];

  constructor(mode: AckMode, config: Partial<ConsumerConfig> = {}) {
    this.mode = mode;
    this.config = { ...defaultConsumerConfig, ...config };
    this.rng = createRng(this.config.seed);
    this.timesCounted = new Array(this.config.initialBacklog).fill(0);
    this.lostFlags = new Array(this.config.initialBacklog).fill(false);
    this.counts.produced = this.config.initialBacklog;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get totals(): ConsumerTotals {
    return { ...this.counts };
  }

  get notes(): RunEvent[] {
    return this.noteLog.map((note) => ({ ...note }));
  }

  get up(): boolean {
    return this.tickCount >= this.downUntil;
  }

  /** The offset the consumer resumes from after a crash. */
  get committed(): number {
    return this.committedOffset;
  }

  /** Events in the log the consumer has not taken yet. */
  get lag(): number {
    return this.counts.produced - this.position;
  }

  /** Clicks nobody has counted or lost yet: the rest of the batch in hand plus the lag. */
  get uncounted(): number {
    return this.counts.produced - this.counts.unique - this.counts.lost;
  }

  /** The unprocessed part of the batch in hand, as [from, to). */
  get inHand(): [number, number] {
    return [this.cursorOffset, this.batchEndOffset];
  }

  /** Lost clicks count against the total and double counts add to it. Positive means too high. */
  get countError(): number {
    return this.counts.doubleCounted - this.counts.lost;
  }

  offsetState(offset: number): OffsetState {
    if (this.lostFlags[offset]) return 'lost';
    const times = this.timesCounted[offset] ?? 0;
    if (times > 1) return 'double';
    if (times === 1) return 'counted';
    if (offset >= this.cursorOffset && offset < this.batchEndOffset) return 'in-hand';
    return 'waiting';
  }

  apply(command: ConsumerCommand): void {
    if (command.type !== 'crash' || !this.up) return;
    const tick = this.tickCount;
    this.counts.crashes += 1;
    const remainder = this.batchEndOffset - this.cursorOffset;
    if (this.mode === 'ack-first') {
      for (let offset = this.cursorOffset; offset < this.batchEndOffset; offset += 1) {
        this.lostFlags[offset] = true;
      }
      this.counts.lost += remainder;
      this.note(
        tick,
        remainder > 0
          ? `The consumer crashes with ${remainder} clicks in hand. Their offsets are already committed, so nobody will count them.`
          : 'The consumer crashes between batches. Nothing in hand, so nothing is lost this time.',
      );
    } else {
      const uncommitted = this.cursorOffset - this.committedOffset;
      const fate =
        this.mode === 'dedupe' ? 'It will read them again and skip them.' : 'It will count them again.';
      this.note(
        tick,
        uncommitted > 0
          ? `The consumer crashes after counting ${uncommitted} clicks it has not committed yet. ${fate}`
          : 'The consumer crashes right after a commit. Nothing to reread this time.',
      );
    }
    this.position = this.committedOffset;
    this.cursorOffset = this.committedOffset;
    this.batchEndOffset = this.committedOffset;
    this.downUntil = tick + this.config.restartTicks;
    this.restarting = true;
  }

  step(): ConsumerTick {
    const tick = this.tickCount;
    const arrivals = poisson(this.rng, this.config.clicksPerSecond * this.config.tickSeconds);
    for (let index = 0; index < arrivals; index += 1) {
      this.timesCounted.push(0);
      this.lostFlags.push(false);
    }
    this.counts.produced += arrivals;
    if (tick >= this.downUntil) {
      if (this.restarting) {
        this.restarting = false;
        this.note(tick, `The consumer restarts and resumes from committed offset ${this.committedOffset}.`);
      }
      this.read();
    }
    this.tickCount += 1;
    return { tick, produced: this.counts.produced, miscounted: this.counts.lost + this.counts.doubleCounted };
  }

  private read(): void {
    for (let budget = this.config.readPerTick; budget > 0; budget -= 1) {
      if (this.cursorOffset >= this.batchEndOffset && !this.poll()) return;
      const offset = this.cursorOffset;
      const times = this.timesCounted[offset] ?? 0;
      if (this.mode === 'dedupe' && times > 0) {
        this.counts.skipped += 1;
      } else {
        // The count and the seen click id commit together, which is what makes skipping safe.
        this.timesCounted[offset] = times + 1;
        this.counts.counted += 1;
        if (times === 0) this.counts.unique += 1;
        else this.counts.doubleCounted += 1;
      }
      this.cursorOffset += 1;
      if (this.cursorOffset >= this.batchEndOffset && this.mode !== 'ack-first') {
        this.committedOffset = this.batchEndOffset;
      }
    }
  }

  /** Takes the next batch from the log. At most once commits its offset right here. */
  private poll(): boolean {
    if (this.position >= this.counts.produced) return false;
    this.cursorOffset = this.position;
    this.batchEndOffset = Math.min(this.position + this.config.batchSize, this.counts.produced);
    this.position = this.batchEndOffset;
    if (this.mode === 'ack-first') this.committedOffset = this.batchEndOffset;
    return true;
  }

  private note(tick: number, text: string): void {
    this.noteLog.push({ tick, text });
  }

  checkpoint(): ConsumerCheckpoint {
    return {
      tickCount: this.tickCount,
      rngState: this.rng.getState(),
      committed: this.committedOffset,
      position: this.position,
      cursor: this.cursorOffset,
      batchEnd: this.batchEndOffset,
      downUntil: this.downUntil,
      restarting: this.restarting,
      timesCounted: [...this.timesCounted],
      lostFlags: [...this.lostFlags],
      totals: { ...this.counts },
      notes: this.notes,
    };
  }

  restore(checkpoint: ConsumerCheckpoint): void {
    this.tickCount = checkpoint.tickCount;
    this.rng.setState(checkpoint.rngState);
    this.committedOffset = checkpoint.committed;
    this.position = checkpoint.position;
    this.cursorOffset = checkpoint.cursor;
    this.batchEndOffset = checkpoint.batchEnd;
    this.downUntil = checkpoint.downUntil;
    this.restarting = checkpoint.restarting;
    this.timesCounted = [...checkpoint.timesCounted];
    this.lostFlags = [...checkpoint.lostFlags];
    this.counts = { ...checkpoint.totals };
    this.noteLog = checkpoint.notes.map((note) => ({ ...note }));
  }
}

export const ACK_SECONDS = 10;
export const ACK_CRASH_SECONDS = [3.2, 7.1] as const;

export interface AckScenario {
  id: AckMode;
  label: string;
  diff: string;
}

export const ackScenarios: Record<AckMode, AckScenario> = {
  'ack-first': { id: 'ack-first', label: 'At most once', diff: 'Commit the offset, then count' },
  'ack-after': { id: 'ack-after', label: 'At least once', diff: 'Count, then commit the offset' },
  dedupe: { id: 'dedupe', label: 'Effectively once', diff: 'Count, then commit, skip seen click ids' },
};

/** One consumer policy over a fixed 10 s run with two scheduled crashes. */
export class AckModeRun {
  readonly length: number;
  readonly tickSeconds: number;
  readonly scenario: AckScenario;
  readonly model: OffsetConsumer;
  readonly series: number[] = [];
  private readonly schedule: ScheduledCommand<ConsumerCommand>[];

  constructor(mode: AckMode = 'ack-after', seed = 42) {
    this.scenario = ackScenarios[mode];
    this.model = new OffsetConsumer(mode, { seed });
    this.tickSeconds = this.model.config.tickSeconds;
    this.length = Math.round(ACK_SECONDS / this.tickSeconds);
    this.schedule = ACK_CRASH_SECONDS.map((seconds) => ({
      at: Math.round(seconds / this.tickSeconds),
      command: { type: 'crash' } as const,
    }));
  }

  get ticks(): number {
    return this.model.ticks;
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  get events(): RunEvent[] {
    return this.model.notes;
  }

  apply(command: ConsumerCommand): void {
    if (this.done) return;
    this.model.apply(command);
  }

  step(): void {
    if (this.done) return;
    const tick = stepScheduled(this.model, this.schedule);
    this.series.push(tick.miscounted);
  }
}
