import { createRng, randomInt } from '../rng';

/**
 * Toy model of a checkout saga. Three services each own a database: Inventory
 * reserves stock, Payments charges the card, Shipping books a courier. Two
 * lanes run the same seeded orders, one coordinated by an orchestrator and one
 * by choreography over an event bus. Every message takes exactly one tick, so
 * the timings are illustrative and only the relative costs matter.
 */

export type SagaStyle = 'orchestration' | 'choreography';
export type StepId = 'reserve' | 'charge' | 'book';
export type NodeId = 'orders' | 'log' | 'bus' | 'inventory' | 'payments' | 'shipping';

export const TICK_MS = 100;
export const SAGA_SEED = 42;
export const ORDER_COUNT = 6;
export const ORDER_GAP_TICKS = 4;
export const SAGA_LENGTH = 32;
export const TIMEOUT_TICKS = 4;
export const INITIAL_STOCK = 24;

export interface Order {
  id: number;
  items: number;
  amount: number;
  startTick: number;
}

/** The shared workload: both lanes check out exactly these carts. */
export function createWorkload(seed = SAGA_SEED, count = ORDER_COUNT): Order[] {
  const rng = createRng(seed);
  const orders: Order[] = [];
  for (let index = 0; index < count; index += 1) {
    const items = randomInt(rng, 1, 3);
    const amount = randomInt(rng, 4, 24) * 5;
    orders.push({ id: index + 1, items, amount, startTick: index * ORDER_GAP_TICKS });
  }
  return orders;
}

export interface StepInfo {
  id: StepId;
  label: string;
  service: NodeId;
  serviceLabel: string;
  compensation: string | null;
}

export const STEPS: readonly StepInfo[] = [
  {
    id: 'reserve',
    label: 'Reserve stock',
    service: 'inventory',
    serviceLabel: 'Inventory',
    compensation: 'Release stock',
  },
  {
    id: 'charge',
    label: 'Charge card',
    service: 'payments',
    serviceLabel: 'Payments',
    compensation: 'Refund card',
  },
  { id: 'book', label: 'Book courier', service: 'shipping', serviceLabel: 'Shipping', compensation: null },
];

export interface SagaFaults {
  declineOrder: number | null;
  rejectOrder: number | null;
  lostReplyOrder: number | null;
  dedupe: boolean;
}

export type SagaScenarioId = 'happy' | 'courier' | 'declined' | 'lost-reply' | 'no-dedupe';

export interface SagaScenario {
  id: SagaScenarioId;
  label: string;
  diff: string;
  faults: SagaFaults;
  focusOrder: number;
}

const NO_FAULTS: SagaFaults = { declineOrder: null, rejectOrder: null, lostReplyOrder: null, dedupe: true };

export const sagaScenarios: Record<SagaScenarioId, SagaScenario> = {
  happy: {
    id: 'happy',
    label: 'Happy path',
    diff: 'Every step succeeds',
    faults: NO_FAULTS,
    focusOrder: 3,
  },
  courier: {
    id: 'courier',
    label: 'Courier fails',
    diff: 'Shipping rejects order 3',
    faults: { ...NO_FAULTS, rejectOrder: 3 },
    focusOrder: 3,
  },
  declined: {
    id: 'declined',
    label: 'Card declined',
    diff: 'Payments declines order 2',
    faults: { ...NO_FAULTS, declineOrder: 2 },
    focusOrder: 2,
  },
  'lost-reply': {
    id: 'lost-reply',
    label: 'Lost reply, deduped',
    diff: 'Order 2 charge reply lost, dedupe on',
    faults: { ...NO_FAULTS, lostReplyOrder: 2 },
    focusOrder: 2,
  },
  'no-dedupe': {
    id: 'no-dedupe',
    label: 'Lost reply, no dedupe',
    diff: 'Order 2 charge reply lost, dedupe off',
    faults: { ...NO_FAULTS, lostReplyOrder: 2, dedupe: false },
    focusOrder: 2,
  },
};

export const sagaScenarioOrder: readonly SagaScenarioId[] = [
  'happy',
  'courier',
  'declined',
  'lost-reply',
  'no-dedupe',
];

export const styleLabels: Record<SagaStyle, string> = {
  orchestration: 'Orchestration',
  choreography: 'Choreography',
};

export interface SagaMessage {
  id: number;
  orderId: number;
  kind: string;
  from: NodeId;
  to: NodeId;
  sentAt: number;
  lost: boolean;
  retry: boolean;
  /** The forward step this message asks for, so the order grid can show it as in progress. */
  step: StepId | null;
}

interface Retry {
  at: number;
  orderId: number;
  kind: string;
  from: NodeId;
  to: NodeId;
  step: StepId | null;
}

export type LogState =
  | 'none'
  | 'reserving'
  | 'charging'
  | 'booking'
  | 'completed'
  | 'refunding'
  | 'releasing'
  | 'cancelled';
export type OrdersState = 'none' | 'placed' | 'confirmed' | 'cancelled';
export type Outcome = 'waiting' | 'running' | 'completed' | 'compensated';

export interface OrderState {
  inventory: 'none' | 'reserved' | 'released';
  payment: 'none' | 'charged' | 'declined' | 'refunded';
  shipping: 'none' | 'booked' | 'rejected';
  charges: number;
  /** Orchestration only: the saga log row the orchestrator keeps. */
  log: LogState;
  /** Choreography only: what the Orders service has heard so far. */
  orders: OrdersState;
  outcome: Outcome;
  reservedAt: number | null;
  releasedAt: number | null;
  chargedAt: number | null;
  refundedAt: number | null;
  finishedAt: number | null;
  replyLost: boolean;
}

export interface LaneState {
  style: SagaStyle;
  orders: OrderState[];
  /** Messages sent during the last processed tick; each arrives one tick later. */
  inFlight: SagaMessage[];
  retries: Retry[];
  sent: number;
  nextId: number;
  stock: number;
  stockSeries: number[];
  chargedTotal: number;
  refundedTotal: number;
  overcharged: number;
  reservedUnits: number;
  releasedUnits: number;
  /** Services that reported a failure or a double charge during the last processed tick. */
  failing: NodeId[];
}

export interface SagaEvent {
  tick: number;
  lane: SagaStyle | null;
  text: string;
  marker: boolean;
}

const SUBSCRIBERS: Record<string, NodeId> = {
  OrderPlaced: 'inventory',
  StockReserved: 'payments',
  PaymentDeclined: 'inventory',
  CardCharged: 'shipping',
  CourierBooked: 'orders',
  CourierFailed: 'payments',
  CardRefunded: 'inventory',
  StockReleased: 'orders',
};

const FORWARD_STEP: Record<string, StepId> = {
  Reserve: 'reserve',
  OrderPlaced: 'reserve',
  Charge: 'charge',
  StockReserved: 'charge',
  Book: 'book',
  CardCharged: 'book',
};

function newOrderState(): OrderState {
  return {
    inventory: 'none',
    payment: 'none',
    shipping: 'none',
    charges: 0,
    log: 'none',
    orders: 'none',
    outcome: 'waiting',
    reservedAt: null,
    releasedAt: null,
    chargedAt: null,
    refundedAt: null,
    finishedAt: null,
    replyLost: false,
  };
}

function newLane(style: SagaStyle, count: number): LaneState {
  return {
    style,
    orders: Array.from({ length: count }, newOrderState),
    inFlight: [],
    retries: [],
    sent: 0,
    nextId: 1,
    stock: INITIAL_STOCK,
    stockSeries: [],
    chargedTotal: 0,
    refundedTotal: 0,
    overcharged: 0,
    reservedUnits: 0,
    releasedUnits: 0,
    failing: [],
  };
}

interface Ctx {
  lane: LaneState;
  now: number;
  workload: readonly Order[];
  faults: SagaFaults;
  emit: (text: string, marker: boolean) => void;
}

function stateOf(ctx: Ctx, orderId: number): OrderState {
  const state = ctx.lane.orders[orderId - 1];
  if (!state) throw new Error(`Unknown order ${orderId}`);
  return state;
}

function orderOf(ctx: Ctx, orderId: number): Order {
  const order = ctx.workload[orderId - 1];
  if (!order) throw new Error(`Unknown order ${orderId}`);
  return order;
}

function send(
  ctx: Ctx,
  orderId: number,
  kind: string,
  from: NodeId,
  to: NodeId,
  lost = false,
  retry = false,
) {
  const { lane } = ctx;
  lane.sent += 1;
  lane.inFlight.push({
    id: lane.nextId,
    orderId,
    kind,
    from,
    to,
    sentAt: ctx.now,
    lost,
    retry,
    step: FORWARD_STEP[kind] ?? null,
  });
  lane.nextId += 1;
}

function publish(ctx: Ctx, orderId: number, kind: string, from: NodeId, lost = false) {
  send(ctx, orderId, kind, from, 'bus', lost);
}

function markFailing(ctx: Ctx, node: NodeId) {
  if (!ctx.lane.failing.includes(node)) ctx.lane.failing.push(node);
}

function reserve(ctx: Ctx, order: Order) {
  const state = stateOf(ctx, order.id);
  if (state.inventory !== 'none') return;
  state.inventory = 'reserved';
  state.reservedAt = ctx.now;
  ctx.lane.stock -= order.items;
  ctx.lane.reservedUnits += order.items;
}

function release(ctx: Ctx, order: Order) {
  const state = stateOf(ctx, order.id);
  if (state.inventory !== 'reserved') return;
  state.inventory = 'released';
  state.releasedAt = ctx.now;
  ctx.lane.stock += order.items;
  ctx.lane.releasedUnits += order.items;
  const held = (ctx.now - (state.reservedAt ?? ctx.now)) * TICK_MS;
  const [noun, pronoun] = order.items === 1 ? ['item', 'it'] : ['items', 'them'];
  ctx.emit(
    `Inventory releases ${order.items} ${noun} for order ${order.id}. Other shoppers could not buy ${pronoun} for ${held} ms.`,
    true,
  );
}

function charge(ctx: Ctx, order: Order): 'charged' | 'declined' {
  const state = stateOf(ctx, order.id);
  if (ctx.faults.declineOrder === order.id) {
    if (state.payment === 'none') {
      state.payment = 'declined';
      markFailing(ctx, 'payments');
      ctx.emit(`Payments declines the card for order ${order.id}. Stock is already reserved.`, true);
    }
    return 'declined';
  }
  if (state.payment === 'charged' && ctx.faults.dedupe) {
    ctx.emit(
      `Payments finds order ${order.id} already charged, so it repeats the answer without charging again.`,
      true,
    );
    return 'charged';
  }
  state.charges += 1;
  ctx.lane.chargedTotal += order.amount;
  if (state.charges > 1) {
    ctx.lane.overcharged += order.amount;
    markFailing(ctx, 'payments');
    ctx.emit(`Payments charges order ${order.id} again: the customer pays $${order.amount} twice.`, true);
  }
  state.payment = 'charged';
  state.chargedAt ??= ctx.now;
  return 'charged';
}

function refund(ctx: Ctx, order: Order) {
  const state = stateOf(ctx, order.id);
  if (state.payment !== 'charged') return;
  state.payment = 'refunded';
  state.refundedAt = ctx.now;
  ctx.lane.refundedTotal += order.amount;
  const held = (ctx.now - (state.chargedAt ?? ctx.now)) * TICK_MS;
  ctx.emit(`Payments refunds $${order.amount} for order ${order.id}, ${held} ms after charging it.`, true);
}

function book(ctx: Ctx, order: Order): 'booked' | 'rejected' {
  const state = stateOf(ctx, order.id);
  if (state.shipping !== 'none') return state.shipping;
  if (ctx.faults.rejectOrder === order.id) {
    state.shipping = 'rejected';
    markFailing(ctx, 'shipping');
    ctx.emit(`Shipping finds no courier for order ${order.id}. The card is already charged.`, true);
    return 'rejected';
  }
  state.shipping = 'booked';
  return 'booked';
}

/** True when this charge reply is the one the scenario loses; the request's sender retries after a timeout. */
function loseChargeReply(ctx: Ctx, order: Order, request: SagaMessage): boolean {
  const state = stateOf(ctx, order.id);
  if (ctx.faults.lostReplyOrder !== order.id || state.replyLost) return false;
  state.replyLost = true;
  ctx.lane.retries.push({
    at: request.sentAt + TIMEOUT_TICKS,
    orderId: order.id,
    kind: request.kind,
    from: request.from,
    to: request.to,
    step: request.step,
  });
  return true;
}

function finish(ctx: Ctx, order: Order, outcome: 'completed' | 'compensated') {
  const state = stateOf(ctx, order.id);
  state.outcome = outcome;
  state.finishedAt = ctx.now;
  const ms = (ctx.now - order.startTick) * TICK_MS;
  ctx.emit(
    outcome === 'completed'
      ? `Order ${order.id} completes in ${ms} ms.`
      : `Order ${order.id} is cancelled after ${ms} ms, with every finished step compensated.`,
    false,
  );
}

function setLog(state: OrderState, log: LogState) {
  state.log = log;
}

function orchestrationDeliver(ctx: Ctx, msg: SagaMessage) {
  const order = orderOf(ctx, msg.orderId);
  const state = stateOf(ctx, msg.orderId);
  switch (msg.kind) {
    case 'Reserve':
      reserve(ctx, order);
      send(ctx, order.id, 'Reserved', 'inventory', 'orders');
      break;
    case 'Charge': {
      const result = charge(ctx, order);
      const lost = result === 'charged' && loseChargeReply(ctx, order, msg);
      send(ctx, order.id, result === 'charged' ? 'Charged' : 'Declined', 'payments', 'orders', lost);
      break;
    }
    case 'Book':
      send(ctx, order.id, book(ctx, order) === 'booked' ? 'Booked' : 'Rejected', 'shipping', 'orders');
      break;
    case 'Refund':
      refund(ctx, order);
      send(ctx, order.id, 'Refunded', 'payments', 'orders');
      break;
    case 'Release':
      release(ctx, order);
      send(ctx, order.id, 'Released', 'inventory', 'orders');
      break;
    case 'Reserved':
      if (state.log !== 'reserving') break;
      setLog(state, 'charging');
      send(ctx, order.id, 'Charge', 'orders', 'payments');
      break;
    case 'Charged':
      if (state.log !== 'charging') break;
      setLog(state, 'booking');
      send(ctx, order.id, 'Book', 'orders', 'shipping');
      break;
    case 'Declined':
      if (state.log !== 'charging') break;
      setLog(state, 'releasing');
      ctx.emit(
        `The orchestrator logs the decline for order ${order.id} and sends Release to Inventory.`,
        false,
      );
      send(ctx, order.id, 'Release', 'orders', 'inventory');
      break;
    case 'Booked':
      if (state.log !== 'booking') break;
      setLog(state, 'completed');
      finish(ctx, order, 'completed');
      break;
    case 'Rejected':
      if (state.log !== 'booking') break;
      setLog(state, 'refunding');
      ctx.emit(
        `The orchestrator logs the failure for order ${order.id} and compensates in reverse: refund first, then release.`,
        false,
      );
      send(ctx, order.id, 'Refund', 'orders', 'payments');
      break;
    case 'Refunded':
      if (state.log !== 'refunding') break;
      setLog(state, 'releasing');
      send(ctx, order.id, 'Release', 'orders', 'inventory');
      break;
    case 'Released':
      if (state.log !== 'releasing') break;
      setLog(state, 'cancelled');
      finish(ctx, order, 'compensated');
      break;
  }
}

function choreographyDeliver(ctx: Ctx, msg: SagaMessage) {
  const order = orderOf(ctx, msg.orderId);
  const state = stateOf(ctx, msg.orderId);
  if (msg.to === 'bus') {
    const subscriber = SUBSCRIBERS[msg.kind];
    if (subscriber) send(ctx, order.id, msg.kind, 'bus', subscriber, false, msg.retry);
    return;
  }
  switch (msg.kind) {
    case 'OrderPlaced':
      reserve(ctx, order);
      publish(ctx, order.id, 'StockReserved', 'inventory');
      break;
    case 'StockReserved': {
      const result = charge(ctx, order);
      const lost = result === 'charged' && loseChargeReply(ctx, order, msg);
      publish(ctx, order.id, result === 'charged' ? 'CardCharged' : 'PaymentDeclined', 'payments', lost);
      break;
    }
    case 'CardCharged':
      publish(ctx, order.id, book(ctx, order) === 'booked' ? 'CourierBooked' : 'CourierFailed', 'shipping');
      break;
    case 'CourierFailed':
      refund(ctx, order);
      publish(ctx, order.id, 'CardRefunded', 'payments');
      break;
    case 'PaymentDeclined':
    case 'CardRefunded':
      release(ctx, order);
      publish(ctx, order.id, 'StockReleased', 'inventory');
      break;
    case 'CourierBooked':
      if (state.orders !== 'placed') break;
      state.orders = 'confirmed';
      finish(ctx, order, 'completed');
      break;
    case 'StockReleased':
      if (state.orders !== 'placed') break;
      state.orders = 'cancelled';
      finish(ctx, order, 'compensated');
      break;
  }
}

function deliver(ctx: Ctx, msg: SagaMessage) {
  if (msg.lost) {
    ctx.emit(
      ctx.lane.style === 'orchestration'
        ? `Payments' reply for order ${msg.orderId} never reaches the orchestrator.`
        : `Payments' ${msg.kind} event for order ${msg.orderId} never reaches the bus, so the bus never hears that Payments finished.`,
      true,
    );
    return;
  }
  if (ctx.lane.style === 'orchestration') orchestrationDeliver(ctx, msg);
  else choreographyDeliver(ctx, msg);
}

function fireRetry(ctx: Ctx, retry: Retry) {
  const state = stateOf(ctx, retry.orderId);
  const waited = TIMEOUT_TICKS * TICK_MS;
  if (ctx.lane.style === 'orchestration') {
    if (state.log !== 'charging') return;
    ctx.emit(
      `The orchestrator hears nothing about order ${retry.orderId} for ${waited} ms and sends ${retry.kind} again.`,
      true,
    );
  } else {
    ctx.emit(
      `The bus gets no acknowledgment for order ${retry.orderId} within ${waited} ms and delivers ${retry.kind} to Payments again.`,
      true,
    );
  }
  send(ctx, retry.orderId, retry.kind, retry.from, retry.to, false, true);
}

function startOrder(ctx: Ctx, order: Order) {
  const state = stateOf(ctx, order.id);
  state.outcome = 'running';
  if (ctx.lane.style === 'orchestration') {
    setLog(state, 'reserving');
    send(ctx, order.id, 'Reserve', 'orders', 'inventory');
  } else {
    state.orders = 'placed';
    publish(ctx, order.id, 'OrderPlaced', 'orders');
  }
}

export interface SagaCheckpoint {
  ticks: number;
  lanes: [LaneState, LaneState];
  events: SagaEvent[];
}

/** Both coordination styles run the same orders and the same faults, one tick at a time. */
export class SagaDuel {
  readonly scenario: SagaScenario;
  readonly workload: readonly Order[];
  readonly length = SAGA_LENGTH;
  readonly tickSeconds = TICK_MS / 1000;
  lanes: [LaneState, LaneState];
  events: SagaEvent[] = [];
  ticks = 0;

  constructor(scenarioId: SagaScenarioId = 'happy', seed = SAGA_SEED) {
    this.scenario = sagaScenarios[scenarioId];
    this.workload = createWorkload(seed);
    this.lanes = [
      newLane('orchestration', this.workload.length),
      newLane('choreography', this.workload.length),
    ];
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  step(): void {
    if (this.done) return;
    const now = this.ticks;
    for (const order of this.workload) {
      if (order.startTick !== now) continue;
      const noun = order.items === 1 ? 'item' : 'items';
      this.events.push({
        tick: now,
        lane: null,
        text: `Order ${order.id} checks out: ${order.items} ${noun}, $${order.amount}.`,
        marker: false,
      });
    }
    for (const lane of this.lanes) this.stepLane(lane, now);
    this.ticks = now + 1;
    if (this.done) {
      const [a, b] = this.lanes;
      this.events.push({
        tick: this.ticks,
        lane: null,
        text: `Run ends. Orchestration sent ${a.sent} messages and choreography sent ${b.sent}.`,
        marker: false,
      });
    }
  }

  private stepLane(lane: LaneState, now: number) {
    const ctx: Ctx = {
      lane,
      now,
      workload: this.workload,
      faults: this.scenario.faults,
      emit: (text, marker) => {
        this.events.push({
          tick: now,
          lane: lane.style,
          text: `${styleLabels[lane.style]}: ${text}`,
          marker,
        });
      },
    };
    lane.failing = [];
    const arriving = lane.inFlight;
    lane.inFlight = [];
    for (const msg of arriving) deliver(ctx, msg);
    const due = lane.retries.filter((retry) => retry.at === now);
    lane.retries = lane.retries.filter((retry) => retry.at !== now);
    for (const retry of due) fireRetry(ctx, retry);
    for (const order of this.workload) {
      if (order.startTick === now) startOrder(ctx, order);
    }
    lane.stockSeries.push(lane.stock);
  }

  checkpoint(): SagaCheckpoint {
    return structuredClone({ ticks: this.ticks, lanes: this.lanes, events: this.events });
  }

  restore(checkpoint: SagaCheckpoint): void {
    const copy = structuredClone(checkpoint);
    this.ticks = copy.ticks;
    this.lanes = copy.lanes;
    this.events = copy.events;
  }
}

export interface LaneSummary {
  started: number;
  completed: number;
  compensated: number;
  inFlight: number;
  messages: number;
  charged: number;
  refunded: number;
  overcharged: number;
  reservedUnits: number;
  releasedUnits: number;
  stock: number;
  slowestMs: number;
  longestHoldMs: number;
  placesToAsk: number;
}

export function summarizeLane(lane: LaneState, workload: readonly Order[]): LaneSummary {
  let started = 0;
  let completed = 0;
  let compensated = 0;
  let slowest = 0;
  let longestHold = 0;
  lane.orders.forEach((state, index) => {
    const order = workload[index];
    if (!order || state.outcome === 'waiting') return;
    started += 1;
    if (state.outcome === 'completed') completed += 1;
    if (state.outcome === 'compensated') compensated += 1;
    if (state.finishedAt !== null) slowest = Math.max(slowest, state.finishedAt - order.startTick);
    if (state.releasedAt !== null && state.reservedAt !== null) {
      longestHold = Math.max(longestHold, state.releasedAt - state.reservedAt);
    }
  });
  return {
    started,
    completed,
    compensated,
    inFlight: started - completed - compensated,
    messages: lane.sent,
    charged: lane.chargedTotal,
    refunded: lane.refundedTotal,
    overcharged: lane.overcharged,
    reservedUnits: lane.reservedUnits,
    releasedUnits: lane.releasedUnits,
    stock: lane.stock,
    slowestMs: slowest * TICK_MS,
    longestHoldMs: longestHold * TICK_MS,
    placesToAsk: lane.style === 'orchestration' ? 1 : 4,
  };
}

export type CellStatus = 'waiting' | 'active' | 'done' | 'doubled' | 'failed' | 'undone' | 'skipped';

export interface StepCell {
  step: StepId;
  status: CellStatus;
  text: string;
}

function inProgress(lane: LaneState, orderId: number, step: StepId): boolean {
  return (
    lane.inFlight.some((msg) => msg.orderId === orderId && msg.step === step && !msg.lost) ||
    lane.retries.some((retry) => retry.orderId === orderId && retry.step === step)
  );
}

/** Each service's own record of one order, which is the truth the order grid shows. */
export function orderCells(lane: LaneState, order: Order): StepCell[] {
  const state = lane.orders[order.id - 1] ?? newOrderState();
  const finished = state.outcome === 'completed' || state.outcome === 'compensated';
  const pending = (step: StepId): StepCell => {
    if (finished) return { step, status: 'skipped', text: 'Skipped' };
    if (inProgress(lane, order.id, step)) return { step, status: 'active', text: 'In progress' };
    return { step, status: 'waiting', text: 'Waiting' };
  };
  const noun = order.items === 1 ? 'item' : 'items';
  const reserveCell: StepCell =
    state.inventory === 'reserved'
      ? { step: 'reserve', status: 'done', text: `Reserved ${order.items} ${noun}` }
      : state.inventory === 'released'
        ? { step: 'reserve', status: 'undone', text: `Released ${order.items} ${noun}` }
        : pending('reserve');
  let chargeCell: StepCell;
  if (state.payment === 'charged') {
    chargeCell =
      state.charges > 1
        ? { step: 'charge', status: 'doubled', text: `Charged $${order.amount} twice` }
        : { step: 'charge', status: 'done', text: `Charged $${order.amount}` };
  } else if (state.payment === 'declined') {
    chargeCell = { step: 'charge', status: 'failed', text: 'Declined' };
  } else if (state.payment === 'refunded') {
    chargeCell = { step: 'charge', status: 'undone', text: `Refunded $${order.amount}` };
  } else {
    chargeCell = pending('charge');
  }
  const bookCell: StepCell =
    state.shipping === 'booked'
      ? { step: 'book', status: 'done', text: 'Booked' }
      : state.shipping === 'rejected'
        ? { step: 'book', status: 'failed', text: 'No courier' }
        : pending('book');
  return [reserveCell, chargeCell, bookCell];
}

const logText: Record<LogState, string> = {
  none: 'No record yet',
  reserving: 'Step 1 of 3, reserving stock',
  charging: 'Step 2 of 3, charging card',
  booking: 'Step 3 of 3, booking courier',
  completed: 'Completed',
  refunding: 'Compensating, refunding card',
  releasing: 'Compensating, releasing stock',
  cancelled: 'Cancelled, all steps compensated',
};

const ordersText: Record<OrdersState, string> = {
  none: 'No record yet',
  placed: 'Placed, outcome unknown',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export interface WhereAnswer {
  place: string;
  answer: string;
}

/** Who you have to ask, and what each one says, to learn where one order stands. */
export function whereIs(lane: LaneState, order: Order): WhereAnswer[] {
  const state = lane.orders[order.id - 1] ?? newOrderState();
  if (lane.style === 'orchestration') return [{ place: 'Saga log', answer: logText[state.log] }];
  const noun = order.items === 1 ? 'item' : 'items';
  const inventory = {
    none: 'No record yet',
    reserved: `Reserved ${order.items} ${noun}`,
    released: `Released ${order.items} ${noun}`,
  }[state.inventory];
  const payment = {
    none: 'No record yet',
    charged: state.charges > 1 ? `Charged $${order.amount} twice` : `Charged $${order.amount}`,
    declined: 'Declined',
    refunded: `Refunded $${order.amount}`,
  }[state.payment];
  const shipping = { none: 'No record yet', booked: 'Courier booked', rejected: 'No courier' }[
    state.shipping
  ];
  return [
    { place: 'Orders', answer: ordersText[state.orders] },
    { place: 'Inventory', answer: inventory },
    { place: 'Payments', answer: payment },
    { place: 'Shipping', answer: shipping },
  ];
}

/** Runs one scenario to the end; the tests and the lesson prose quote these results. */
export function runSaga(scenarioId: SagaScenarioId, seed = SAGA_SEED): SagaDuel {
  const duel = new SagaDuel(scenarioId, seed);
  while (!duel.done) duel.step();
  return duel;
}
