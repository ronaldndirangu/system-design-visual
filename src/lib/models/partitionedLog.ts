import { createRng, hashString, poisson, randomInt } from '../rng';
import type { ModelAdapter, ScheduledCommand } from './adapter';
import { stepScheduled } from './adapter';

/**
 * A toy partitioned log for the URL shortener's click events. The redirect
 * service appends one event per click to a topic split into partitions, and
 * a consumer group of analytics workers reads it. Lesson specific: one
 * topic, one group, eager rebalancing, and offsets saved on a timer.
 */

/** Short codes chosen so that hashing puts exactly two on each of 4 partitions. */
export const SHORT_CODES = ['cat', 'fox', 'elk', 'yak', 'owl', 'ant', 'dog', 'bee'] as const;
export type ShortCode = (typeof SHORT_CODES)[number];
/** The code whose click order the ordering duel draws. */
export const FOCUS_CODE: ShortCode = 'cat';

export type Partitioner = 'key' | 'round-robin';

export function partitionOf(code: string, partitions: number): number {
  return hashString(code) % partitions;
}

export interface ClickEvent {
  code: ShortCode;
  /** Click number for this short code, starting at 1. */
  seq: number;
  partition: number;
  /** Position of the event in its partition, starting at 0. */
  offset: number;
}

export interface LogConfig {
  partitions: number;
  consumers: number;
  maxConsumers: number;
  /** Clicks per second across the whole topic. */
  arrivalRate: number;
  /** Events per second one consumer can process. */
  consumerRate: number;
  partitioner: Partitioner;
  /** How long the whole group stops reading while it reassigns partitions. */
  rebalanceSeconds: number;
  /** How often each consumer saves its read position. */
  commitSeconds: number;
  tickSeconds: number;
  seed: number;
}

export const defaultLogConfig: LogConfig = {
  partitions: 4,
  consumers: 4,
  maxConsumers: 6,
  arrivalRate: 80,
  consumerRate: 50,
  partitioner: 'key',
  rebalanceSeconds: 2,
  commitSeconds: 5,
  tickSeconds: 0.1,
  seed: 42,
};

export type LogCommand =
  | { type: 'crash'; consumer: number }
  | { type: 'join' }
  | { type: 'stall'; consumer: number; seconds: number };

export interface PartitionState {
  id: number;
  events: ClickEvent[];
  /** Next offset the owner will read. */
  position: number;
  /** Saved position. A new owner starts reading here. */
  committed: number;
  /** One past the highest offset ever processed, to spot events read twice. */
  highWater: number;
  owner: number | null;
}

export interface ConsumerState {
  /** Shown to learners as "consumer 1", "consumer 2", and so on. */
  id: number;
  alive: boolean;
  partitions: number[];
  /** Events this consumer has processed, first reads and repeats together. */
  processed: number;
  /** The tick this consumer resumes after a stall. */
  stalledUntil: number;
  credit: number;
  cursor: number;
}

export interface AppliedClick {
  seq: number;
  /** True when a newer click for the same code was already applied. */
  late: boolean;
}

/** A click applied after a newer click for the same code. */
export interface LateClick {
  code: ShortCode;
  seq: number;
  /** The newer click number already applied when this one arrived. */
  newest: number;
}

export interface LogTotals {
  produced: number;
  /** Events processed for the first time. */
  firstReads: number;
  /** Events processed again after a crash rewound a partition. */
  rereads: number;
  /** First reads that arrived after a newer click for the same code. */
  outOfOrder: number;
}

export interface LogTick {
  tick: number;
  produced: number;
  firstReads: number;
  rereads: number;
  outOfOrder: number;
  lag: number;
  rebalancing: boolean;
}

export interface LogNote {
  tick: number;
  text: string;
}

export interface LogCheckpoint {
  ticks: number;
  rng: number;
  parts: PartitionState[];
  members: ConsumerState[];
  rebalanceUntil: number;
  roundRobin: number;
  lastSeq: Record<string, number>;
  newest: Record<string, number>;
  totals: LogTotals;
  focus: AppliedClick[];
  notes: LogNote[];
  firstLate: LateClick | null;
  late: LateClick[];
}

const FOCUS_KEEP = 10;
const LATE_KEEP = 4;

const listNames = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export const partitionLabel = (id: number) => `P${id + 1}`;

export class PartitionedLog implements ModelAdapter<LogCommand, LogTick, LogCheckpoint> {
  readonly config: LogConfig;
  private readonly rng;
  private tickCount = 0;
  private parts: PartitionState[];
  private members: ConsumerState[];
  private rebalanceUntil = -1;
  private roundRobin = 0;
  private lastSeq: Record<string, number> = {};
  private newest: Record<string, number> = {};
  private counts: LogTotals = { produced: 0, firstReads: 0, rereads: 0, outOfOrder: 0 };
  private focus: AppliedClick[] = [];
  private noteLog: LogNote[] = [];
  private lateSample: LateClick | null = null;
  private lateList: LateClick[] = [];

  constructor(config: Partial<LogConfig> = {}) {
    this.config = { ...defaultLogConfig, ...config };
    this.rng = createRng(this.config.seed);
    this.parts = Array.from({ length: this.config.partitions }, (_, id) => ({
      id,
      events: [],
      position: 0,
      committed: 0,
      highWater: 0,
      owner: null,
    }));
    this.members = Array.from({ length: Math.min(this.config.consumers, this.config.maxConsumers) }, (_, i) =>
      newConsumer(i + 1),
    );
    this.assign(false);
  }

  get ticks(): number {
    return this.tickCount;
  }

  get partitions(): readonly PartitionState[] {
    return this.parts;
  }

  get consumers(): readonly ConsumerState[] {
    return this.members;
  }

  get totals(): LogTotals {
    return { ...this.counts };
  }

  /** Events nobody in the group has read yet, summed over partitions. */
  get lag(): number {
    return this.parts.reduce((sum, part) => sum + lagOf(part), 0);
  }

  get rebalancing(): boolean {
    return this.rebalanceUntil >= 0;
  }

  get rebalanceSecondsLeft(): number {
    return this.rebalancing ? (this.rebalanceUntil - this.tickCount) * this.config.tickSeconds : 0;
  }

  /** The last few clicks for FOCUS_CODE, in the order the group applied them. */
  get focusTrail(): readonly AppliedClick[] {
    return this.focus;
  }

  get notes(): readonly LogNote[] {
    return this.noteLog;
  }

  /** The first click the group applied out of order, if any. */
  get firstLate(): LateClick | null {
    return this.lateSample;
  }

  /** The last few clicks applied out of order, oldest first. */
  get recentLate(): readonly LateClick[] {
    return this.lateList;
  }

  get aliveCount(): number {
    return this.members.filter((member) => member.alive).length;
  }

  apply(command: LogCommand): void {
    const tick = this.tickCount;
    if (command.type === 'join') {
      if (this.aliveCount >= this.config.maxConsumers) return;
      const id = Math.max(0, ...this.members.map((member) => member.id)) + 1;
      this.members.push(newConsumer(id));
      this.note(
        tick,
        `Consumer ${id} joins the group. Every consumer stops reading while the group rebalances.`,
      );
      this.startRebalance();
      return;
    }
    const member = this.members.find((candidate) => candidate.id === command.consumer && candidate.alive);
    if (!member) return;
    if (command.type === 'stall') {
      member.stalledUntil = tick + Math.round(command.seconds / this.config.tickSeconds);
      this.note(
        tick,
        `Consumer ${member.id} stalls for ${command.seconds} s, as in a long garbage collection pause.`,
      );
      return;
    }
    member.alive = false;
    const owned = member.partitions.map(partitionLabel);
    const unsaved = member.partitions.reduce((sum, id) => {
      const part = this.parts[id];
      return part ? sum + part.position - part.committed : sum;
    }, 0);
    this.note(
      tick,
      owned.length > 0
        ? `Consumer ${member.id} crashes while reading ${listNames(owned)}. ${unsaved} events it read are not saved yet.`
        : `Consumer ${member.id} crashes. It owned no partition.`,
    );
    this.startRebalance();
  }

  step(): LogTick {
    const tick = this.tickCount;
    const { tickSeconds } = this.config;
    if (this.rebalancing && tick >= this.rebalanceUntil) {
      this.rebalanceUntil = -1;
      this.assign(true);
    }

    const before = { ...this.counts };
    const arrivals = poisson(this.rng, this.config.arrivalRate * tickSeconds);
    for (let i = 0; i < arrivals; i += 1) {
      const code = SHORT_CODES[randomInt(this.rng, 0, SHORT_CODES.length - 1)] ?? 'cat';
      const seq = (this.lastSeq[code] ?? 0) + 1;
      this.lastSeq[code] = seq;
      const partition =
        this.config.partitioner === 'key'
          ? partitionOf(code, this.config.partitions)
          : this.roundRobin++ % this.config.partitions;
      const part = this.parts[partition];
      if (!part) continue;
      part.events.push({ code, seq, partition, offset: part.events.length });
      this.counts.produced += 1;
    }

    if (!this.rebalancing) this.consume(tick);

    const commitTicks = Math.max(1, Math.round(this.config.commitSeconds / tickSeconds));
    if ((tick + 1) % commitTicks === 0) {
      for (const member of this.members) {
        if (!member.alive || tick < member.stalledUntil) continue;
        for (const id of member.partitions) {
          const part = this.parts[id];
          if (part) part.committed = part.position;
        }
      }
    }

    for (const member of this.members) {
      if (member.alive && member.stalledUntil === tick + 1) {
        this.note(tick + 1, `Consumer ${member.id} resumes and works through what piled up.`);
      }
    }

    this.tickCount += 1;
    return {
      tick,
      produced: this.counts.produced - before.produced,
      firstReads: this.counts.firstReads - before.firstReads,
      rereads: this.counts.rereads - before.rereads,
      outOfOrder: this.counts.outOfOrder - before.outOfOrder,
      lag: this.lag,
      rebalancing: this.rebalancing,
    };
  }

  checkpoint(): LogCheckpoint {
    return {
      ticks: this.tickCount,
      rng: this.rng.getState(),
      parts: this.parts.map((part) => ({ ...part, events: [...part.events] })),
      members: this.members.map((member) => ({ ...member, partitions: [...member.partitions] })),
      rebalanceUntil: this.rebalanceUntil,
      roundRobin: this.roundRobin,
      lastSeq: { ...this.lastSeq },
      newest: { ...this.newest },
      totals: { ...this.counts },
      focus: this.focus.map((click) => ({ ...click })),
      notes: this.noteLog.map((note) => ({ ...note })),
      firstLate: this.lateSample ? { ...this.lateSample } : null,
      late: this.lateList.map((click) => ({ ...click })),
    };
  }

  restore(checkpoint: LogCheckpoint): void {
    this.tickCount = checkpoint.ticks;
    this.rng.setState(checkpoint.rng);
    this.parts = checkpoint.parts.map((part) => ({ ...part, events: [...part.events] }));
    this.members = checkpoint.members.map((member) => ({ ...member, partitions: [...member.partitions] }));
    this.rebalanceUntil = checkpoint.rebalanceUntil;
    this.roundRobin = checkpoint.roundRobin;
    this.lastSeq = { ...checkpoint.lastSeq };
    this.newest = { ...checkpoint.newest };
    this.counts = { ...checkpoint.totals };
    this.focus = checkpoint.focus.map((click) => ({ ...click }));
    this.noteLog = checkpoint.notes.map((note) => ({ ...note }));
    this.lateSample = checkpoint.firstLate ? { ...checkpoint.firstLate } : null;
    this.lateList = checkpoint.late.map((click) => ({ ...click }));
  }

  private note(tick: number, text: string): void {
    this.noteLog.push({ tick, text });
  }

  /**
   * Eager rebalancing: healthy consumers save their positions and give up
   * every partition. A crashed consumer saves nothing, so its partitions
   * rewind to their last saved position.
   */
  private startRebalance(): void {
    for (const part of this.parts) {
      const owner = this.members.find((member) => member.id === part.owner);
      if (owner?.alive) part.committed = part.position;
      else part.position = part.committed;
      part.owner = null;
    }
    for (const member of this.members) member.partitions = [];
    this.rebalanceUntil = this.tickCount + Math.round(this.config.rebalanceSeconds / this.config.tickSeconds);
  }

  /** Hands partition p to the (p mod n)th live consumer, in id order. */
  private assign(announce: boolean): void {
    const live = this.members.filter((member) => member.alive);
    for (const member of this.members) {
      member.partitions = [];
      member.cursor = 0;
    }
    for (const part of this.parts) {
      const owner = live.length > 0 ? live[part.id % live.length] : undefined;
      part.owner = owner?.id ?? null;
      owner?.partitions.push(part.id);
    }
    if (!announce) return;
    if (live.length === 0) {
      this.note(this.tickCount, 'Rebalance done, but no consumer is left. Every partition waits.');
      return;
    }
    const busy = live.filter((member) => member.partitions.length > 0);
    const idle = live.filter((member) => member.partitions.length === 0);
    const owners = busy.map(
      (member) => `consumer ${member.id} reads ${listNames(member.partitions.map(partitionLabel))}`,
    );
    const idleText =
      idle.length > 0
        ? ` ${idle.length === 1 ? 'Consumer' : 'Consumers'} ${listNames(idle.map((member) => String(member.id)))} ${idle.length === 1 ? 'gets' : 'get'} no partition and ${idle.length === 1 ? 'sits' : 'sit'} idle.`
        : '';
    this.note(this.tickCount, `Rebalance done: ${listNames(owners)}.${idleText}`);
  }

  /**
   * Each running consumer takes its share of events, one partition at a time
   * in turn. Consumers run in parallel, so their batches interleave.
   */
  private consume(tick: number): void {
    const batches: ClickEvent[][] = [];
    for (const member of this.members) {
      if (!member.alive || tick < member.stalledUntil || member.partitions.length === 0) continue;
      const budget = member.credit + this.config.consumerRate * this.config.tickSeconds;
      const batch: ClickEvent[] = [];
      let idleTurns = 0;
      while (batch.length < Math.floor(budget) && idleTurns < member.partitions.length) {
        const id = member.partitions[member.cursor % member.partitions.length] ?? 0;
        member.cursor += 1;
        const part = this.parts[id];
        const event = part?.events[part.position];
        if (!part || !event) {
          idleTurns += 1;
          continue;
        }
        idleTurns = 0;
        part.position += 1;
        batch.push(event);
      }
      member.credit = Math.min(1, budget - batch.length);
      member.processed += batch.length;
      batches.push(batch);
    }
    const longest = Math.max(0, ...batches.map((batch) => batch.length));
    for (let i = 0; i < longest; i += 1) {
      for (const batch of batches) {
        const event = batch[i];
        if (event) this.applyEvent(event);
      }
    }
  }

  private applyEvent(event: ClickEvent): void {
    const part = this.parts[event.partition];
    if (!part) return;
    if (event.offset < part.highWater) {
      this.counts.rereads += 1;
      return;
    }
    part.highWater = event.offset + 1;
    this.counts.firstReads += 1;
    const newest = this.newest[event.code] ?? 0;
    const late = event.seq < newest;
    if (late) {
      this.counts.outOfOrder += 1;
      const click = { code: event.code, seq: event.seq, newest };
      this.lateSample ??= click;
      this.lateList.push(click);
      if (this.lateList.length > LATE_KEEP) this.lateList.shift();
    } else {
      this.newest[event.code] = event.seq;
    }
    if (event.code === FOCUS_CODE) {
      this.focus.push({ seq: event.seq, late });
      if (this.focus.length > FOCUS_KEEP) this.focus.shift();
    }
  }
}

function newConsumer(id: number): ConsumerState {
  return { id, alive: true, partitions: [], processed: 0, stalledUntil: 0, credit: 0, cursor: 0 };
}

export function lagOf(part: PartitionState): number {
  return part.events.length - part.position;
}

/* A consumer group run: one log, a scenario, and a fixed length. */

export type GroupScenarioId = 'one' | 'four' | 'crash' | 'six';

export interface GroupScenario {
  id: GroupScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  consumers: number;
  schedule: ScheduledCommand<LogCommand>[];
}

export const GROUP_SECONDS = 20;
export const CRASH_AT_SECONDS = 8;

export const groupScenarios: Record<GroupScenarioId, GroupScenario> = {
  one: {
    id: 'one',
    label: 'One consumer',
    diff: 'Baseline: 1 consumer reads all 4 partitions at up to 50 events/s. Clicks arrive at about 80/s.',
    consumers: 1,
    schedule: [],
  },
  four: {
    id: 'four',
    label: 'Four consumers',
    diff: 'Consumers: 1 to 4, one per partition. Each partition gets about 20 clicks/s.',
    consumers: 4,
    schedule: [],
  },
  crash: {
    id: 'crash',
    label: 'A consumer crashes',
    diff: `Consumers: 4. Consumer 2 crashes at ${CRASH_AT_SECONDS} s. Positions are saved every 5 s.`,
    consumers: 4,
    schedule: [{ at: CRASH_AT_SECONDS * 10, command: { type: 'crash', consumer: 2 } }],
  },
  six: {
    id: 'six',
    label: 'Six consumers',
    diff: 'Consumers: 1 to 6, for the same 4 partitions.',
    consumers: 6,
    schedule: [],
  },
};

export interface RunEvent {
  tick: number;
  text: string;
}

export class GroupRun {
  readonly scenario: GroupScenario;
  readonly log: PartitionedLog;
  readonly length: number;
  readonly tickSeconds: number;
  /** Total lag after each tick. */
  readonly series: number[] = [];
  peakLag = 0;

  constructor(scenario: GroupScenario, seed = 42) {
    this.scenario = scenario;
    this.log = new PartitionedLog({ consumers: scenario.consumers, seed });
    this.tickSeconds = this.log.config.tickSeconds;
    this.length = Math.round(GROUP_SECONDS / this.tickSeconds);
  }

  get ticks(): number {
    return this.log.ticks;
  }

  get done(): boolean {
    return this.log.ticks >= this.length;
  }

  get events(): readonly RunEvent[] {
    return this.log.notes;
  }

  /** Learner commands land before the next tick, like scheduled ones. */
  apply(command: LogCommand): void {
    if (!this.done) this.log.apply(command);
  }

  step(): void {
    if (this.done) return;
    const tick = stepScheduled(this.log, this.scenario.schedule);
    this.series.push(tick.lag);
    this.peakLag = Math.max(this.peakLag, tick.lag);
  }
}

/* The ordering duel: the same clicks, keyed by short code or spread round robin. */

export const ORDER_SECONDS = 10;
export const STALL_AT_SECONDS = 3;
export const STALL_SECONDS = 1.5;

export const partitionerLabels: Record<Partitioner, string> = {
  key: 'Keyed by short code',
  'round-robin': 'Round robin',
};

export interface OrderLane {
  partitioner: Partitioner;
  label: string;
  log: PartitionedLog;
  /** Out of order clicks so far, after each tick. */
  series: number[];
}

export interface OrderEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export class OrderingDuel {
  readonly length: number;
  readonly tickSeconds: number;
  readonly lanes: [OrderLane, OrderLane];
  readonly events: OrderEvent[] = [];
  private readonly schedule: ScheduledCommand<LogCommand>[];

  constructor(seed = 42) {
    this.tickSeconds = defaultLogConfig.tickSeconds;
    this.length = Math.round(ORDER_SECONDS / this.tickSeconds);
    this.schedule = [
      {
        at: Math.round(STALL_AT_SECONDS / this.tickSeconds),
        command: { type: 'stall', consumer: 2, seconds: STALL_SECONDS },
      },
    ];
    const lane = (partitioner: Partitioner): OrderLane => ({
      partitioner,
      label: partitionerLabels[partitioner],
      log: new PartitionedLog({ partitioner, seed }),
      series: [],
    });
    this.lanes = [lane('key'), lane('round-robin')];
  }

  get ticks(): number {
    return this.lanes[0].log.ticks;
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.ticks;
    for (const entry of this.schedule) {
      if (entry.at === tick && entry.command.type === 'stall') {
        this.events.push({
          tick,
          text: `Consumer 2 stalls for ${entry.command.seconds} s in both setups, as in a long garbage collection pause.`,
          marker: true,
        });
      }
    }
    for (const lane of this.lanes) {
      const hadLate = lane.log.firstLate !== null;
      stepScheduled(lane.log, this.schedule);
      lane.series.push(lane.log.totals.outOfOrder);
      const first = lane.log.firstLate;
      if (!hadLate && first) {
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: click ${first.seq} for /${first.code} lands after click ${first.newest} was already counted.`,
          marker: true,
        });
      }
    }
    const [keyed, spread] = this.lanes;
    const stallEnd = Math.round((STALL_AT_SECONDS + STALL_SECONDS) / this.tickSeconds);
    if (tick + 1 === stallEnd) {
      this.events.push({
        tick: tick + 1,
        text: `Consumer 2 resumes. Out of order so far: ${keyed.label.toLowerCase()} ${keyed.log.totals.outOfOrder}, ${spread.label.toLowerCase()} ${spread.log.totals.outOfOrder}.`,
        marker: true,
      });
    }
    if (this.done) {
      this.events.push({
        tick: this.ticks,
        text: `Run ends. Clicks counted out of order: ${keyed.label.toLowerCase()} ${keyed.log.totals.outOfOrder}, ${spread.label.toLowerCase()} ${spread.log.totals.outOfOrder}, out of ${spread.log.totals.produced} clicks.`,
        marker: false,
      });
    }
  }
}
