import { createRng, randomInt } from '../rng';

/**
 * A toy payment service: 120 shoppers press Pay, the service calls the bank,
 * and some calls time out. Every payment's arrival, amount, and the bank's
 * behavior on each attempt come from one pre-generated workload, so both lanes
 * send the same requests at the same moments and only the lane rule differs.
 * Times are compressed: reconciliation runs every 10 s here and nightly in
 * real life, and the settlement file lags by seconds here and by hours or days
 * in real life. An unknown payment stays unknown until the file shows its
 * charge or a status lookup by key returns a terminal answer.
 */
export const TICK_SECONDS = 0.1;
export const PAYMENTS = 120;
export const GRID_COLS = 12;
export const MAX_ATTEMPTS = 3;
/** Waits before the second and third attempts. */
export const BACKOFF_SECONDS = [0.5, 1] as const;
const ARRIVAL_SECONDS = 20;
/** A request reaches the bank, and the bank charges the card, this long after it is sent. */
const BANK_RECEIVE_TICKS = 1;
/** A charge reaches the bank's settlement file this long after the bank takes the money, drawn per payment. */
export const SETTLE_SECONDS = [3, 15] as const;
/**
 * The bank answers a status lookup with "still processing" until this long after the last attempt.
 * After that its answer is final: charged, or no charge.
 */
export const BANK_FINAL_SECONDS = 5;

export type PayDuelId = 'retries' | 'reconcile';
export type PayScenarioId = 'slow-bank' | 'short-timeout' | 'healthy-bank' | 'outage' | 'calm-day';
export type PayMetric = 'doubled' | 'unknown';

export interface LaneConfig {
  label: string;
  /** Every attempt for one payment carries the same key, and the bank charges a key at most once. */
  idempotencyKey: boolean;
  /** Null means the service trusts its own ledger and never compares it with the bank. */
  reconcileSeconds: number | null;
}

/** Shares of attempts that get lost on the way to the bank, or reach it and reply after the timeout. */
export interface BankWeather {
  lostShare: number;
  slowShare: number;
}

export interface PayScenario {
  id: PayScenarioId;
  label: string;
  /** What this scenario changes from its duel's baseline, shown on its chip. */
  diff: string;
  bank: BankWeather;
  /** A window in which attempts sent to the bank meet worse weather. */
  outage: { fromSeconds: number; toSeconds: number; bank: BankWeather } | null;
  timeoutSeconds: number;
  seconds: number;
  metric: PayMetric;
  lanes: [LaneConfig, LaneConfig];
}

const retryLanes: [LaneConfig, LaneConfig] = [
  { label: 'Retry without a key', idempotencyKey: false, reconcileSeconds: null },
  { label: 'Retry with an idempotency key', idempotencyKey: true, reconcileSeconds: null },
];
const reconcileLanes: [LaneConfig, LaneConfig] = [
  { label: 'Trust the ledger', idempotencyKey: true, reconcileSeconds: null },
  { label: 'Reconcile every 10 s', idempotencyKey: true, reconcileSeconds: 10 },
];
const slowBank: BankWeather = { lostShare: 0.05, slowShare: 0.15 };
const calmBank: BankWeather = { lostShare: 0, slowShare: 0 };

export const payScenarios: Record<PayScenarioId, PayScenario> = {
  'slow-bank': {
    id: 'slow-bank',
    label: 'Slow bank',
    diff: 'Baseline: 120 payments in 20 s. 15% of bank replies arrive after the 2 s timeout, and 5% of requests never reach the bank.',
    bank: slowBank,
    outage: null,
    timeoutSeconds: 2,
    seconds: 30,
    metric: 'doubled',
    lanes: retryLanes,
  },
  'short-timeout': {
    id: 'short-timeout',
    label: 'Shorter timeout',
    diff: 'Timeout: 2 s to 1 s, so some ordinary replies count as late too.',
    bank: slowBank,
    outage: null,
    timeoutSeconds: 1,
    seconds: 30,
    metric: 'doubled',
    lanes: retryLanes,
  },
  'healthy-bank': {
    id: 'healthy-bank',
    label: 'Healthy bank',
    diff: 'Late replies: 15% to none. Lost requests: 5% to none.',
    bank: calmBank,
    outage: null,
    timeoutSeconds: 2,
    seconds: 30,
    metric: 'doubled',
    lanes: retryLanes,
  },
  outage: {
    id: 'outage',
    label: 'Bank outage',
    diff: 'Baseline: the bank is healthy except from 8 s to 16 s, when 45% of replies arrive late and 35% of requests get lost.',
    bank: calmBank,
    outage: { fromSeconds: 8, toSeconds: 16, bank: { lostShare: 0.35, slowShare: 0.45 } },
    timeoutSeconds: 2,
    seconds: 30,
    metric: 'unknown',
    lanes: reconcileLanes,
  },
  'calm-day': {
    id: 'calm-day',
    label: 'Calm day',
    diff: 'Outage from 8 s to 16 s: removed. Every reply arrives in time.',
    bank: calmBank,
    outage: null,
    timeoutSeconds: 2,
    seconds: 30,
    metric: 'unknown',
    lanes: reconcileLanes,
  },
};

export const duelScenarioIds: Record<PayDuelId, PayScenarioId[]> = {
  retries: ['slow-bank', 'short-timeout', 'healthy-bank'],
  reconcile: ['outage', 'calm-day'],
};

/** The dice for one attempt. The scenario's weather decides what they mean. */
export interface AttemptDraw {
  roll: number;
  fastTicks: number;
  slowTicks: number;
}

export interface Payment {
  id: number;
  arrival: number;
  amount: number;
  attempts: AttemptDraw[];
}

/** The shared shoppers, in id order. Every scenario uses the same ones. */
export function makePayments(seed: number): Payment[] {
  const rng = createRng(seed);
  const payments: Payment[] = [];
  for (let id = 0; id < PAYMENTS; id += 1) {
    const arrival = randomInt(rng, 0, Math.round(ARRIVAL_SECONDS / TICK_SECONDS) - 1);
    const amount = randomInt(rng, 2, 18) * 5;
    const attempts: AttemptDraw[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      attempts.push({ roll: rng(), fastTicks: randomInt(rng, 3, 12), slowTicks: randomInt(rng, 25, 45) });
    }
    payments.push({ id, arrival, amount, attempts });
  }
  return payments;
}

/** Settlement delay per payment, from its own stream so the shoppers above never change. */
function makeSettleTicks(seed: number): number[] {
  const rng = createRng(seed ^ 0x5e771e);
  const [low, high] = SETTLE_SECONDS.map((seconds) => Math.round(seconds / TICK_SECONDS));
  return Array.from({ length: PAYMENTS }, () => randomInt(rng, low ?? 0, high ?? 0));
}

export type AttemptKind = 'fast' | 'slow' | 'lost';

export type PayPhase = 'future' | 'sending' | 'backoff' | 'paid' | 'unknown' | 'failed';

interface LaneState {
  phase: PayPhase[];
  attempt: number[];
  sentAt: number[];
  retryAt: number[];
  /** Charges the bank made for each payment. More than one means the shopper paid twice. */
  charges: number[];
  /** Tick of the bank's first charge for each payment, or -1. */
  chargedAt: number[];
  recovered: number;
  confirmedFailed: number;
  retries: number;
  deduped: number;
  arrived: number;
  series: number[];
  firstDouble: boolean;
  firstDedupe: boolean;
}

export interface PayLane {
  config: LaneConfig;
  state: LaneState;
}

export interface PayEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface PayCheckpoint {
  tick: number;
  lanes: [LaneState, LaneState];
  events: PayEvent[];
  firstUnknown: boolean;
}

function emptyLane(): LaneState {
  const blank = () => Array.from({ length: PAYMENTS }, () => 0);
  return {
    phase: Array.from({ length: PAYMENTS }, () => 'future' as PayPhase),
    attempt: blank(),
    sentAt: blank(),
    retryAt: blank(),
    charges: blank(),
    chargedAt: Array.from({ length: PAYMENTS }, () => -1),
    recovered: 0,
    confirmedFailed: 0,
    retries: 0,
    deduped: 0,
    arrived: 0,
    series: [],
    firstDouble: false,
    firstDedupe: false,
  };
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export class PayDuel {
  readonly scenario: PayScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly timeoutTicks: number;
  readonly payments: Payment[];
  /** How long each payment's charge takes to reach the bank's settlement file. */
  readonly settleTicks: number[];
  readonly finalTicks = Math.round(BANK_FINAL_SECONDS / TICK_SECONDS);
  readonly lanes: [PayLane, PayLane];
  events: PayEvent[] = [];
  private tickCount = 0;
  private firstUnknown = false;

  constructor(scenario: PayScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(scenario.seconds / TICK_SECONDS);
    this.timeoutTicks = Math.round(scenario.timeoutSeconds / TICK_SECONDS);
    this.payments = makePayments(seed);
    this.settleTicks = makeSettleTicks(seed);
    this.lanes = [
      { config: scenario.lanes[0], state: emptyLane() },
      { config: scenario.lanes[1], state: emptyLane() },
    ];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  checkpoint(): PayCheckpoint {
    return structuredClone({
      tick: this.tickCount,
      lanes: [this.lanes[0].state, this.lanes[1].state] as [LaneState, LaneState],
      events: this.events,
      firstUnknown: this.firstUnknown,
    });
  }

  restore(saved: PayCheckpoint): void {
    const copy = structuredClone(saved);
    this.tickCount = copy.tick;
    this.lanes[0].state = copy.lanes[0];
    this.lanes[1].state = copy.lanes[1];
    this.events = copy.events;
    this.firstUnknown = copy.firstUnknown;
  }

  /** What the bank does with one attempt, given when it was sent. */
  attemptKind(payment: Payment, attempt: number, sentAt: number): AttemptKind {
    const { outage } = this.scenario;
    const inOutage =
      outage !== null &&
      sentAt >= Math.round(outage.fromSeconds / TICK_SECONDS) &&
      sentAt < Math.round(outage.toSeconds / TICK_SECONDS);
    const weather = inOutage ? outage.bank : this.scenario.bank;
    const roll = payment.attempts[attempt]?.roll ?? 1;
    if (roll < weather.lostShare) return 'lost';
    if (roll < weather.lostShare + weather.slowShare) return 'slow';
    return 'fast';
  }

  private replyTicks(payment: Payment, attempt: number, kind: AttemptKind): number {
    const draw = payment.attempts[attempt];
    if (!draw || kind === 'lost') return Number.POSITIVE_INFINITY;
    return kind === 'slow' ? draw.slowTicks : draw.fastTicks;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    const { outage } = this.scenario;
    if (outage && tick === Math.round(outage.fromSeconds / TICK_SECONDS)) {
      this.events.push({
        tick,
        text: `The bank slows down. Most replies now arrive after the ${this.scenario.timeoutSeconds} s timeout, and some requests never reach it.`,
        marker: true,
      });
    }
    if (outage && tick === Math.round(outage.toSeconds / TICK_SECONDS)) {
      this.events.push({ tick, text: 'The bank recovers. Replies arrive in time again.', marker: true });
    }
    const newlyUnknown = this.lanes.map((lane) => this.stepLane(lane, tick));
    if (this.scenario.metric === 'unknown' && !this.firstUnknown) {
      const id = newlyUnknown[0];
      if (id !== undefined && id >= 0) {
        this.firstUnknown = true;
        this.events.push({
          tick: tick + 1,
          text: `Both lanes: payment ${id + 1} gives up after ${MAX_ATTEMPTS} attempts that all timed out. The service cannot tell whether the bank charged the card.`,
          marker: true,
        });
      }
    }
    this.tickCount += 1;
    if (this.done) this.wrapUp();
  }

  /** Returns the first payment that gave up this tick, or -1. */
  private stepLane(lane: PayLane, tick: number): number {
    const s = lane.state;
    const { label, idempotencyKey, reconcileSeconds } = lane.config;
    const narrateCharges = this.scenario.metric === 'doubled';
    let gaveUp = -1;

    for (const payment of this.payments) {
      const id = payment.id;
      if (s.phase[id] === 'future' && payment.arrival === tick) {
        s.phase[id] = 'sending';
        s.attempt[id] = 0;
        s.sentAt[id] = tick;
        s.arrived += 1;
      }
      if (s.phase[id] === 'backoff' && s.retryAt[id] === tick) {
        s.phase[id] = 'sending';
        s.attempt[id] = (s.attempt[id] ?? 0) + 1;
        s.sentAt[id] = tick;
        s.retries += 1;
      }
      if (s.phase[id] !== 'sending') continue;

      const attempt = s.attempt[id] ?? 0;
      const sentAt = s.sentAt[id] ?? tick;
      const kind = this.attemptKind(payment, attempt, sentAt);
      const elapsed = tick - sentAt;

      if (kind !== 'lost' && elapsed === BANK_RECEIVE_TICKS) {
        const charges = s.charges[id] ?? 0;
        if (idempotencyKey && charges > 0) {
          s.deduped += 1;
          if (narrateCharges && !s.firstDedupe) {
            s.firstDedupe = true;
            this.events.push({
              tick: tick + 1,
              text: `${label}: payment ${id + 1} timed out, and its retry carries the same key. The bank returns the first result and charges nothing.`,
              marker: true,
            });
          }
        } else {
          s.charges[id] = charges + 1;
          if (charges === 0) s.chargedAt[id] = tick;
          if (narrateCharges && charges + 1 === 2 && !s.firstDouble) {
            s.firstDouble = true;
            this.events.push({
              tick: tick + 1,
              text: `${label}: payment ${id + 1} timed out, and its retry charges the card again. The shopper pays ${money(payment.amount)} twice.`,
              marker: true,
            });
          }
        }
      }

      const reply = this.replyTicks(payment, attempt, kind);
      if (reply <= this.timeoutTicks && elapsed === reply) {
        s.phase[id] = 'paid';
      } else if (elapsed === this.timeoutTicks) {
        const wait = BACKOFF_SECONDS[attempt];
        if (wait === undefined) {
          s.phase[id] = 'unknown';
          if (gaveUp < 0) gaveUp = id;
        } else {
          s.phase[id] = 'backoff';
          s.retryAt[id] = tick + Math.round(wait / TICK_SECONDS);
        }
      }
    }

    if (reconcileSeconds !== null && (tick + 1) % Math.round(reconcileSeconds / TICK_SECONDS) === 0) {
      this.reconcile(lane, tick);
    }

    s.series.push(this.scenario.metric === 'doubled' ? countDoubled(lane) : countPhase(lane, 'unknown'));
    return gaveUp;
  }

  /** True once a payment's charge has reached the bank's settlement file. */
  inFile(lane: PayLane, id: number, tick: number): boolean {
    const chargedAt = lane.state.chargedAt[id] ?? -1;
    return chargedAt >= 0 && chargedAt + (this.settleTicks[id] ?? 0) <= tick;
  }

  /** True once the bank's answer to a status lookup for this payment is terminal. */
  lookupFinal(lane: PayLane, id: number, tick: number): boolean {
    return (lane.state.sentAt[id] ?? tick) + this.finalTicks <= tick;
  }

  /**
   * Settle unknown payments from evidence. A charge in the settlement file completes a payment.
   * A missing file entry proves nothing, because the file lags, so the job then looks the payment
   * up by its idempotency key. Only a terminal answer settles it; "still processing" keeps it unknown.
   */
  private reconcile(lane: PayLane, tick: number): void {
    const s = lane.state;
    let fromFile = 0;
    let lookedUpCharged = 0;
    let failed = 0;
    let pending = 0;
    for (let id = 0; id < PAYMENTS; id += 1) {
      if (s.phase[id] !== 'unknown') continue;
      const charged = (s.charges[id] ?? 0) > 0;
      if (this.inFile(lane, id, tick)) {
        s.phase[id] = 'paid';
        s.recovered += 1;
        fromFile += 1;
      } else if (!this.lookupFinal(lane, id, tick)) {
        pending += 1;
      } else if (charged) {
        s.phase[id] = 'paid';
        s.recovered += 1;
        lookedUpCharged += 1;
      } else {
        s.phase[id] = 'failed';
        s.confirmedFailed += 1;
        failed += 1;
      }
    }
    if (fromFile + lookedUpCharged + failed + pending === 0) return;
    const sentences = [];
    if (fromFile > 0)
      sentences.push(
        `the bank's file shows ${count(fromFile, 'charge')} the ledger lacks, so ${fromFile === 1 ? 'that payment completes' : 'those payments complete'}.`,
      );
    const lookups = [];
    if (lookedUpCharged > 0) lookups.push(count(lookedUpCharged, 'more charge'));
    if (failed > 0)
      lookups.push(
        `${count(failed, 'payment')} the bank never charged, which ${failed === 1 ? 'is' : 'are'} marked failed`,
      );
    if (lookups.length > 0) sentences.push(`a status lookup by key confirms ${lookups.join(' and ')}.`);
    if (pending > 0)
      sentences.push(
        `${count(pending, 'payment')} ${pending === 1 ? 'stays' : 'stay'} unknown because the bank is still processing ${pending === 1 ? 'it' : 'them'}.`,
      );
    const text = sentences.map((sentence, i) =>
      i === 0 ? sentence : sentence.charAt(0).toUpperCase() + sentence.slice(1),
    );
    this.events.push({ tick: tick + 1, text: `${lane.config.label}: ${text.join(' ')}`, marker: true });
  }

  private wrapUp(): void {
    const [a, b] = this.lanes;
    const name = (lane: PayLane) => lane.config.label.toLowerCase();
    const sa = summarize(a, this.payments);
    const sb = summarize(b, this.payments);
    this.events.push({
      tick: this.tickCount,
      text:
        this.scenario.metric === 'doubled'
          ? `Run ends. Shoppers charged more than once: ${name(a)} ${sa.doubled}, ${name(b)} ${sb.doubled}. Extra money taken: ${money(sa.extraDollars)} and ${money(sb.extraDollars)}.`
          : `Run ends. Payments with an unknown outcome: ${name(a)} ${sa.unknown}, ${name(b)} ${sb.unknown}. Money the bank took that the ledger never recorded: ${money(sa.gapDollars)} and ${money(sb.gapDollars)}.`,
      marker: false,
    });
  }
}

function countDoubled(lane: PayLane): number {
  return lane.state.charges.filter((charges) => charges >= 2).length;
}

function countPhase(lane: PayLane, phase: PayPhase): number {
  return lane.state.phase.filter((value) => value === phase).length;
}

export type TileView = 'future' | 'pending' | 'paid' | 'doubled' | 'unknown' | 'failed';

export function tileView(lane: PayLane, id: number): { view: TileView; charges: number } {
  const s = lane.state;
  const charges = s.charges[id] ?? 0;
  if (charges >= 2) return { view: 'doubled', charges };
  const phase = s.phase[id];
  if (phase === 'sending' || phase === 'backoff') return { view: 'pending', charges };
  if (phase === 'paid' || phase === 'unknown' || phase === 'failed' || phase === 'future')
    return { view: phase, charges };
  return { view: 'future', charges };
}

export interface PaySummary {
  arrived: number;
  inFlight: number;
  paid: number;
  unknown: number;
  failed: number;
  bankCharges: number;
  doubled: number;
  extraDollars: number;
  retries: number;
  deduped: number;
  recovered: number;
  bankDollars: number;
  ledgerDollars: number;
  /** Money the bank took that the ledger has no entry for. */
  gapDollars: number;
}

export function summarize(lane: PayLane, payments: Payment[]): PaySummary {
  const s = lane.state;
  let bankDollars = 0;
  let ledgerDollars = 0;
  let extraDollars = 0;
  let bankCharges = 0;
  for (const payment of payments) {
    const charges = s.charges[payment.id] ?? 0;
    bankCharges += charges;
    bankDollars += charges * payment.amount;
    if (charges >= 2) extraDollars += (charges - 1) * payment.amount;
    if (s.phase[payment.id] === 'paid') ledgerDollars += payment.amount;
  }
  return {
    arrived: s.arrived,
    inFlight: countPhase(lane, 'sending') + countPhase(lane, 'backoff'),
    paid: countPhase(lane, 'paid'),
    unknown: countPhase(lane, 'unknown'),
    failed: countPhase(lane, 'failed'),
    bankCharges,
    doubled: countDoubled(lane),
    extraDollars,
    retries: s.retries,
    deduped: s.deduped,
    recovered: s.recovered,
    bankDollars,
    ledgerDollars,
    gapDollars: bankDollars - ledgerDollars,
  };
}

export interface PaymentsEstimate {
  averagePerSecond: number;
  peakPerSecond: number;
  ledgerEntriesPerDay: number;
  ledgerGigabytesPerDay: number;
  keyStoreGigabytes: number;
}

/** Back-of-envelope sizing for the lesson's illustrative payment service. */
export function paymentsEstimates({
  paymentsPerDay = 10_000_000,
  peakFactor = 5,
  entriesPerPayment = 2,
  bytesPerEntry = 200,
  keyRetentionDays = 1,
  bytesPerKey = 100,
} = {}): PaymentsEstimate {
  const average = paymentsPerDay / 86_400;
  const entries = paymentsPerDay * entriesPerPayment;
  return {
    averagePerSecond: Math.round(average),
    peakPerSecond: Math.round(average * peakFactor),
    ledgerEntriesPerDay: entries,
    ledgerGigabytesPerDay: Math.round((entries * bytesPerEntry) / 1e9),
    keyStoreGigabytes: Math.round((paymentsPerDay * keyRetentionDays * bytesPerKey) / 1e9),
  };
}
