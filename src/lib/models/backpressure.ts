import { createRng, poisson, randomInt } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';
import { percentile } from './serverFarm';

/**
 * A toy sho.rt redirect service under a viral link: 5 workers take requests
 * from a waiting line, and each redirect needs 60 to 140 ms of work (100 ms on
 * average), so the service finishes about 50 requests per second. Clients give
 * up after 1 s. Arrivals and work sizes come from a pre-generated workload, so
 * two policies can face exactly the same requests. Time moves in 10 ms substeps.
 */
export type QueuePolicy = 'none' | 'bounded' | 'unbounded' | 'shed';

export const queuePolicyLabels: Record<QueuePolicy, string> = {
  none: 'No queue',
  bounded: 'Queue of 40',
  unbounded: 'Unbounded queue',
  shed: 'Shed by wait',
};

interface PolicySpec {
  /** Requests that may wait for a worker before new ones get a 503; null means no limit. */
  limit: number | null;
  /**
   * Also reject at the door when the expected wait passes the wait budget, and
   * drop requests from the line once their client has given up.
   */
  shed: boolean;
}

export const QUEUE_LIMIT = 40;
/** The longest expected wait the shedding policy accepts at the door. */
export const WAIT_BUDGET_MS = 600;

const policySpecs: Record<QueuePolicy, PolicySpec> = {
  none: { limit: 0, shed: false },
  bounded: { limit: QUEUE_LIMIT, shed: false },
  unbounded: { limit: null, shed: false },
  shed: { limit: QUEUE_LIMIT, shed: true },
};

export const TICK_MS = 100;
const SUBSTEP_MS = 10;
const SUBSTEPS = TICK_MS / SUBSTEP_MS;
export const WORKERS = 5;
export const DEADLINE_MS = 1000;
export const BASE_RATE = 40;
const MEAN_WORK_MS = 100;
/** Weight of the newest work time in the shedding policy's running average. */
const EWMA_WEIGHT = 0.1;

/* ---------- One shared workload per traffic shape ---------- */

export type TrafficShape = 'steady' | 'burst' | 'viral';

export interface Arrival {
  atMs: number;
  /** Work this redirect needs at normal speed. */
  workMs: number;
}

export const SPIKE_START_TICK = 40;
export const BURST_END_TICK = 50;
export const VIRAL_END_TICK = 160;
export const BURST_RATE = 90;
export const VIRAL_RATE = 75;

/** Requests per second at a moment in the run. */
export function trafficRate(shape: TrafficShape, ms: number): number {
  const tick = ms / TICK_MS;
  switch (shape) {
    case 'steady':
      return BASE_RATE;
    case 'burst':
      return tick >= SPIKE_START_TICK && tick < BURST_END_TICK ? BURST_RATE : BASE_RATE;
    case 'viral':
      return tick >= SPIKE_START_TICK && tick < VIRAL_END_TICK ? VIRAL_RATE : BASE_RATE;
  }
}

/**
 * Draws arrival times and work sizes from two separate seeded streams, so
 * changing the traffic shape never reshuffles the work each request needs.
 */
export function generateWorkload(shape: TrafficShape, seed: number, seconds: number): Arrival[] {
  const arrivals = createRng(seed);
  const work = createRng(seed ^ 0x5bd1e995);
  const list: Arrival[] = [];
  for (let ms = 0; ms < seconds * 1000; ms += SUBSTEP_MS) {
    const count = poisson(arrivals, (trafficRate(shape, ms) * SUBSTEP_MS) / 1000);
    for (let i = 0; i < count; i += 1) {
      list.push({ atMs: ms, workMs: SUBSTEP_MS * randomInt(work, 6, 14) });
    }
  }
  return list;
}

/* ---------- The server ---------- */

export type QueueCommand = { type: 'slow'; factor: number } | { type: 'recover' };

interface Job {
  id: number;
  arrivedAt: number;
  workMs: number;
}

interface Working extends Job {
  startedAt: number;
  doneAt: number;
}

export interface QueueTotals {
  arrived: number;
  /** Answered within the client's 1 s deadline. */
  served: number;
  /** Answered after the client gave up: the work was wasted. */
  late: number;
  /** Turned away at the door with a 503 and Retry-After. */
  rejected: number;
  /** Removed from the line because the client had already given up. */
  dropped: number;
  /** Requests that left the line, by starting work (with or without a wait) or by being dropped. */
  leftLine: number;
  /** Total time those requests spent in line, in ms. */
  waitSum: number;
  /** Requests waiting, summed over time, in request milliseconds. */
  waitingArea: number;
}

export interface QueueTick {
  arrived: number;
  served: number;
  late: number;
  rejected: number;
  dropped: number;
  /** Requests that left the line for a worker this tick and will answer in time. */
  startedInTime: number;
  /** Requests that left the line for a worker this tick but will answer too late. */
  startedLate: number;
  leftLine: number;
  /** Wait in line for every request that started work this tick, in ms. */
  waits: number[];
  queued: number;
  busy: number;
}

export interface QueueSnapshot {
  queued: number;
  busy: number;
  /** How long the request at the front of the line has waited, in ms. */
  oldestWaitMs: number;
  /** The longest line this policy accepts right now; null means no limit. */
  admitLimit: number | null;
}

interface QueueState {
  ticks: number;
  cursor: number;
  slowFactor: number;
  /** Running average of recent work times, which the shedding policy uses to predict waits. */
  ewmaMs: number;
  queue: Job[];
  working: Working[];
  totals: QueueTotals;
}

export interface QueueCheckpoint {
  state: QueueState;
}

function emptyTotals(): QueueTotals {
  return {
    arrived: 0,
    served: 0,
    late: 0,
    rejected: 0,
    dropped: 0,
    leftLine: 0,
    waitSum: 0,
    waitingArea: 0,
  };
}

export class QueueServer implements ModelAdapter<QueueCommand, QueueTick, QueueCheckpoint> {
  readonly policy: QueuePolicy;
  private readonly spec: PolicySpec;
  private readonly workload: readonly Arrival[];
  private state: QueueState;

  constructor(policy: QueuePolicy, workload: readonly Arrival[]) {
    this.policy = policy;
    this.spec = policySpecs[policy];
    this.workload = workload;
    this.state = {
      ticks: 0,
      cursor: 0,
      slowFactor: 1,
      ewmaMs: MEAN_WORK_MS,
      queue: [],
      working: [],
      totals: emptyTotals(),
    };
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get totals(): Readonly<QueueTotals> {
    return this.state.totals;
  }

  /** Requests still inside the server: waiting in line or holding a worker. */
  get inFlight(): number {
    return this.state.queue.length + this.state.working.length;
  }

  apply(command: QueueCommand): void {
    switch (command.type) {
      case 'slow':
        this.state.slowFactor = command.factor;
        return;
      case 'recover':
        this.state.slowFactor = 1;
        return;
    }
  }

  step(): QueueTick {
    const before = { ...this.state.totals };
    const tick = { startedInTime: 0, startedLate: 0, waits: [] as number[] };
    const base = this.state.ticks * TICK_MS;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      const now = base + sub * SUBSTEP_MS;
      this.complete(now);
      this.assign(now, tick);
      this.arrive(now, tick);
      this.state.totals.waitingArea += this.state.queue.length * SUBSTEP_MS;
    }
    this.state.ticks += 1;
    const totals = this.state.totals;
    return {
      arrived: totals.arrived - before.arrived,
      served: totals.served - before.served,
      late: totals.late - before.late,
      rejected: totals.rejected - before.rejected,
      dropped: totals.dropped - before.dropped,
      startedInTime: tick.startedInTime,
      startedLate: tick.startedLate,
      leftLine: totals.leftLine - before.leftLine,
      waits: tick.waits,
      queued: this.state.queue.length,
      busy: this.state.working.length,
    };
  }

  snapshot(): QueueSnapshot {
    const now = this.state.ticks * TICK_MS;
    const front = this.state.queue[0];
    return {
      queued: this.state.queue.length,
      busy: this.state.working.length,
      oldestWaitMs: front ? now - front.arrivedAt : 0,
      admitLimit: this.admitLimit(),
    };
  }

  /** Total time requests still in line have waited so far, in ms. */
  pendingWaitMs(): number {
    const now = this.state.ticks * TICK_MS;
    return this.state.queue.reduce((sum, job) => sum + now - job.arrivedAt, 0);
  }

  checkpoint(): QueueCheckpoint {
    return structuredClone({ state: this.state });
  }

  restore(checkpoint: QueueCheckpoint): void {
    this.state = structuredClone(checkpoint).state;
  }

  private admitLimit(): number | null {
    const { limit, shed } = this.spec;
    if (!shed) return limit;
    // A request at position k waits for about k + 1 departures, one every ewma / workers ms.
    const byWait = Math.floor((WAIT_BUDGET_MS * WORKERS) / this.state.ewmaMs);
    return limit === null ? byWait : Math.min(limit, byWait);
  }

  private complete(now: number): void {
    const state = this.state;
    const finished = state.working.filter((job) => job.doneAt <= now);
    if (finished.length === 0) return;
    state.working = state.working.filter((job) => job.doneAt > now);
    for (const job of finished) {
      if (job.doneAt - job.arrivedAt <= DEADLINE_MS) state.totals.served += 1;
      else state.totals.late += 1;
      state.ewmaMs += EWMA_WEIGHT * (job.doneAt - job.startedAt - state.ewmaMs);
    }
  }

  private start(
    job: Job,
    now: number,
    tick: { startedInTime: number; startedLate: number; waits: number[] },
  ) {
    const state = this.state;
    const doneAt = now + job.workMs * state.slowFactor;
    state.working.push({ ...job, startedAt: now, doneAt });
    state.totals.leftLine += 1;
    state.totals.waitSum += now - job.arrivedAt;
    tick.waits.push(now - job.arrivedAt);
    if (doneAt - job.arrivedAt <= DEADLINE_MS) tick.startedInTime += 1;
    else tick.startedLate += 1;
  }

  private assign(now: number, tick: { startedInTime: number; startedLate: number; waits: number[] }) {
    const state = this.state;
    while (state.working.length < WORKERS) {
      const job = state.queue.shift();
      if (!job) return;
      if (this.spec.shed && now - job.arrivedAt >= DEADLINE_MS) {
        state.totals.dropped += 1;
        state.totals.leftLine += 1;
        state.totals.waitSum += now - job.arrivedAt;
        continue;
      }
      this.start(job, now, tick);
    }
  }

  private arrive(now: number, tick: { startedInTime: number; startedLate: number; waits: number[] }) {
    const state = this.state;
    while (state.cursor < this.workload.length) {
      const next = this.workload[state.cursor];
      if (!next || next.atMs >= now + SUBSTEP_MS) return;
      const job: Job = { id: state.cursor, arrivedAt: now, workMs: next.workMs };
      state.cursor += 1;
      state.totals.arrived += 1;
      // assign() has already emptied the line into any free worker, so a free worker means no line.
      if (state.working.length < WORKERS) {
        this.start(job, now, tick);
        continue;
      }
      const limit = this.admitLimit();
      if (limit !== null && state.queue.length >= limit) state.totals.rejected += 1;
      else state.queue.push(job);
    }
  }
}

/* ---------- Two policies side by side on the same traffic ---------- */

export type QueueScenarioId = 'steady' | 'burst' | 'viral' | 'slow';
export type QueueMetric = 'queued' | 'rejected' | 'goodput';

export interface QueueScenario {
  id: QueueScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  traffic: TrafficShape;
  policies: [QueuePolicy, QueuePolicy];
  schedule: ScheduledCommand<QueueCommand>[];
  metric: QueueMetric;
}

export interface QueueEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const QUEUE_RUN_SECONDS = 20;
export const SLOW_TICK = 40;
export const SLOW_RECOVER_TICK = 140;
/** Ticks in the rolling window behind the per second rates. */
export const RATE_WINDOW = 10;

export const queueScenarios: Record<QueueScenarioId, QueueScenario> = {
  steady: {
    id: 'steady',
    label: 'Steady traffic',
    diff: 'Baseline: 40 req/s against about 50 req/s of capacity (5 workers, 100 ms per redirect). Clients give up after 1 s. Unbounded queue against a queue of 40.',
    traffic: 'steady',
    policies: ['unbounded', 'bounded'],
    schedule: [],
    metric: 'queued',
  },
  burst: {
    id: 'burst',
    label: 'Short burst',
    diff: 'Traffic jumps to 90 req/s for 1 s at 4 s. No queue against a queue of 40.',
    traffic: 'burst',
    policies: ['none', 'bounded'],
    schedule: [],
    metric: 'rejected',
  },
  viral: {
    id: 'viral',
    label: 'Viral link',
    diff: 'Traffic jumps to 75 req/s from 4 s to 16 s. Unbounded queue against a queue of 40.',
    traffic: 'viral',
    policies: ['unbounded', 'bounded'],
    schedule: [],
    metric: 'goodput',
  },
  slow: {
    id: 'slow',
    label: 'Slow redirects',
    diff: 'Steady 40 req/s, but every redirect takes twice as long from 4 s to 14 s. Queue of 40 against the same queue plus a 600 ms wait budget.',
    traffic: 'steady',
    policies: ['bounded', 'shed'],
    schedule: [
      { at: SLOW_TICK, command: { type: 'slow', factor: 2 } },
      { at: SLOW_RECOVER_TICK, command: { type: 'recover' } },
    ],
    metric: 'goodput',
  },
};

export const queueMetricLabels: Record<QueueMetric, string> = {
  queued: 'Requests waiting in line',
  rejected: 'Requests rejected per second',
  goodput: 'Answered in time per second',
};

function trafficNotes(shape: TrafficShape): QueueEvent[] {
  switch (shape) {
    case 'steady':
      return [];
    case 'burst':
      return [
        { tick: SPIKE_START_TICK, text: `Traffic jumps to ${BURST_RATE} req/s.`, marker: true },
        { tick: BURST_END_TICK, text: `Traffic falls back to ${BASE_RATE} req/s.`, marker: true },
      ];
    case 'viral':
      return [
        {
          tick: SPIKE_START_TICK,
          text: `A link goes viral: traffic jumps to ${VIRAL_RATE} req/s.`,
          marker: true,
        },
        { tick: VIRAL_END_TICK, text: `Traffic falls back to ${BASE_RATE} req/s.`, marker: true },
      ];
  }
}

export interface QueueLane {
  policy: QueuePolicy;
  label: string;
  server: QueueServer;
  /** One value per tick for the scenario's metric. */
  series: number[];
  waits: number[];
  /** Per tick counts behind the rolling per second rates. */
  recent: { served: number[]; late: number[]; rejected: number[]; leftLine: number[] };
  peakQueue: number;
  seen: { rejected: boolean; late: boolean; dropped: boolean; long: boolean; stalled: boolean };
}

/** Requests waiting in line that count as a long line in the transcript. */
const LONG_LINE = 100;

function rolling(values: number[]): number {
  let sum = 0;
  for (const value of values.slice(-RATE_WINDOW)) sum += value;
  return sum * (1000 / (RATE_WINDOW * TICK_MS));
}

export class QueueDuel {
  readonly scenario: QueueScenario;
  readonly length: number;
  readonly tickSeconds = TICK_MS / 1000;
  readonly lanes: [QueueLane, QueueLane];
  readonly events: QueueEvent[] = [];
  private readonly notes: QueueEvent[];
  private tickCount = 0;

  constructor(scenario: QueueScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(QUEUE_RUN_SECONDS / this.tickSeconds);
    this.notes = trafficNotes(scenario.traffic);
    const workload = generateWorkload(scenario.traffic, seed, QUEUE_RUN_SECONDS);
    const lane = (policy: QueuePolicy): QueueLane => ({
      policy,
      label: queuePolicyLabels[policy],
      server: new QueueServer(policy, workload),
      series: [],
      waits: [],
      recent: { served: [], late: [], rejected: [], leftLine: [] },
      peakQueue: 0,
      seen: { rejected: false, late: false, dropped: false, long: false, stalled: false },
    });
    this.lanes = [lane(scenario.policies[0]), lane(scenario.policies[1])];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** Answered in time per second over the last second. */
  goodput(lane: QueueLane): number {
    return rolling(lane.recent.served);
  }

  /** Requests leaving the line per second over the last second. */
  drainRate(lane: QueueLane): number {
    return rolling(lane.recent.leftLine);
  }

  /** Answers per second over the last second that arrived after the client gave up. */
  lateRate(lane: QueueLane): number {
    return rolling(lane.recent.late);
  }

  /** Requests turned away per second over the last second. */
  rejectRate(lane: QueueLane): number {
    return rolling(lane.recent.rejected);
  }

  step(): QueueTickPair | null {
    if (this.done) return null;
    const tick = this.tickCount;
    const { schedule, metric } = this.scenario;
    for (const note of this.notes) if (note.tick === tick) this.events.push(note);
    for (const entry of schedule) {
      if (entry.at === tick)
        this.events.push({ tick, text: describeQueueCommand(entry.command), marker: true });
    }
    const results = this.lanes.map((lane) => {
      const result = stepScheduled(lane.server, schedule);
      lane.waits.push(...result.waits);
      lane.recent.served.push(result.served);
      lane.recent.late.push(result.late);
      lane.recent.rejected.push(result.rejected);
      lane.recent.leftLine.push(result.leftLine);
      lane.peakQueue = Math.max(lane.peakQueue, result.queued);
      const value =
        metric === 'queued'
          ? result.queued
          : metric === 'rejected'
            ? rolling(lane.recent.rejected)
            : rolling(lane.recent.served);
      lane.series.push(value);
      this.noteFirsts(lane, tick + 1);
      return result;
    }) as QueueTickPair;
    this.tickCount += 1;
    if (this.done) {
      const [first, second] = this.lanes;
      const a = first.server;
      const b = second.server;
      let text = `Run ends. Answered in time: ${first.label} ${a.totals.served}, ${second.label} ${b.totals.served}.`;
      if (a.inFlight + b.inFlight > 0 && Math.max(first.peakQueue, second.peakQueue) >= LONG_LINE) {
        text += ` Still inside the server: ${first.label} ${a.inFlight}, ${second.label} ${b.inFlight}.`;
      }
      this.events.push({ tick: this.tickCount, text, marker: false });
    }
    return results;
  }

  private noteFirsts(lane: QueueLane, at: number): void {
    const totals = lane.server.totals;
    const push = (text: string) =>
      this.events.push({ tick: at, text: `${lane.label}: ${text}`, marker: true });
    if (!lane.seen.rejected && totals.rejected > 0) {
      lane.seen.rejected = true;
      push(
        lane.policy === 'none'
          ? 'all 5 workers are busy and there is no line, so a request gets a 503.'
          : lane.policy === 'shed'
            ? `the expected wait passes ${WAIT_BUDGET_MS} ms, so new requests get a 503 with Retry-After.`
            : 'the line is full, so new requests get a 503 with Retry-After.',
      );
    }
    if (!lane.seen.long && lane.server.snapshot().queued >= LONG_LINE) {
      lane.seen.long = true;
      push(`${LONG_LINE} requests are waiting, about 2 s of work for 5 workers.`);
    }
    if (!lane.seen.late && totals.late > 0) {
      lane.seen.late = true;
      push('the first answer arrives after its client gave up.');
    }
    if (!lane.seen.dropped && totals.dropped > 0) {
      lane.seen.dropped = true;
      push('drops a request from the line because its client already gave up.');
    }
    const window = lane.recent.served.slice(-RATE_WINDOW);
    if (
      !lane.seen.stalled &&
      window.length === RATE_WINDOW &&
      window.every((value) => value === 0) &&
      lane.server.snapshot().busy === WORKERS
    ) {
      lane.seen.stalled = true;
      push('every worker is busy, yet no answer has arrived in time for a full second.');
    }
  }
}

export type QueueTickPair = [QueueTick, QueueTick];

export interface QueueSummary {
  arrived: number;
  served: number;
  late: number;
  rejected: number;
  dropped: number;
  /** Waiting in line or holding a worker when the run stops. */
  inside: number;
  peakQueue: number;
  p95WaitMs: number;
  /**
   * Little's law over the run so far, L = λ × W exactly: average line length,
   * admitted requests per second, and their average wait in line so far
   * (a request still in line counts the time it has waited up to now).
   */
  averageLine: number;
  admittedPerSecond: number;
  averageWaitMs: number;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarizeQueue(lane: QueueLane): QueueSummary {
  const sorted = [...lane.waits].sort((a, b) => a - b);
  const totals = lane.server.totals;
  const elapsedMs = Math.max(lane.server.ticks * TICK_MS, 1);
  const admitted = totals.arrived - totals.rejected;
  return {
    arrived: totals.arrived,
    served: totals.served,
    late: totals.late,
    rejected: totals.rejected,
    dropped: totals.dropped,
    inside: lane.server.inFlight,
    peakQueue: lane.peakQueue,
    p95WaitMs: percentile(sorted, 0.95),
    averageLine: totals.waitingArea / elapsedMs,
    admittedPerSecond: (admitted * 1000) / elapsedMs,
    averageWaitMs: admitted > 0 ? (totals.waitSum + lane.server.pendingWaitMs()) / admitted : 0,
  };
}

function describeQueueCommand(command: QueueCommand): string {
  switch (command.type) {
    case 'slow':
      return `Every redirect starts taking ${command.factor} times as long.`;
    case 'recover':
      return 'Redirects take their normal time again.';
  }
}
