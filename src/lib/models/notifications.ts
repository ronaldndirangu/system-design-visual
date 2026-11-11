import { createRng, randomInt } from '../rng';

/**
 * A toy notification service: 60 users ask for a login code over 24 s, and
 * each code is useless 5 s after the user asks. Codes leave through an SMS
 * provider that accepts a fixed number of sends per tick. Every code's arrival
 * comes from one pre-generated workload, so both lanes see the same requests at
 * the same moments and only the lane rule differs. Times are compressed: real
 * codes live for minutes and real campaigns take minutes to drain.
 */
export const TICK_SECONDS = 0.1;
export const CODES = 60;
export const GRID_COLS = 12;
const ARRIVAL_SECONDS = 24;
export const DEADLINE_SECONDS = 5;
const DEADLINE_TICKS = Math.round(DEADLINE_SECONDS / TICK_SECONDS);
/** The backup SMS provider accepts fewer sends per tick, and charges more for each. */
export const BACKUP_SENDS_PER_TICK = 1;
/** The circuit breaker opens after this many failed sends in a row. */
export const BREAKER_THRESHOLD = 3;
/** While the breaker is open, a health check probes the primary this often. */
export const PROBE_SECONDS = 2;
const PROBE_TICKS = Math.round(PROBE_SECONDS / TICK_SECONDS);
/**
 * Retry delays double from 0.5 s and stop growing at 4 s. Real clients add
 * random jitter so retries spread out; this toy leaves jitter out so every
 * replay matches.
 */
export const BACKOFF_START_SECONDS = 0.5;
export const BACKOFF_CAP_SECONDS = 4;

export type NotifDuelId = 'deadline' | 'outage';
export type NotifScenarioId =
  | 'campaign'
  | 'double-rate'
  | 'no-campaign'
  | 'sms-outage'
  | 'long-outage'
  | 'no-outage';

export interface LaneConfig {
  label: string;
  /** Login codes skip ahead of any marketing message in the queue. */
  priority: boolean;
  /** A code that reaches its deadline unsent leaves the queue and never goes out. */
  dropExpired: boolean;
  /** A circuit breaker sends codes to the backup provider while the primary keeps failing. */
  failover: boolean;
}

export interface NotifScenario {
  id: NotifScenarioId;
  label: string;
  /** What this scenario changes from its duel's baseline, shown on its chip. */
  diff: string;
  /** The primary SMS provider's rate limit, in sends per tick. */
  sendsPerTick: number;
  /** Marketing messages enqueued all at once. No scenario combines a campaign with an outage. */
  campaign: { size: number; atSeconds: number } | null;
  /** The primary provider rejects every send in this window, quickly and with a clear error. */
  outage: { fromSeconds: number; toSeconds: number } | null;
  seconds: number;
  lanes: [LaneConfig, LaneConfig];
}

const deadlineLanes: [LaneConfig, LaneConfig] = [
  { label: 'One shared queue', priority: false, dropExpired: false, failover: false },
  { label: 'Priority lane for codes', priority: true, dropExpired: true, failover: false },
];
const outageLanes: [LaneConfig, LaneConfig] = [
  { label: 'Retry the same provider', priority: true, dropExpired: true, failover: false },
  { label: 'Fail over to a backup', priority: true, dropExpired: true, failover: true },
];

export const notifScenarios: Record<NotifScenarioId, NotifScenario> = {
  campaign: {
    id: 'campaign',
    label: 'Campaign at 2 s',
    diff: 'Baseline: 60 login codes over 24 s, each useless after 5 s. The SMS provider accepts 20 sends per second. At 2 s a marketing campaign enqueues 300 messages at once.',
    sendsPerTick: 2,
    campaign: { size: 300, atSeconds: 2 },
    outage: null,
    seconds: 30,
    lanes: deadlineLanes,
  },
  'double-rate': {
    id: 'double-rate',
    label: 'Pay for double the rate',
    diff: 'Provider rate limit: 20 to 40 sends per second.',
    sendsPerTick: 4,
    campaign: { size: 300, atSeconds: 2 },
    outage: null,
    seconds: 30,
    lanes: deadlineLanes,
  },
  'no-campaign': {
    id: 'no-campaign',
    label: 'No campaign',
    diff: 'Marketing campaign: removed.',
    sendsPerTick: 2,
    campaign: null,
    outage: null,
    seconds: 30,
    lanes: deadlineLanes,
  },
  'sms-outage': {
    id: 'sms-outage',
    label: 'Primary down 5 to 15 s',
    diff: 'Baseline: the same 60 codes and no campaign. The primary SMS provider rejects every send from 5 s to 15 s. A failed send retries after 0.5 s, then 1, 2, and 4 s.',
    sendsPerTick: 2,
    campaign: null,
    outage: { fromSeconds: 5, toSeconds: 15 },
    seconds: 30,
    lanes: outageLanes,
  },
  'long-outage': {
    id: 'long-outage',
    label: 'Longer outage',
    diff: 'Outage: 5 to 15 s becomes 5 to 25 s.',
    sendsPerTick: 2,
    campaign: null,
    outage: { fromSeconds: 5, toSeconds: 25 },
    seconds: 30,
    lanes: outageLanes,
  },
  'no-outage': {
    id: 'no-outage',
    label: 'No outage',
    diff: 'Outage: removed.',
    sendsPerTick: 2,
    campaign: null,
    outage: null,
    seconds: 30,
    lanes: outageLanes,
  },
};

export const duelScenarioIds: Record<NotifDuelId, NotifScenarioId[]> = {
  deadline: ['campaign', 'double-rate', 'no-campaign'],
  outage: ['sms-outage', 'long-outage', 'no-outage'],
};

export interface Code {
  /** Codes are numbered in request order, counted from 0. */
  id: number;
  /** The tick the user asks for the code. */
  arrival: number;
  /** The first tick the code is useless. */
  deadline: number;
}

/** The shared login requests, in arrival order. Every scenario uses the same codes. */
export function makeCodes(seed: number): Code[] {
  const rng = createRng(seed);
  const drafts = Array.from({ length: CODES }, (_, order) => ({
    order,
    arrival: randomInt(rng, 0, Math.round(ARRIVAL_SECONDS / TICK_SECONDS) - 1),
  }));
  drafts.sort((x, y) => x.arrival - y.arrival || x.order - y.order);
  return drafts.map(({ arrival }, id) => ({ id, arrival, deadline: arrival + DEADLINE_TICKS }));
}

/** Retry delay in ticks after a code's nth failed send. */
export function backoffTicks(failures: number): number {
  const seconds = Math.min(BACKOFF_START_SECONDS * 2 ** (failures - 1), BACKOFF_CAP_SECONDS);
  return Math.round(seconds / TICK_SECONDS);
}

/**
 * future: not requested yet. waiting: in the queue. retrying: a send failed and
 * the code waits out its backoff. onTime: sent before its deadline. late: sent
 * after its deadline, so the user got a dead code. expired: dropped at its
 * deadline without a send.
 */
export type CodePhase = 'future' | 'waiting' | 'retrying' | 'onTime' | 'late' | 'expired';

interface LaneState {
  phase: CodePhase[];
  sentAt: number[];
  /** Still unsent after its deadline, in a lane that keeps expired codes. */
  overdue: boolean[];
  viaBackup: boolean[];
  failures: number[];
  /** The tick a code in backoff rejoins the queue. */
  retryAt: number[];
  /** Ready to send, oldest first: code ids, and -1 for each marketing message. */
  queue: number[];
  marketingSent: number;
  /** The tick the last marketing message went out, or -1. */
  lastMarketingTick: number;
  failedSends: number;
  breakerOpen: boolean;
  consecutiveFailures: number;
  /** The tick of the next health check while the breaker is open. */
  nextProbe: number;
  series: number[];
  firstMiss: boolean;
  firstJump: boolean;
}

export interface NotifLane {
  config: LaneConfig;
  state: LaneState;
}

export interface NotifEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface NotifCheckpoint {
  tick: number;
  lanes: [LaneState, LaneState];
  events: NotifEvent[];
}

function emptyLane(): LaneState {
  const blank = () => Array.from({ length: CODES }, () => -1);
  const no = () => Array.from({ length: CODES }, () => false);
  return {
    phase: Array.from({ length: CODES }, (): CodePhase => 'future'),
    sentAt: blank(),
    overdue: no(),
    viaBackup: no(),
    failures: Array.from({ length: CODES }, () => 0),
    retryAt: blank(),
    queue: [],
    marketingSent: 0,
    lastMarketingTick: -1,
    failedSends: 0,
    breakerOpen: false,
    consecutiveFailures: 0,
    nextProbe: -1,
    series: [],
    firstMiss: false,
    firstJump: false,
  };
}

function countPhase(lane: NotifLane, phase: CodePhase): number {
  return lane.state.phase.filter((value) => value === phase).length;
}

const unsent = (phase: CodePhase | undefined) => phase === 'waiting' || phase === 'retrying';

/** Codes past their deadline: sent late, dropped, or still waiting. */
function missedNow(lane: NotifLane): number {
  const s = lane.state;
  let overdue = 0;
  s.phase.forEach((phase, id) => {
    if (unsent(phase) && s.overdue[id]) overdue += 1;
  });
  return countPhase(lane, 'late') + countPhase(lane, 'expired') + overdue;
}

export class NotifDuel {
  readonly scenario: NotifScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly codes: Code[];
  readonly lanes: [NotifLane, NotifLane];
  /** The ticks the campaign lands and the primary goes down and recovers; -1 when they never happen. */
  readonly campaignTick: number;
  readonly downTick: number;
  readonly upTick: number;
  events: NotifEvent[] = [];
  private tickCount = 0;

  constructor(scenario: NotifScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(scenario.seconds / TICK_SECONDS);
    this.codes = makeCodes(seed);
    this.lanes = [
      { config: scenario.lanes[0], state: emptyLane() },
      { config: scenario.lanes[1], state: emptyLane() },
    ];
    const { campaign, outage } = scenario;
    this.campaignTick = campaign ? Math.round(campaign.atSeconds / TICK_SECONDS) : -1;
    this.downTick = outage ? Math.round(outage.fromSeconds / TICK_SECONDS) : -1;
    this.upTick = outage ? Math.round(outage.toSeconds / TICK_SECONDS) : -1;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  get campaignSize(): number {
    return this.scenario.campaign?.size ?? 0;
  }

  /** The primary provider rejects sends during the outage. */
  primaryDown(tick: number): boolean {
    return this.downTick >= 0 && tick >= this.downTick && tick < this.upTick;
  }

  checkpoint(): NotifCheckpoint {
    return structuredClone({
      tick: this.tickCount,
      lanes: [this.lanes[0].state, this.lanes[1].state] as [LaneState, LaneState],
      events: this.events,
    });
  }

  restore(saved: NotifCheckpoint): void {
    const copy = structuredClone(saved);
    this.tickCount = copy.tick;
    this.lanes[0].state = copy.lanes[0];
    this.lanes[1].state = copy.lanes[1];
    this.events = copy.events;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (tick === this.campaignTick) {
      this.events.push({
        tick,
        text: `A marketing campaign drops ${this.campaignSize} messages into the queue at once.`,
        marker: true,
      });
    }
    if (tick === this.downTick) {
      this.events.push({ tick, text: 'The primary SMS provider starts rejecting every send.', marker: true });
    }
    if (tick === this.upTick) {
      this.events.push({ tick, text: 'The primary SMS provider recovers.', marker: true });
    }
    for (const lane of this.lanes) this.stepLane(lane, tick);
    this.tickCount += 1;
    if (this.done) this.wrapUp();
  }

  private stepLane(lane: NotifLane, tick: number): void {
    const s = lane.state;
    const { label, failover } = lane.config;

    if (tick === this.campaignTick) {
      for (let n = 0; n < this.campaignSize; n += 1) s.queue.push(-1);
    }
    for (const code of this.codes) {
      if (code.arrival === tick) {
        s.phase[code.id] = 'waiting';
        s.queue.push(code.id);
      }
    }
    for (const code of this.codes) {
      if (s.phase[code.id] === 'retrying' && s.retryAt[code.id] === tick) {
        s.phase[code.id] = 'waiting';
        s.queue.push(code.id);
      }
    }
    this.sweep(lane, tick);

    if (s.breakerOpen && tick === s.nextProbe) {
      if (this.primaryDown(tick)) {
        s.nextProbe += PROBE_TICKS;
      } else {
        s.breakerOpen = false;
        s.consecutiveFailures = 0;
        this.events.push({
          tick: tick + 1,
          text: `${label}: a health check reaches the primary, so the breaker closes and codes go back to it.`,
          marker: true,
        });
      }
    }

    let primaryUsed = 0;
    let backupUsed = 0;
    while (s.queue.length > 0) {
      const backup = s.breakerOpen;
      if (backup ? backupUsed >= BACKUP_SENDS_PER_TICK : primaryUsed >= this.scenario.sendsPerTick) break;
      if (backup) backupUsed += 1;
      else primaryUsed += 1;
      const index = lane.config.priority
        ? Math.max(
            0,
            s.queue.findIndex((entry) => entry >= 0),
          )
        : 0;
      const [entry = -1] = s.queue.splice(index, 1);
      if (entry < 0) {
        s.marketingSent += 1;
        s.lastMarketingTick = tick;
        continue;
      }
      if (index > 0 && !s.firstJump) {
        s.firstJump = true;
        this.events.push({
          tick: tick + 1,
          text: `${label}: code ${entry + 1} skips past ${index} marketing messages and goes out at once.`,
          marker: true,
        });
      }
      if (!backup && this.primaryDown(tick)) {
        this.fail(lane, entry, tick);
        continue;
      }
      if (!backup) s.consecutiveFailures = 0;
      const code = this.codes[entry];
      s.sentAt[entry] = tick;
      s.viaBackup[entry] = backup;
      s.phase[entry] = code && tick >= code.deadline ? 'late' : 'onTime';
    }

    if (failover && !s.breakerOpen && s.consecutiveFailures >= BREAKER_THRESHOLD) {
      s.breakerOpen = true;
      s.nextProbe = tick + PROBE_TICKS;
      this.events.push({
        tick: tick + 1,
        text: `${label}: ${s.consecutiveFailures} sends in a row fail, so the circuit breaker opens and codes go to the backup provider.`,
        marker: true,
      });
    }

    s.series.push(missedNow(lane));
  }

  private fail(lane: NotifLane, id: number, tick: number): void {
    const s = lane.state;
    s.failedSends += 1;
    s.consecutiveFailures += 1;
    s.failures[id] = (s.failures[id] ?? 0) + 1;
    s.phase[id] = 'retrying';
    s.retryAt[id] = tick + backoffTicks(s.failures[id] ?? 1);
  }

  /** Codes that reach their deadline unsent are dropped or flagged, depending on the lane. */
  private sweep(lane: NotifLane, tick: number): void {
    const s = lane.state;
    const { label, dropExpired } = lane.config;
    for (const code of this.codes) {
      const id = code.id;
      if (!unsent(s.phase[id]) || tick < code.deadline || s.overdue[id]) continue;
      if (dropExpired) {
        s.phase[id] = 'expired';
        s.queue = s.queue.filter((entry) => entry !== id);
      } else {
        s.overdue[id] = true;
      }
      if (s.firstMiss) continue;
      s.firstMiss = true;
      const tries = s.failures[id] ?? 0;
      const text = dropExpired
        ? `${label}: code ${id + 1} reaches its ${DEADLINE_SECONDS} s deadline after ${tries} failed ${tries === 1 ? 'send' : 'sends'}, so the lane drops it. The user never gets a code.`
        : `${label}: code ${id + 1} has waited ${DEADLINE_SECONDS} s, its whole lifetime. It is useless now, and the queue will still send it.`;
      this.events.push({ tick: tick + 1, text, marker: true });
    }
  }

  private wrapUp(): void {
    const [a, b] = this.lanes;
    const name = (lane: NotifLane) => lane.config.label.toLowerCase();
    const sa = summarize(a, this.codes);
    const sb = summarize(b, this.codes);
    let text = `Run ends. Codes that missed the ${DEADLINE_SECONDS} s deadline: ${name(a)} ${sa.missed}, ${name(b)} ${sb.missed}.`;
    if (this.campaignSize > 0) {
      const done = (sum: NotifSummary) =>
        sum.campaignDoneSeconds < 0 ? 'still queued' : `${sum.campaignDoneSeconds.toFixed(1)} s`;
      text += ` Last campaign message sent: ${name(a)} ${done(sa)}, ${name(b)} ${done(sb)}.`;
    }
    if (sb.viaBackup > 0) {
      text += ` The backup carried ${sb.viaBackup} codes.`;
    }
    this.events.push({ tick: this.tickCount, text, marker: false });
  }
}

export type TileView =
  | 'future'
  | 'waiting'
  | 'overdue'
  | 'retrying'
  | 'onTime'
  | 'backup'
  | 'late'
  | 'expired';

export function tileView(lane: NotifLane, id: number): TileView {
  const s = lane.state;
  const phase = s.phase[id] ?? 'future';
  if (phase === 'waiting' && s.overdue[id]) return 'overdue';
  if (phase === 'onTime' && s.viaBackup[id]) return 'backup';
  return phase;
}

export interface NotifSummary {
  requested: number;
  onTime: number;
  /** Sent after the deadline: a wasted send and a dead code on the user's phone. */
  late: number;
  /** Dropped at the deadline without a send. */
  expired: number;
  /** Waiting or in backoff, including codes already past their deadline. */
  pending: number;
  /** Late, expired, or still waiting past the deadline. */
  missed: number;
  viaBackup: number;
  failedSends: number;
  /** From the request to the send, over codes that went out. */
  averageWaitSeconds: number;
  marketingQueued: number;
  marketingSent: number;
  /** When the last campaign message went out, or -1 while any remain. */
  campaignDoneSeconds: number;
  breakerOpen: boolean;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function summarize(lane: NotifLane, codes: Code[]): NotifSummary {
  const s = lane.state;
  let requested = 0;
  let sent = 0;
  let waitTicks = 0;
  for (const code of codes) {
    const phase = s.phase[code.id];
    if (phase === 'future') continue;
    requested += 1;
    if (phase === 'onTime' || phase === 'late') {
      sent += 1;
      waitTicks += (s.sentAt[code.id] ?? code.arrival) - code.arrival;
    }
  }
  const marketingQueued = s.queue.filter((entry) => entry < 0).length;
  return {
    requested,
    onTime: countPhase(lane, 'onTime'),
    late: countPhase(lane, 'late'),
    expired: countPhase(lane, 'expired'),
    pending: countPhase(lane, 'waiting') + countPhase(lane, 'retrying'),
    missed: missedNow(lane),
    viaBackup: s.viaBackup.filter(Boolean).length,
    failedSends: s.failedSends,
    averageWaitSeconds: sent === 0 ? 0 : round1((waitTicks / sent) * TICK_SECONDS),
    marketingQueued,
    marketingSent: s.marketingSent,
    campaignDoneSeconds:
      s.marketingSent > 0 && marketingQueued === 0 ? round1((s.lastMarketingTick + 1) * TICK_SECONDS) : -1,
    breakerOpen: s.breakerOpen,
  };
}

export interface QueueView {
  codes: number;
  marketing: number;
  /** The place in line of the code that goes out next, counted from 1, or 0 with no code waiting. */
  nextCodePlace: number;
  /** The first entries the provider will take: 'code' or 'marketing'. */
  head: ('code' | 'marketing')[];
}

/** The ready queue as the lane will drain it: codes first in a priority lane, arrival order otherwise. */
export function queueView(lane: NotifLane, headSize: number): QueueView {
  const queue = lane.state.queue;
  const marketing = queue.filter((entry) => entry < 0).length;
  const codes = queue.length - marketing;
  const order = lane.config.priority
    ? [...queue.filter((entry) => entry >= 0), ...queue.filter((entry) => entry < 0)]
    : queue;
  return {
    codes,
    marketing,
    nextCodePlace: order.findIndex((entry) => entry >= 0) + 1,
    head: order.slice(0, headSize).map((entry) => (entry >= 0 ? 'code' : 'marketing')),
  };
}

/** How long the oldest unsent code has waited, at the end of the last tick that ran. */
export function oldestWaitSeconds(lane: NotifLane, codes: Code[], ticks: number): number {
  let oldest = -1;
  for (const code of codes) {
    if (!unsent(lane.state.phase[code.id])) continue;
    oldest = Math.max(oldest, ticks - code.arrival);
  }
  return oldest < 0 ? 0 : round1(oldest * TICK_SECONDS);
}

export interface NotificationsEstimate {
  notificationsPerDay: number;
  averagePerSecond: number;
  peakPerSecond: number;
  codesPerSecond: number;
  campaignDrainMinutes: number;
  storageGigabytesPerDay: number;
}

/** Back-of-envelope sizing for the lesson's illustrative notification service. */
export function notificationsEstimates({
  dailyUsers = 20_000_000,
  notificationsPerUserPerDay = 5,
  peakFactor = 3,
  codesPerDay = 2_000_000,
  campaignRecipients = 5_000_000,
  providerSendsPerSecond = 2_000,
  bytesPerRecord = 500,
} = {}): NotificationsEstimate {
  const perDay = dailyUsers * notificationsPerUserPerDay;
  const average = perDay / 86_400;
  return {
    notificationsPerDay: perDay,
    averagePerSecond: Math.round(average),
    peakPerSecond: Math.round(average * peakFactor),
    codesPerSecond: Math.round(codesPerDay / 86_400),
    campaignDrainMinutes: Math.round(campaignRecipients / providerSendsPerSecond / 60),
    storageGigabytesPerDay: Math.round((perDay * bytesPerRecord) / 1e9),
  };
}
