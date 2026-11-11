import { createRng, hashString, randomInt } from '../rng';

/**
 * A toy flash sale: 100 seats, a crowd of buyers, and two ways to claim a
 * seat. Every buyer's arrival, seat choices, checkout time, and decision to
 * pay come from one pre-generated workload, so both lanes face the exact same
 * crowd and only the claiming rule differs. Times are compressed: checkout
 * takes seconds here and minutes in real life.
 */
export const ROWS = 10;
export const COLS = 10;
export const SEATS = ROWS * COLS;
export const TICK_SECONDS = 0.1;
/** A buyer picks at random among this many of the best seats that look free. */
export const PICK_FROM = 10;
const ROW_NAMES = 'ABCDEFGHIJ';

export type WriteMode = 'blind' | 'conditional';
export type TicketMetric = 'doubled' | 'sold';
export type TicketDuelId = 'oversell' | 'holds';
export type TicketScenarioId = 'rush' | 'waiting-room' | 'trickle' | 'abandon' | 'all-pay' | 'slow-pay';

export interface LaneConfig {
  label: string;
  write: WriteMode;
  /** Null means a hold lasts until the buyer pays, even if they never come back. */
  holdSeconds: number | null;
  /**
   * Pressing Pay claims the hold for checkout: one conditional write checks
   * that the hold is still this buyer's and moves its deadline to this many
   * seconds from now. Null means the hold keeps its original deadline while
   * the payment runs.
   */
  checkoutSeconds: number | null;
}

export interface WorkloadConfig {
  buyers: number;
  /** Random arrivals spread over this many seconds, or one buyer every gap seconds. */
  arrival: { kind: 'random'; seconds: number } | { kind: 'even'; gapSeconds: number };
  abandonShare: number;
  /** How long the bank takes to approve a payment after the buyer presses Pay. Absent means at once. */
  paymentSeconds?: { min: number; max: number };
}

export interface TicketScenario {
  id: TicketScenarioId;
  label: string;
  /** What this scenario changes from its duel's baseline, shown on its chip. */
  diff: string;
  workload: WorkloadConfig;
  /** Buyers let out of the waiting room per second, first come, first served. Null means no waiting room. */
  admitPerSecond: number | null;
  seconds: number;
  metric: TicketMetric;
  lanes: [LaneConfig, LaneConfig];
}

const blindLanes: [LaneConfig, LaneConfig] = [
  { label: 'Read, then write', write: 'blind', holdSeconds: 8, checkoutSeconds: null },
  { label: 'Conditional write', write: 'conditional', holdSeconds: 8, checkoutSeconds: null },
];
const holdLanes: [LaneConfig, LaneConfig] = [
  { label: 'Holds never expire', write: 'conditional', holdSeconds: null, checkoutSeconds: null },
  { label: 'Holds expire after 8 s', write: 'conditional', holdSeconds: 8, checkoutSeconds: null },
];
const checkoutLanes: [LaneConfig, LaneConfig] = [
  { label: 'Holds expire after 8 s', write: 'conditional', holdSeconds: 8, checkoutSeconds: null },
  { label: 'Pay claims the hold', write: 'conditional', holdSeconds: 8, checkoutSeconds: 10 },
];

const rushWorkload: WorkloadConfig = {
  buyers: 600,
  arrival: { kind: 'random', seconds: 3 },
  abandonShare: 0,
};
const abandonWorkload: WorkloadConfig = {
  buyers: 400,
  arrival: { kind: 'random', seconds: 28 },
  abandonShare: 0.3,
};

export const ticketScenarios: Record<TicketScenarioId, TicketScenario> = {
  rush: {
    id: 'rush',
    label: 'Doors open',
    diff: 'Baseline: 600 buyers arrive in the first 3 s and all open the seat map at once. 100 seats.',
    workload: rushWorkload,
    admitPerSecond: null,
    seconds: 20,
    metric: 'doubled',
    lanes: blindLanes,
  },
  'waiting-room': {
    id: 'waiting-room',
    label: 'Add a waiting room',
    diff: 'Waiting room: none to 20 buyers let in per second, first come, first served.',
    workload: rushWorkload,
    admitPerSecond: 20,
    seconds: 20,
    metric: 'doubled',
    lanes: blindLanes,
  },
  trickle: {
    id: 'trickle',
    label: 'Quiet test day',
    diff: 'Buyers: 600 in 3 s to 60 in total, one every 0.3 s.',
    workload: { buyers: 60, arrival: { kind: 'even', gapSeconds: 0.3 }, abandonShare: 0 },
    admitPerSecond: null,
    seconds: 20,
    metric: 'doubled',
    lanes: blindLanes,
  },
  abandon: {
    id: 'abandon',
    label: 'Some buyers walk away',
    diff: 'Baseline: 400 buyers over 28 s. Checkout takes 3 to 6 s and 30% leave without paying.',
    workload: abandonWorkload,
    admitPerSecond: null,
    seconds: 30,
    metric: 'sold',
    lanes: holdLanes,
  },
  'all-pay': {
    id: 'all-pay',
    label: 'Everyone pays',
    diff: 'Buyers who leave without paying: 30% to none.',
    workload: { ...abandonWorkload, abandonShare: 0 },
    admitPerSecond: null,
    seconds: 30,
    metric: 'sold',
    lanes: holdLanes,
  },
  'slow-pay': {
    id: 'slow-pay',
    label: 'Slow bank approvals',
    diff: 'Buyers who leave: 30% to none. Bank approval: instant to 1 to 5 s, so some checkouts outlast an 8 s hold. The second lane extends the hold to 10 s when its buyer presses Pay.',
    workload: { ...abandonWorkload, abandonShare: 0, paymentSeconds: { min: 1, max: 5 } },
    admitPerSecond: null,
    seconds: 30,
    metric: 'sold',
    lanes: checkoutLanes,
  },
};

export const duelScenarioIds: Record<TicketDuelId, TicketScenarioId[]> = {
  oversell: ['rush', 'waiting-room', 'trickle'],
  holds: ['abandon', 'all-pay', 'slow-pay'],
};

export interface Buyer {
  id: number;
  arrival: number;
  /** Ticks from getting a hold to pressing Pay or walking away. */
  payTicks: number;
  abandons: boolean;
  /** Ticks from pressing Pay to the bank's approval. */
  paymentTicks: number;
}

/** The shared crowd, sorted by arrival tick and then id. */
export function makeWorkload(config: WorkloadConfig, seed: number): Buyer[] {
  const rng = createRng(seed);
  const buyers: Buyer[] = [];
  for (let id = 0; id < config.buyers; id += 1) {
    const arrival =
      config.arrival.kind === 'even'
        ? Math.round((id * config.arrival.gapSeconds) / TICK_SECONDS)
        : randomInt(rng, 0, Math.round(config.arrival.seconds / TICK_SECONDS) - 1);
    const payTicks = randomInt(rng, 30, 60);
    const abandons = rng() < config.abandonShare;
    // A hash keeps the main random stream untouched, so adding bank delay never reshuffles the crowd.
    const bank = config.paymentSeconds;
    const paymentTicks = bank
      ? Math.round(
          (bank.min + (hashString(`${seed}:bank:${id}`) / 4294967296) * (bank.max - bank.min)) / TICK_SECONDS,
        )
      : 0;
    buyers.push({ id, arrival, payTicks, abandons, paymentTicks });
  }
  return buyers.sort((a, b) => a.arrival - b.arrival || a.id - b.id);
}

/** Seats from best to worst: front rows first, then outward from the middle of the row. */
export const BEST_ORDER: number[] = Array.from({ length: SEATS }, (_, seat) => seat).sort((a, b) => {
  const rowA = Math.floor(a / COLS);
  const rowB = Math.floor(b / COLS);
  const centerA = Math.abs((a % COLS) - (COLS - 1) / 2);
  const centerB = Math.abs((b % COLS) - (COLS - 1) / 2);
  return rowA - rowB || centerA - centerB || a - b;
});

export function seatName(seat: number): string {
  return `${ROW_NAMES[Math.floor(seat / COLS)]}${(seat % COLS) + 1}`;
}

export type Phase =
  | 'future'
  | 'queued'
  | 'reading'
  | 'writing'
  | 'holding'
  /** Pressed Pay and waiting for the bank. The seat may already be gone if the hold expired. */
  | 'paying'
  | 'ticketed'
  | 'abandoned'
  /** Lost the seat because the hold expired before the payment captured. */
  | 'expired'
  | 'soldOut';

interface LaneState {
  phase: Phase[];
  /** The seat a buyer is about to write, holds, or bought. -1 for none. */
  seat: number[];
  holdStart: number[];
  /** Tick at which the buyer's hold lapses. -1 means it never does. */
  expiresAt: number[];
  payStart: number[];
  reads: number[];
  /** Buyer ids holding or owning each seat. Two or more means the seat was promised twice. */
  holders: number[][];
  doubled: boolean[];
  queue: number[];
  admitBudget: number;
  totals: {
    arrived: number;
    ticketed: number;
    rejected: number;
    soldOut: number;
    abandoned: number;
    released: number;
    doubledSeats: number;
    /** Approved payments the system voided because the hold had already expired. */
    voided: number;
    /** Buyers who lost their seat to an expired hold. */
    lost: number;
  };
  queriesByTick: number[];
  peakQueries: number;
  series: number[];
  allSold: boolean;
  firstSoldOut: boolean;
}

export interface TicketLane {
  config: LaneConfig;
  state: LaneState;
}

export interface TicketEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export type SeatView = 'free' | 'held' | 'left' | 'sold' | 'doubled';

export interface TicketCheckpoint {
  tick: number;
  lanes: [LaneState, LaneState];
  events: TicketEvent[];
}

function emptyLane(buyers: number): LaneState {
  return {
    phase: Array.from({ length: buyers }, () => 'future' as Phase),
    seat: Array.from({ length: buyers }, () => -1),
    holdStart: Array.from({ length: buyers }, () => -1),
    expiresAt: Array.from({ length: buyers }, () => -1),
    payStart: Array.from({ length: buyers }, () => -1),
    reads: Array.from({ length: buyers }, () => 0),
    holders: Array.from({ length: SEATS }, () => []),
    doubled: Array.from({ length: SEATS }, () => false),
    queue: [],
    admitBudget: 0,
    totals: {
      arrived: 0,
      ticketed: 0,
      rejected: 0,
      soldOut: 0,
      abandoned: 0,
      released: 0,
      doubledSeats: 0,
      voided: 0,
      lost: 0,
    },
    queriesByTick: [],
    peakQueries: 0,
    series: [],
    allSold: false,
    firstSoldOut: false,
  };
}

export class TicketDuel {
  readonly scenario: TicketScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly buyers: Buyer[];
  readonly lanes: [TicketLane, TicketLane];
  events: TicketEvent[] = [];
  private tickCount = 0;
  private readonly seed: number;
  private readonly byId: Buyer[];
  private nextArrival = 0;

  constructor(scenario: TicketScenario, seed = 42) {
    this.scenario = scenario;
    this.seed = seed;
    this.length = Math.round(scenario.seconds / TICK_SECONDS);
    this.buyers = makeWorkload(scenario.workload, seed);
    this.byId = [...this.buyers].sort((a, b) => a.id - b.id);
    const count = this.buyers.length;
    this.lanes = [
      { config: scenario.lanes[0], state: emptyLane(count) },
      { config: scenario.lanes[1], state: emptyLane(count) },
    ];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  checkpoint(): TicketCheckpoint {
    return structuredClone({
      tick: this.tickCount,
      lanes: [this.lanes[0].state, this.lanes[1].state] as [LaneState, LaneState],
      events: this.events,
    });
  }

  restore(saved: TicketCheckpoint): void {
    const copy = structuredClone(saved);
    this.tickCount = copy.tick;
    this.lanes[0].state = copy.lanes[0];
    this.lanes[1].state = copy.lanes[1];
    this.events = copy.events;
    this.nextArrival = this.buyers.findIndex((buyer) => buyer.arrival >= copy.tick);
    if (this.nextArrival < 0) this.nextArrival = this.buyers.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    const arriving: number[] = [];
    while (this.nextArrival < this.buyers.length && this.buyers[this.nextArrival]?.arrival === tick) {
      arriving.push(this.buyers[this.nextArrival]?.id ?? 0);
      this.nextArrival += 1;
    }
    for (const lane of this.lanes) this.stepLane(lane, tick, arriving);
    this.tickCount += 1;
    if (this.done) this.wrapUp();
  }

  private stepLane(lane: TicketLane, tick: number, arriving: number[]): void {
    const s = lane.state;
    const { label, write, holdSeconds, checkoutSeconds } = lane.config;
    const holdTicks = holdSeconds === null ? null : Math.round(holdSeconds / TICK_SECONDS);
    const checkoutTicks = checkoutSeconds === null ? null : Math.round(checkoutSeconds / TICK_SECONDS);
    let queries = 0;

    for (const id of arriving) {
      s.phase[id] = 'queued';
      s.queue.push(id);
      s.totals.arrived += 1;
    }

    // Writes from buyers who read last tick, in the order they read.
    const rereads: number[] = [];
    for (let id = 0; id < s.phase.length; id += 1) {
      if (s.phase[id] !== 'writing') continue;
      queries += 1;
      const seat = s.seat[id] ?? -1;
      const holders = s.holders[seat] ?? [];
      if (write === 'conditional' && holders.length > 0) {
        s.totals.rejected += 1;
        s.phase[id] = 'reading';
        s.seat[id] = -1;
        rereads.push(id);
        continue;
      }
      holders.push(id);
      s.phase[id] = 'holding';
      s.holdStart[id] = tick;
      s.expiresAt[id] = holdTicks === null ? -1 : tick + holdTicks;
      if (holders.length >= 2 && !s.doubled[seat]) {
        s.doubled[seat] = true;
        s.totals.doubledSeats += 1;
        if (s.totals.doubledSeats === 1) {
          this.events.push({
            tick: tick + 1,
            text: `${label}: seat ${seatName(seat)} is promised to ${holders.length} buyers. Each one saw it free a moment earlier.`,
            marker: true,
          });
        }
      }
    }

    // Checkouts move through hold, pay, and capture. Every hold past its deadline goes back on
    // sale, whatever its buyer is doing, and a payment only captures against a live hold.
    const expired = (id: number) => (s.expiresAt[id] ?? -1) >= 0 && tick >= (s.expiresAt[id] ?? -1);
    for (let id = 0; id < s.phase.length; id += 1) {
      const phase = s.phase[id];
      if (phase !== 'holding' && phase !== 'paying' && phase !== 'abandoned') continue;
      const buyer = this.byId[id];
      if (!buyer) continue;
      const seat = s.seat[id] ?? -1;
      if (phase === 'holding' && tick - (s.holdStart[id] ?? tick) >= buyer.payTicks) {
        if (buyer.abandons) {
          s.phase[id] = 'abandoned';
          s.totals.abandoned += 1;
        } else if (!expired(id)) {
          // The claim is one conditional write: it succeeds only while this buyer's hold is live.
          if (checkoutTicks !== null) s.expiresAt[id] = tick + checkoutTicks;
          s.phase[id] = 'paying';
          s.payStart[id] = tick;
        }
      }
      if (s.phase[id] === 'paying' && tick - (s.payStart[id] ?? tick) >= buyer.paymentTicks) {
        if (seat >= 0 && !expired(id)) {
          s.phase[id] = 'ticketed';
          s.totals.ticketed += 1;
        } else {
          s.phase[id] = 'expired';
          s.totals.voided += 1;
          s.totals.lost += 1;
          if (s.totals.voided === 1) {
            this.events.push({
              tick: tick + 1,
              text: `${label}: the bank approves a payment after its hold expired, so the system voids the authorization and that buyer gets no ticket.`,
              marker: true,
            });
          }
        }
      }
      const now = s.phase[id];
      if (seat >= 0 && now !== 'ticketed' && expired(id)) {
        s.holders[seat] = (s.holders[seat] ?? []).filter((holder) => holder !== id);
        s.seat[id] = -1;
        s.totals.released += 1;
        if (now === 'holding') {
          s.phase[id] = 'expired';
          s.totals.lost += 1;
        }
        if (s.totals.released === 1) {
          const why =
            now === 'abandoned'
              ? 'so the seat its buyer abandoned goes back on sale'
              : now === 'paying'
                ? 'while its buyer still waits on the bank, so the seat goes back on sale'
                : 'before its buyer presses Pay, so the seat goes back on sale';
          this.events.push({
            tick: tick + 1,
            text: `${label}: the hold on ${seatName(seat)} expires after ${holdSeconds} s, ${why}.`,
            marker: true,
          });
        }
      }
    }

    // Once every seat has a paid ticket, the waiting room tells everyone left.
    const everySeatPaid = s.holders.every(
      (holders) => holders.length > 0 && holders.every((holder) => s.phase[holder] === 'ticketed'),
    );
    if (everySeatPaid && !s.allSold) {
      s.allSold = true;
      this.events.push({
        tick: tick + 1,
        text: `${label}: all ${SEATS} seats are paid for, as ${s.totals.ticketed} tickets.`,
        marker: this.scenario.metric === 'doubled',
      });
    }
    if (everySeatPaid) {
      for (const id of s.queue) this.markSoldOut(lane, id, tick);
      s.queue = [];
    }

    // Admission from the waiting room.
    const admitted: number[] = [];
    if (this.scenario.admitPerSecond === null) {
      admitted.push(...s.queue);
      s.queue = [];
    } else {
      s.admitBudget += this.scenario.admitPerSecond * TICK_SECONDS;
      while (s.admitBudget >= 1 && s.queue.length > 0) {
        admitted.push(s.queue.shift() ?? 0);
        s.admitBudget -= 1;
      }
      if (s.queue.length === 0) s.admitBudget = Math.min(s.admitBudget, 1);
    }

    // Reads: everyone choosing this tick sees the same snapshot of free seats.
    const free = BEST_ORDER.filter((seat) => (s.holders[seat]?.length ?? 0) === 0);
    const shortlist = Math.min(PICK_FROM, free.length);
    for (const id of [...rereads, ...admitted]) {
      queries += 1;
      if (shortlist === 0) {
        this.markSoldOut(lane, id, tick);
        continue;
      }
      const attempt = s.reads[id] ?? 0;
      s.reads[id] = attempt + 1;
      const u = hashString(`${this.seed}:${id}:${attempt}`) / 4294967296;
      s.seat[id] = free[Math.floor(u * shortlist)] ?? -1;
      s.phase[id] = 'writing';
    }

    s.queriesByTick.push(queries);
    const window = s.queriesByTick.slice(-Math.round(1 / TICK_SECONDS));
    s.peakQueries = Math.max(
      s.peakQueries,
      window.reduce((sum, value) => sum + value, 0),
    );
    s.series.push(this.scenario.metric === 'doubled' ? s.totals.doubledSeats : s.totals.ticketed);
  }

  private markSoldOut(lane: TicketLane, id: number, tick: number): void {
    const s = lane.state;
    s.phase[id] = 'soldOut';
    s.totals.soldOut += 1;
    if (s.firstSoldOut || this.scenario.metric !== 'sold') {
      s.firstSoldOut = true;
      return;
    }
    s.firstSoldOut = true;
    const left = countSeats(lane, 'left');
    this.events.push({
      tick: tick + 1,
      text:
        left === 0
          ? `${lane.config.label}: the first buyer sees "sold out". Every held seat belongs to a buyer who is still paying.`
          : `${lane.config.label}: the first buyer sees "sold out" while ${left} ${left === 1 ? 'seat sits in a hold whose buyer' : 'seats sit in holds whose buyers'} already left.`,
      marker: true,
    });
  }

  private wrapUp(): void {
    const [a, b] = this.lanes;
    const name = (lane: TicketLane) => lane.config.label.toLowerCase();
    const sa = summarize(a);
    const sb = summarize(b);
    let text: string;
    if (this.scenario.metric === 'doubled') {
      text = `Run ends. Seats promised to two or more buyers: ${name(a)} ${sa.doubledSeats}, ${name(b)} ${sb.doubledSeats}. Tickets issued for ${SEATS} seats: ${sa.ticketed} and ${sb.ticketed}.`;
    } else if (this.scenario.workload.paymentSeconds) {
      text = `Run ends. Tickets sold: ${name(a)} ${sa.ticketed}, ${name(b)} ${sb.ticketed}. Approved payments voided because the hold expired first: ${sa.voided} and ${sb.voided}.`;
    } else {
      text = `Run ends. Tickets sold: ${name(a)} ${sa.ticketed}, ${name(b)} ${sb.ticketed}. Seats stuck with buyers who left: ${sa.stuck} and ${sb.stuck}.`;
    }
    this.events.push({ tick: this.tickCount, text, marker: false });
  }
}

export function seatView(lane: TicketLane, seat: number): { view: SeatView; holders: number } {
  const s = lane.state;
  const holders = s.holders[seat] ?? [];
  if (holders.length === 0) return { view: 'free', holders: 0 };
  if (holders.length >= 2) return { view: 'doubled', holders: holders.length };
  const phase = s.phase[holders[0] ?? 0];
  if (phase === 'ticketed') return { view: 'sold', holders: 1 };
  if (phase === 'abandoned') return { view: 'left', holders: 1 };
  return { view: 'held', holders: 1 };
}

export function countSeats(lane: TicketLane, view: SeatView): number {
  let count = 0;
  for (let seat = 0; seat < SEATS; seat += 1) if (seatView(lane, seat).view === view) count += 1;
  return count;
}

export interface PhaseCounts {
  queued: number;
  choosing: number;
  /** Holding a seat or waiting on the bank. */
  checkout: number;
  ticketed: number;
  abandoned: number;
  /** Lost the seat to an expired hold. */
  lost: number;
  soldOut: number;
}

export function phaseCounts(lane: TicketLane): PhaseCounts {
  const counts: PhaseCounts = {
    queued: 0,
    choosing: 0,
    checkout: 0,
    ticketed: 0,
    abandoned: 0,
    lost: 0,
    soldOut: 0,
  };
  for (const phase of lane.state.phase) {
    if (phase === 'queued') counts.queued += 1;
    else if (phase === 'reading' || phase === 'writing') counts.choosing += 1;
    else if (phase === 'holding' || phase === 'paying') counts.checkout += 1;
    else if (phase === 'ticketed') counts.ticketed += 1;
    else if (phase === 'abandoned') counts.abandoned += 1;
    else if (phase === 'expired') counts.lost += 1;
    else if (phase === 'soldOut') counts.soldOut += 1;
  }
  return counts;
}

export interface TicketSummary {
  arrived: number;
  ticketed: number;
  doubledSeats: number;
  rejected: number;
  peakQueries: number;
  soldOut: number;
  abandoned: number;
  /** Seats held right now by a buyer who already walked away. */
  stuck: number;
  released: number;
  /** Approved payments voided because the hold expired before capture. */
  voided: number;
  /** Buyers who lost their seat to an expired hold, paying or not. */
  lost: number;
}

export function summarize(lane: TicketLane): TicketSummary {
  const t = lane.state.totals;
  return {
    arrived: t.arrived,
    ticketed: t.ticketed,
    doubledSeats: t.doubledSeats,
    rejected: t.rejected,
    peakQueries: lane.state.peakQueries,
    soldOut: t.soldOut,
    abandoned: t.abandoned,
    stuck: countSeats(lane, 'left'),
    released: t.released,
    voided: t.voided,
    lost: t.lost,
  };
}

export interface TicketingEstimate {
  buyersPerSeat: number;
  peakRequestsPerSecond: number;
  holdAttemptsPerSecond: number;
  seatTableKilobytes: number;
}

/** Back-of-envelope sizing for the lesson's illustrative sale of 10,000 seats. */
export function ticketingEstimates({
  people = 1_000_000,
  seats = 10_000,
  burstSeconds = 60,
  requestsPerPerson = 6,
  bytesPerSeat = 100,
} = {}): TicketingEstimate {
  return {
    buyersPerSeat: Math.round(people / seats),
    peakRequestsPerSecond: Math.round((people * requestsPerPerson) / burstSeconds),
    holdAttemptsPerSecond: Math.round(people / burstSeconds),
    seatTableKilobytes: Math.round((seats * bytesPerSeat) / 1000),
  };
}
