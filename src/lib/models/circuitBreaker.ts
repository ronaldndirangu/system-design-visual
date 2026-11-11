import { createRng, poisson, randomInt, type SeededRng } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';
import { percentile } from './serverFarm';

/**
 * A toy redirect server that records each click by calling the analytics
 * ingest service before it answers the redirect. A worker that waits on a hung
 * call cannot answer anyone else, so an analytics outage can take redirects
 * down with it. A circuit breaker watches recent call outcomes, stops calling a
 * dependency that keeps failing, and buffers the click locally instead. Time
 * moves in 10 ms substeps. Ingest recovers on schedule whatever its load, which
 * a real overloaded service may not do.
 */
export type BreakerPolicy = 'none' | 'breaker' | 'flood';

export const breakerPolicyLabels: Record<BreakerPolicy, string> = {
  none: 'No breaker',
  breaker: 'Breaker, 3 probes',
  flood: 'Breaker, no probe limit',
};

export type BreakerState = 'closed' | 'open' | 'half-open';

export const breakerStateLabels: Record<BreakerState, string> = {
  closed: 'Closed',
  open: 'Open',
  'half-open': 'Half-open',
};

const TICK_MS = 100;
const SUBSTEP_MS = 10;
const SUBSTEPS = TICK_MS / SUBSTEP_MS;
/** Time to look up the long URL before the click call. */
export const LOOKUP_MS = 10;
/** Time to write a click to the local buffer instead of calling ingest. */
export const BUFFER_MS = 10;
/** The redirect worker stops waiting for the ingest call after this long. */
export const CALL_TIMEOUT_MS = 500;
export const TRANSIENT_RATE = 0.02;
/** The breaker judges ingest on the calls that finished in this rolling window. */
export const WINDOW_MS = 1000;
/** The breaker never opens on fewer calls than this, so a handful of errors cannot trip it. */
export const MIN_CALLS = 20;
/** The breaker opens when at least this share of the calls in the window failed. */
export const FAILURE_THRESHOLD = 0.5;
/** How long the breaker stays open before it tries ingest again. */
export const COOLDOWN_MS = 2000;
/** Trial calls a half-open breaker lets through. All must succeed to close it. */
export const PROBES = 3;

export interface BreakerServerConfig {
  policy: BreakerPolicy;
  seed: number;
  /** Redirects per second. Each one records one click. */
  arrivalRate: number;
  workers: number;
  /** Redirects that may wait for a worker before new ones get 503. */
  queueLimit: number;
}

export const defaultBreakerConfig: BreakerServerConfig = {
  policy: 'none',
  seed: 42,
  arrivalRate: 150,
  workers: 16,
  queueLimit: 64,
};

export type BreakerCommand = { type: 'hang' } | { type: 'down' } | { type: 'up' };

type IngestHealth = 'healthy' | 'hang' | 'down';
type CallOutcome = 'ok' | 'error' | 'timeout' | 'refused';

interface Redirect {
  id: number;
  arrivedAt: number;
}

interface Job extends Redirect {
  doneAt: number;
  /** A call to ingest, or a short circuit straight to the local buffer. */
  kind: 'call' | 'short';
  callStart: number;
  /** Sealed when the call starts: a hung call stays hung after ingest heals. */
  outcome: CallOutcome;
  /** The half-open round this trial call belongs to, or -1 for an ordinary call. */
  probeRound: number;
}

interface CallRecord {
  at: number;
  failed: boolean;
}

interface Breaker {
  state: BreakerState;
  /** Outcomes of calls that finished while the breaker was closed, newest last. */
  window: CallRecord[];
  openUntil: number;
  /** Counts half-open rounds, so a late probe from an old round never decides a new one. */
  round: number;
  probesSent: number;
  probeSuccesses: number;
  /** What the window held when the breaker last opened from closed. */
  tripFailures: number;
  tripCalls: number;
}

export interface BreakerTotals {
  /** Redirects that reached the server. */
  arrived: number;
  /** Redirects sent to the user, with the click recorded or buffered. */
  answered: number;
  /** Clicks the ingest service stored. */
  recorded: number;
  /** Clicks written to the local buffer for a later upload. */
  buffered: number;
  /** Redirects turned away with 503 at a full queue. */
  rejected: number;
  /** Calls sent to the ingest service. */
  calls: number;
  /** Calls that ended in an error, a refusal, or a timeout. */
  callFailures: number;
  timedOut: number;
  /** Redirects that skipped the call because the breaker was open. */
  shortCircuited: number;
  /** Times the breaker opened, from closed or after a failed probe. */
  opens: number;
  /** Times the breaker closed after enough probes succeeded. */
  closes: number;
  /** Trial calls sent while half-open. */
  probes: number;
  /** Probes that failed and sent the breaker back to open. */
  failedProbes: number;
  /** Milliseconds the breaker spent open. */
  openMs: number;
}

export interface BreakerTick {
  answered: number;
  recorded: number;
  buffered: number;
  rejected: number;
  calls: number;
  timedOut: number;
  shortCircuited: number;
  /** Response times of the redirects answered this tick, in ms. */
  latencies: number[];
  busyWorkers: number;
  state: BreakerState;
}

interface BreakerServerState {
  ticks: number;
  nextRedirect: number;
  ingest: IngestHealth;
  queue: Redirect[];
  working: Job[];
  breaker: Breaker;
  totals: BreakerTotals;
}

export interface BreakerCheckpoint {
  state: BreakerServerState;
  arrivals: number;
  work: number;
}

/** Busy means a lookup, a buffer write, or a call under 100 ms. Stuck means waiting on ingest longer. */
export type BreakerCellState = 'idle' | 'busy' | 'stuck';

export interface BreakerSnapshot {
  workers: BreakerCellState[];
  queued: number;
  state: BreakerState;
  windowCalls: number;
  windowFailures: number;
  cooldownLeftMs: number;
  /** Probes of the current half-open round still waiting for an answer. */
  probesOut: number;
  probesSent: number;
  ingest: IngestHealth;
}

function emptyBreakerTotals(): BreakerTotals {
  return {
    arrived: 0,
    answered: 0,
    recorded: 0,
    buffered: 0,
    rejected: 0,
    calls: 0,
    callFailures: 0,
    timedOut: 0,
    shortCircuited: 0,
    opens: 0,
    closes: 0,
    probes: 0,
    failedProbes: 0,
    openMs: 0,
  };
}

export class BreakerServer implements ModelAdapter<BreakerCommand, BreakerTick, BreakerCheckpoint> {
  readonly config: BreakerServerConfig;
  /** Drives redirect arrivals only, so every policy sees the same traffic. */
  private readonly arrivals: SeededRng;
  /** Drives call times and transient errors. */
  private readonly work: SeededRng;
  private state: BreakerServerState;

  constructor(config: Partial<BreakerServerConfig> = {}) {
    this.config = { ...defaultBreakerConfig, ...config };
    this.arrivals = createRng(this.config.seed);
    this.work = createRng(this.config.seed ^ 0x5bd1e995);
    this.state = {
      ticks: 0,
      nextRedirect: 0,
      ingest: 'healthy',
      queue: [],
      working: [],
      breaker: {
        state: 'closed',
        window: [],
        openUntil: 0,
        round: 0,
        probesSent: 0,
        probeSuccesses: 0,
        tripFailures: 0,
        tripCalls: 0,
      },
      totals: emptyBreakerTotals(),
    };
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get totals(): Readonly<BreakerTotals> {
    return this.state.totals;
  }

  /** Redirects the server holds: queued or on a worker. */
  get inFlight(): number {
    return this.state.queue.length + this.state.working.length;
  }

  get breakerState(): BreakerState {
    return this.state.breaker.state;
  }

  /** Failures and calls in the window when the breaker last opened from closed. */
  get lastTrip(): { failures: number; calls: number } {
    return { failures: this.state.breaker.tripFailures, calls: this.state.breaker.tripCalls };
  }

  apply(command: BreakerCommand): void {
    this.state.ingest = command.type === 'up' ? 'healthy' : command.type;
  }

  step(): BreakerTick {
    const before = { ...this.state.totals };
    const latencies: number[] = [];
    const base = this.state.ticks * TICK_MS;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      const now = base + sub * SUBSTEP_MS;
      this.complete(now, latencies);
      this.coolDown(now);
      this.arrive(now);
      this.assignWorkers(now);
      if (this.state.breaker.state === 'open') this.state.totals.openMs += SUBSTEP_MS;
    }
    this.state.ticks += 1;
    const totals = this.state.totals;
    return {
      answered: totals.answered - before.answered,
      recorded: totals.recorded - before.recorded,
      buffered: totals.buffered - before.buffered,
      rejected: totals.rejected - before.rejected,
      calls: totals.calls - before.calls,
      timedOut: totals.timedOut - before.timedOut,
      shortCircuited: totals.shortCircuited - before.shortCircuited,
      latencies,
      busyWorkers: this.state.working.length,
      state: this.state.breaker.state,
    };
  }

  snapshot(): BreakerSnapshot {
    const state = this.state;
    const breaker = state.breaker;
    const now = state.ticks * TICK_MS;
    const cells: BreakerCellState[] = state.working.map((job) =>
      job.kind === 'call' && now - job.callStart >= TICK_MS ? 'stuck' : 'busy',
    );
    const recent = breaker.window.filter((record) => record.at > now - WINDOW_MS);
    return {
      workers: [...cells, ...Array<BreakerCellState>(this.config.workers - cells.length).fill('idle')],
      queued: state.queue.length,
      state: breaker.state,
      windowCalls: recent.length,
      windowFailures: recent.filter((record) => record.failed).length,
      cooldownLeftMs: breaker.state === 'open' ? Math.max(0, breaker.openUntil - now) : 0,
      probesOut:
        breaker.state === 'half-open'
          ? state.working.filter((job) => job.probeRound === breaker.round).length
          : 0,
      probesSent: breaker.state === 'half-open' ? breaker.probesSent : 0,
      ingest: state.ingest,
    };
  }

  checkpoint(): BreakerCheckpoint {
    return structuredClone({
      state: this.state,
      arrivals: this.arrivals.getState(),
      work: this.work.getState(),
    });
  }

  restore(checkpoint: BreakerCheckpoint): void {
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
      state.totals.answered += 1;
      latencies.push(now - job.arrivedAt);
      if (job.kind === 'short') {
        state.totals.buffered += 1;
        continue;
      }
      const failed = job.outcome !== 'ok';
      if (failed) {
        state.totals.buffered += 1;
        state.totals.callFailures += 1;
        if (job.outcome === 'timeout') state.totals.timedOut += 1;
      } else {
        state.totals.recorded += 1;
      }
      this.judge(job, failed, now);
    }
  }

  /** Feeds one finished call to the breaker. */
  private judge(job: Job, failed: boolean, now: number): void {
    if (this.config.policy === 'none') return;
    const breaker = this.state.breaker;
    if (breaker.state === 'closed') {
      breaker.window.push({ at: now, failed });
      breaker.window = breaker.window.filter((record) => record.at > now - WINDOW_MS);
      const failures = breaker.window.filter((record) => record.failed).length;
      const calls = breaker.window.length;
      if (calls >= MIN_CALLS && failures / calls >= FAILURE_THRESHOLD) {
        breaker.tripFailures = failures;
        breaker.tripCalls = calls;
        this.open(now);
      }
      return;
    }
    if (breaker.state !== 'half-open' || job.probeRound !== breaker.round) return;
    if (failed) {
      this.state.totals.failedProbes += 1;
      this.open(now);
      return;
    }
    breaker.probeSuccesses += 1;
    if (breaker.probeSuccesses >= PROBES) {
      breaker.state = 'closed';
      breaker.window = [];
      this.state.totals.closes += 1;
    }
  }

  private open(now: number): void {
    const breaker = this.state.breaker;
    breaker.state = 'open';
    breaker.window = [];
    breaker.openUntil = now + COOLDOWN_MS;
    this.state.totals.opens += 1;
  }

  private coolDown(now: number): void {
    const breaker = this.state.breaker;
    if (breaker.state !== 'open' || now < breaker.openUntil) return;
    breaker.state = 'half-open';
    breaker.round += 1;
    breaker.probesSent = 0;
    breaker.probeSuccesses = 0;
  }

  private arrive(now: number): void {
    const state = this.state;
    const count = poisson(this.arrivals, (this.config.arrivalRate * SUBSTEP_MS) / 1000);
    for (let i = 0; i < count; i += 1) {
      state.totals.arrived += 1;
      if (state.queue.length >= this.config.queueLimit) {
        state.totals.rejected += 1;
        continue;
      }
      state.queue.push({ id: state.nextRedirect, arrivedAt: now });
      state.nextRedirect += 1;
    }
  }

  /** Decides whether this redirect may call ingest, and as a probe or not. */
  private permit(): { call: boolean; probeRound: number } {
    const breaker = this.state.breaker;
    if (this.config.policy === 'none' || breaker.state === 'closed') return { call: true, probeRound: -1 };
    if (breaker.state === 'open') return { call: false, probeRound: -1 };
    if (this.config.policy === 'breaker' && breaker.probesSent >= PROBES)
      return { call: false, probeRound: -1 };
    breaker.probesSent += 1;
    this.state.totals.probes += 1;
    return { call: true, probeRound: breaker.round };
  }

  private assignWorkers(now: number): void {
    const state = this.state;
    while (state.working.length < this.config.workers) {
      const redirect = state.queue.shift();
      if (!redirect) return;
      const callStart = now + LOOKUP_MS;
      const { call, probeRound } = this.permit();
      if (!call) {
        state.totals.shortCircuited += 1;
        state.working.push({
          ...redirect,
          kind: 'short',
          callStart,
          doneAt: callStart + BUFFER_MS,
          outcome: 'ok',
          probeRound,
        });
        continue;
      }
      state.totals.calls += 1;
      let callMs = SUBSTEP_MS;
      let outcome: CallOutcome = 'refused';
      if (state.ingest === 'hang') {
        callMs = CALL_TIMEOUT_MS;
        outcome = 'timeout';
      } else if (state.ingest === 'healthy') {
        callMs = SUBSTEP_MS * randomInt(this.work, 3, 5);
        outcome = this.work() < TRANSIENT_RATE ? 'error' : 'ok';
      }
      state.working.push({
        ...redirect,
        kind: 'call',
        callStart,
        doneAt: callStart + callMs,
        outcome,
        probeRound,
      });
    }
  }
}

/* Two policies side by side on the same redirects */

export type BreakerScenarioId = 'hang' | 'refused' | 'probe' | 'normal';
export type BreakerMetric = 'answered' | 'calls';

export interface BreakerScenario {
  id: BreakerScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  policies: [BreakerPolicy, BreakerPolicy];
  schedule: ScheduledCommand<BreakerCommand>[];
  metric: BreakerMetric;
}

export interface BreakerEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const BREAKER_RUN_SECONDS = 20;
export const FAULT_TICK = 30;
export const HEAL_TICK = 120;

const hangSchedule: ScheduledCommand<BreakerCommand>[] = [
  { at: FAULT_TICK, command: { type: 'hang' } },
  { at: HEAL_TICK, command: { type: 'up' } },
];

export const breakerScenarios: Record<BreakerScenarioId, BreakerScenario> = {
  hang: {
    id: 'hang',
    label: 'Ingest hangs at 3 s',
    diff: 'Ingest calls get no answer from 3 s to 12 s, so each one waits out the 500 ms timeout. No breaker against a breaker with 3 probes.',
    policies: ['none', 'breaker'],
    schedule: hangSchedule,
    metric: 'answered',
  },
  refused: {
    id: 'refused',
    label: 'Ingest down at 3 s',
    diff: 'Ingest refuses connections at once from 3 s to 12 s. No breaker against a breaker with 3 probes. The chart counts calls sent to ingest.',
    policies: ['none', 'breaker'],
    schedule: [
      { at: FAULT_TICK, command: { type: 'down' } },
      { at: HEAL_TICK, command: { type: 'up' } },
    ],
    metric: 'calls',
  },
  probe: {
    id: 'probe',
    label: 'Probe gently',
    diff: 'Same hang. A breaker that lets every call through when half-open against one that sends 3 probes.',
    policies: ['flood', 'breaker'],
    schedule: hangSchedule,
    metric: 'answered',
  },
  normal: {
    id: 'normal',
    label: 'Normal day',
    diff: 'Baseline: 150 redirects/s, 16 workers, a queue of 64, 30 to 50 ms per ingest call, 2% transient errors. No breaker against a breaker with 3 probes.',
    policies: ['none', 'breaker'],
    schedule: [],
    metric: 'answered',
  },
};

export interface BreakerLane {
  policy: BreakerPolicy;
  label: string;
  server: BreakerServer;
  /** One value per tick for the scenario's metric, per second. */
  series: number[];
  /** Breaker state at the end of each tick. */
  states: BreakerState[];
  latencies: number[];
  seen: { rejected: boolean; opened: boolean; halfOpen: boolean; failedProbe: boolean; closed: boolean };
  /** Set when ingest heals, cleared on the first tick that records nearly every click again. */
  recoveringSince: number | null;
  /** Seconds from ingest healing until clicks are recorded again, or null if they never are. */
  recoverySeconds: number | null;
}

export class BreakerDuel {
  readonly scenario: BreakerScenario;
  readonly length: number;
  readonly tickSeconds = TICK_MS / 1000;
  readonly lanes: [BreakerLane, BreakerLane];
  readonly events: BreakerEvent[] = [];
  private tickCount = 0;

  constructor(scenario: BreakerScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(BREAKER_RUN_SECONDS / this.tickSeconds);
    const lane = (policy: BreakerPolicy): BreakerLane => ({
      policy,
      label: breakerPolicyLabels[policy],
      server: new BreakerServer({ policy, seed }),
      series: [],
      states: [],
      latencies: [],
      seen: { rejected: false, opened: false, halfOpen: false, failedProbe: false, closed: false },
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
        this.events.push({ tick, text: describeBreakerCommand(entry.command), marker: true });
    }
    const heals = schedule.some((entry) => entry.command.type === 'up' && entry.at === tick);
    for (const lane of this.lanes) {
      const before = { ...lane.server.totals };
      const result = stepScheduled(lane.server, schedule);
      const totals = lane.server.totals;
      lane.latencies.push(...result.latencies);
      lane.series.push((metric === 'calls' ? result.calls : result.answered) * perSecond);
      lane.states.push(result.state);
      const at = tick + 1;
      if (!lane.seen.rejected && result.rejected > 0) {
        lane.seen.rejected = true;
        this.events.push({
          tick: at,
          text: `${lane.label}: every worker is waiting on ingest and the queue is full, so new redirects get a 503.`,
          marker: true,
        });
      }
      if (!lane.seen.opened && totals.opens > 0) {
        lane.seen.opened = true;
        const trip = lane.server.lastTrip;
        this.events.push({
          tick: at,
          text: `${lane.label}: the breaker opens after ${trip.failures} of the last ${trip.calls} calls failed. Redirects skip ingest and buffer the click.`,
          marker: true,
        });
      }
      if (!lane.seen.halfOpen && totals.probes > 0) {
        lane.seen.halfOpen = true;
        const admits =
          lane.policy === 'flood' ? 'lets every redirect call ingest' : `lets ${PROBES} probe calls through`;
        this.events.push({
          tick: at,
          text: `${lane.label}: the ${COOLDOWN_MS / 1000} s cooldown ends, so the half-open breaker ${admits}.`,
          marker: true,
        });
      }
      if (!lane.seen.failedProbe && totals.failedProbes > 0) {
        lane.seen.failedProbe = true;
        const refused = schedule.some((entry) => entry.command.type === 'down');
        this.events.push({
          tick: at,
          text: `${lane.label}: a probe ${refused ? 'is refused' : 'times out'}, so the breaker opens again for another ${COOLDOWN_MS / 1000} s.`,
          marker: true,
        });
      }
      if (!lane.seen.closed && totals.closes > before.closes) {
        lane.seen.closed = true;
        this.events.push({
          tick: at,
          text:
            lane.policy === 'flood'
              ? `${lane.label}: the first ${PROBES} calls of the flood succeed, so the breaker closes.`
              : `${lane.label}: ${PROBES} probes succeed, so the breaker closes and redirects call ingest again.`,
          marker: true,
        });
      }
      if (heals) lane.recoveringSince = tick;
      if (lane.recoveringSince !== null && result.answered > 0 && result.recorded / result.answered >= 0.9) {
        lane.recoverySeconds = ((at - lane.recoveringSince) * TICK_MS) / 1000;
        this.events.push({
          tick: at,
          text: `${lane.label}: clicks reach ingest again, ${formatSeconds(lane.recoverySeconds)} after it heals.`,
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
      let text = `Run ends. Redirects answered: ${first.label} ${a.answered}, ${second.label} ${b.answered}. Turned away with 503: ${a.rejected} and ${b.rejected}. Calls sent to ingest: ${a.calls} and ${b.calls}.`;
      for (const lane of this.lanes) {
        const totals = lane.server.totals;
        if (lane.policy !== 'none')
          text += ` ${lane.label} opened ${totals.opens} ${totals.opens === 1 ? 'time' : 'times'}, sent ${totals.probes} probes, and stayed open ${formatSeconds(totals.openMs / 1000)}.`;
        if (lane.recoveringSince !== null) text += ` ${lane.label} still buffers clicks when the run ends.`;
      }
      this.events.push({ tick: this.tickCount, text, marker: false });
    }
  }
}

export interface BreakerSummary {
  arrived: number;
  answered: number;
  recorded: number;
  buffered: number;
  rejected: number;
  calls: number;
  timedOut: number;
  shortCircuited: number;
  opens: number;
  probes: number;
  openSeconds: number;
  p95Ms: number;
  recoverySeconds: number | null;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarizeBreaker(lane: BreakerLane): BreakerSummary {
  const sorted = [...lane.latencies].sort((a, b) => a - b);
  const totals = lane.server.totals;
  return {
    arrived: totals.arrived,
    answered: totals.answered,
    recorded: totals.recorded,
    buffered: totals.buffered,
    rejected: totals.rejected,
    calls: totals.calls,
    timedOut: totals.timedOut,
    shortCircuited: totals.shortCircuited,
    opens: totals.opens,
    probes: totals.probes,
    openSeconds: totals.openMs / 1000,
    p95Ms: percentile(sorted, 0.95),
    recoverySeconds: lane.recoverySeconds,
  };
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

function describeBreakerCommand(command: BreakerCommand): string {
  switch (command.type) {
    case 'hang':
      return 'The analytics ingest service hangs: calls get no answer.';
    case 'down':
      return 'The analytics ingest service goes down and refuses connections.';
    case 'up':
      return 'The analytics ingest service is healthy again.';
  }
}
