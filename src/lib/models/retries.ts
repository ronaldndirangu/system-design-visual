import { createRng, poisson, randomInt, type SeededRng } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';
import { percentile } from './serverFarm';

/**
 * A toy click ingest path: redirect servers send each click event to the
 * analytics ingest service and wait for an answer. The service runs a pool of
 * workers behind a bounded queue, finishes every attempt it accepts even after
 * the sender stopped waiting, and fails a small share of attempts with a
 * transient error. Each click carries an idempotency key, so an abandoned
 * attempt that still lands never counts the click twice. Time moves in 10 ms
 * substeps.
 */
export type RetryPolicy = 'none' | 'immediate' | 'jitter' | 'budget';

export const retryPolicyLabels: Record<RetryPolicy, string> = {
  none: 'No retries',
  immediate: 'Retry at once',
  jitter: 'Backoff with jitter',
  budget: 'Jitter and a budget',
};

interface RetryPolicySpec {
  maxAttempts: number;
  /** How long to wait before a retry: one substep, or a random slice of a doubling window. */
  wait: 'immediate' | 'jitter';
  /** Whether retries spend tokens that only fresh clicks refill. */
  budget: boolean;
}

const retryPolicySpecs: Record<RetryPolicy, RetryPolicySpec> = {
  none: { maxAttempts: 1, wait: 'immediate', budget: false },
  immediate: { maxAttempts: 4, wait: 'immediate', budget: false },
  jitter: { maxAttempts: 4, wait: 'jitter', budget: false },
  budget: { maxAttempts: 4, wait: 'jitter', budget: true },
};

const TICK_MS = 100;
const SUBSTEP_MS = 10;
const SUBSTEPS = TICK_MS / SUBSTEP_MS;
/** The sender stops waiting for one attempt after this long. */
export const ATTEMPT_TIMEOUT_MS = 500;
/** The sender stops trying to deliver a click this long after it happened. */
export const CLICK_DEADLINE_MS = 2000;
/** The first retry waits a random time up to this; each later retry doubles the window. */
export const BACKOFF_BASE_MS = 200;
export const MAX_ATTEMPTS = 4;
/** Tokens each fresh click adds to the retry budget. A retry costs one token. */
export const BUDGET_PER_CLICK = 0.1;
export const BUDGET_CAP = 10;
export const TRANSIENT_RATE = 0.02;

export interface RetryServerConfig {
  policy: RetryPolicy;
  seed: number;
  /** Clicks per second. */
  arrivalRate: number;
  workers: number;
  /** Attempts that may wait for a worker before new ones get 503. */
  queueLimit: number;
}

export const defaultRetryConfig: RetryServerConfig = {
  policy: 'none',
  seed: 42,
  arrivalRate: 150,
  workers: 8,
  queueLimit: 150,
};

export type RetryCommand = { type: 'slow' } | { type: 'fast' } | { type: 'down' } | { type: 'up' };

interface Click {
  id: number;
  arrivedAt: number;
  deadline: number;
  attempts: number;
  /** The attempt the sender is waiting on, or null between attempts. */
  attemptId: number | null;
  timeoutAt: number;
  retryAt: number | null;
}

interface Attempt {
  id: number;
  clickId: number;
}

interface Working extends Attempt {
  doneAt: number;
  transient: boolean;
}

export interface RetryTotals {
  /** Clicks the redirect servers needed to deliver. */
  arrived: number;
  /** Clicks whose sender heard back with a success before giving up. */
  confirmed: number;
  /** Clicks whose sender stopped trying: out of attempts, time, or budget. */
  gaveUp: number;
  attempts: number;
  retries: number;
  /** Attempts turned away with 503 at a full queue, or refused and dropped while the service was down. */
  rejected: number;
  /** Attempts the sender stopped waiting for after the per attempt timeout. */
  timedOut: number;
  /** Attempts that came back with a transient error. */
  transient: number;
  /** Attempts the service completed, whether or not anyone still waited. */
  finished: number;
  /** Attempts the service completed after their sender had stopped waiting. */
  wasted: number;
  /** Clicks stored at least once, including ones whose sender gave up before the answer came back. */
  recorded: number;
  /** Repeat deliveries of a stored click that the idempotency key caught. */
  duplicates: number;
  /** Retries skipped because the retry budget was empty. */
  budgetDenied: number;
}

export interface RetryTick {
  attempts: number;
  confirmed: number;
  gaveUp: number;
  rejected: number;
  timedOut: number;
  wasted: number;
  latencies: number[];
  busyWorkers: number;
}

interface RetryState {
  ticks: number;
  nextClick: number;
  nextAttempt: number;
  slow: boolean;
  down: boolean;
  tokens: number;
  pending: Click[];
  queue: Attempt[];
  working: Working[];
  landed: Set<number>;
  totals: RetryTotals;
}

export interface RetryCheckpoint {
  state: RetryState;
  arrivals: number;
  work: number;
}

export type RetryCellState = 'idle' | 'working' | 'nobody';

export interface RetrySnapshot {
  workers: RetryCellState[];
  queued: number;
  /** Queued attempts whose sender already stopped waiting. */
  queuedForNobody: number;
  /** Clicks waiting out a backoff before their next attempt. */
  waitingToRetry: number;
  tokens: number;
  down: boolean;
}

function emptyRetryTotals(): RetryTotals {
  return {
    arrived: 0,
    confirmed: 0,
    gaveUp: 0,
    attempts: 0,
    retries: 0,
    rejected: 0,
    timedOut: 0,
    transient: 0,
    finished: 0,
    wasted: 0,
    recorded: 0,
    duplicates: 0,
    budgetDenied: 0,
  };
}

export class RetryServer implements ModelAdapter<RetryCommand, RetryTick, RetryCheckpoint> {
  readonly config: RetryServerConfig;
  private readonly spec: RetryPolicySpec;
  /** Drives click arrivals only, so every policy sees the same clicks. */
  private readonly arrivals: SeededRng;
  /** Drives service times, transient errors, and jitter. */
  private readonly work: SeededRng;
  private state: RetryState;

  constructor(config: Partial<RetryServerConfig> = {}) {
    this.config = { ...defaultRetryConfig, ...config };
    this.spec = retryPolicySpecs[this.config.policy];
    this.arrivals = createRng(this.config.seed);
    this.work = createRng(this.config.seed ^ 0x5bd1e995);
    this.state = {
      ticks: 0,
      nextClick: 0,
      nextAttempt: 0,
      slow: false,
      down: false,
      tokens: BUDGET_CAP,
      pending: [],
      queue: [],
      working: [],
      landed: new Set(),
      totals: emptyRetryTotals(),
    };
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get totals(): Readonly<RetryTotals> {
    return this.state.totals;
  }

  /** Clicks still being delivered: waiting on an attempt or on a backoff. */
  get inFlight(): number {
    return this.state.pending.length;
  }

  /** Attempts the service holds: queued or on a worker. */
  get inService(): number {
    return this.state.queue.length + this.state.working.length;
  }

  apply(command: RetryCommand): void {
    const state = this.state;
    switch (command.type) {
      case 'slow':
        state.slow = true;
        return;
      case 'fast':
        state.slow = false;
        return;
      case 'up':
        state.down = false;
        return;
      case 'down': {
        state.down = true;
        const now = state.ticks * TICK_MS;
        const dropped = [...state.working, ...state.queue];
        state.working = [];
        state.queue = [];
        for (const attempt of dropped) {
          state.totals.rejected += 1;
          const click = state.pending.find((item) => item.attemptId === attempt.id);
          if (click) {
            click.attemptId = null;
            this.failAttempt(click, now);
          }
        }
        return;
      }
    }
  }

  step(): RetryTick {
    const before = { ...this.state.totals };
    const latencies: number[] = [];
    const base = this.state.ticks * TICK_MS;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      const now = base + sub * SUBSTEP_MS;
      this.complete(now, latencies);
      this.expire(now);
      this.sendRetries(now);
      this.arrive(now);
      this.assignWorkers(now);
    }
    this.state.ticks += 1;
    const totals = this.state.totals;
    return {
      attempts: totals.attempts - before.attempts,
      confirmed: totals.confirmed - before.confirmed,
      gaveUp: totals.gaveUp - before.gaveUp,
      rejected: totals.rejected - before.rejected,
      timedOut: totals.timedOut - before.timedOut,
      wasted: totals.wasted - before.wasted,
      latencies,
      busyWorkers: this.state.working.length,
    };
  }

  snapshot(): RetrySnapshot {
    const state = this.state;
    const waitedOn = new Set(state.pending.map((click) => click.attemptId));
    const cells: RetryCellState[] = state.working.map((job) => (waitedOn.has(job.id) ? 'working' : 'nobody'));
    return {
      workers: [...cells, ...Array<RetryCellState>(this.config.workers - cells.length).fill('idle')],
      queued: state.queue.length,
      queuedForNobody: state.queue.filter((attempt) => !waitedOn.has(attempt.id)).length,
      waitingToRetry: state.pending.filter((click) => click.retryAt !== null).length,
      tokens: state.tokens,
      down: state.down,
    };
  }

  checkpoint(): RetryCheckpoint {
    return structuredClone({
      state: this.state,
      arrivals: this.arrivals.getState(),
      work: this.work.getState(),
    });
  }

  restore(checkpoint: RetryCheckpoint): void {
    const copy = structuredClone(checkpoint);
    this.state = copy.state;
    this.arrivals.setState(copy.arrivals);
    this.work.setState(copy.work);
  }

  private complete(now: number, latencies: number[]): void {
    const state = this.state;
    const finished = state.working.filter((job) => job.doneAt <= now);
    if (finished.length === 0) return;
    state.working = state.working.filter((job) => job.doneAt > now);
    for (const job of finished) {
      state.totals.finished += 1;
      if (job.transient) state.totals.transient += 1;
      else this.land(job.clickId);
      const index = state.pending.findIndex((click) => click.attemptId === job.id);
      const click = state.pending[index];
      if (!click) {
        state.totals.wasted += 1;
        continue;
      }
      if (job.transient) {
        click.attemptId = null;
        this.failAttempt(click, now);
        continue;
      }
      state.pending.splice(index, 1);
      state.totals.confirmed += 1;
      latencies.push(now - click.arrivedAt);
    }
  }

  private land(clickId: number): void {
    const state = this.state;
    if (state.landed.has(clickId)) {
      state.totals.duplicates += 1;
      return;
    }
    state.landed.add(clickId);
    state.totals.recorded += 1;
  }

  private expire(now: number): void {
    const expired = this.state.pending.filter((click) => click.attemptId !== null && click.timeoutAt <= now);
    for (const click of expired) {
      this.state.totals.timedOut += 1;
      click.attemptId = null;
      this.failAttempt(click, now);
    }
  }

  private sendRetries(now: number): void {
    const due = this.state.pending.filter((click) => click.retryAt !== null && click.retryAt <= now);
    for (const click of due) {
      click.retryAt = null;
      this.send(click, now);
    }
  }

  private arrive(now: number): void {
    const state = this.state;
    const count = poisson(this.arrivals, (this.config.arrivalRate * SUBSTEP_MS) / 1000);
    for (let i = 0; i < count; i += 1) {
      const click: Click = {
        id: state.nextClick,
        arrivedAt: now,
        deadline: now + CLICK_DEADLINE_MS,
        attempts: 0,
        attemptId: null,
        timeoutAt: 0,
        retryAt: null,
      };
      state.nextClick += 1;
      state.totals.arrived += 1;
      if (this.spec.budget) state.tokens = Math.min(BUDGET_CAP, state.tokens + BUDGET_PER_CLICK);
      state.pending.push(click);
      this.send(click, now);
    }
  }

  private send(click: Click, now: number): void {
    const state = this.state;
    click.attempts += 1;
    state.totals.attempts += 1;
    if (click.attempts > 1) state.totals.retries += 1;
    const id = state.nextAttempt;
    state.nextAttempt += 1;
    if (state.down || state.queue.length >= this.config.queueLimit) {
      state.totals.rejected += 1;
      this.failAttempt(click, now);
      return;
    }
    click.attemptId = id;
    click.timeoutAt = now + Math.min(ATTEMPT_TIMEOUT_MS, click.deadline - now);
    state.queue.push({ id, clickId: click.id });
  }

  /** Decides what a sender does after an attempt fails: wait and retry, or give up. */
  private failAttempt(click: Click, now: number): void {
    const state = this.state;
    const spec = this.spec;
    if (click.attempts >= spec.maxAttempts) {
      this.giveUp(click);
      return;
    }
    let wait = SUBSTEP_MS;
    if (spec.wait === 'jitter') {
      const window = BACKOFF_BASE_MS * 2 ** (click.attempts - 1);
      wait = SUBSTEP_MS * randomInt(this.work, 1, window / SUBSTEP_MS);
    }
    if (now + wait >= click.deadline) {
      this.giveUp(click);
      return;
    }
    if (spec.budget) {
      if (state.tokens < 1) {
        state.totals.budgetDenied += 1;
        this.giveUp(click);
        return;
      }
      state.tokens -= 1;
    }
    click.retryAt = now + wait;
  }

  private giveUp(click: Click): void {
    const state = this.state;
    const index = state.pending.indexOf(click);
    if (index >= 0) state.pending.splice(index, 1);
    state.totals.gaveUp += 1;
  }

  private assignWorkers(now: number): void {
    const state = this.state;
    while (state.working.length < this.config.workers) {
      const attempt = state.queue.shift();
      if (!attempt) return;
      const serviceMs = SUBSTEP_MS * randomInt(this.work, 3, 5) * (state.slow ? 2 : 1);
      const transient = this.work() < TRANSIENT_RATE;
      state.working.push({ ...attempt, doneAt: now + serviceMs, transient });
    }
  }
}

/* Two policies side by side on the same clicks */

export type RetryScenarioId = 'healthy' | 'storm' | 'blip' | 'budget';
export type RetryMetric = 'confirmed' | 'attempts';

export interface RetryScenario {
  id: RetryScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  policies: [RetryPolicy, RetryPolicy];
  schedule: ScheduledCommand<RetryCommand>[];
  metric: RetryMetric;
}

export interface RetryEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const RETRY_RUN_SECONDS = 20;
export const SLOW_TICK = 30;
export const FAST_TICK = 60;
export const DOWN_TICK = 30;
export const UP_TICK = 35;

const slowSchedule: ScheduledCommand<RetryCommand>[] = [
  { at: SLOW_TICK, command: { type: 'slow' } },
  { at: FAST_TICK, command: { type: 'fast' } },
];

export const retryScenarios: Record<RetryScenarioId, RetryScenario> = {
  healthy: {
    id: 'healthy',
    label: 'Normal day',
    diff: 'Baseline: 150 clicks/s, 8 workers, 30 to 50 ms per attempt, a queue of 150, 2% transient errors. No retries against backoff with jitter.',
    policies: ['none', 'jitter'],
    schedule: [],
    metric: 'confirmed',
  },
  storm: {
    id: 'storm',
    label: 'Slowdown at 3 s',
    diff: 'Attempts take twice as long from 3 s to 6 s. No retries against backoff with jitter.',
    policies: ['none', 'jitter'],
    schedule: slowSchedule,
    metric: 'confirmed',
  },
  blip: {
    id: 'blip',
    label: 'Restart at 3 s',
    diff: 'The ingest service restarts and refuses connections from 3 s to 3.5 s. Retry at once against backoff with jitter.',
    policies: ['immediate', 'jitter'],
    schedule: [
      { at: DOWN_TICK, command: { type: 'down' } },
      { at: UP_TICK, command: { type: 'up' } },
    ],
    metric: 'attempts',
  },
  budget: {
    id: 'budget',
    label: 'Slowdown with a budget',
    diff: 'Same slowdown. Backoff with jitter, without and with a retry budget of 10% of fresh clicks.',
    policies: ['jitter', 'budget'],
    schedule: slowSchedule,
    metric: 'confirmed',
  },
};

export interface RetryLane {
  policy: RetryPolicy;
  label: string;
  server: RetryServer;
  /** One value per tick for the scenario's metric, per second. */
  series: number[];
  latencies: number[];
  peakAttemptsPerSecond: number;
  seen: { timedOut: boolean; rejected: boolean; outage: boolean; budget: boolean };
  /** Set when the trigger ends, cleared on the first tick without timeouts or turned away attempts. */
  recoveringSince: number | null;
  /** Seconds from the end of the trigger until attempts stop failing, or null if they never do. */
  recoverySeconds: number | null;
}

export class RetryDuel {
  readonly scenario: RetryScenario;
  readonly length: number;
  readonly tickSeconds = TICK_MS / 1000;
  readonly lanes: [RetryLane, RetryLane];
  readonly events: RetryEvent[] = [];
  private tickCount = 0;

  constructor(scenario: RetryScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(RETRY_RUN_SECONDS / this.tickSeconds);
    const lane = (policy: RetryPolicy): RetryLane => ({
      policy,
      label: retryPolicyLabels[policy],
      server: new RetryServer({ policy, seed }),
      series: [],
      latencies: [],
      peakAttemptsPerSecond: 0,
      seen: { timedOut: false, rejected: false, outage: false, budget: false },
      recoveringSince: null,
      recoverySeconds: null,
    });
    this.lanes = [lane(scenario.policies[0]), lane(scenario.policies[1])];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    const { schedule, metric } = this.scenario;
    const perSecond = 1 / this.tickSeconds;
    for (const entry of schedule) {
      if (entry.at === tick)
        this.events.push({ tick, text: describeRetryCommand(entry.command), marker: true });
    }
    const triggerEnds = schedule.some(
      (entry) => (entry.command.type === 'fast' || entry.command.type === 'up') && entry.at === tick,
    );
    for (const lane of this.lanes) {
      const result = stepScheduled(lane.server, schedule);
      const totals = lane.server.totals;
      lane.latencies.push(...result.latencies);
      const attemptsPerSecond = result.attempts * perSecond;
      lane.series.push(metric === 'attempts' ? attemptsPerSecond : result.confirmed * perSecond);
      lane.peakAttemptsPerSecond = Math.max(lane.peakAttemptsPerSecond, attemptsPerSecond);
      const at = tick + 1;
      if (!lane.seen.timedOut && totals.timedOut > 0) {
        lane.seen.timedOut = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: the first attempt times out after ${ATTEMPT_TIMEOUT_MS} ms.`,
          marker: true,
        });
      }
      if (!lane.seen.rejected && result.rejected > 0 && !lane.server.snapshot().down) {
        lane.seen.rejected = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: the queue is full, so new attempts get a 503.`,
          marker: true,
        });
      }
      if (!lane.seen.outage && result.gaveUp > 0 && lane.server.snapshot().down) {
        lane.seen.outage = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: the first click gives up during the restart, because the service refused its attempts.`,
          marker: true,
        });
      }
      if (!lane.seen.budget && totals.budgetDenied > 0) {
        lane.seen.budget = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: the retry budget runs dry, so failed clicks stop retrying.`,
          marker: true,
        });
      }
      if (triggerEnds) lane.recoveringSince = tick;
      if (lane.recoveringSince !== null && result.timedOut + result.rejected === 0) {
        const lag = at - lane.recoveringSince;
        lane.recoverySeconds = (lag * TICK_MS) / 1000;
        this.events.push({
          tick: at,
          text: `${lane.label}: attempts stop failing, ${formatSeconds(lane.recoverySeconds)} after the service is healthy again.`,
          marker: true,
        });
        lane.recoveringSince = null;
      }
    }
    this.tickCount += 1;
    if (this.done) {
      const [first, second] = this.lanes;
      const a = first.server.totals;
      const b = second.server.totals;
      let text = `Run ends. Clicks confirmed: ${first.label} ${a.confirmed}, ${second.label} ${b.confirmed}. Attempts sent: ${a.attempts} and ${b.attempts}.`;
      for (const lane of this.lanes) {
        if (lane.recoveringSince !== null) text += ` ${lane.label} is still failing when the run ends.`;
      }
      this.events.push({ tick: this.tickCount, text, marker: false });
    }
  }
}

export interface RetrySummary {
  arrived: number;
  confirmed: number;
  gaveUp: number;
  attempts: number;
  /** Attempts per click. */
  amplification: number;
  rejected: number;
  timedOut: number;
  wasted: number;
  recorded: number;
  duplicates: number;
  p95Ms: number;
  peakAttemptsPerSecond: number;
  recoverySeconds: number | null;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarizeRetries(lane: RetryLane): RetrySummary {
  const sorted = [...lane.latencies].sort((a, b) => a - b);
  const totals = lane.server.totals;
  return {
    arrived: totals.arrived,
    confirmed: totals.confirmed,
    gaveUp: totals.gaveUp,
    attempts: totals.attempts,
    amplification: totals.arrived === 0 ? 0 : totals.attempts / totals.arrived,
    rejected: totals.rejected,
    timedOut: totals.timedOut,
    wasted: totals.wasted,
    recorded: totals.recorded,
    duplicates: totals.duplicates,
    p95Ms: percentile(sorted, 0.95),
    peakAttemptsPerSecond: lane.peakAttemptsPerSecond,
    recoverySeconds: lane.recoverySeconds,
  };
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

function describeRetryCommand(command: RetryCommand): string {
  switch (command.type) {
    case 'slow':
      return 'The ingest service slows down: attempts take twice as long.';
    case 'fast':
      return 'The ingest service runs at full speed again.';
    case 'down':
      return 'The ingest service restarts and refuses connections.';
    case 'up':
      return 'The ingest service accepts connections again.';
  }
}

/* A herd of senders reconnecting after a restart */

export type HerdPolicy = 'backoff' | 'jitter';

export const herdPolicyLabels: Record<HerdPolicy, string> = {
  backoff: 'Backoff, no jitter',
  jitter: 'Backoff with full jitter',
};

export const HERD_CLIENTS = 40;
export const HERD_STEP_MS = 50;
/** The ingest service refuses every attempt before this time. */
export const HERD_RESTART_MS = 500;
/** Attempts the service can take in one step; the rest get 503 at once. */
export const HERD_CAPACITY = 3;
export const HERD_BASE_MS = 100;
export const HERD_CAP_MS = 1600;
export const HERD_RUN_SECONDS = 6;

interface HerdClient {
  attempts: number;
  /** Time of the next attempt, or null once served. */
  nextAt: number | null;
  servedAt: number | null;
}

export type HerdOutcome = 'served' | 'rejected' | 'refused';

export interface HerdMark {
  step: number;
  client: number;
  outcome: HerdOutcome;
}

export interface HerdTotals {
  attempts: number;
  served: number;
  /** Attempts turned away with 503 because the step was already full. */
  rejected: number;
  /** Attempts refused while the service was still restarting. */
  refused: number;
}

export interface HerdTick {
  attempts: number;
  served: number;
  marks: HerdMark[];
}

interface HerdState {
  steps: number;
  clients: HerdClient[];
  totals: HerdTotals;
}

export interface HerdCheckpoint {
  state: HerdState;
  rng: number;
}

/**
 * Every redirect server loses its connection at the same moment when the
 * ingest service restarts. Each one retries on the same schedule, with or
 * without jitter, against a service that takes a fixed number of attempts per
 * 50 ms step and has no queue.
 */
export class RetryHerd implements ModelAdapter<never, HerdTick, HerdCheckpoint> {
  readonly policy: HerdPolicy;
  private readonly rng: SeededRng;
  private state: HerdState;

  constructor(policy: HerdPolicy, seed = 42) {
    this.policy = policy;
    this.rng = createRng(seed);
    const clients: HerdClient[] = [];
    for (let i = 0; i < HERD_CLIENTS; i += 1) {
      const client: HerdClient = { attempts: 0, nextAt: null, servedAt: null };
      client.nextAt = this.nextAttemptAt(client, 0);
      clients.push(client);
    }
    this.state = {
      steps: 0,
      clients,
      totals: { attempts: 0, served: 0, rejected: 0, refused: 0 },
    };
  }

  get ticks(): number {
    return this.state.steps;
  }

  get totals(): Readonly<HerdTotals> {
    return this.state.totals;
  }

  get waiting(): number {
    return this.state.clients.filter((client) => client.servedAt === null).length;
  }

  /** Time the last sender got through, or null while any still wait. */
  get allServedAt(): number | null {
    if (this.waiting > 0) return null;
    return Math.max(...this.state.clients.map((client) => client.servedAt ?? 0));
  }

  apply(_command: never): void {}

  step(): HerdTick {
    const state = this.state;
    const step = state.steps;
    const now = step * HERD_STEP_MS;
    const due: number[] = [];
    state.clients.forEach((client, index) => {
      if (client.nextAt !== null && client.nextAt <= now) due.push(index);
    });
    const marks: HerdMark[] = [];
    let served = 0;
    if (now < HERD_RESTART_MS) {
      for (const index of due) {
        state.totals.refused += 1;
        marks.push({ step, client: index, outcome: 'refused' });
      }
    } else {
      const lucky = new Set<number>();
      const pool = [...due];
      while (lucky.size < HERD_CAPACITY && pool.length > 0) {
        const [pick] = pool.splice(randomInt(this.rng, 0, pool.length - 1), 1);
        if (pick !== undefined) lucky.add(pick);
      }
      for (const index of due) {
        const outcome: HerdOutcome = lucky.has(index) ? 'served' : 'rejected';
        if (outcome === 'served') served += 1;
        else state.totals.rejected += 1;
        marks.push({ step, client: index, outcome });
      }
    }
    for (const mark of marks) {
      const client = state.clients[mark.client];
      if (!client) continue;
      client.attempts += 1;
      state.totals.attempts += 1;
      if (mark.outcome === 'served') {
        client.servedAt = now;
        client.nextAt = null;
      } else {
        client.nextAt = this.nextAttemptAt(client, now);
      }
    }
    state.totals.served += served;
    state.steps += 1;
    return { attempts: marks.length, served, marks };
  }

  checkpoint(): HerdCheckpoint {
    return structuredClone({ state: this.state, rng: this.rng.getState() });
  }

  restore(checkpoint: HerdCheckpoint): void {
    const copy = structuredClone(checkpoint);
    this.state = copy.state;
    this.rng.setState(copy.rng);
  }

  /** The original send failed at time 0, so retry n waits on window n. */
  private nextAttemptAt(client: HerdClient, now: number): number {
    const window = Math.min(HERD_CAP_MS, HERD_BASE_MS * 2 ** client.attempts);
    const steps = window / HERD_STEP_MS;
    const wait = this.policy === 'backoff' ? steps : randomInt(this.rng, 1, steps);
    return now + wait * HERD_STEP_MS;
  }
}

export interface HerdLane {
  policy: HerdPolicy;
  label: string;
  herd: RetryHerd;
  /** Attempts per step. */
  series: number[];
  marks: HerdMark[];
  peakAttempts: number;
  /** Steps where the service had room but nobody tried. */
  idleSteps: number;
  announced: boolean;
}

export class HerdDuel {
  readonly length: number;
  readonly tickSeconds = HERD_STEP_MS / 1000;
  readonly lanes: [HerdLane, HerdLane];
  readonly events: RetryEvent[] = [];
  private tickCount = 0;

  constructor(seed = 42) {
    this.length = Math.round(HERD_RUN_SECONDS / this.tickSeconds);
    const lane = (policy: HerdPolicy): HerdLane => ({
      policy,
      label: herdPolicyLabels[policy],
      herd: new RetryHerd(policy, seed),
      series: [],
      marks: [],
      peakAttempts: 0,
      idleSteps: 0,
      announced: false,
    });
    this.lanes = [lane('backoff'), lane('jitter')];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (tick === 0)
      this.events.push({
        tick: 0,
        text: `The ingest service restarts and drops all ${HERD_CLIENTS} connections at once.`,
        marker: true,
      });
    if (tick * HERD_STEP_MS === HERD_RESTART_MS)
      this.events.push({
        tick,
        text: `The ingest service is back and takes ${HERD_CAPACITY} attempts every ${HERD_STEP_MS} ms.`,
        marker: true,
      });
    for (const lane of this.lanes) {
      const waitingBefore = lane.herd.waiting;
      const result = lane.herd.step();
      lane.series.push(result.attempts);
      lane.marks.push(...result.marks);
      lane.peakAttempts = Math.max(lane.peakAttempts, result.attempts);
      if (tick * HERD_STEP_MS >= HERD_RESTART_MS && waitingBefore > 0 && result.attempts === 0)
        lane.idleSteps += 1;
      const servedAt = lane.herd.allServedAt;
      if (!lane.announced && servedAt !== null) {
        lane.announced = true;
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: every redirect server is connected again at ${formatSeconds(servedAt / 1000)}, after ${lane.herd.totals.attempts} attempts.`,
          marker: true,
        });
      }
    }
    this.tickCount += 1;
    if (this.done) {
      const parts = this.lanes.map((lane) => {
        const waiting = lane.herd.waiting;
        return waiting > 0
          ? `${lane.label} still has ${waiting} of ${HERD_CLIENTS} waiting after ${lane.herd.totals.attempts} attempts`
          : `${lane.label} used ${lane.herd.totals.attempts} attempts`;
      });
      this.events.push({ tick: this.tickCount, text: `Run ends. ${parts.join('; ')}.`, marker: false });
    }
  }
}
