import { createRng, poisson, randomInt, type SeededRng } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';

/**
 * A toy model of a shared service behind a rate limiter. Clients send
 * requests in 100 ms ticks; a per-client limiter answers 429 or lets the
 * request through to one server with a bounded queue. Rejected clients may
 * retry at once or wait for Retry-After. All numbers are illustrative.
 *
 * Three seeded streams keep comparisons fair: the workload stream draws
 * arrivals and the policy stream draws retry jitter, so changing the limiter
 * never changes which requests arrive.
 */
export type LimiterConfig =
  | { kind: 'none' }
  | { kind: 'tokenBucket'; rate: number; burst: number }
  | { kind: 'fixedWindow'; limit: number; windowSeconds: number }
  | { kind: 'slidingWindow'; limit: number; windowSeconds: number };

export type LimiterKind = LimiterConfig['kind'];
export type RetryMode = 'none' | 'immediate' | 'retryAfter';

/** A client that sends all its traffic in bursts at fixed offsets of a cycle. */
export interface EdgePattern {
  burst: number;
  periodTicks: number;
  offsets: number[];
}

export interface ClientSpec {
  id: string;
  label: string;
  /** Average requests per second for Poisson clients. */
  rate: number;
  polite: boolean;
  edges?: EdgePattern;
}

export interface RateLimitConfig {
  clients: ClientSpec[];
  limiter: LimiterConfig;
  retry: RetryMode;
  /** Requests per second the server finishes. */
  capacity: number;
  /** Requests the server queue holds before it sheds new ones with 503. */
  queueLimit: number;
  maxRetries: number;
  tickSeconds: number;
  seed: number;
}

export type RateLimitCommand =
  | { type: 'setRate'; client: number; rate: number }
  | { type: 'setLimiter'; limiter: LimiterConfig };

export interface ClientTick {
  /** New requests this tick. */
  arrived: number;
  /** New requests plus retries that reached the limiter. */
  attempts: number;
  /** 429 responses sent this tick. */
  rejections: number;
  /** Requests whose final answer was 429 this tick. */
  limited: number;
  admitted: number;
  /** Requests the full server queue shed with 503. */
  failed: number;
  served: number;
}

export interface RateLimitTick {
  tick: number;
  clients: ClientTick[];
  attempts: number;
  rejections: number;
  limited: number;
  admitted: number;
  failed: number;
  served: number;
  queue: number;
  inFlight: number;
  /** What each client may still send right now: tokens, or room left in its window. */
  allowance: number[];
}

export interface ClientTotals {
  arrived: number;
  attempts: number;
  rejections: number;
  limited: number;
  admitted: number;
  failed: number;
  served: number;
  waitTicks: number;
}

interface LimiterState {
  tokens: number;
  windowIndex: number;
  count: number;
  slots: number[];
}

interface Pending {
  client: number;
  born: number;
  attempt: number;
  due: number;
}

interface Queued {
  client: number;
  born: number;
}

export interface RateLimitCheckpoint {
  ticks: number;
  rates: number[];
  limiter: LimiterConfig;
  limiterStates: LimiterState[];
  queue: Queued[];
  pending: Pending[];
  totals: ClientTotals[];
  recentAdmitted: number[];
  peakLoad: number;
  workload: number;
  policy: number;
}

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = {
  clients: [{ id: 'a', label: 'A', rate: 6, polite: true }],
  limiter: { kind: 'tokenBucket', rate: 10, burst: 20 },
  retry: 'none',
  capacity: 1000,
  queueLimit: 1000,
  maxRetries: 3,
  tickSeconds: 0.1,
  seed: 42,
};

const emptyTotals = (): ClientTotals => ({
  arrived: 0,
  attempts: 0,
  rejections: 0,
  limited: 0,
  admitted: 0,
  failed: 0,
  served: 0,
  waitTicks: 0,
});

const emptyClientTick = (): ClientTick => ({
  arrived: 0,
  attempts: 0,
  rejections: 0,
  limited: 0,
  admitted: 0,
  failed: 0,
  served: 0,
});

function windowTicks(limiter: LimiterConfig, tickSeconds: number): number {
  if (limiter.kind === 'fixedWindow' || limiter.kind === 'slidingWindow') {
    return Math.max(1, Math.round(limiter.windowSeconds / tickSeconds));
  }
  return 1;
}

function freshState(limiter: LimiterConfig, tickSeconds: number): LimiterState {
  return {
    tokens: limiter.kind === 'tokenBucket' ? limiter.burst : 0,
    windowIndex: 0,
    count: 0,
    slots: new Array<number>(windowTicks(limiter, tickSeconds)).fill(0),
  };
}

const mod = (value: number, n: number) => ((value % n) + n) % n;

export class RateLimitModel implements ModelAdapter<RateLimitCommand, RateLimitTick, RateLimitCheckpoint> {
  readonly config: RateLimitConfig;
  private tickCount = 0;
  private rates: number[];
  private limiter: LimiterConfig;
  private limiterStates: LimiterState[];
  private queue: Queued[] = [];
  private pending: Pending[] = [];
  private totals: ClientTotals[];
  private recentAdmitted: number[];
  private peak = 0;
  private readonly workload: SeededRng;
  private readonly policy: SeededRng;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...RATE_LIMIT_DEFAULTS, ...config };
    const { clients, limiter, tickSeconds, seed } = this.config;
    this.rates = clients.map((client) => client.rate);
    this.limiter = limiter;
    this.limiterStates = clients.map(() => freshState(limiter, tickSeconds));
    this.totals = clients.map(emptyTotals);
    this.recentAdmitted = new Array<number>(Math.round(1 / tickSeconds)).fill(0);
    this.workload = createRng(seed);
    this.policy = createRng(seed ^ 0x9e3779b9);
  }

  get ticks(): number {
    return this.tickCount;
  }

  get currentLimiter(): LimiterConfig {
    return this.limiter;
  }

  rateOf(client: number): number {
    return this.rates[client] ?? 0;
  }

  /** Requests a client may send right now: tokens left, or room left in the window. */
  allowanceOf(client: number): number {
    return this.allowance(client);
  }

  /** Whole-run counts per client. */
  clientTotals(): readonly ClientTotals[] {
    return this.totals;
  }

  /** Most requests admitted to the server in any one second so far. */
  get peakLoad(): number {
    return this.peak;
  }

  /** Requests still waiting: in the server queue or waiting to retry. */
  inFlight(client?: number): number {
    const match = (entry: { client: number }) => client === undefined || entry.client === client;
    return this.queue.filter(match).length + this.pending.filter(match).length;
  }

  apply(command: RateLimitCommand): void {
    if (command.type === 'setRate') {
      if (command.client >= 0 && command.client < this.rates.length) {
        this.rates[command.client] = Math.max(0, command.rate);
      }
      return;
    }
    const previous = this.limiter;
    const next = command.limiter;
    this.limiter = next;
    this.limiterStates = this.limiterStates.map((state) => {
      const fresh = freshState(next, this.config.tickSeconds);
      if (previous.kind === 'tokenBucket' && next.kind === 'tokenBucket') {
        fresh.tokens = Math.min(state.tokens, next.burst);
      }
      return fresh;
    });
  }

  step(): RateLimitTick {
    const tick = this.tickCount;
    const { clients, tickSeconds } = this.config;
    const perClient = clients.map(emptyClientTick);

    this.refill(tick);

    const attempts: { client: number; born: number; attempt: number; key: number }[] = [];
    const due = this.pending.filter((entry) => entry.due <= tick);
    this.pending = this.pending.filter((entry) => entry.due > tick);
    clients.forEach((client, index) => {
      const arrivals = this.arrivals(client, index, tick);
      const mine = due
        .filter((entry) => entry.client === index)
        .map((entry) => ({ client: index, born: entry.born, attempt: entry.attempt }));
      for (let i = 0; i < arrivals; i += 1) mine.push({ client: index, born: tick, attempt: 0 });
      const counts = perClient[index];
      if (counts) counts.arrived = arrivals;
      const totals = this.totals[index];
      if (totals) totals.arrived += arrivals;
      // Spread each client's requests evenly across the tick, then merge by time.
      mine.forEach((entry, j) => {
        attempts.push({ ...entry, key: (j + 0.5) / mine.length });
      });
    });
    attempts.sort((a, b) => a.key - b.key || a.client - b.client);

    let admittedNow = 0;
    for (const entry of attempts) {
      const counts = perClient[entry.client];
      const totals = this.totals[entry.client];
      if (!counts || !totals) continue;
      counts.attempts += 1;
      totals.attempts += 1;
      const waitTicks = this.decide(entry.client, tick);
      if (waitTicks === 0) {
        counts.admitted += 1;
        totals.admitted += 1;
        admittedNow += 1;
        if (this.queue.length < this.config.queueLimit) {
          this.queue.push({ client: entry.client, born: entry.born });
        } else {
          counts.failed += 1;
          totals.failed += 1;
        }
        continue;
      }
      counts.rejections += 1;
      totals.rejections += 1;
      if (this.config.retry === 'none' || entry.attempt >= this.config.maxRetries) {
        counts.limited += 1;
        totals.limited += 1;
        continue;
      }
      const delay =
        this.config.retry === 'immediate'
          ? 1
          : this.retryAfterTicks(waitTicks) + randomInt(this.policy, 0, Math.round(0.5 / tickSeconds));
      this.pending.push({
        client: entry.client,
        born: entry.born,
        attempt: entry.attempt + 1,
        due: tick + delay,
      });
    }

    const servable = Math.round(this.config.capacity * tickSeconds);
    const done = this.queue.splice(0, servable);
    for (const request of done) {
      const counts = perClient[request.client];
      const totals = this.totals[request.client];
      if (!counts || !totals) continue;
      counts.served += 1;
      totals.served += 1;
      totals.waitTicks += tick - request.born;
    }

    this.recentAdmitted[mod(tick, this.recentAdmitted.length)] = admittedNow;
    const load = this.recentAdmitted.reduce((sum, value) => sum + value, 0);
    this.peak = Math.max(this.peak, load);

    this.tickCount += 1;
    const sum = (key: keyof ClientTick) => perClient.reduce((total, counts) => total + counts[key], 0);
    return {
      tick,
      clients: perClient,
      attempts: sum('attempts'),
      rejections: sum('rejections'),
      limited: sum('limited'),
      admitted: sum('admitted'),
      failed: sum('failed'),
      served: sum('served'),
      queue: this.queue.length,
      inFlight: this.queue.length + this.pending.length,
      allowance: clients.map((_, index) => this.allowance(index)),
    };
  }

  checkpoint(): RateLimitCheckpoint {
    return {
      ticks: this.tickCount,
      rates: [...this.rates],
      limiter: this.limiter,
      limiterStates: this.limiterStates.map((state) => ({ ...state, slots: [...state.slots] })),
      queue: this.queue.map((entry) => ({ ...entry })),
      pending: this.pending.map((entry) => ({ ...entry })),
      totals: this.totals.map((totals) => ({ ...totals })),
      recentAdmitted: [...this.recentAdmitted],
      peakLoad: this.peak,
      workload: this.workload.getState(),
      policy: this.policy.getState(),
    };
  }

  restore(checkpoint: RateLimitCheckpoint): void {
    this.tickCount = checkpoint.ticks;
    this.rates = [...checkpoint.rates];
    this.limiter = checkpoint.limiter;
    this.limiterStates = checkpoint.limiterStates.map((state) => ({ ...state, slots: [...state.slots] }));
    this.queue = checkpoint.queue.map((entry) => ({ ...entry }));
    this.pending = checkpoint.pending.map((entry) => ({ ...entry }));
    this.totals = checkpoint.totals.map((totals) => ({ ...totals }));
    this.recentAdmitted = [...checkpoint.recentAdmitted];
    this.peak = checkpoint.peakLoad;
    this.workload.setState(checkpoint.workload);
    this.policy.setState(checkpoint.policy);
  }

  private arrivals(client: ClientSpec, index: number, tick: number): number {
    // Draw for every client every tick so the workload stream never depends on the policy.
    const drawn = poisson(this.workload, (this.rates[index] ?? 0) * this.config.tickSeconds);
    if (!client.edges) return drawn;
    const { burst, periodTicks, offsets } = client.edges;
    return offsets.includes(mod(tick, periodTicks)) ? burst : 0;
  }

  private refill(tick: number) {
    const limiter = this.limiter;
    for (const state of this.limiterStates) {
      if (limiter.kind === 'tokenBucket') {
        state.tokens = Math.min(limiter.burst, state.tokens + limiter.rate * this.config.tickSeconds);
      } else if (limiter.kind === 'fixedWindow') {
        const index = Math.floor(tick / state.slots.length);
        if (index !== state.windowIndex) {
          state.windowIndex = index;
          state.count = 0;
        }
      } else if (limiter.kind === 'slidingWindow') {
        state.slots[mod(tick, state.slots.length)] = 0;
      }
    }
  }

  /** Returns 0 to admit, or the ticks until this client may send again. */
  private decide(client: number, tick: number): number {
    const limiter = this.limiter;
    const state = this.limiterStates[client];
    if (!state || limiter.kind === 'none') return 0;
    if (limiter.kind === 'tokenBucket') {
      if (state.tokens >= 1) {
        state.tokens -= 1;
        return 0;
      }
      return Math.max(1, Math.ceil((1 - state.tokens) / (limiter.rate * this.config.tickSeconds)));
    }
    const size = state.slots.length;
    if (limiter.kind === 'fixedWindow') {
      if (state.count < limiter.limit) {
        state.count += 1;
        return 0;
      }
      return size - mod(tick, size);
    }
    const used = state.slots.reduce((sum, value) => sum + value, 0);
    if (used < limiter.limit) {
      const slot = mod(tick, size);
      state.slots[slot] = (state.slots[slot] ?? 0) + 1;
      return 0;
    }
    for (let k = tick - size + 1; k <= tick; k += 1) {
      if ((state.slots[mod(k, size)] ?? 0) > 0) return k + size - tick;
    }
    return 1;
  }

  /** Retry-After is whole seconds, so round the wait up and convert back to ticks. */
  private retryAfterTicks(waitTicks: number): number {
    const seconds = Math.max(1, Math.ceil(waitTicks * this.config.tickSeconds - 1e-9));
    return Math.round(seconds / this.config.tickSeconds);
  }

  private allowance(client: number): number {
    const limiter = this.limiter;
    const state = this.limiterStates[client];
    if (!state || limiter.kind === 'none') return Number.POSITIVE_INFINITY;
    if (limiter.kind === 'tokenBucket') return state.tokens;
    if (limiter.kind === 'fixedWindow') return limiter.limit - state.count;
    return limiter.limit - state.slots.reduce((sum, value) => sum + value, 0);
  }
}

export function describeLimiter(limiter: LimiterConfig): string {
  switch (limiter.kind) {
    case 'none':
      return 'No limit';
    case 'tokenBucket':
      return `Token bucket: ${limiter.rate} per s, burst ${limiter.burst}`;
    case 'fixedWindow':
      return `Fixed window: ${limiter.limit} per ${limiter.windowSeconds} s`;
    case 'slidingWindow':
      return `Sliding window: ${limiter.limit} per ${limiter.windowSeconds} s`;
  }
}

/* ------------------------------------------------------------------------ */
/* Scenarios: one lane for the token bucket playground, two for the duels.  */
/* ------------------------------------------------------------------------ */

export interface ScenarioEvent extends ScheduledCommand<RateLimitCommand> {
  text: string;
}

export interface RunEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export type ChartMetric = 'politeTrouble' | 'serverLoad' | 'rejections' | 'allowance';

export type ReadoutKey =
  | 'politeServed'
  | 'politeFailed'
  | 'politeWait'
  | 'noisyLimited'
  | 'peakLoad'
  | 'served'
  | 'gaveUp'
  | 'rejections'
  | 'attempts'
  | 'limited';

export interface LaneSpec {
  label: string;
  limiter: LimiterConfig;
  retry: RetryMode;
}

export interface RunScenario<Id extends string = string> {
  id: Id;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  seconds: number;
  base: Omit<RateLimitConfig, 'limiter' | 'retry' | 'seed'>;
  lanes: LaneSpec[];
  schedule: ScenarioEvent[];
  chart: ChartMetric;
  readout: ReadoutKey[];
}

const polite = (id: string, rate: number): ClientSpec => ({
  id,
  label: id.toUpperCase(),
  rate,
  polite: true,
});

const perClientBucket: LimiterConfig = { kind: 'tokenBucket', rate: 100, burst: 20 };

export type DuelId = 'noisy' | 'edges' | 'retries' | 'calm';

export const duelScenarios: Record<DuelId, RunScenario<DuelId>> = {
  noisy: {
    id: 'noisy',
    label: 'Noisy neighbor',
    diff: 'Client A: 50 to 400 req/s at 5 s',
    seconds: 20,
    base: {
      ...RATE_LIMIT_DEFAULTS,
      clients: [
        { id: 'a', label: 'A', rate: 50, polite: false },
        polite('b', 50),
        polite('c', 50),
        polite('d', 50),
      ],
      capacity: 300,
      queueLimit: 60,
    },
    lanes: [
      { label: 'No limit', limiter: { kind: 'none' }, retry: 'none' },
      { label: 'Token bucket per client', limiter: perClientBucket, retry: 'none' },
    ],
    schedule: [
      {
        at: 50,
        command: { type: 'setRate', client: 0, rate: 400 },
        text: 'Client A jumps from 50 to 400 req/s',
      },
    ],
    chart: 'politeTrouble',
    readout: ['politeServed', 'politeFailed', 'politeWait', 'noisyLimited'],
  },
  edges: {
    id: 'edges',
    label: 'Window edges',
    diff: 'Client A: 100 requests at 0.9 s and 1.0 s, every 2 s',
    seconds: 20,
    base: {
      ...RATE_LIMIT_DEFAULTS,
      clients: [
        {
          id: 'a',
          label: 'A',
          rate: 0,
          polite: false,
          edges: { burst: 100, periodTicks: 20, offsets: [9, 10] },
        },
        polite('b', 40),
        polite('c', 40),
      ],
      capacity: 300,
      queueLimit: 150,
    },
    lanes: [
      {
        label: 'Fixed window',
        limiter: { kind: 'fixedWindow', limit: 100, windowSeconds: 1 },
        retry: 'none',
      },
      {
        label: 'Sliding window',
        limiter: { kind: 'slidingWindow', limit: 100, windowSeconds: 1 },
        retry: 'none',
      },
    ],
    schedule: [],
    chart: 'serverLoad',
    readout: ['peakLoad', 'politeFailed', 'noisyLimited'],
  },
  retries: {
    id: 'retries',
    label: 'Retry storm',
    diff: 'Client A: 40 to 160 req/s from 5 s to 7 s',
    seconds: 20,
    base: {
      ...RATE_LIMIT_DEFAULTS,
      clients: [{ id: 'a', label: 'A', rate: 40, polite: false }, polite('b', 40)],
      capacity: 300,
      queueLimit: 60,
    },
    lanes: [
      { label: 'Retry at once', limiter: { kind: 'tokenBucket', rate: 60, burst: 30 }, retry: 'immediate' },
      {
        label: 'Wait for Retry-After',
        limiter: { kind: 'tokenBucket', rate: 60, burst: 30 },
        retry: 'retryAfter',
      },
    ],
    schedule: [
      {
        at: 50,
        command: { type: 'setRate', client: 0, rate: 160 },
        text: 'Client A bursts from 40 to 160 req/s',
      },
      { at: 70, command: { type: 'setRate', client: 0, rate: 40 }, text: 'Client A drops back to 40 req/s' },
    ],
    chart: 'rejections',
    readout: ['served', 'gaveUp', 'rejections', 'attempts'],
  },
  calm: {
    id: 'calm',
    label: 'Calm traffic',
    diff: 'Every client under its limit: no change',
    seconds: 20,
    base: {
      ...RATE_LIMIT_DEFAULTS,
      clients: [polite('a', 50), polite('b', 50), polite('c', 50), polite('d', 50)],
      capacity: 300,
      queueLimit: 60,
    },
    lanes: [
      { label: 'No limit', limiter: { kind: 'none' }, retry: 'none' },
      { label: 'Token bucket per client', limiter: perClientBucket, retry: 'none' },
    ],
    schedule: [],
    chart: 'serverLoad',
    readout: ['served', 'limited', 'politeWait'],
  },
};

export type BucketId = 'steady' | 'burst' | 'overload';

const bucketBase: RunScenario['base'] = {
  ...RATE_LIMIT_DEFAULTS,
  clients: [{ id: 'a', label: 'A', rate: 6, polite: true }],
};

const bucketLane = (rate: number, burst: number): LaneSpec => ({
  label: 'Token bucket',
  limiter: { kind: 'tokenBucket', rate, burst },
  retry: 'none',
});

export const BUCKET_RATE = 10;
export const BUCKET_BURST = 20;

export const bucketScenarios: Record<BucketId, RunScenario<BucketId>> = {
  steady: {
    id: 'steady',
    label: 'Steady',
    diff: '6 req/s against a refill of 10 tokens/s',
    seconds: 12,
    base: bucketBase,
    lanes: [bucketLane(BUCKET_RATE, BUCKET_BURST)],
    schedule: [],
    chart: 'allowance',
    readout: ['served', 'limited'],
  },
  burst: {
    id: 'burst',
    label: 'Burst',
    diff: 'Rate 6 to 30 req/s from 4 s to 6 s',
    seconds: 12,
    base: bucketBase,
    lanes: [bucketLane(BUCKET_RATE, BUCKET_BURST)],
    schedule: [
      { at: 40, command: { type: 'setRate', client: 0, rate: 30 }, text: 'Burst starts: 6 to 30 req/s' },
      { at: 60, command: { type: 'setRate', client: 0, rate: 6 }, text: 'Burst ends: back to 6 req/s' },
    ],
    chart: 'allowance',
    readout: ['served', 'limited'],
  },
  overload: {
    id: 'overload',
    label: 'Sustained overload',
    diff: 'Rate 6 to 15 req/s from 4 s on',
    seconds: 12,
    base: bucketBase,
    lanes: [bucketLane(BUCKET_RATE, BUCKET_BURST)],
    schedule: [
      {
        at: 40,
        command: { type: 'setRate', client: 0, rate: 15 },
        text: 'Rate rises from 6 to 15 req/s and stays',
      },
    ],
    chart: 'allowance',
    readout: ['served', 'limited'],
  },
};

export interface LaneSummary {
  arrived: number;
  served: number;
  limited: number;
  failed: number;
  rejections: number;
  attempts: number;
  inFlight: number;
  politeArrived: number;
  politeServed: number;
  politeFailed: number;
  politeLimited: number;
  /** Average seconds a served polite request waited in the server queue. */
  politeWait: number;
  noisyLimited: number;
  peakLoad: number;
}

export function summarize(model: RateLimitModel): LaneSummary {
  const totals = model.clientTotals();
  const clients = model.config.clients;
  const pick = (filter: (client: ClientSpec) => boolean, key: keyof ClientTotals) =>
    totals.reduce((sum, entry, index) => {
      const client = clients[index];
      return client && filter(client) ? sum + entry[key] : sum;
    }, 0);
  const all = () => true;
  const isPolite = (client: ClientSpec) => client.polite;
  const politeServed = pick(isPolite, 'served');
  return {
    arrived: pick(all, 'arrived'),
    served: pick(all, 'served'),
    limited: pick(all, 'limited'),
    failed: pick(all, 'failed'),
    rejections: pick(all, 'rejections'),
    attempts: pick(all, 'attempts'),
    inFlight: model.inFlight(),
    politeArrived: pick(isPolite, 'arrived'),
    politeServed,
    politeFailed: pick(isPolite, 'failed'),
    politeLimited: pick(isPolite, 'limited'),
    politeWait:
      politeServed > 0 ? (pick(isPolite, 'waitTicks') * model.config.tickSeconds) / politeServed : 0,
    noisyLimited: pick((client) => !client.polite, 'limited'),
    peakLoad: model.peakLoad,
  };
}

/**
 * Runs one scenario on one or two lanes. Every lane gets the same seed and
 * the same schedule, so they replay the same arrivals.
 */
export class LimiterRun {
  readonly scenario: RunScenario;
  readonly length: number;
  readonly tickSeconds: number;
  readonly lanes: RateLimitModel[];
  readonly series: number[][];
  readonly events: RunEvent[] = [];
  private tickCount = 0;
  private readonly windows: number[][];
  private readonly seen: Set<string>[];

  constructor(scenario: RunScenario, seed = 42) {
    this.scenario = scenario;
    this.tickSeconds = scenario.base.tickSeconds;
    this.length = Math.round(scenario.seconds / this.tickSeconds);
    this.lanes = scenario.lanes.map(
      (lane) => new RateLimitModel({ ...scenario.base, limiter: lane.limiter, retry: lane.retry, seed }),
    );
    this.series = this.lanes.map(() => []);
    const perSecond = Math.round(1 / this.tickSeconds);
    this.windows = this.lanes.map(() => new Array<number>(perSecond).fill(0));
    this.seen = this.lanes.map(() => new Set<string>());
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** Applies a live change, such as a slider, to every lane, and logs it when given a note. */
  apply(command: RateLimitCommand, note?: string) {
    for (const lane of this.lanes) lane.apply(command);
    if (note && !this.done) this.events.push({ tick: this.tickCount, text: note, marker: true });
  }

  step(): RateLimitTick[] {
    if (this.done) return [];
    const tick = this.tickCount;
    for (const entry of this.scenario.schedule) {
      if (entry.at === tick) this.events.push({ tick, text: entry.text, marker: true });
    }
    const results = this.lanes.map((lane) => stepScheduled(lane, this.scenario.schedule));
    results.forEach((result, index) => {
      this.series[index]?.push(this.chartValue(index, result));
      this.detect(index, result);
    });
    this.tickCount += 1;
    if (this.done) this.events.push({ tick: this.length, text: this.endNote(), marker: false });
    return results;
  }

  private chartValue(index: number, result: RateLimitTick): number {
    const lane = this.lanes[index];
    const window = this.windows[index];
    if (!lane || !window) return 0;
    const clients = lane.config.clients;
    let value = 0;
    switch (this.scenario.chart) {
      case 'allowance':
        return Math.floor(result.allowance[0] ?? 0);
      case 'serverLoad':
        value = result.admitted;
        break;
      case 'rejections':
        value = result.rejections;
        break;
      case 'politeTrouble':
        value = result.clients.reduce(
          (sum, counts, i) => (clients[i]?.polite ? sum + counts.failed + counts.limited : sum),
          0,
        );
        break;
    }
    window[mod(result.tick, window.length)] = value;
    return window.reduce((sum, entry) => sum + entry, 0);
  }

  private detect(index: number, result: RateLimitTick) {
    const lane = this.lanes[index];
    const seen = this.seen[index];
    if (!lane || !seen) return;
    const label = this.lanes.length > 1 ? `${this.scenario.lanes[index]?.label}: ` : '';
    const once = (key: string, text: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      this.events.push({ tick: result.tick, text: label + text, marker: true });
    };
    const clients = lane.config.clients;
    result.clients.forEach((counts, i) => {
      const name = clients[i]?.label ?? '?';
      if (counts.rejections > 0) {
        once(
          `429-${i}`,
          this.lanes.length > 1 ? `first 429 for client ${name}` : 'Bucket empty: requests now get 429',
        );
      }
      if (counts.failed > 0 && clients[i]?.polite) {
        once('503', `server queue full, client ${name} gets 503`);
      }
      if (counts.limited > 0 && lane.config.retry !== 'none') {
        once(`gave-up-${i}`, `client ${name} gives up after ${lane.config.maxRetries} retries`);
      }
    });
    if (this.lanes.length === 1 && seen.has('429-0')) {
      const limiter = lane.currentLimiter;
      if (limiter.kind === 'tokenBucket' && (result.allowance[0] ?? 0) >= limiter.burst) {
        once('refilled', 'Bucket full again');
      }
    }
  }

  private endNote(): string {
    const summaries = this.lanes.map(summarize);
    const names = this.scenario.lanes.map((lane) => lane.label);
    const part = (index: number, text: (s: LaneSummary) => string) => {
      const summary = summaries[index];
      return summary ? `${names[index]} ${text(summary)}` : '';
    };
    const pct = (count: number, whole: number) =>
      whole > 0 ? `${Math.round((count / whole) * 100)}%` : '0%';
    switch (this.scenario.chart) {
      case 'politeTrouble':
        return `Run complete. Polite clients got ${this.lanes
          .map((_, i) => part(i, (s) => `${pct(s.politeServed, s.politeArrived)} served`))
          .join(', ')}.`;
      case 'serverLoad':
        return `Run complete. Busiest second at the server: ${this.lanes
          .map((_, i) => part(i, (s) => `${s.peakLoad} requests`))
          .join(', ')}.`;
      case 'rejections':
        return `Run complete. Requests that gave up: ${this.lanes
          .map((_, i) => part(i, (s) => `${s.limited} of ${s.arrived}`))
          .join(', ')}.`;
      case 'allowance': {
        const summary = summaries[0];
        return summary
          ? `Run complete: ${summary.served} of ${summary.arrived} requests served, ${summary.limited} got 429.`
          : 'Run complete.';
      }
    }
  }
}
