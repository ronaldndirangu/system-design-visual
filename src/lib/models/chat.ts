import { createRng, randomInt } from '../rng';

/**
 * A toy group chat: 96 messages reach the chat server over 20 s, the server
 * gives each one the next sequence number for the conversation, and push
 * workers deliver it to one phone. Every message's arrival, worker, and delays
 * come from one pre-generated workload, so both lanes see the same messages at
 * the same moments and only the lane rule differs. Times are compressed: real
 * heartbeat timeouts and offline spells last longer.
 */
export const TICK_SECONDS = 0.1;
export const MESSAGES = 96;
export const GRID_COLS = 12;
const ARRIVAL_SECONDS = 20;
/** A reconnecting phone receives its first batch this long after the new socket opens. */
export const RECONNECT_TICKS = 3;
export const SCREEN_TAIL = 6;

export type ChatDuelId = 'ordering' | 'sync';
export type ChatScenarioId =
  | 'busy-group'
  | 'more-stalls'
  | 'one-path'
  | 'tunnel'
  | 'quick-heartbeat'
  | 'online';
export type ChatMetric = 'outOfOrder' | 'lost';

export interface LaneConfig {
  label: string;
  /** The phone shows messages strictly by sequence number and holds any that arrive early. */
  reorderBuffer: boolean;
  /** On reconnect the phone sends the last sequence number it showed and the server replays the rest from its log. */
  catchUp: boolean;
}

export interface ChatScenario {
  id: ChatScenarioId;
  label: string;
  /** What this scenario changes from its duel's baseline, shown on its chip. */
  diff: string;
  /** Parallel push workers. Each worker delivers its own messages in order. */
  paths: number;
  /** Share of messages whose worker stalls before it delivers them. */
  stallShare: number;
  /** A spell in which the phone has no signal and its socket dies without closing. */
  offline: { fromSeconds: number; toSeconds: number } | null;
  /** The server marks a silent socket dead after this long without a heartbeat. */
  heartbeatTimeoutSeconds: number;
  seconds: number;
  metric: ChatMetric;
  lanes: [LaneConfig, LaneConfig];
}

const orderingLanes: [LaneConfig, LaneConfig] = [
  { label: 'Show in arrival order', reorderBuffer: false, catchUp: false },
  { label: 'Sequence numbers and a reorder buffer', reorderBuffer: true, catchUp: false },
];
const syncLanes: [LaneConfig, LaneConfig] = [
  { label: 'Push, and queue while offline', reorderBuffer: false, catchUp: false },
  { label: 'Cursor catch-up on reconnect', reorderBuffer: true, catchUp: true },
];

export const chatScenarios: Record<ChatScenarioId, ChatScenario> = {
  'busy-group': {
    id: 'busy-group',
    label: 'Busy group chat',
    diff: 'Baseline: 96 messages in 20 s, spread over 4 push workers. 15% of messages meet a worker that stalls for 1 to 2.5 s.',
    paths: 4,
    stallShare: 0.15,
    offline: null,
    heartbeatTimeoutSeconds: 3,
    seconds: 30,
    metric: 'outOfOrder',
    lanes: orderingLanes,
  },
  'more-stalls': {
    id: 'more-stalls',
    label: 'More stalls',
    diff: 'Stalled messages: 15% to 35%.',
    paths: 4,
    stallShare: 0.35,
    offline: null,
    heartbeatTimeoutSeconds: 3,
    seconds: 30,
    metric: 'outOfOrder',
    lanes: orderingLanes,
  },
  'one-path': {
    id: 'one-path',
    label: 'One worker per chat',
    diff: 'Push workers for this chat: 4 to 1. Nothing can overtake, so a stall delays every message behind it.',
    paths: 1,
    stallShare: 0.15,
    offline: null,
    heartbeatTimeoutSeconds: 3,
    seconds: 30,
    metric: 'outOfOrder',
    lanes: orderingLanes,
  },
  tunnel: {
    id: 'tunnel',
    label: 'Phone in a tunnel',
    diff: 'Baseline: one push worker, no stalls. The phone loses signal from 6 s to 14 s and its socket dies silently. The server notices after 3 s without a heartbeat.',
    paths: 1,
    stallShare: 0,
    offline: { fromSeconds: 6, toSeconds: 14 },
    heartbeatTimeoutSeconds: 3,
    seconds: 30,
    metric: 'lost',
    lanes: syncLanes,
  },
  'quick-heartbeat': {
    id: 'quick-heartbeat',
    label: 'Faster heartbeats',
    diff: 'Heartbeat timeout: 3 s to 1 s.',
    paths: 1,
    stallShare: 0,
    offline: { fromSeconds: 6, toSeconds: 14 },
    heartbeatTimeoutSeconds: 1,
    seconds: 30,
    metric: 'lost',
    lanes: syncLanes,
  },
  online: {
    id: 'online',
    label: 'Stays online',
    diff: 'Signal loss from 6 s to 14 s: removed.',
    paths: 1,
    stallShare: 0,
    offline: null,
    heartbeatTimeoutSeconds: 3,
    seconds: 30,
    metric: 'lost',
    lanes: syncLanes,
  },
};

export const duelScenarioIds: Record<ChatDuelId, ChatScenarioId[]> = {
  ordering: ['busy-group', 'more-stalls', 'one-path'],
  sync: ['tunnel', 'quick-heartbeat', 'online'],
};

export interface Message {
  /** Also the conversation sequence number, counted from 0. */
  id: number;
  /** The tick the chat server receives the message and gives it a sequence number. */
  arrival: number;
  pathRoll: number;
  stallRoll: number;
  fastTicks: number;
  stallTicks: number;
}

/** The shared conversation, in sequence order. Every scenario uses the same messages. */
export function makeMessages(seed: number): Message[] {
  const rng = createRng(seed);
  const drafts = Array.from({ length: MESSAGES }, (_, order) => ({
    order,
    arrival: randomInt(rng, 0, Math.round(ARRIVAL_SECONDS / TICK_SECONDS) - 1),
    pathRoll: randomInt(rng, 0, 11),
    stallRoll: rng(),
    fastTicks: randomInt(rng, 2, 5),
    stallTicks: randomInt(rng, 10, 25),
  }));
  drafts.sort((x, y) => x.arrival - y.arrival || x.order - y.order);
  return drafts.map(({ arrival, pathRoll, stallRoll, fastTicks, stallTicks }, id) => ({
    id,
    arrival,
    pathRoll,
    stallRoll,
    fastTicks,
    stallTicks,
  }));
}

/**
 * future: not sent yet. flight: on its way to the phone. queued: the server
 * holds it because it knows the phone is offline. held: on the phone, waiting
 * in the reorder buffer for an earlier message. shown: on screen. lost: pushed
 * into a dead socket.
 */
export type ChatPhase = 'future' | 'flight' | 'queued' | 'held' | 'shown' | 'lost';

interface LaneState {
  phase: ChatPhase[];
  /** The tick a message in flight reaches the phone. */
  arriveAt: number[];
  /** The tick the phone received a message, before any wait in the buffer. */
  receivedAt: number[];
  shownAt: number[];
  outOfOrder: boolean[];
  recovered: boolean[];
  /** Message ids in the order the phone put them on screen. */
  screen: number[];
  /** Highest id on screen so far, or -1. */
  maxShown: number;
  /** Next id the reorder buffer may release. */
  nextExpected: number;
  /** Each worker delivers in order, so nothing it carries arrives before this tick. */
  pathFree: number[];
  sent: number;
  series: number[];
  firstLate: boolean;
  firstHold: boolean;
}

export interface ChatLane {
  config: LaneConfig;
  state: LaneState;
}

export interface ChatEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface ChatCheckpoint {
  tick: number;
  lanes: [LaneState, LaneState];
  events: ChatEvent[];
}

function emptyLane(paths: number): LaneState {
  const blank = () => Array.from({ length: MESSAGES }, () => -1);
  const no = () => Array.from({ length: MESSAGES }, () => false);
  return {
    phase: Array.from({ length: MESSAGES }, (): ChatPhase => 'future'),
    arriveAt: blank(),
    receivedAt: blank(),
    shownAt: blank(),
    outOfOrder: no(),
    recovered: no(),
    screen: [],
    maxShown: -1,
    nextExpected: 0,
    pathFree: Array.from({ length: paths }, () => 0),
    sent: 0,
    series: [],
    firstLate: false,
    firstHold: false,
  };
}

function idsIn(lane: ChatLane, phase: ChatPhase): number[] {
  const ids: number[] = [];
  lane.state.phase.forEach((value, id) => {
    if (value === phase) ids.push(id);
  });
  return ids;
}

function countPhase(lane: ChatLane, phase: ChatPhase): number {
  return lane.state.phase.filter((value) => value === phase).length;
}

export class ChatDuel {
  readonly scenario: ChatScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly messages: Message[];
  readonly lanes: [ChatLane, ChatLane];
  /** The ticks the phone loses signal, the server notices, and the phone reconnects; -1 when they never happen. */
  readonly offTick: number;
  readonly detectTick: number;
  readonly onTick: number;
  events: ChatEvent[] = [];
  private tickCount = 0;

  constructor(scenario: ChatScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(scenario.seconds / TICK_SECONDS);
    this.messages = makeMessages(seed);
    this.lanes = [
      { config: scenario.lanes[0], state: emptyLane(scenario.paths) },
      { config: scenario.lanes[1], state: emptyLane(scenario.paths) },
    ];
    const { offline } = scenario;
    this.offTick = offline ? Math.round(offline.fromSeconds / TICK_SECONDS) : -1;
    this.onTick = offline ? Math.round(offline.toSeconds / TICK_SECONDS) : -1;
    const detect = this.offTick + Math.round(scenario.heartbeatTimeoutSeconds / TICK_SECONDS);
    this.detectTick = offline && detect < this.onTick ? detect : -1;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  checkpoint(): ChatCheckpoint {
    return structuredClone({
      tick: this.tickCount,
      lanes: [this.lanes[0].state, this.lanes[1].state] as [LaneState, LaneState],
      events: this.events,
    });
  }

  restore(saved: ChatCheckpoint): void {
    const copy = structuredClone(saved);
    this.tickCount = copy.tick;
    this.lanes[0].state = copy.lanes[0];
    this.lanes[1].state = copy.lanes[1];
    this.events = copy.events;
  }

  /** The phone has signal outside the offline spell. */
  private phoneOnline(tick: number): boolean {
    return this.offTick < 0 || tick < this.offTick || tick >= this.onTick;
  }

  /** The server keeps pushing into the old socket until a heartbeat goes missing for long enough. */
  private serverKnowsOffline(tick: number): boolean {
    return !this.phoneOnline(tick) && this.detectTick >= 0 && tick >= this.detectTick;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (tick === this.offTick) {
      this.events.push({
        tick,
        text: 'The phone loses signal. Its socket dies without a goodbye, so the server still treats it as connected.',
        marker: true,
      });
    }
    for (const lane of this.lanes) this.stepLane(lane, tick);
    if (tick === this.detectTick) {
      const lost = countPhase(this.lanes[0], 'lost');
      this.events.push({
        tick: tick + 1,
        text: `The server hears no heartbeat for ${this.scenario.heartbeatTimeoutSeconds} s and marks the phone offline. By then it pushed ${lost} messages into the dead socket. It queues new ones from here.`,
        marker: true,
      });
    }
    this.tickCount += 1;
    if (this.done) this.wrapUp();
  }

  private stepLane(lane: ChatLane, tick: number): void {
    const s = lane.state;
    const { label, reorderBuffer } = lane.config;

    if (tick === this.offTick) {
      for (const id of idsIn(lane, 'flight')) s.phase[id] = 'lost';
    }
    if (tick === this.onTick) this.reconnect(lane, tick);

    for (const message of this.messages) {
      if (message.arrival !== tick) continue;
      const id = message.id;
      s.sent += 1;
      if (this.serverKnowsOffline(tick)) {
        s.phase[id] = 'queued';
      } else if (!this.phoneOnline(tick)) {
        s.phase[id] = 'lost';
      } else {
        const path = message.pathRoll % this.scenario.paths;
        const stalled = message.stallRoll < this.scenario.stallShare;
        const at = Math.max(s.pathFree[path] ?? 0, tick + (stalled ? message.stallTicks : message.fastTicks));
        s.pathFree[path] = at;
        s.phase[id] = 'flight';
        s.arriveAt[id] = at;
      }
    }

    for (const message of this.messages) {
      const id = message.id;
      if (s.phase[id] !== 'flight' || s.arriveAt[id] !== tick) continue;
      s.receivedAt[id] = tick;
      if (reorderBuffer) s.phase[id] = 'held';
      else this.show(lane, id, tick);
    }

    if (reorderBuffer) {
      while (s.nextExpected < MESSAGES && s.phase[s.nextExpected] === 'held') {
        this.show(lane, s.nextExpected, tick);
        s.nextExpected += 1;
      }
      const early = idsIn(lane, 'held')[0];
      if (early !== undefined && !s.firstHold) {
        s.firstHold = true;
        this.events.push({
          tick: tick + 1,
          text: `${label}: message ${early + 1} arrives before message ${s.nextExpected + 1}, so the phone holds it until the gap fills.`,
          marker: true,
        });
      }
    }

    const outOfOrder = s.outOfOrder.filter(Boolean).length;
    s.series.push(this.scenario.metric === 'outOfOrder' ? outOfOrder : countPhase(lane, 'lost'));
  }

  private show(lane: ChatLane, id: number, tick: number): void {
    const s = lane.state;
    s.phase[id] = 'shown';
    s.shownAt[id] = tick;
    s.screen.push(id);
    if (id < s.maxShown) {
      s.outOfOrder[id] = true;
      if (!s.firstLate) {
        s.firstLate = true;
        this.events.push({
          tick: tick + 1,
          text: `${lane.config.label}: message ${id + 1} arrives after message ${s.maxShown + 1} and lands below it, out of order.`,
          marker: true,
        });
      }
    }
    s.maxShown = Math.max(s.maxShown, id);
  }

  /** The phone opens a new socket. The server sends its backlog first, then live messages behind it. */
  private reconnect(lane: ChatLane, tick: number): void {
    const s = lane.state;
    const at = tick + RECONNECT_TICKS;
    for (let path = 0; path < s.pathFree.length; path += 1) s.pathFree[path] = at;
    const lost = idsIn(lane, 'lost');
    const queued = idsIn(lane, 'queued');
    const replay = lane.config.catchUp ? [...lost, ...queued].sort((x, y) => x - y) : queued;
    for (const id of replay) {
      if (s.phase[id] === 'lost') s.recovered[id] = true;
      s.phase[id] = 'flight';
      s.arriveAt[id] = at;
    }
    const text = lane.config.catchUp
      ? `${lane.config.label}: the phone reconnects and says the last message it showed is ${s.nextExpected}. The server replays the ${replay.length} messages after it from the log, including the ${lost.length} lost in the dead socket.`
      : `${lane.config.label}: the phone reconnects and the server sends its ${queued.length} queued messages. The ${lost.length} messages lost in the dead socket never arrive, and this lane never checks for the gap.`;
    this.events.push({ tick: tick + 1, text, marker: true });
  }

  private wrapUp(): void {
    const [a, b] = this.lanes;
    const name = (lane: ChatLane) => lane.config.label.toLowerCase();
    const sa = summarize(a, this.messages);
    const sb = summarize(b, this.messages);
    let text: string;
    if (this.scenario.metric === 'outOfOrder') {
      const hold =
        sb.heldBack === 0
          ? 'The reorder buffer never had to wait.'
          : `The reorder buffer held back ${sb.heldBack} messages, for ${sb.averageHoldSeconds.toFixed(1)} s on average and ${sb.longestHoldSeconds.toFixed(1)} s at most.`;
      text = `Run ends. Messages shown out of order: ${name(a)} ${sa.outOfOrder}, ${name(b)} ${sb.outOfOrder}. ${hold}`;
    } else {
      text = `Run ends. Messages missing from the phone: ${name(a)} ${sa.lost}, ${name(b)} ${sb.lost}.`;
    }
    this.events.push({ tick: this.tickCount, text, marker: false });
  }
}

export type TileView = 'future' | 'flight' | 'queued' | 'held' | 'shown' | 'late' | 'lost' | 'recovered';

export function tileView(lane: ChatLane, id: number): TileView {
  const s = lane.state;
  const phase = s.phase[id] ?? 'future';
  if (phase !== 'shown') return phase;
  if (s.outOfOrder[id]) return 'late';
  if (s.recovered[id]) return 'recovered';
  return 'shown';
}

export interface ScreenEntry {
  id: number;
  /** late: shown below a message sent after it. */
  flag: 'ok' | 'late';
}

/** The last few messages on the phone's screen, in the order the phone shows them. */
export function screenTail(lane: ChatLane, count = SCREEN_TAIL): ScreenEntry[] {
  const s = lane.state;
  const start = Math.max(0, s.screen.length - count);
  return s.screen.slice(start).map((id): ScreenEntry => ({ id, flag: s.outOfOrder[id] ? 'late' : 'ok' }));
}

/** Runs of lost messages (inclusive ids) that sit above a message the phone already shows. */
export function missingAbove(lane: ChatLane): { first: number; last: number }[] {
  const s = lane.state;
  const newest = s.screen.reduce((max, id) => Math.max(max, id), -1);
  const runs: { first: number; last: number }[] = [];
  for (let id = 0; id < newest; id += 1) {
    if (s.phase[id] !== 'lost') continue;
    const run = runs.at(-1);
    if (run && run.last === id - 1) run.last = id;
    else runs.push({ first: id, last: id });
  }
  return runs;
}

export interface ChatSummary {
  sent: number;
  shown: number;
  inFlight: number;
  /** The server holds these until the phone comes back. */
  queued: number;
  /** On the phone, waiting for an earlier message. */
  held: number;
  /** Pushed into a dead socket and never replayed (so far). */
  lost: number;
  outOfOrder: number;
  recovered: number;
  /** Shown messages that waited in the reorder buffer for at least one tick. */
  heldBack: number;
  averageHoldSeconds: number;
  longestHoldSeconds: number;
  /** From the server receiving a message to the phone showing it, over shown messages. */
  averageDelaySeconds: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function summarize(lane: ChatLane, messages: Message[]): ChatSummary {
  const s = lane.state;
  let shown = 0;
  let heldBack = 0;
  let holdTicks = 0;
  let longest = 0;
  let delayTicks = 0;
  for (const message of messages) {
    const id = message.id;
    if (s.phase[id] !== 'shown') continue;
    shown += 1;
    const shownAt = s.shownAt[id] ?? 0;
    const wait = shownAt - (s.receivedAt[id] ?? shownAt);
    if (wait > 0) {
      heldBack += 1;
      holdTicks += wait;
      longest = Math.max(longest, wait);
    }
    delayTicks += shownAt - message.arrival;
  }
  return {
    sent: s.sent,
    shown,
    inFlight: countPhase(lane, 'flight'),
    queued: countPhase(lane, 'queued'),
    held: countPhase(lane, 'held'),
    lost: countPhase(lane, 'lost'),
    outOfOrder: s.outOfOrder.filter(Boolean).length,
    recovered: s.recovered.filter(Boolean).length,
    heldBack,
    averageHoldSeconds: heldBack === 0 ? 0 : round1((holdTicks / heldBack) * TICK_SECONDS),
    longestHoldSeconds: round1(longest * TICK_SECONDS),
    averageDelaySeconds: shown === 0 ? 0 : round1((delayTicks / shown) * TICK_SECONDS),
  };
}

export interface ChatEstimate {
  messagesPerDay: number;
  averagePerSecond: number;
  peakPerSecond: number;
  deliveriesPerSecond: number;
  openConnections: number;
  gatewayServers: number;
  heartbeatsPerSecond: number;
  storageGigabytesPerDay: number;
}

/** Back-of-envelope sizing for the lesson's illustrative chat service. */
export function chatEstimates({
  dailyUsers = 50_000_000,
  messagesPerUserPerDay = 40,
  peakFactor = 3,
  recipientsPerMessage = 5,
  onlineShare = 0.4,
  connectionsPerGateway = 100_000,
  heartbeatSeconds = 30,
  bytesPerMessage = 200,
} = {}): ChatEstimate {
  const perDay = dailyUsers * messagesPerUserPerDay;
  const average = perDay / 86_400;
  const connections = Math.round(dailyUsers * onlineShare);
  return {
    messagesPerDay: perDay,
    averagePerSecond: Math.round(average),
    peakPerSecond: Math.round(average * peakFactor),
    deliveriesPerSecond: Math.round(average * peakFactor * recipientsPerMessage),
    openConnections: connections,
    gatewayServers: Math.ceil(connections / connectionsPerGateway),
    heartbeatsPerSecond: Math.round(connections / heartbeatSeconds),
    storageGigabytesPerDay: Math.round((perDay * bytesPerMessage) / 1e9),
  };
}
