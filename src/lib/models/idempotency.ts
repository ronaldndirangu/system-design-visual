import { createRng, poisson, randomInt } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';

/**
 * A toy sho.rt checkout. Customers buy a custom short link for $5: the client
 * sends POST /purchases, the server charges the card through a payment
 * provider, then answers with a receipt. The network sometimes loses a
 * receipt and payments sometimes run slow, so clients stop waiting after 1 s
 * and send the purchase again. Orders, every attempt's payment time, and every
 * response's fate come from a pre-generated workload, so two server designs
 * face exactly the same customers. Time moves in 10 ms substeps.
 */
export type KeyPolicy = 'none' | 'after' | 'claim';

export const keyPolicyLabels: Record<KeyPolicy, string> = {
  none: 'No key',
  after: 'Key saved after charging',
  claim: 'Key claimed first',
};

export const TICK_MS = 100;
const SUBSTEP_MS = 10;
const SUBSTEPS = TICK_MS / SUBSTEP_MS;
/** One way trip between client and server. */
export const NETWORK_MS = 50;
export const CLIENT_TIMEOUT_MS = 1000;
/** Pause before the next attempt, after a timeout or a 409. */
export const RETRY_WAIT_MS = 250;
export const MAX_ATTEMPTS = 4;
export const ORDER_RATE = 4;
export const ORDER_SECONDS = 15;
export const PRICE_DOLLARS = 5;
export const FAST_PAY_MS = [200, 600] as const;
export const SLOW_PAY_MS = [1200, 2000] as const;

/* One shared workload */

export interface AttemptDraw {
  fastMs: number;
  slowMs: number;
  /** The payment runs slow when this uniform draw falls below the slow share. */
  slowU: number;
  /** The response to this attempt gets lost when this uniform draw falls below the loss rate. */
  lostU: number;
}

export interface OrderArrival {
  atMs: number;
  /** Pre-drawn fate for each attempt the client may send. */
  attempts: AttemptDraw[];
}

/**
 * Draws order times and attempt fates from two separate seeded streams. The
 * workload never depends on the loss rate or slow share, so a scenario that
 * changes them changes how each draw plays out, never which draws happen.
 */
export function generateOrders(seed: number, seconds = ORDER_SECONDS): OrderArrival[] {
  const arrivals = createRng(seed);
  const draws = createRng(seed ^ 0x2f6b9a1d);
  const orders: OrderArrival[] = [];
  for (let ms = 0; ms < seconds * 1000; ms += SUBSTEP_MS) {
    const count = poisson(arrivals, (ORDER_RATE * SUBSTEP_MS) / 1000);
    for (let i = 0; i < count; i += 1) {
      const attempts: AttemptDraw[] = [];
      for (let a = 0; a < MAX_ATTEMPTS; a += 1) {
        attempts.push({
          fastMs: SUBSTEP_MS * randomInt(draws, FAST_PAY_MS[0] / SUBSTEP_MS, FAST_PAY_MS[1] / SUBSTEP_MS),
          slowMs: SUBSTEP_MS * randomInt(draws, SLOW_PAY_MS[0] / SUBSTEP_MS, SLOW_PAY_MS[1] / SUBSTEP_MS),
          slowU: draws(),
          lostU: draws(),
        });
      }
      orders.push({ atMs: ms, attempts });
    }
  }
  return orders;
}

/* Client, network, server, and key store */

export type CheckoutCommand = { type: 'loss'; rate: number } | { type: 'slowPayments'; share: number };

export interface CheckoutConditions {
  /** Share of responses the network loses. */
  lossRate: number;
  /** Share of payments that take 1.2 to 2 s instead of 0.2 to 0.6 s. */
  slowShare: number;
}

type ClientPhase = 'waiting' | 'backoff' | 'confirmed' | 'gaveUp';

interface ClientState {
  phase: ClientPhase;
  /** Index of the latest attempt sent. */
  attempt: number;
  deadline: number;
  nextAt: number;
}

interface Message {
  order: number;
  attempt: number;
  at: number;
  kind: 'request' | 'receipt' | 'conflict';
}

interface Payment {
  order: number;
  attempt: number;
  doneAt: number;
}

/** 0: never seen, 1: claimed and in progress, 2: receipt saved. */
type KeyState = 0 | 1 | 2;

export interface CheckoutTotals {
  orders: number;
  confirmed: number;
  /** Clients that used every attempt without reading a receipt. */
  gaveUp: number;
  attempts: number;
  paymentsStarted: number;
  charges: number;
  /** Orders charged two or more times. */
  doubleCharged: number;
  /** Charges beyond the first one for each order. */
  extraCharges: number;
  /** Payments that started while an earlier payment for the same order was still running. */
  overlaps: number;
  /** Retries answered with the saved receipt and no new charge. */
  replays: number;
  /** Retries answered 409 because the first attempt was still in progress. */
  conflicts: number;
  responses: number;
  responsesLost: number;
  delivered: number;
  /** Delivered after the client stopped waiting for that attempt, so nobody read them. */
  ignored: number;
}

export type CheckoutNoteKind = 'double-repeat' | 'double-overlap' | 'replay' | 'conflict' | 'gave-up';

export interface CheckoutNote {
  kind: CheckoutNoteKind;
  order: number;
  /** Charges on the order when the note happened. */
  charges: number;
}

export interface CheckoutTick {
  charges: number;
  doubleCharged: number;
  replays: number;
  conflicts: number;
  confirmed: number;
  gaveUp: number;
  notes: CheckoutNote[];
}

export type OrderCell = 'future' | 'open' | 'paid' | 'double' | 'unsure';

export interface CheckoutSnapshot {
  cells: OrderCell[];
  /** Charges per arrived order. */
  charges: number[];
  running: number;
  claimedKeys: number;
  savedKeys: number;
  open: number;
}

interface CheckoutState {
  ticks: number;
  cursor: number;
  lossRate: number;
  slowShare: number;
  clients: ClientState[];
  keys: KeyState[];
  charges: number[];
  /** True once two payments for the order have run at the same time. */
  raced: boolean[];
  toServer: Message[];
  toClient: Message[];
  payments: Payment[];
  totals: CheckoutTotals;
}

export interface CheckoutCheckpoint {
  state: CheckoutState;
}

function emptyTotals(): CheckoutTotals {
  return {
    orders: 0,
    confirmed: 0,
    gaveUp: 0,
    attempts: 0,
    paymentsStarted: 0,
    charges: 0,
    doubleCharged: 0,
    extraCharges: 0,
    overlaps: 0,
    replays: 0,
    conflicts: 0,
    responses: 0,
    responsesLost: 0,
    delivered: 0,
    ignored: 0,
  };
}

export class Checkout implements ModelAdapter<CheckoutCommand, CheckoutTick, CheckoutCheckpoint> {
  readonly policy: KeyPolicy;
  private readonly orders: readonly OrderArrival[];
  private state: CheckoutState;
  private notes: CheckoutNote[] = [];

  constructor(policy: KeyPolicy, orders: readonly OrderArrival[], conditions: CheckoutConditions) {
    this.policy = policy;
    this.orders = orders;
    this.state = {
      ticks: 0,
      cursor: 0,
      lossRate: conditions.lossRate,
      slowShare: conditions.slowShare,
      clients: [],
      keys: [],
      charges: [],
      raced: [],
      toServer: [],
      toClient: [],
      payments: [],
      totals: emptyTotals(),
    };
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get totals(): Readonly<CheckoutTotals> {
    return this.state.totals;
  }

  /** Orders whose client is still waiting for a receipt or about to retry. */
  get open(): number {
    return this.state.clients.filter((client) => client.phase === 'waiting' || client.phase === 'backoff')
      .length;
  }

  /** Requests on their way to the server, payments running, and responses on their way back. */
  get inTransit(): { toServer: number; running: number; toClient: number } {
    return {
      toServer: this.state.toServer.length,
      running: this.state.payments.length,
      toClient: this.state.toClient.length,
    };
  }

  apply(command: CheckoutCommand): void {
    switch (command.type) {
      case 'loss':
        this.state.lossRate = command.rate;
        return;
      case 'slowPayments':
        this.state.slowShare = command.share;
        return;
    }
  }

  step(): CheckoutTick {
    const before = { ...this.state.totals };
    this.notes = [];
    const base = this.state.ticks * TICK_MS;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      const now = base + sub * SUBSTEP_MS;
      this.finishPayments(now);
      this.serve(now);
      this.receive(now);
      this.timeOut(now);
      this.resend(now);
      this.arrive(now);
    }
    this.state.ticks += 1;
    const totals = this.state.totals;
    return {
      charges: totals.charges - before.charges,
      doubleCharged: totals.doubleCharged - before.doubleCharged,
      replays: totals.replays - before.replays,
      conflicts: totals.conflicts - before.conflicts,
      confirmed: totals.confirmed - before.confirmed,
      gaveUp: totals.gaveUp - before.gaveUp,
      notes: this.notes,
    };
  }

  snapshot(): CheckoutSnapshot {
    const { clients, charges, keys, payments } = this.state;
    const cells = this.orders.map((_, id): OrderCell => {
      const client = clients[id];
      if (!client) return 'future';
      const charged = charges[id] ?? 0;
      if (charged >= 2) return 'double';
      if (client.phase === 'confirmed') return 'paid';
      if (client.phase === 'gaveUp') return 'unsure';
      return 'open';
    });
    return {
      cells,
      charges: [...charges],
      running: payments.length,
      claimedKeys: keys.filter((key) => key === 1).length,
      savedKeys: keys.filter((key) => key === 2).length,
      open: this.open,
    };
  }

  checkpoint(): CheckoutCheckpoint {
    return structuredClone({ state: this.state });
  }

  restore(checkpoint: CheckoutCheckpoint): void {
    this.state = structuredClone(checkpoint).state;
  }

  private draw(order: number, attempt: number): AttemptDraw {
    const draw = this.orders[order]?.attempts[attempt];
    if (!draw) throw new Error(`No draw for order ${order}, attempt ${attempt}`);
    return draw;
  }

  private respond(order: number, attempt: number, kind: 'receipt' | 'conflict', now: number): void {
    const state = this.state;
    state.totals.responses += 1;
    if (this.draw(order, attempt).lostU < state.lossRate) {
      state.totals.responsesLost += 1;
      return;
    }
    state.toClient.push({ order, attempt, kind, at: now + NETWORK_MS });
  }

  private finishPayments(now: number): void {
    const state = this.state;
    const done = state.payments.filter((payment) => payment.doneAt <= now);
    if (done.length === 0) return;
    state.payments = state.payments.filter((payment) => payment.doneAt > now);
    for (const payment of done) {
      const charged = (state.charges[payment.order] ?? 0) + 1;
      state.charges[payment.order] = charged;
      state.totals.charges += 1;
      if (charged >= 2) state.totals.extraCharges += 1;
      if (charged === 2) {
        state.totals.doubleCharged += 1;
        this.notes.push({
          kind: state.raced[payment.order] ? 'double-overlap' : 'double-repeat',
          order: payment.order,
          charges: charged,
        });
      }
      if (this.policy !== 'none') state.keys[payment.order] = 2;
      this.respond(payment.order, payment.attempt, 'receipt', now);
    }
  }

  private startPayment(order: number, attempt: number, now: number): void {
    const state = this.state;
    const draw = this.draw(order, attempt);
    const ms = draw.slowU < state.slowShare ? draw.slowMs : draw.fastMs;
    if (state.payments.some((payment) => payment.order === order)) {
      state.totals.overlaps += 1;
      state.raced[order] = true;
    }
    state.payments.push({ order, attempt, doneAt: now + ms });
    state.totals.paymentsStarted += 1;
  }

  private serve(now: number): void {
    const state = this.state;
    const arrived = state.toServer.filter((message) => message.at <= now);
    if (arrived.length === 0) return;
    state.toServer = state.toServer.filter((message) => message.at > now);
    for (const { order, attempt } of arrived) {
      const key = state.keys[order] ?? 0;
      if (this.policy !== 'none' && key === 2) {
        state.totals.replays += 1;
        this.notes.push({ kind: 'replay', order, charges: state.charges[order] ?? 0 });
        this.respond(order, attempt, 'receipt', now);
        continue;
      }
      if (this.policy === 'claim' && key === 1) {
        state.totals.conflicts += 1;
        this.notes.push({ kind: 'conflict', order, charges: state.charges[order] ?? 0 });
        this.respond(order, attempt, 'conflict', now);
        continue;
      }
      if (this.policy === 'claim') state.keys[order] = 1;
      this.startPayment(order, attempt, now);
    }
  }

  private retryOrGiveUp(order: number, client: ClientState, from: number): void {
    if (client.attempt + 1 < MAX_ATTEMPTS) {
      client.phase = 'backoff';
      client.nextAt = from + RETRY_WAIT_MS;
      return;
    }
    client.phase = 'gaveUp';
    this.state.totals.gaveUp += 1;
    this.notes.push({ kind: 'gave-up', order, charges: this.state.charges[order] ?? 0 });
  }

  private receive(now: number): void {
    const state = this.state;
    const arrived = state.toClient.filter((message) => message.at <= now);
    if (arrived.length === 0) return;
    state.toClient = state.toClient.filter((message) => message.at > now);
    for (const message of arrived) {
      state.totals.delivered += 1;
      const client = state.clients[message.order];
      if (client?.phase !== 'waiting' || client.attempt !== message.attempt) {
        state.totals.ignored += 1;
        continue;
      }
      if (message.kind === 'receipt') {
        client.phase = 'confirmed';
        state.totals.confirmed += 1;
      } else {
        this.retryOrGiveUp(message.order, client, now);
      }
    }
  }

  private timeOut(now: number): void {
    this.state.clients.forEach((client, order) => {
      if (client.phase === 'waiting' && client.deadline <= now) this.retryOrGiveUp(order, client, now);
    });
  }

  private send(order: number, client: ClientState, now: number): void {
    client.phase = 'waiting';
    client.deadline = now + CLIENT_TIMEOUT_MS;
    this.state.totals.attempts += 1;
    this.state.toServer.push({ order, attempt: client.attempt, kind: 'request', at: now + NETWORK_MS });
  }

  private resend(now: number): void {
    this.state.clients.forEach((client, order) => {
      if (client.phase !== 'backoff' || client.nextAt > now) return;
      client.attempt += 1;
      this.send(order, client, now);
    });
  }

  private arrive(now: number): void {
    const state = this.state;
    while (state.cursor < this.orders.length) {
      const next = this.orders[state.cursor];
      if (!next || next.atMs >= now + SUBSTEP_MS) return;
      const order = state.cursor;
      state.cursor += 1;
      state.totals.orders += 1;
      const client: ClientState = { phase: 'waiting', attempt: 0, deadline: 0, nextAt: 0 };
      state.clients[order] = client;
      state.keys[order] = 0;
      state.charges[order] = 0;
      state.raced[order] = false;
      this.send(order, client, now);
    }
  }
}

/* Two server designs side by side on the same customers */

export type IdemScenarioId = 'calm' | 'lossy' | 'slow';

export interface IdemScenario {
  id: IdemScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  conditions: CheckoutConditions;
  policies: [KeyPolicy, KeyPolicy];
  schedule: ScheduledCommand<CheckoutCommand>[];
}

export interface IdemEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const IDEM_RUN_SECONDS = 20;
export const SLOW_START_TICK = 40;
export const SLOW_END_TICK = 100;
export const SLOW_SHARE = 0.4;
export const CALM_LOSS = 0.01;
export const LOSSY_LOSS = 0.15;

export const idemScenarios: Record<IdemScenarioId, IdemScenario> = {
  calm: {
    id: 'calm',
    label: 'Healthy network',
    diff: 'Baseline: 4 purchases per second for 15 s. 1% of responses get lost, payments take 0.2 to 0.6 s, and clients wait 1 s, then try again, up to 4 attempts. No key against key claimed first.',
    conditions: { lossRate: CALM_LOSS, slowShare: 0 },
    policies: ['none', 'claim'],
    schedule: [],
  },
  lossy: {
    id: 'lossy',
    label: 'Lossy mobile network',
    diff: '15% of responses get lost instead of 1%. No key against key claimed first.',
    conditions: { lossRate: LOSSY_LOSS, slowShare: 0 },
    policies: ['none', 'claim'],
    schedule: [],
  },
  slow: {
    id: 'slow',
    label: 'Slow payments',
    diff: 'From 4 s to 10 s, 40% of payments take 1.2 to 2 s, longer than the client waits. Key saved after charging against key claimed first.',
    conditions: { lossRate: CALM_LOSS, slowShare: 0 },
    policies: ['after', 'claim'],
    schedule: [
      { at: SLOW_START_TICK, command: { type: 'slowPayments', share: SLOW_SHARE } },
      { at: SLOW_END_TICK, command: { type: 'slowPayments', share: 0 } },
    ],
  },
};

export interface IdemLane {
  policy: KeyPolicy;
  label: string;
  checkout: Checkout;
  /** Orders charged twice or more so far, one value per tick. */
  series: number[];
  seen: Set<CheckoutNoteKind>;
}

const orderName = (order: number) => `Order #${order + 1}`;

function noteText(note: CheckoutNote): string {
  const name = orderName(note.order);
  switch (note.kind) {
    case 'double-repeat':
      return `${name} is charged twice. The client never saw the first receipt, so its retry looked like a new purchase.`;
    case 'double-overlap':
      return `${name} is charged twice. A retry arrived while the first payment was still running, and no receipt was saved yet.`;
    case 'replay':
      return `${name}: a retry carries the same key, so the server replays the saved receipt and charges nothing.`;
    case 'conflict':
      return `${name}: a retry arrives while the first payment is still running. The key is claimed, so the server answers 409 and charges nothing.`;
    case 'gave-up':
      return `${name}: the client gives up after ${MAX_ATTEMPTS} attempts without a receipt, so the customer cannot tell whether they paid.`;
  }
}

export function describeCheckoutCommand(command: CheckoutCommand): string {
  switch (command.type) {
    case 'loss':
      return `The network starts losing ${Math.round(command.rate * 100)}% of responses.`;
    case 'slowPayments':
      return command.share > 0
        ? `The payment provider slows down: ${Math.round(command.share * 100)}% of payments take 1.2 to 2 s.`
        : 'The payment provider recovers: payments take 0.2 to 0.6 s again.';
  }
}

export class IdemDuel {
  readonly scenario: IdemScenario;
  readonly length: number;
  readonly tickSeconds = TICK_MS / 1000;
  readonly lanes: [IdemLane, IdemLane];
  readonly events: IdemEvent[] = [];
  readonly orderCount: number;
  private tickCount = 0;

  constructor(scenario: IdemScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(IDEM_RUN_SECONDS / this.tickSeconds);
    const orders = generateOrders(seed);
    this.orderCount = orders.length;
    const lane = (policy: KeyPolicy): IdemLane => ({
      policy,
      label: keyPolicyLabels[policy],
      checkout: new Checkout(policy, orders, scenario.conditions),
      series: [],
      seen: new Set(),
    });
    this.lanes = [lane(scenario.policies[0]), lane(scenario.policies[1])];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step(): [CheckoutTick, CheckoutTick] | null {
    if (this.done) return null;
    const tick = this.tickCount;
    for (const entry of this.scenario.schedule) {
      if (entry.at === tick)
        this.events.push({ tick, text: describeCheckoutCommand(entry.command), marker: true });
    }
    const results = this.lanes.map((lane) => {
      const result = stepScheduled(lane.checkout, this.scenario.schedule);
      lane.series.push(lane.checkout.totals.doubleCharged);
      for (const note of result.notes) {
        if (lane.seen.has(note.kind)) continue;
        lane.seen.add(note.kind);
        this.events.push({ tick: tick + 1, text: `${lane.label}: ${noteText(note)}`, marker: true });
      }
      return result;
    }) as [CheckoutTick, CheckoutTick];
    this.tickCount += 1;
    if (this.done) {
      const [first, second] = this.lanes.map(summarizeCheckout) as [CheckoutSummary, CheckoutSummary];
      const [a, b] = this.lanes;
      this.events.push({
        tick: this.tickCount,
        text: `Run ends. Orders charged twice: ${a.label} ${first.doubleCharged}, ${b.label} ${second.doubleCharged}. Money taken by mistake: ${a.label} $${first.extraDollars}, ${b.label} $${second.extraDollars}.`,
        marker: false,
      });
    }
    return results;
  }
}

export interface CheckoutSummary extends CheckoutTotals {
  open: number;
  extraDollars: number;
  /** Clients that gave up even though their card was charged. */
  gaveUpCharged: number;
}

export function summarizeCheckout(lane: IdemLane): CheckoutSummary {
  const totals = lane.checkout.totals;
  const snap = lane.checkout.snapshot();
  const gaveUpCharged = snap.cells.filter(
    (cell, order) => cell === 'unsure' && (snap.charges[order] ?? 0) > 0,
  ).length;
  return {
    ...totals,
    open: lane.checkout.open,
    extraDollars: totals.extraCharges * PRICE_DOLLARS,
    gaveUpCharged,
  };
}
