import { createRng, poisson, randomInt, type SeededRng } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';
import { percentile } from './serverFarm';

/**
 * A toy sho.rt server: a pool of workers takes requests from a short queue,
 * and each request runs one link lookup on database replica A, B, or C
 * through a shared connection pool. Healthy replicas answer in 10 to 30 ms
 * and never run out of capacity. Time moves in 10 ms substeps so timeouts
 * fire close to their deadline.
 */
export type TimeoutPolicy = 'none' | 'cancel-150' | 'nocancel-150' | 'cancel-2000';

export const policyLabels: Record<TimeoutPolicy, string> = {
  none: 'No timeout',
  'cancel-150': '150 ms timeout',
  'nocancel-150': '150 ms, no cancel',
  'cancel-2000': '2 s timeout',
};

interface PolicySpec {
  timeoutMs: number | null;
  /** Whether a timed out request also stops its database query. */
  cancel: boolean;
}

const policySpecs: Record<TimeoutPolicy, PolicySpec> = {
  none: { timeoutMs: null, cancel: false },
  'cancel-150': { timeoutMs: 150, cancel: true },
  'nocancel-150': { timeoutMs: 150, cancel: false },
  'cancel-2000': { timeoutMs: 2000, cancel: true },
};

export const REPLICAS = ['A', 'B', 'C'] as const;
export const HUNG_REPLICA = 2;
export const TICK_MS = 100;
const SUBSTEP_MS = 10;
const SUBSTEPS = TICK_MS / SUBSTEP_MS;
/** Healthy lookups take at most 30 ms, so anything held this long is stuck. */
export const SLOW_MS = 100;

export interface TimeoutServerConfig {
  policy: TimeoutPolicy;
  seed: number;
  /** Requests per second. */
  arrivalRate: number;
  workers: number;
  /** Requests that may wait for a worker before new ones get 503. */
  queueLimit: number;
  connections: number;
}

export const defaultTimeoutConfig: TimeoutServerConfig = {
  policy: 'none',
  seed: 42,
  arrivalRate: 50,
  workers: 16,
  queueLimit: 16,
  connections: 16,
};

export type TimeoutCommand = { type: 'hang'; replica: number } | { type: 'recover'; replica: number };

interface Job {
  id: number;
  arrivedAt: number;
  replica: number;
  queryMs: number;
}

interface Working extends Job {
  startedAt: number;
}

interface Query {
  id: number;
  replica: number;
  queryMs: number;
  /** True once the request behind this query has given up. */
  orphan: boolean;
  startedAt: number;
  /** Infinity while the replica does not answer. */
  doneAt: number;
}

export interface TimeoutTotals {
  arrived: number;
  served: number;
  /** Turned away with 503 because the server queue was full. */
  rejected: number;
  /** Timed out with 504. */
  failed: number;
  /** Queries stopped because their request timed out. */
  cancelled: number;
  /** Queries the database finished after their request had already given up. */
  ranForNobody: number;
}

export interface TimeoutTick {
  arrived: number;
  served: number;
  rejected: number;
  failed: number;
  latencies: number[];
  busyWorkers: number;
  busyConnections: number;
}

interface TimeoutState {
  ticks: number;
  nextId: number;
  hung: boolean[];
  queue: Job[];
  working: Working[];
  poolQueue: Query[];
  running: Query[];
  totals: TimeoutTotals;
}

export interface TimeoutCheckpoint {
  state: TimeoutState;
  rng: number;
}

export type CellState = 'idle' | 'working' | 'waiting' | 'nobody';

export interface TimeoutSnapshot {
  workers: CellState[];
  connections: CellState[];
  queued: number;
  /** Queries waiting for a database connection, including abandoned ones. */
  poolWaiting: number;
  poolWaitingForNobody: number;
}

function emptyTotals(): TimeoutTotals {
  return { arrived: 0, served: 0, rejected: 0, failed: 0, cancelled: 0, ranForNobody: 0 };
}

export class TimeoutServer implements ModelAdapter<TimeoutCommand, TimeoutTick, TimeoutCheckpoint> {
  readonly config: TimeoutServerConfig;
  private readonly spec: PolicySpec;
  private readonly rng: SeededRng;
  private state: TimeoutState;

  constructor(config: Partial<TimeoutServerConfig> = {}) {
    this.config = { ...defaultTimeoutConfig, ...config };
    this.spec = policySpecs[this.config.policy];
    this.rng = createRng(this.config.seed);
    this.state = {
      ticks: 0,
      nextId: 0,
      hung: REPLICAS.map(() => false),
      queue: [],
      working: [],
      poolQueue: [],
      running: [],
      totals: emptyTotals(),
    };
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get totals(): Readonly<TimeoutTotals> {
    return this.state.totals;
  }

  /** Requests still inside the server: queued or holding a worker. */
  get inFlight(): number {
    return this.state.queue.length + this.state.working.length;
  }

  apply(command: TimeoutCommand): void {
    const now = this.state.ticks * TICK_MS;
    switch (command.type) {
      case 'hang':
        this.state.hung[command.replica] = true;
        for (const query of this.state.running) {
          if (query.replica === command.replica) query.doneAt = Number.POSITIVE_INFINITY;
        }
        return;
      case 'recover':
        this.state.hung[command.replica] = false;
        for (const query of this.state.running) {
          if (query.replica === command.replica && query.doneAt === Number.POSITIVE_INFINITY) {
            query.doneAt = now + query.queryMs;
          }
        }
        return;
    }
  }

  step(): TimeoutTick {
    const before = { ...this.state.totals };
    const latencies: number[] = [];
    const base = this.state.ticks * TICK_MS;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      const now = base + sub * SUBSTEP_MS;
      this.complete(now, latencies);
      this.expire(now);
      this.arrive(now);
      this.assignWorkers(now);
      this.assignConnections(now);
    }
    this.state.ticks += 1;
    const totals = this.state.totals;
    return {
      arrived: totals.arrived - before.arrived,
      served: totals.served - before.served,
      rejected: totals.rejected - before.rejected,
      failed: totals.failed - before.failed,
      latencies,
      busyWorkers: this.state.working.length,
      busyConnections: this.state.running.length,
    };
  }

  snapshot(): TimeoutSnapshot {
    const now = this.state.ticks * TICK_MS;
    const { workers, connections } = this.config;
    const workerCells: CellState[] = this.state.working.map((job) =>
      now - job.startedAt > SLOW_MS ? 'waiting' : 'working',
    );
    const connectionCells: CellState[] = this.state.running.map((query) => {
      if (query.orphan) return 'nobody';
      return now - query.startedAt > SLOW_MS ? 'waiting' : 'working';
    });
    const pad = (cells: CellState[], size: number) => [
      ...cells,
      ...Array<CellState>(size - cells.length).fill('idle'),
    ];
    return {
      workers: pad(workerCells, workers),
      connections: pad(connectionCells, connections),
      queued: this.state.queue.length,
      poolWaiting: this.state.poolQueue.length,
      poolWaitingForNobody: this.state.poolQueue.filter((query) => query.orphan).length,
    };
  }

  checkpoint(): TimeoutCheckpoint {
    return structuredClone({ state: this.state, rng: this.rng.getState() });
  }

  restore(checkpoint: TimeoutCheckpoint): void {
    const copy = structuredClone(checkpoint);
    this.state = copy.state;
    this.rng.setState(copy.rng);
  }

  private complete(now: number, latencies: number[]): void {
    const state = this.state;
    const finished = state.running.filter((query) => query.doneAt <= now);
    if (finished.length === 0) return;
    state.running = state.running.filter((query) => query.doneAt > now);
    for (const query of finished) {
      if (query.orphan) {
        state.totals.ranForNobody += 1;
        continue;
      }
      const index = state.working.findIndex((job) => job.id === query.id);
      const [job] = state.working.splice(index, 1);
      if (!job) continue;
      state.totals.served += 1;
      latencies.push(now - job.arrivedAt);
    }
  }

  private expire(now: number): void {
    const { timeoutMs, cancel } = this.spec;
    if (timeoutMs === null) return;
    const state = this.state;
    const expired = state.working.filter((job) => now - job.startedAt >= timeoutMs);
    if (expired.length === 0) return;
    state.working = state.working.filter((job) => now - job.startedAt < timeoutMs);
    for (const job of expired) {
      state.totals.failed += 1;
      const waiting = state.poolQueue.findIndex((query) => query.id === job.id);
      const running = state.running.findIndex((query) => query.id === job.id);
      if (cancel) {
        if (waiting >= 0) state.poolQueue.splice(waiting, 1);
        if (running >= 0) {
          state.running.splice(running, 1);
          state.totals.cancelled += 1;
        }
        continue;
      }
      const query = state.poolQueue[waiting] ?? state.running[running];
      if (query) query.orphan = true;
    }
  }

  private arrive(now: number): void {
    const state = this.state;
    const count = poisson(this.rng, (this.config.arrivalRate * SUBSTEP_MS) / 1000);
    for (let i = 0; i < count; i += 1) {
      const job: Job = {
        id: state.nextId,
        arrivedAt: now,
        replica: randomInt(this.rng, 0, REPLICAS.length - 1),
        queryMs: SUBSTEP_MS * randomInt(this.rng, 1, 3),
      };
      state.nextId += 1;
      state.totals.arrived += 1;
      if (state.queue.length < this.config.queueLimit) state.queue.push(job);
      else state.totals.rejected += 1;
    }
  }

  private assignWorkers(now: number): void {
    const state = this.state;
    while (state.working.length < this.config.workers) {
      const job = state.queue.shift();
      if (!job) return;
      state.working.push({ ...job, startedAt: now });
      state.poolQueue.push({
        id: job.id,
        replica: job.replica,
        queryMs: job.queryMs,
        orphan: false,
        startedAt: -1,
        doneAt: Number.POSITIVE_INFINITY,
      });
    }
  }

  private assignConnections(now: number): void {
    const state = this.state;
    while (state.running.length < this.config.connections) {
      const query = state.poolQueue.shift();
      if (!query) return;
      query.startedAt = now;
      query.doneAt = state.hung[query.replica] ? Number.POSITIVE_INFINITY : now + query.queryMs;
      state.running.push(query);
    }
  }
}

/* Two policies side by side on the same traffic */

export type TimeoutScenarioId = 'healthy' | 'hang' | 'long' | 'nocancel';
export type TimeoutMetric = 'workers' | 'connections';

export interface TimeoutScenario {
  id: TimeoutScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  policies: [TimeoutPolicy, TimeoutPolicy];
  schedule: ScheduledCommand<TimeoutCommand>[];
  metric: TimeoutMetric;
}

export interface TimeoutEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const TIMEOUT_RUN_SECONDS = 20;
export const HANG_TICK = 30;
export const RECOVER_TICK = 120;

const hangSchedule: ScheduledCommand<TimeoutCommand>[] = [
  { at: HANG_TICK, command: { type: 'hang', replica: HUNG_REPLICA } },
  { at: RECOVER_TICK, command: { type: 'recover', replica: HUNG_REPLICA } },
];

export const timeoutScenarios: Record<TimeoutScenarioId, TimeoutScenario> = {
  healthy: {
    id: 'healthy',
    label: 'All replicas healthy',
    diff: 'Baseline: 50 req/s, 16 workers, 16 database connections, lookups take 10 to 30 ms. No timeout against 150 ms.',
    policies: ['none', 'cancel-150'],
    schedule: [],
    metric: 'workers',
  },
  hang: {
    id: 'hang',
    label: 'Replica C hangs',
    diff: 'Replica C stops answering from 3 s to 12 s. No timeout against 150 ms.',
    policies: ['none', 'cancel-150'],
    schedule: hangSchedule,
    metric: 'workers',
  },
  long: {
    id: 'long',
    label: 'Timeout too long',
    diff: 'Same hang. Timeout: 2 s against 150 ms, both cancel the query.',
    policies: ['cancel-2000', 'cancel-150'],
    schedule: hangSchedule,
    metric: 'workers',
  },
  nocancel: {
    id: 'nocancel',
    label: 'Timeout without cancel',
    diff: 'Same hang. Both time out at 150 ms; only one also cancels the database query.',
    policies: ['nocancel-150', 'cancel-150'],
    schedule: hangSchedule,
    metric: 'connections',
  },
};

export interface TimeoutLane {
  policy: TimeoutPolicy;
  label: string;
  server: TimeoutServer;
  /** One value per tick for the scenario's metric. */
  series: number[];
  latencies: number[];
  peakWorkers: number;
  peakConnections: number;
  seen: { failed: boolean; rejected: boolean; full: boolean };
  /** Set at recovery, cleared on the first tick without errors. */
  recoveringSince: number | null;
}

export class TimeoutDuel {
  readonly scenario: TimeoutScenario;
  readonly length: number;
  readonly tickSeconds = TICK_MS / 1000;
  readonly lanes: [TimeoutLane, TimeoutLane];
  readonly events: TimeoutEvent[] = [];
  private tickCount = 0;

  constructor(scenario: TimeoutScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(TIMEOUT_RUN_SECONDS / this.tickSeconds);
    const lane = (policy: TimeoutPolicy): TimeoutLane => ({
      policy,
      label: policyLabels[policy],
      server: new TimeoutServer({ policy, seed }),
      series: [],
      latencies: [],
      peakWorkers: 0,
      peakConnections: 0,
      seen: { failed: false, rejected: false, full: false },
      recoveringSince: null,
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
    for (const entry of schedule) {
      if (entry.at === tick)
        this.events.push({ tick, text: describeTimeoutCommand(entry.command), marker: true });
    }
    for (const lane of this.lanes) {
      const result = stepScheduled(lane.server, schedule);
      const { config, totals } = lane.server;
      lane.latencies.push(...result.latencies);
      lane.series.push(metric === 'workers' ? result.busyWorkers : result.busyConnections);
      lane.peakWorkers = Math.max(lane.peakWorkers, result.busyWorkers);
      lane.peakConnections = Math.max(lane.peakConnections, result.busyConnections);
      const at = tick + 1;
      if (!lane.seen.failed && totals.failed > 0) {
        lane.seen.failed = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: the first request times out with a 504.`,
          marker: true,
        });
      }
      const full =
        metric === 'workers'
          ? result.busyWorkers >= config.workers
          : result.busyConnections >= config.connections;
      if (!lane.seen.full && full) {
        lane.seen.full = true;
        const text =
          metric === 'workers'
            ? `${lane.label}: all ${config.workers} workers are busy.`
            : `${lane.label}: all ${config.connections} database connections are taken.`;
        this.events.push({ tick: at, text, marker: true });
      }
      if (!lane.seen.rejected && totals.rejected > 0) {
        lane.seen.rejected = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: the server queue is full, so new requests get a 503.`,
          marker: true,
        });
      }
      if (schedule.some((entry) => entry.command.type === 'recover' && entry.at === tick))
        lane.recoveringSince = tick;
      if (lane.recoveringSince !== null && result.failed + result.rejected === 0) {
        const lag = at - lane.recoveringSince;
        if (lag >= 3) {
          this.events.push({
            tick: at,
            text: `${lane.label}: requests succeed again, ${formatSeconds(lag * this.tickSeconds)} after replica C recovered.`,
            marker: true,
          });
        }
        lane.recoveringSince = null;
      }
    }
    this.tickCount += 1;
    if (this.done) {
      const [first, second] = this.lanes;
      const a = first.server.totals;
      const b = second.server.totals;
      let text = `Run ends. Served: ${first.label} ${a.served}, ${second.label} ${b.served}.`;
      if (a.ranForNobody + b.ranForNobody > 0) {
        text += ` Queries the database finished for nobody: ${first.label} ${a.ranForNobody}, ${second.label} ${b.ranForNobody}.`;
      }
      this.events.push({ tick: this.tickCount, text, marker: false });
    }
  }
}

export interface TimeoutSummary {
  arrived: number;
  served: number;
  rejected: number;
  failed: number;
  p95Ms: number;
  maxMs: number;
  peakWorkers: number;
  peakConnections: number;
  ranForNobody: number;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarizeTimeouts(lane: TimeoutLane): TimeoutSummary {
  const sorted = [...lane.latencies].sort((a, b) => a - b);
  const totals = lane.server.totals;
  return {
    arrived: totals.arrived,
    served: totals.served,
    rejected: totals.rejected,
    failed: totals.failed,
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    peakWorkers: lane.peakWorkers,
    peakConnections: lane.peakConnections,
    ranForNobody: totals.ranForNobody,
  };
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

function describeTimeoutCommand(command: TimeoutCommand): string {
  switch (command.type) {
    case 'hang':
      return `Replica ${REPLICAS[command.replica]} stops answering.`;
    case 'recover':
      return `Replica ${REPLICAS[command.replica]} answers again.`;
  }
}

/* One request crossing three hops toward a 1 s deadline */

export type BudgetMode = 'fixed' | 'propagate';
export type HopId = 'client' | 'gateway' | 'server' | 'database';

export const CLIENT_DEADLINE_MS = 1000;
const GATEWAY_WORK_MS = 10;
const SERVER_WORK_MS = 30;
/** Each hop's own fixed timeout for the call it makes, in the fixed mode. */
export const FIXED_TIMEOUTS_MS = { client: 1000, gateway: 3000, server: 5000 } as const;

export interface BudgetHop {
  id: HopId;
  label: string;
  startMs: number;
  endMs: number;
  /** How the hop stopped: it got its answer, its own timer fired, or the deadline cancelled it. */
  outcome: 'answered' | 'timed-out' | 'cancelled';
  /** The longest this hop is willing to wait or run, from its start. */
  allowanceMs: number;
  /** Time this hop kept going after the client had already given up. */
  afterGiveUpMs: number;
}

export interface BudgetPlan {
  mode: BudgetMode;
  queryMs: number;
  hops: BudgetHop[];
  clientAnswered: boolean;
  clientDoneMs: number;
  lastStopMs: number;
  /** How long the last hop kept working after the client gave up. */
  lateMs: number;
  /** Hops still working after the client gave up. */
  lateHops: number;
}

/**
 * Times for one redirect that passes client, gateway, sho.rt server, and
 * the link database. Answers travel back instantly in this toy model.
 */
export function planDeadline(queryMs: number, mode: BudgetMode): BudgetPlan {
  const gatewayCalls = GATEWAY_WORK_MS;
  const serverCalls = GATEWAY_WORK_MS + SERVER_WORK_MS;
  const answerAt = serverCalls + queryMs;
  const hop = (
    id: HopId,
    label: string,
    startMs: number,
    stopAt: number,
    allowanceMs: number,
    stopped: BudgetHop['outcome'],
  ): BudgetHop => {
    const endMs = Math.min(answerAt, stopAt);
    return {
      id,
      label,
      startMs,
      endMs,
      allowanceMs,
      outcome: endMs < answerAt ? stopped : 'answered',
      afterGiveUpMs: 0,
    };
  };
  let hops: BudgetHop[];
  if (mode === 'fixed') {
    const database = hop(
      'database',
      'Link database',
      serverCalls,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      'answered',
    );
    const server = hop(
      'server',
      'sho.rt server',
      gatewayCalls,
      serverCalls + FIXED_TIMEOUTS_MS.server,
      SERVER_WORK_MS + FIXED_TIMEOUTS_MS.server,
      'timed-out',
    );
    const gatewayStop = Math.min(server.endMs, gatewayCalls + FIXED_TIMEOUTS_MS.gateway);
    const gateway = hop(
      'gateway',
      'API gateway',
      0,
      gatewayStop,
      GATEWAY_WORK_MS + FIXED_TIMEOUTS_MS.gateway,
      'timed-out',
    );
    const client = hop(
      'client',
      'Client app',
      0,
      Math.min(gateway.endMs, FIXED_TIMEOUTS_MS.client),
      FIXED_TIMEOUTS_MS.client,
      'timed-out',
    );
    hops = [client, gateway, server, database];
  } else {
    const deadline = CLIENT_DEADLINE_MS;
    hops = [
      hop('client', 'Client app', 0, deadline, deadline, 'timed-out'),
      hop('gateway', 'API gateway', 0, deadline, deadline, 'cancelled'),
      hop('server', 'sho.rt server', gatewayCalls, deadline, deadline - gatewayCalls, 'cancelled'),
      hop('database', 'Link database', serverCalls, deadline, deadline - serverCalls, 'cancelled'),
    ];
  }
  const client = hops[0] as BudgetHop;
  const clientAnswered = client.outcome === 'answered';
  if (!clientAnswered) {
    for (const entry of hops) entry.afterGiveUpMs = Math.max(0, entry.endMs - client.endMs);
  }
  const lastStopMs = Math.max(...hops.map((entry) => entry.endMs));
  return {
    mode,
    queryMs,
    hops,
    clientAnswered,
    clientDoneMs: client.endMs,
    lastStopMs,
    lateMs: lastStopMs - client.endMs,
    lateHops: hops.filter((entry) => entry.afterGiveUpMs > 0).length,
  };
}
