/**
 * Lesson-specific toy models for stream processing.
 *
 * Every click carries two times: the event time, when the redirect server
 * handled the click and stamped it, and
 * the processing time, when the stream job reads the click. ClockCounter reads
 * one partition of clicks and counts them in 2 s tumbling windows by one of
 * those clocks. ClockDuel runs both clocks on the same clicks and the same
 * consumer reads, so the two lanes differ only in which time they count by.
 *
 * WatermarkCounter counts by event time and publishes a window once its
 * watermark, the newest event time it has seen minus a fixed wait, passes the
 * window end. A click whose window already has a result is late, and a policy
 * decides whether to drop it, add it in a correction, or set it aside for a
 * batch job. WatermarkDuel runs a short wait and a long wait on the same clicks.
 *
 * windowShapes counts one set of clicks in tumbling and in sliding windows.
 *
 * Every number these models produce is illustrative. None of them describes a
 * real stream processing engine.
 */
import { createRng, poisson, randomInt } from '../rng';
import type { ModelAdapter, ScheduledCommand } from './adapter';
import { stepScheduled } from './adapter';
import type { DuelEvent } from './deliveryOutbox';

export const STREAM_TICK_SECONDS = 0.1;
export const STREAM_SECONDS = 20;
export const STREAM_TICKS = Math.round(STREAM_SECONDS / STREAM_TICK_SECONDS);
export const STREAM_CLICKS_PER_SECOND = 20;
export const WINDOW_SECONDS = 2;
export const WINDOW_COUNT = Math.round(STREAM_SECONDS / WINDOW_SECONDS);
export const TICKS_PER_WINDOW = Math.round(WINDOW_SECONDS / STREAM_TICK_SECONDS);
/** A window above this count fires a spike alert: 1.5 times the normal 40 clicks. */
export const SPIKE_ALERT = 60;
/** Clicks the consumer can read per tick, five times the normal arrival rate. */
export const CONSUMER_CAPACITY = 10;

export function windowOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_WINDOW);
}

/** The first tick after a window, which is also the next window's first tick. */
export function windowEnd(window: number): number {
  return (window + 1) * TICKS_PER_WINDOW;
}

/** "4 to 6 s" for window 2. */
export function windowName(window: number): string {
  return `${window * WINDOW_SECONDS} to ${(window + 1) * WINDOW_SECONDS} s`;
}

export interface StreamClick {
  id: number;
  /** The tick the redirect server handled the click: the event time. */
  eventTick: number;
  /** The tick the click reaches the topic. */
  arriveTick: number;
  /** An edge region buffered this click while its link to the topic was down. */
  held: boolean;
  /** The first send of this click failed, and a retry delivered it late. */
  slow: boolean;
}

/** A reconnected edge region sends its buffered clicks over this many ticks. */
export const RECONNECT_SPREAD_TICKS = 5;

export interface EdgeOutage {
  /** Share of all clicks that the cut-off edge region serves. */
  share: number;
  fromSeconds: number;
  /** The region reconnects and sends what it buffered, over the next 0.4 s. */
  untilSeconds: number;
}

export interface ClickOptions {
  /** Share of clicks whose first send fails, so a retry delivers them 0.5 to 2.5 s late. */
  slowShare?: number;
  outage?: EdgeOutage;
}

/**
 * About 20 clicks per second for 20 s. The redirect server stamps each click
 * with its event time, and most clicks reach the topic within 0.3 s.
 * Every click draws the same random numbers whatever the options, so two
 * scenarios with one seed differ only in what their options change.
 */
export function makeClicks(seed: number, options: ClickOptions = {}): StreamClick[] {
  const rng = createRng(seed);
  const mean = STREAM_CLICKS_PER_SECOND * STREAM_TICK_SECONDS;
  const slowShare = options.slowShare ?? 0;
  const outage = options.outage;
  const from = outage ? Math.round(outage.fromSeconds / STREAM_TICK_SECONDS) : 0;
  const until = outage ? Math.round(outage.untilSeconds / STREAM_TICK_SECONDS) : 0;
  const clicks: StreamClick[] = [];
  for (let tick = 0; tick < STREAM_TICKS; tick += 1) {
    const count = poisson(rng, mean);
    for (let index = 0; index < count; index += 1) {
      const network = randomInt(rng, 0, 3);
      const slowRoll = rng();
      const slowDelay = randomInt(rng, 5, 25);
      const heldRoll = rng();
      const reconnect = randomInt(rng, 0, RECONNECT_SPREAD_TICKS - 1);
      const held = outage !== undefined && tick >= from && tick < until && heldRoll < outage.share;
      const slow = !held && slowRoll < slowShare;
      const arriveTick = held ? until + reconnect : tick + (slow ? slowDelay : network);
      clicks.push({ id: clicks.length, eventTick: tick, arriveTick, held, slow });
    }
  }
  return clicks;
}

/** Clicks in the order they reach the topic, which is the order a consumer reads them. */
export function arrivalOrder(clicks: readonly StreamClick[]): StreamClick[] {
  return [...clicks].sort((a, b) => a.arriveTick - b.arriveTick || a.id - b.id);
}

/* ------------------------------------------------------------------ */
/* Processing time versus event time                                   */
/* ------------------------------------------------------------------ */

export type Clock = 'processing' | 'event';
export type ConsumerCommand = { type: 'stop' } | { type: 'start' };

export interface ClockTotals {
  /** Clicks people have made so far. */
  happened: number;
  /** Clicks that reached the topic. */
  arrived: number;
  read: number;
  /** In the topic and not read yet. */
  waiting: number;
  /** Handled by a redirect server, but buffered at the edge or waiting for a retry. */
  onTheWay: number;
  /** Counted in a window other than the one the click happened in. */
  wrongWindow: number;
  /** Counted in its own window after that window ended. */
  afterEnd: number;
  /** Spike alerts fired. */
  alerts: number;
}

export interface ClockTick {
  tick: number;
  read: number;
  waiting: number;
  /** The largest gap between a window's count and the clicks that happened in it. */
  worstGap: number;
  /** The window that crossed the spike alert this tick, if any. */
  alertWindow: number | null;
}

export interface ClockCheckpoint {
  tickCount: number;
  up: boolean;
  nextHappen: number;
  nextArrive: number;
  nextRead: number;
  counts: number[];
  afterEnd: number[];
  truth: number[];
  alerted: boolean[];
  totals: ClockTotals;
}

function emptyClockTotals(): ClockTotals {
  return {
    happened: 0,
    arrived: 0,
    read: 0,
    waiting: 0,
    onTheWay: 0,
    wrongWindow: 0,
    afterEnd: 0,
    alerts: 0,
  };
}

const zeros = () => Array.from({ length: WINDOW_COUNT }, () => 0);

function bump(list: number[], index: number, by = 1): void {
  list[index] = (list[index] ?? 0) + by;
}

/** One stream job reading the topic in order and counting clicks per 2 s window by one clock. */
export class ClockCounter implements ModelAdapter<ConsumerCommand, ClockTick, ClockCheckpoint> {
  readonly clock: Clock;
  private readonly clicks: readonly StreamClick[];
  private readonly order: readonly StreamClick[];
  private tickCount = 0;
  private up = true;
  private nextHappen = 0;
  private nextArrive = 0;
  private nextRead = 0;
  private countList = zeros();
  private afterEndList = zeros();
  private truthList = zeros();
  private alerted: boolean[] = zeros().map(() => false);
  private counts: ClockTotals = emptyClockTotals();

  constructor(clock: Clock, clicks: readonly StreamClick[]) {
    this.clock = clock;
    this.clicks = clicks;
    this.order = arrivalOrder(clicks);
  }

  get ticks(): number {
    return this.tickCount;
  }

  get totals(): ClockTotals {
    return { ...this.counts };
  }

  get reading(): boolean {
    return this.up;
  }

  /** Clicks counted in each window by this job's clock. */
  get windowCounts(): number[] {
    return [...this.countList];
  }

  /** Clicks counted in each window after the window ended. Always zero for processing time. */
  get afterEndCounts(): number[] {
    return [...this.afterEndList];
  }

  /** Clicks that happened in each window so far, whether or not they arrived. */
  get truth(): number[] {
    return [...this.truthList];
  }

  /** Clicks the cut-off edge region is buffering right now. */
  get heldNow(): number {
    let held = 0;
    for (let id = 0; id < this.nextHappen; id += 1) {
      const click = this.clicks[id];
      if (click?.held && click.arriveTick >= this.tickCount) held += 1;
    }
    return held;
  }

  get worstGap(): number {
    return this.countList.reduce(
      (worst, count, index) => Math.max(worst, Math.abs(count - (this.truthList[index] ?? 0))),
      0,
    );
  }

  apply(command: ConsumerCommand): void {
    this.up = command.type === 'start';
  }

  step(): ClockTick {
    const tick = this.tickCount;
    for (let click = this.clicks[this.nextHappen]; click && click.eventTick <= tick; ) {
      bump(this.truthList, windowOf(click.eventTick));
      this.nextHappen += 1;
      click = this.clicks[this.nextHappen];
    }
    for (let click = this.order[this.nextArrive]; click && click.arriveTick <= tick; ) {
      this.nextArrive += 1;
      click = this.order[this.nextArrive];
    }
    let read = 0;
    let alertWindow: number | null = null;
    while (this.up && read < CONSUMER_CAPACITY && this.nextRead < this.nextArrive) {
      const click = this.order[this.nextRead];
      if (!click) break;
      this.nextRead += 1;
      read += 1;
      const home = windowOf(click.eventTick);
      const target = this.clock === 'processing' ? windowOf(tick) : home;
      bump(this.countList, target);
      if (target !== home) this.counts.wrongWindow += 1;
      if (this.clock === 'event' && tick >= windowEnd(home)) {
        bump(this.afterEndList, home);
        this.counts.afterEnd += 1;
      }
      if ((this.countList[target] ?? 0) > SPIKE_ALERT && !this.alerted[target]) {
        this.alerted[target] = true;
        this.counts.alerts += 1;
        alertWindow = target;
      }
    }
    this.tickCount += 1;
    this.counts.happened = this.nextHappen;
    this.counts.arrived = this.nextArrive;
    this.counts.read = this.nextRead;
    this.counts.waiting = this.nextArrive - this.nextRead;
    this.counts.onTheWay = this.nextHappen - this.nextArrive;
    return { tick, read, waiting: this.counts.waiting, worstGap: this.worstGap, alertWindow };
  }

  checkpoint(): ClockCheckpoint {
    return {
      tickCount: this.tickCount,
      up: this.up,
      nextHappen: this.nextHappen,
      nextArrive: this.nextArrive,
      nextRead: this.nextRead,
      counts: [...this.countList],
      afterEnd: [...this.afterEndList],
      truth: [...this.truthList],
      alerted: [...this.alerted],
      totals: { ...this.counts },
    };
  }

  restore(checkpoint: ClockCheckpoint): void {
    this.tickCount = checkpoint.tickCount;
    this.up = checkpoint.up;
    this.nextHappen = checkpoint.nextHappen;
    this.nextArrive = checkpoint.nextArrive;
    this.nextRead = checkpoint.nextRead;
    this.countList = [...checkpoint.counts];
    this.afterEndList = [...checkpoint.afterEnd];
    this.truthList = [...checkpoint.truth];
    this.alerted = [...checkpoint.alerted];
    this.counts = { ...checkpoint.totals };
  }
}

export type ClockScenario = 'restart' | 'outage' | 'steady';

export const RESTART = { stopSeconds: 5, startSeconds: 9 } as const;
export const OUTAGE: EdgeOutage = { share: 0.4, fromSeconds: 4, untilSeconds: 10 };

export const clockScenarios: Record<ClockScenario, { label: string; diff: string }> = {
  restart: {
    label: 'Consumer restart',
    diff: `The stream job stops at ${RESTART.stopSeconds} s for a deploy and starts again at ${RESTART.startSeconds} s`,
  },
  outage: {
    label: 'Edge region cut off',
    diff: `The region serving ${OUTAGE.share * 100}% of clicks loses its link to the topic from ${OUTAGE.fromSeconds} to ${OUTAGE.untilSeconds} s and buffers them`,
  },
  steady: {
    label: 'Steady traffic',
    diff: 'Every click reaches the topic within 0.3 s, and the job never stops',
  },
};

export interface ClockLane {
  clock: Clock;
  label: string;
  model: ClockCounter;
  /** The worst window gap after each tick. */
  series: number[];
}

/** The same clicks and the same consumer reads, counted by processing time and by event time. */
export class ClockDuel {
  readonly length = STREAM_TICKS;
  readonly tickSeconds = STREAM_TICK_SECONDS;
  readonly scenario: ClockScenario;
  readonly lanes: [ClockLane, ClockLane];
  readonly events: DuelEvent[] = [];
  private readonly schedule: ScheduledCommand<ConsumerCommand>[];
  private caughtUpNoted = false;

  constructor(scenario: ClockScenario = 'restart', seed = 7) {
    this.scenario = scenario;
    const clicks = makeClicks(seed, scenario === 'outage' ? { outage: OUTAGE } : {});
    this.lanes = [
      {
        clock: 'processing',
        label: 'Processing time',
        model: new ClockCounter('processing', clicks),
        series: [],
      },
      { clock: 'event', label: 'Event time', model: new ClockCounter('event', clicks), series: [] },
    ];
    const at = (seconds: number) => Math.round(seconds / this.tickSeconds);
    this.schedule =
      scenario === 'restart'
        ? [
            { at: at(RESTART.stopSeconds), command: { type: 'stop' } },
            { at: at(RESTART.startSeconds), command: { type: 'start' } },
          ]
        : [];
  }

  get ticks(): number {
    return this.lanes[0].model.ticks;
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  /** Clicks that happened in each window so far. Both lanes see the same clicks. */
  get truth(): number[] {
    return this.lanes[0].model.truth;
  }

  step(): void {
    if (this.done) return;
    const tick = this.ticks;
    const [processing, event] = this.lanes;
    const waitingBefore = processing.model.totals.waiting;
    const heldBefore = processing.model.heldNow;
    const a = stepScheduled(processing.model, this.schedule);
    const b = stepScheduled(event.model, this.schedule);
    processing.series.push(a.worstGap);
    event.series.push(b.worstGap);

    if (this.scenario === 'restart') {
      if (tick === Math.round(RESTART.stopSeconds / this.tickSeconds)) {
        this.events.push({
          tick,
          text: 'The stream job stops for a deploy. New clicks keep reaching the topic and wait there.',
          marker: true,
        });
      }
      if (tick === Math.round(RESTART.startSeconds / this.tickSeconds)) {
        this.events.push({
          tick,
          text: `The job starts again with ${waitingBefore} clicks waiting and reads up to ${CONSUMER_CAPACITY} every ${this.tickSeconds} s.`,
          marker: true,
        });
      }
      const restartTick = Math.round(RESTART.startSeconds / this.tickSeconds);
      if (!this.caughtUpNoted && tick > restartTick && a.waiting < CONSUMER_CAPACITY) {
        this.caughtUpNoted = true;
        this.events.push({ tick, text: 'The job catches up with the topic.', marker: true });
      }
    }
    if (this.scenario === 'outage' && tick === Math.round(OUTAGE.untilSeconds / this.tickSeconds)) {
      this.events.push({
        tick,
        text: `The edge region reconnects and sends the ${heldBefore} clicks it buffered since ${OUTAGE.fromSeconds} s.`,
        marker: true,
      });
    }
    if (a.alertWindow !== null) {
      const happened = processing.model.truth[a.alertWindow] ?? 0;
      const counted = processing.model.windowCounts[a.alertWindow] ?? 0;
      this.events.push({
        tick,
        text: `Processing time fires a spike alert: it has counted ${counted} clicks in ${windowName(a.alertWindow)}, where only ${happened} have happened so far.`,
        marker: true,
      });
    }
    if (b.alertWindow !== null) {
      this.events.push({
        tick,
        text: `Event time fires a spike alert for ${windowName(b.alertWindow)}.`,
        marker: true,
      });
    }

    if (this.done) {
      const p = processing.model.totals;
      const e = event.model.totals;
      this.events.push({
        tick: this.length,
        text: `Run ends. Processing time counted ${p.wrongWindow} clicks in the wrong window and fired ${p.alerts} spike ${p.alerts === 1 ? 'alert' : 'alerts'}. Event time put every click it read in the window it happened in, and ${e.afterEnd} of them reached their window after it ended.`,
        marker: false,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Watermarks and late clicks                                          */
/* ------------------------------------------------------------------ */

export type LatePolicy = 'drop' | 'update' | 'side';
export const ALLOWED_LATENESS_SECONDS = 10;
/** One click in ten needs a retry to reach the topic. */
export const SLOW_SHARE = 0.1;

export interface WatermarkConfig {
  /** Ticks the watermark trails the newest event time seen. */
  waitTicks: number;
  policy: LatePolicy;
  /** For 'update': ticks of watermark past a window end during which late clicks still count. */
  allowedTicks: number;
}

export interface WindowResult {
  /** Clicks counted before the window's first result. */
  ontime: number;
  /** Late clicks added to the result after it was published. */
  corrected: number;
  /** Late clicks thrown away. */
  dropped: number;
  /** Late clicks written to the side table. */
  side: number;
  /** The tick of the first result, or null while the window is open. */
  publishedAt: number | null;
  /** The tick the job forgot the window, or null while it still holds it. */
  forgottenAt: number | null;
}

export interface WatermarkTotals {
  happened: number;
  read: number;
  onTheWay: number;
  ontime: number;
  /** Clicks that arrived after their window was published. */
  late: number;
  corrected: number;
  dropped: number;
  side: number;
  published: number;
  /** Updated results sent downstream: one per window per tick it changed. */
  corrections: number;
}

export interface WatermarkTick {
  tick: number;
  late: number;
  /** Windows published this tick. */
  published: number[];
}

export interface WatermarkCheckpoint {
  tickCount: number;
  nextHappen: number;
  nextArrive: number;
  maxEvent: number;
  truth: number[];
  windows: WindowResult[];
  totals: WatermarkTotals;
}

function emptyWindow(): WindowResult {
  return { ontime: 0, corrected: 0, dropped: 0, side: 0, publishedAt: null, forgottenAt: null };
}

function emptyWatermarkTotals(): WatermarkTotals {
  return {
    happened: 0,
    read: 0,
    onTheWay: 0,
    ontime: 0,
    late: 0,
    corrected: 0,
    dropped: 0,
    side: 0,
    published: 0,
    corrections: 0,
  };
}

/**
 * A stream job that counts by event time and publishes each window once the
 * watermark passes its end. It reads every click the tick it reaches the topic.
 */
export class WatermarkCounter {
  readonly config: WatermarkConfig;
  private readonly clicks: readonly StreamClick[];
  private readonly order: readonly StreamClick[];
  private tickCount = 0;
  private nextHappen = 0;
  private nextArrive = 0;
  private maxEvent = -1;
  private truthList = zeros();
  private windowList: WindowResult[] = zeros().map(emptyWindow);
  private counts: WatermarkTotals = emptyWatermarkTotals();

  constructor(clicks: readonly StreamClick[], config: WatermarkConfig) {
    this.clicks = clicks;
    this.order = arrivalOrder(clicks);
    this.config = config;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get totals(): WatermarkTotals {
    return { ...this.counts };
  }

  get truth(): number[] {
    return [...this.truthList];
  }

  get windows(): WindowResult[] {
    return this.windowList.map((window) => ({ ...window }));
  }

  /** The newest event time seen minus the wait, in ticks. Null before the first click. */
  get watermark(): number | null {
    return this.maxEvent < 0 ? null : this.maxEvent - this.config.waitTicks;
  }

  /** Windows the job keeps in memory: started, and not yet forgotten. */
  get held(): number {
    if (this.maxEvent < 0) return 0;
    const newest = windowOf(this.maxEvent);
    return this.windowList.filter((window, index) => index <= newest && window.forgottenAt === null).length;
  }

  /** Clicks inside first results already sent downstream. Open windows do not count yet. */
  get firstResultClicks(): number {
    return this.windowList.reduce((total, window) => total + (window.publishedAt === null ? 0 : window.ontime), 0);
  }

  /** Mean seconds from a window's end to its first result, over published windows. */
  get meanPublishDelay(): number | null {
    const delays = this.windowList.flatMap((window, index) =>
      window.publishedAt === null ? [] : [window.publishedAt - windowEnd(index)],
    );
    if (delays.length === 0) return null;
    return (delays.reduce((sum, delay) => sum + delay, 0) / delays.length) * STREAM_TICK_SECONDS;
  }

  step(): WatermarkTick {
    const tick = this.tickCount;
    for (let click = this.clicks[this.nextHappen]; click && click.eventTick <= tick; ) {
      bump(this.truthList, windowOf(click.eventTick));
      this.nextHappen += 1;
      click = this.clicks[this.nextHappen];
    }
    let late = 0;
    const touched = new Set<number>();
    for (let click = this.order[this.nextArrive]; click && click.arriveTick <= tick; ) {
      const index = windowOf(click.eventTick);
      const window = this.windowList[index];
      if (window) {
        if (window.publishedAt === null) {
          window.ontime += 1;
          this.counts.ontime += 1;
        } else {
          late += 1;
          this.counts.late += 1;
          if (this.config.policy === 'update' && window.forgottenAt === null) {
            window.corrected += 1;
            this.counts.corrected += 1;
            touched.add(index);
          } else if (this.config.policy === 'side') {
            window.side += 1;
            this.counts.side += 1;
          } else {
            window.dropped += 1;
            this.counts.dropped += 1;
          }
        }
      }
      this.maxEvent = Math.max(this.maxEvent, click.eventTick);
      this.nextArrive += 1;
      click = this.order[this.nextArrive];
    }
    this.counts.corrections += touched.size;

    const published: number[] = [];
    const watermark = this.watermark;
    if (watermark !== null) {
      this.windowList.forEach((window, index) => {
        const end = windowEnd(index);
        if (window.publishedAt === null && end <= watermark) {
          window.publishedAt = tick;
          published.push(index);
          this.counts.published += 1;
        }
        const keepFor = this.config.policy === 'update' ? this.config.allowedTicks : 0;
        if (window.publishedAt !== null && window.forgottenAt === null && end + keepFor <= watermark) {
          window.forgottenAt = tick;
        }
      });
    }

    this.tickCount += 1;
    this.counts.happened = this.nextHappen;
    this.counts.read = this.nextArrive;
    this.counts.onTheWay = this.nextHappen - this.nextArrive;
    return { tick, late, published };
  }

  checkpoint(): WatermarkCheckpoint {
    return {
      tickCount: this.tickCount,
      nextHappen: this.nextHappen,
      nextArrive: this.nextArrive,
      maxEvent: this.maxEvent,
      truth: [...this.truthList],
      windows: this.windows,
      totals: { ...this.counts },
    };
  }

  restore(checkpoint: WatermarkCheckpoint): void {
    this.tickCount = checkpoint.tickCount;
    this.nextHappen = checkpoint.nextHappen;
    this.nextArrive = checkpoint.nextArrive;
    this.maxEvent = checkpoint.maxEvent;
    this.truthList = [...checkpoint.truth];
    this.windowList = checkpoint.windows.map((window) => ({ ...window }));
    this.counts = { ...checkpoint.totals };
  }
}

export const WATERMARK_WAITS = [0.5, 3] as const;

export const latePolicies: Record<LatePolicy, { label: string; diff: string }> = {
  drop: { label: 'Drop late clicks', diff: 'allowedLateness 0 s: a late click is thrown away' },
  update: {
    label: `Allow ${ALLOWED_LATENESS_SECONDS} s of lateness`,
    diff: `allowedLateness ${ALLOWED_LATENESS_SECONDS} s: a late click updates the published count`,
  },
  side: {
    label: 'Side table',
    diff: 'A late click goes to a table that the nightly batch job adds back',
  },
};

export interface WatermarkLane {
  waitSeconds: number;
  label: string;
  model: WatermarkCounter;
  /** Late clicks so far, after each tick. */
  series: number[];
}

/** The same clicks through a job that waits 0.5 s and one that waits 3 s, with one late policy. */
export class WatermarkDuel {
  readonly length = STREAM_TICKS;
  readonly tickSeconds = STREAM_TICK_SECONDS;
  readonly policy: LatePolicy;
  readonly lanes: [WatermarkLane, WatermarkLane];
  readonly events: DuelEvent[] = [];
  private readonly firstLateNoted = [false, false];
  private readonly lateAtReconnect = [0, 0];
  private readonly clicks: readonly StreamClick[];

  constructor(policy: LatePolicy = 'drop', seed = 7) {
    this.policy = policy;
    this.clicks = makeClicks(seed, { slowShare: SLOW_SHARE, outage: OUTAGE });
    const lane = (waitSeconds: number): WatermarkLane => ({
      waitSeconds,
      label: `Wait ${waitSeconds} s`,
      model: new WatermarkCounter(this.clicks, {
        waitTicks: Math.round(waitSeconds / STREAM_TICK_SECONDS),
        policy,
        allowedTicks: Math.round(ALLOWED_LATENESS_SECONDS / STREAM_TICK_SECONDS),
      }),
      series: [],
    });
    this.lanes = [lane(WATERMARK_WAITS[0]), lane(WATERMARK_WAITS[1])];
  }

  get ticks(): number {
    return this.lanes[0].model.ticks;
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  get truth(): number[] {
    return this.lanes[0].model.truth;
  }

  /** Clicks the cut-off edge region is buffering right now. */
  get heldNow(): number {
    let held = 0;
    for (const click of this.clicks) {
      if (click.held && click.eventTick < this.ticks && click.arriveTick >= this.ticks) held += 1;
    }
    return held;
  }

  step(): void {
    if (this.done) return;
    const tick = this.ticks;
    const reconnect = Math.round(OUTAGE.untilSeconds / this.tickSeconds);
    const held = this.heldNow;
    if (tick === reconnect) {
      this.lanes.forEach((lane, index) => {
        this.lateAtReconnect[index] = lane.model.totals.late;
      });
    }
    const results = this.lanes.map((lane) => {
      const result = lane.model.step();
      lane.series.push(lane.model.totals.late);
      return result;
    });
    if (tick === reconnect) {
      this.events.push({
        tick,
        text: `The edge region reconnects and sends the ${held} clicks it buffered since ${OUTAGE.fromSeconds} s.`,
        marker: true,
      });
    }
    if (tick === reconnect + RECONNECT_SPREAD_TICKS) {
      const [a, b] = this.lanes.map(
        (lane, index) => lane.model.totals.late - (this.lateAtReconnect[index] ?? 0),
      );
      this.events.push({
        tick,
        text: `The buffered clicks are in. ${this.lanes[0].label} found ${a} of them late, and ${this.lanes[1].label} found ${b} late.`,
        marker: true,
      });
    }
    results.forEach((result, index) => {
      const lane = this.lanes[index];
      if (!lane) return;
      if (result.published.includes(0)) {
        const window = lane.model.windows[0];
        this.events.push({
          tick,
          text: `${lane.label}: the watermark passes 2 s, and the job publishes ${windowName(0)} with ${window?.ontime ?? 0} clicks.`,
          marker: true,
        });
      }
      if (result.late > 0 && !this.firstLateNoted[index] && tick < reconnect) {
        this.firstLateNoted[index] = true;
        this.events.push({
          tick,
          text: `${lane.label}: the first late click arrives. A retried send delivers it after its window was published. ${lateAction(this.policy)}`,
          marker: true,
        });
      }
    });

    if (this.done) {
      const [a, b] = this.lanes.map((lane) => lane.model.totals);
      if (a && b) {
        this.events.push({
          tick: this.length,
          text: `Run ends. ${this.lanes[0].label}: ${a.late} late clicks, ${a.published} windows published. ${this.lanes[1].label}: ${b.late} late clicks, ${b.published} windows published.`,
          marker: false,
        });
      }
    }
  }
}

function lateAction(policy: LatePolicy): string {
  if (policy === 'update') return 'The job adds it and sends an updated count.';
  if (policy === 'side') return 'The job writes it to the side table.';
  return 'The job drops it.';
}

/* ------------------------------------------------------------------ */
/* Window shapes: tumbling and sliding                                 */
/* ------------------------------------------------------------------ */

export type BurstAt = 'inside' | 'across';

export const SHAPES_SECONDS = 30;
export const TUMBLING_SECONDS = 10;
export const SLIDE_SECONDS = 2;
export const SHAPES_ALERT = 40;
export const BURST_CLICKS = 24;
export const BACKGROUND_PER_SECOND = 2;
const SHAPES_TICK = 0.1;

export const burstOptions: Record<BurstAt, { label: string; diff: string; startSeconds: number }> = {
  inside: {
    label: 'Burst inside a window',
    diff: `${BURST_CLICKS} extra clicks from 13 to 15 s`,
    startSeconds: 13,
  },
  across: {
    label: 'Burst across a boundary',
    diff: `${BURST_CLICKS} extra clicks from 19 to 21 s`,
    startSeconds: 19,
  },
};

export interface ShapeClick {
  /** Tenths of a second. */
  tick: number;
  burst: boolean;
}

export interface ShapeWindow {
  startSeconds: number;
  endSeconds: number;
  count: number;
}

export interface WindowShapes {
  clicks: ShapeClick[];
  tumbling: ShapeWindow[];
  sliding: ShapeWindow[];
}

function countIn(clicks: readonly ShapeClick[], startSeconds: number, endSeconds: number): number {
  const from = Math.round(startSeconds / SHAPES_TICK);
  const to = Math.round(endSeconds / SHAPES_TICK);
  return clicks.filter((click) => click.tick >= from && click.tick < to).length;
}

/**
 * About 2 clicks per second for 30 s plus one burst, counted in 10 s tumbling
 * windows and in 10 s windows that slide every 2 s. Only full windows count.
 */
export function windowShapes(burst: BurstAt, seed = 8): WindowShapes {
  const rng = createRng(seed);
  const ticks = Math.round(SHAPES_SECONDS / SHAPES_TICK);
  const clicks: ShapeClick[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const count = poisson(rng, BACKGROUND_PER_SECOND * SHAPES_TICK);
    for (let index = 0; index < count; index += 1) clicks.push({ tick, burst: false });
  }
  const start = Math.round(burstOptions[burst].startSeconds / SHAPES_TICK);
  const span = Math.round(2 / SHAPES_TICK);
  for (let index = 0; index < BURST_CLICKS; index += 1) {
    clicks.push({ tick: start + randomInt(rng, 0, span - 1), burst: true });
  }
  clicks.sort((a, b) => a.tick - b.tick || Number(a.burst) - Number(b.burst));
  const tumbling = Array.from({ length: SHAPES_SECONDS / TUMBLING_SECONDS }, (_, index) => {
    const startSeconds = index * TUMBLING_SECONDS;
    const endSeconds = startSeconds + TUMBLING_SECONDS;
    return { startSeconds, endSeconds, count: countIn(clicks, startSeconds, endSeconds) };
  });
  const slides = (SHAPES_SECONDS - TUMBLING_SECONDS) / SLIDE_SECONDS + 1;
  const sliding = Array.from({ length: slides }, (_, index) => {
    const startSeconds = index * SLIDE_SECONDS;
    const endSeconds = startSeconds + TUMBLING_SECONDS;
    return { startSeconds, endSeconds, count: countIn(clicks, startSeconds, endSeconds) };
  });
  return { clicks, tumbling, sliding };
}
