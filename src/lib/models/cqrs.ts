/**
 * Toy model of CQRS with event sourcing for one shop's carts. Shopper commands
 * go to a write model that checks them against the facts so far and appends
 * the accepted ones to an append-only event log. Three consumers follow the log
 * at their own pace: the cart page view, a top items dashboard, and an email
 * sender that mails a receipt for every checkout. Each consumer remembers its
 * position (the number of the last event it applied), so every read model trails
 * the log by a few events. In the replay scenario a fixed cart page projection
 * rebuilds from position 0 while the buggy one keeps serving pages.
 *
 * The whole workload is drawn from a seed up front, so step() uses no random
 * numbers and a checkpoint only needs the mutable state. Every number is
 * illustrative.
 */
import { createRng, createZipf, poisson, randomInt } from '../rng';

export const CQRS_SECONDS = 24;
const TICK_SECONDS = 0.1;
const MS_PER_TICK = 100;
const TICKS = Math.round(CQRS_SECONDS / TICK_SECONDS);
/** Shoppers go quiet for the last second so every read model can catch up. */
const QUIET_FROM = TICKS - 10;
/** The top items marker fires once the dashboard is this many events behind. */
export const TOP_BEHIND_MARK = 20;

export type ItemId = 'mug' | 'socks' | 'book' | 'tea' | 'lamp';
/** Most popular first: the Zipf sampler picks the mug most often. */
export const ITEMS: readonly ItemId[] = ['mug', 'socks', 'book', 'tea', 'lamp'];
export const ITEM_PRICES: Readonly<Record<ItemId, number>> = {
  mug: 12,
  socks: 8,
  book: 18,
  tea: 6,
  lamp: 40,
};

export type CartCommand =
  | { type: 'AddItem'; cart: number; item: ItemId }
  | { type: 'RemoveItem'; cart: number; item: ItemId }
  | { type: 'Checkout'; cart: number };

export type CartFact =
  | { type: 'ItemAdded'; cart: number; item: ItemId; price: number }
  | { type: 'ItemRemoved'; cart: number; item: ItemId; price: number }
  | { type: 'CheckedOut'; cart: number };

/** A fact once it is in the log. `seq` starts at 1 and never changes. */
export type CartEvent = CartFact & { seq: number; tick: number };

export type Decision = { ok: true; fact: CartFact } | { ok: false; reason: string };

export type Lines = Partial<Record<ItemId, number>>;

export interface WriteCart {
  lines: Lines;
  checkedOut: boolean;
}

export type WriteState = Record<number, WriteCart>;

export interface CartPageEntry {
  lines: Lines;
  total: number;
  checkedOut: boolean;
}

export type CartPageView = Record<number, CartPageEntry>;
export type TopItemsView = Record<ItemId, number>;
/** v1 has the bug this lesson fixes: it ignores ItemRemoved. */
export type ProjectionVersion = 'v1' | 'v2';

export function commandText(command: CartCommand): string {
  if (command.type === 'AddItem') return `add ${command.item} to cart ${command.cart}`;
  if (command.type === 'RemoveItem') return `remove ${command.item} from cart ${command.cart}`;
  return `check out cart ${command.cart}`;
}

export function factText(fact: CartFact): string {
  if (fact.type === 'CheckedOut') return `CheckedOut, cart ${fact.cart}`;
  return `${fact.type} ${fact.item}, cart ${fact.cart}`;
}

function decrement(lines: Lines, item: ItemId): Lines {
  const next: Lines = {};
  for (const key of ITEMS) {
    const count = (lines[key] ?? 0) - (key === item ? 1 : 0);
    if (count > 0) next[key] = count;
  }
  return next;
}

/** The write model: accept a command as a new fact, or reject it with a reason. */
export function decide(state: WriteState, command: CartCommand): Decision {
  const cart = state[command.cart];
  if (cart?.checkedOut) return { ok: false, reason: `cart ${command.cart} is already checked out` };
  if (command.type === 'AddItem') {
    return {
      ok: true,
      fact: { type: 'ItemAdded', cart: command.cart, item: command.item, price: ITEM_PRICES[command.item] },
    };
  }
  if (command.type === 'RemoveItem') {
    if ((cart?.lines[command.item] ?? 0) === 0) {
      return { ok: false, reason: `cart ${command.cart} has no ${command.item}` };
    }
    return {
      ok: true,
      fact: { type: 'ItemRemoved', cart: command.cart, item: command.item, price: ITEM_PRICES[command.item] },
    };
  }
  if (!cart || Object.keys(cart.lines).length === 0) {
    return { ok: false, reason: `cart ${command.cart} is empty` };
  }
  return { ok: true, fact: { type: 'CheckedOut', cart: command.cart } };
}

export function applyToWriteState(state: WriteState, fact: CartFact): void {
  state[fact.cart] ??= { lines: {}, checkedOut: false };
  const cart = state[fact.cart] as WriteCart;
  if (fact.type === 'ItemAdded') cart.lines[fact.item] = (cart.lines[fact.item] ?? 0) + 1;
  else if (fact.type === 'ItemRemoved') cart.lines = decrement(cart.lines, fact.item);
  else cart.checkedOut = true;
}

/** Current write state, rebuilt from nothing but the log. */
export function foldEvents(events: readonly CartFact[]): WriteState {
  const state: WriteState = {};
  for (const event of events) applyToWriteState(state, event);
  return state;
}

export function cartTotal(lines: Lines): number {
  return ITEMS.reduce((sum, item) => sum + (lines[item] ?? 0) * ITEM_PRICES[item], 0);
}

export function applyToCartPage(view: CartPageView, fact: CartFact, version: ProjectionVersion): void {
  view[fact.cart] ??= { lines: {}, total: 0, checkedOut: false };
  const entry = view[fact.cart] as CartPageEntry;
  if (fact.type === 'ItemAdded') {
    entry.lines[fact.item] = (entry.lines[fact.item] ?? 0) + 1;
    entry.total += fact.price;
  } else if (fact.type === 'ItemRemoved') {
    if (version === 'v1') return;
    entry.lines = decrement(entry.lines, fact.item);
    entry.total -= fact.price;
  } else {
    entry.checkedOut = true;
  }
}

export function projectCartPage(events: readonly CartFact[], version: ProjectionVersion): CartPageView {
  const view: CartPageView = {};
  for (const event of events) applyToCartPage(view, event, version);
  return view;
}

export function emptyTopItems(): TopItemsView {
  return { mug: 0, socks: 0, book: 0, tea: 0, lamp: 0 };
}

/** Times each item went into a cart. */
export function applyToTopItems(view: TopItemsView, fact: CartFact): void {
  if (fact.type === 'ItemAdded') view[fact.item] += 1;
}

export function projectTopItems(events: readonly CartFact[]): TopItemsView {
  const view = emptyTopItems();
  for (const event of events) applyToTopItems(view, event);
  return view;
}

export function countWrongTotals(view: CartPageView, truth: CartPageView): number {
  let wrong = 0;
  for (const [cart, entry] of Object.entries(view)) {
    if (entry.total !== truth[Number(cart)]?.total) wrong += 1;
  }
  return wrong;
}

export type CqrsScenarioId = 'normal' | 'sale' | 'replay';

export interface CqrsConfig {
  seed: number;
  /** Shopper commands per second outside the burst. */
  commandRate: number;
  shoppers: number;
  /** Seconds. */
  burst: { from: number; to: number; rate: number } | null;
  cartPollTicks: number;
  topPollTicks: number;
  topPerPoll: number;
  emailPollTicks: number;
  startVersion: ProjectionVersion;
  /** Seconds. When set, v2 starts rebuilding from position 0 at this time. */
  deployAt: number | null;
  replayPerTick: number;
}

export interface CqrsScenario {
  id: CqrsScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  config: CqrsConfig;
}

const BASE: CqrsConfig = {
  seed: 17,
  commandRate: 4,
  shoppers: 5,
  burst: null,
  cartPollTicks: 3,
  topPollTicks: 5,
  topPerPoll: 5,
  emailPollTicks: 2,
  startVersion: 'v2',
  deployAt: null,
  replayPerTick: 2,
};

export const cqrsScenarios: Record<CqrsScenarioId, CqrsScenario> = {
  normal: {
    id: 'normal',
    label: 'Normal lag',
    diff: 'Baseline: 4 commands/s. The cart page catches up every 300 ms. Top items applies at most 10 events/s.',
    config: BASE,
  },
  sale: {
    id: 'sale',
    label: 'Flash sale',
    diff: 'Commands jump to 15/s from 6 s to 12 s. Top items still applies at most 10 events/s.',
    config: { ...BASE, burst: { from: 6, to: 12, rate: 15 } },
  },
  replay: {
    id: 'replay',
    label: 'Fix a bug and replay',
    diff: 'Cart page v1 ignores ItemRemoved. At 12 s, v2 replays the log from position 0.',
    config: { ...BASE, startVersion: 'v1', deployAt: 12 },
  },
};

export interface CqrsNote {
  tick: number;
  text: string;
  /** False for wrap-up notes that have no point on the chart. */
  marker: boolean;
}

export interface CqrsRead {
  cart: number;
  stale: boolean;
  wrong: boolean;
}

export interface CqrsActivity {
  accepted: CartEvent[];
  rejected: { command: CartCommand; reason: string }[];
  cartApplied: number;
  topApplied: number;
  rebuildApplied: number;
  emailApplied: number;
  emailsSent: number;
  reads: CqrsRead[];
}

export interface CqrsStats {
  commands: number;
  appended: number;
  rejected: number;
  reads: number;
  staleReads: number;
  wrongReads: number;
  waitedReads: number;
  waitTicksTotal: number;
  waitTicksMax: number;
  emailsSent: number;
  replayed: number;
  peakCartLag: number;
  peakTopLag: number;
  peakTopLagTick: number;
  wrongCartsAtDeploy: number;
  /** Carts v1 still showed wrong when v2 took over pages; the count can grow while v2 replays. */
  wrongCartsAtSwap: number;
  /** Receipts already mailed when v2 deploys: re-running the commands would mail them again. */
  receiptsAtRisk: number;
  rebuildStartTick: number | null;
  rebuildEndTick: number | null;
}

export interface Lag {
  events: number;
  ms: number;
}

interface PlannedCommand {
  command: CartCommand;
  /** Ticks until the shopper's cart page loads after this command. */
  readDelay: number;
}

interface CqrsState {
  tick: number;
  log: CartEvent[];
  write: WriteState;
  cart: { version: ProjectionVersion; position: number; view: CartPageView };
  /** v2 applied at the live cart page's position: what the page should show. */
  truth: CartPageView;
  rebuild: { position: number; view: CartPageView } | null;
  top: { position: number; view: TopItemsView };
  email: { position: number };
  dueReads: { due: number; cart: number; seq: number; delay: number }[];
  waiting: { cart: number; seq: number; since: number }[];
  activity: CqrsActivity;
  stats: CqrsStats;
  lags: { cart: Lag; top: Lag; email: Lag; rebuild: Lag | null };
  seriesA: number[];
  seriesB: number[];
  transcript: CqrsNote[];
  seen: {
    reject: boolean;
    stale: boolean;
    email: boolean;
    skip: boolean;
    topBehind: boolean;
    topCaught: boolean;
  };
}

export type CqrsCheckpoint = CqrsState;

function emptyActivity(): CqrsActivity {
  return {
    accepted: [],
    rejected: [],
    cartApplied: 0,
    topApplied: 0,
    rebuildApplied: 0,
    emailApplied: 0,
    emailsSent: 0,
    reads: [],
  };
}

const NO_LAG: Lag = { events: 0, ms: 0 };

function toTicks(seconds: number): number {
  return Math.round(seconds / TICK_SECONDS);
}

function planWorkload(config: CqrsConfig): { plan: PlannedCommand[][]; totalEvents: number } {
  const rng = createRng(config.seed);
  const pickItem = createZipf(ITEMS.length, 1);
  const item = (index: number): ItemId => ITEMS[index] ?? 'mug';
  const state: WriteState = {};
  const carts = Array.from({ length: config.shoppers }, (_, i) => i + 1);
  let nextCart = config.shoppers + 1;
  let totalEvents = 0;
  const plan: PlannedCommand[][] = [];
  for (let tick = 0; tick < TICKS; tick += 1) {
    const planned: PlannedCommand[] = [];
    const burst = config.burst;
    const rate =
      burst && tick >= toTicks(burst.from) && tick < toTicks(burst.to) ? burst.rate : config.commandRate;
    const count = tick < QUIET_FROM ? poisson(rng, rate * TICK_SECONDS) : 0;
    for (let i = 0; i < count; i += 1) {
      const shopper = randomInt(rng, 0, config.shoppers - 1);
      const cart = carts[shopper] ?? 1;
      const lines = state[cart]?.lines ?? {};
      const inCart = ITEMS.filter((key) => (lines[key] ?? 0) > 0);
      const roll = rng();
      const commands: CartCommand[] = [];
      if (inCart.length === 0 || roll < 0.55) {
        commands.push({ type: 'AddItem', cart, item: item(pickItem(rng)) });
      } else if (roll < 0.8) {
        const target =
          rng() < 0.8
            ? (inCart[randomInt(rng, 0, inCart.length - 1)] ?? 'mug')
            : item(randomInt(rng, 0, ITEMS.length - 1));
        commands.push({ type: 'RemoveItem', cart, item: target });
      } else {
        commands.push({ type: 'Checkout', cart });
        // A double click on Pay sends the same checkout twice.
        if (rng() < 0.15) commands.push({ type: 'Checkout', cart });
        carts[shopper] = nextCart;
        nextCart += 1;
      }
      for (const command of commands) {
        const decision = decide(state, command);
        if (decision.ok) {
          applyToWriteState(state, decision.fact);
          totalEvents += 1;
        }
        planned.push({ command, readDelay: randomInt(rng, 1, 5) });
      }
    }
    plan.push(planned);
  }
  return { plan, totalEvents };
}

/** Number of events appended before `tick`: a consumer polling at `tick` can see these. */
function visibleHead(log: readonly CartEvent[], tick: number): number {
  let head = log.length;
  while (head > 0 && (log[head - 1]?.tick ?? 0) >= tick) head -= 1;
  return head;
}

export class CqrsModel {
  readonly scenario: CqrsScenario;
  readonly length = TICKS;
  readonly tickSeconds = TICK_SECONDS;
  readonly totalEvents: number;
  private readonly plan: PlannedCommand[][];
  private state: CqrsState;

  constructor(scenario: CqrsScenario) {
    this.scenario = scenario;
    const { plan, totalEvents } = planWorkload(scenario.config);
    this.plan = plan;
    this.totalEvents = totalEvents;
    this.state = this.initialState();
  }

  private initialState(): CqrsState {
    return {
      tick: 0,
      log: [],
      write: {},
      cart: { version: this.scenario.config.startVersion, position: 0, view: {} },
      truth: {},
      rebuild: null,
      top: { position: 0, view: emptyTopItems() },
      email: { position: 0 },
      dueReads: [],
      waiting: [],
      activity: emptyActivity(),
      stats: {
        commands: 0,
        appended: 0,
        rejected: 0,
        reads: 0,
        staleReads: 0,
        wrongReads: 0,
        waitedReads: 0,
        waitTicksTotal: 0,
        waitTicksMax: 0,
        emailsSent: 0,
        replayed: 0,
        peakCartLag: 0,
        peakTopLag: 0,
        peakTopLagTick: 0,
        wrongCartsAtDeploy: 0,
        wrongCartsAtSwap: 0,
        receiptsAtRisk: 0,
        rebuildStartTick: null,
        rebuildEndTick: null,
      },
      lags: { cart: NO_LAG, top: NO_LAG, email: NO_LAG, rebuild: null },
      seriesA: [],
      seriesB: [],
      transcript: [],
      seen: { reject: false, stale: false, email: false, skip: false, topBehind: false, topCaught: false },
    };
  }

  get ticks(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.tick >= TICKS;
  }

  get log(): readonly CartEvent[] {
    return this.state.log;
  }

  get writeState(): WriteState {
    return this.state.write;
  }

  get cartPage(): { version: ProjectionVersion; position: number; view: CartPageView } {
    return this.state.cart;
  }

  get cartTruth(): CartPageView {
    return this.state.truth;
  }

  get rebuild(): { position: number; view: CartPageView } | null {
    return this.state.rebuild;
  }

  get topItems(): { position: number; view: TopItemsView } {
    return this.state.top;
  }

  get emailPosition(): number {
    return this.state.email.position;
  }

  get activity(): CqrsActivity {
    return this.state.activity;
  }

  get stats(): CqrsStats {
    return this.state.stats;
  }

  get lags(): { cart: Lag; top: Lag; email: Lag; rebuild: Lag | null } {
    return this.state.lags;
  }

  get series(): { a: readonly number[]; b: readonly number[] } {
    return { a: this.state.seriesA, b: this.state.seriesB };
  }

  get transcript(): readonly CqrsNote[] {
    return this.state.transcript;
  }

  /** Carts whose page total differs from what v2 shows at the same position. */
  get wrongCarts(): number {
    return this.state.cart.version === 'v1' ? countWrongTotals(this.state.cart.view, this.state.truth) : 0;
  }

  checkpoint(): CqrsCheckpoint {
    return structuredClone(this.state);
  }

  restore(checkpoint: CqrsCheckpoint): void {
    this.state = structuredClone(checkpoint);
  }

  private note(text: string, marker = true): void {
    this.state.transcript.push({ tick: this.state.tick, text, marker });
  }

  private lag(position: number): Lag {
    const s = this.state;
    const next = s.log[position];
    if (!next) return NO_LAG;
    return { events: s.log.length - position, ms: (s.tick - next.tick) * MS_PER_TICK };
  }

  step(): void {
    if (this.done) return;
    const s = this.state;
    const config = this.scenario.config;
    const t = s.tick;
    const activity = emptyActivity();
    s.activity = activity;

    if (config.burst && t === toTicks(config.burst.from)) {
      this.note(`Flash sale starts: shoppers send ${config.burst.rate} commands per second.`);
    }
    if (config.burst && t === toTicks(config.burst.to)) {
      this.note(`Flash sale ends. Commands drop back to ${config.commandRate} per second.`);
    }
    if (config.deployAt !== null && t === toTicks(config.deployAt)) {
      s.rebuild = { position: 0, view: {} };
      s.stats.rebuildStartTick = t;
      s.stats.wrongCartsAtDeploy = this.wrongCarts;
      s.stats.receiptsAtRisk = s.log.filter((event) => event.type === 'CheckedOut').length;
      this.note(
        `Deploy cart page v2. It replays the log from position 0 into a new table while v1 keeps serving pages. Right now ${s.stats.wrongCartsAtDeploy} carts show a wrong total.`,
      );
    }

    for (const planned of this.plan[t] ?? []) {
      s.stats.commands += 1;
      const decision = decide(s.write, planned.command);
      if (!decision.ok) {
        s.stats.rejected += 1;
        activity.rejected.push({ command: planned.command, reason: decision.reason });
        if (!s.seen.reject) {
          s.seen.reject = true;
          this.note(
            `The write model rejects "${commandText(planned.command)}": ${decision.reason}. Rejected commands never reach the log.`,
          );
        }
        continue;
      }
      const event: CartEvent = { ...decision.fact, seq: s.log.length + 1, tick: t };
      s.log.push(event);
      s.stats.appended += 1;
      applyToWriteState(s.write, event);
      activity.accepted.push(event);
      s.dueReads.push({
        due: t + planned.readDelay,
        cart: event.cart,
        seq: event.seq,
        delay: planned.readDelay,
      });
    }

    const visible = visibleHead(s.log, t);

    if (t % config.cartPollTicks === 0) {
      while (s.cart.position < visible) {
        const event = s.log[s.cart.position] as CartEvent;
        applyToCartPage(s.cart.view, event, s.cart.version);
        applyToCartPage(s.truth, event, 'v2');
        s.cart.position += 1;
        activity.cartApplied += 1;
        if (s.cart.version === 'v1' && event.type === 'ItemRemoved' && !s.seen.skip) {
          s.seen.skip = true;
          this.note(
            `Cart page v1 skips event ${event.seq} (ItemRemoved ${event.item}, cart ${event.cart}). Cart ${event.cart} now shows $${event.price} too much.`,
          );
        }
      }
    }

    if (s.rebuild) {
      let replayed = 0;
      while (replayed < config.replayPerTick && s.rebuild.position < visible) {
        applyToCartPage(s.rebuild.view, s.log[s.rebuild.position] as CartEvent, 'v2');
        s.rebuild.position += 1;
        replayed += 1;
      }
      s.stats.replayed += replayed;
      activity.rebuildApplied = replayed;
      if (s.rebuild.position === visible) {
        s.stats.wrongCartsAtSwap = this.wrongCarts;
        s.cart = { version: 'v2', position: s.rebuild.position, view: s.rebuild.view };
        s.truth = structuredClone(s.rebuild.view);
        s.rebuild = null;
        s.stats.rebuildEndTick = t;
        const seconds = ((t - (s.stats.rebuildStartTick ?? t)) * TICK_SECONDS).toFixed(1);
        this.note(
          `Cart page v2 catches up at event ${s.cart.position} after replaying ${s.stats.replayed} events in ${seconds} s. Pages now read v2, which fixes the ${s.stats.wrongCartsAtSwap} carts v1 showed wrong. The email sender kept its own position, so no receipt goes out twice.`,
        );
      }
    }

    if (t % config.topPollTicks === 0) {
      let applied = 0;
      while (applied < config.topPerPoll && s.top.position < visible) {
        applyToTopItems(s.top.view, s.log[s.top.position] as CartEvent);
        s.top.position += 1;
        applied += 1;
      }
      activity.topApplied = applied;
      if (s.seen.topBehind && !s.seen.topCaught && s.top.position === visible) {
        s.seen.topCaught = true;
        this.note('Top items catches up with the log. The backlog drained once the sale traffic stopped.');
      }
    }

    if (t % config.emailPollTicks === 0) {
      while (s.email.position < visible) {
        const event = s.log[s.email.position] as CartEvent;
        s.email.position += 1;
        activity.emailApplied += 1;
        if (event.type !== 'CheckedOut') continue;
        s.stats.emailsSent += 1;
        activity.emailsSent += 1;
        if (!s.seen.email) {
          s.seen.email = true;
          this.note(
            `The email sender reads event ${event.seq} and mails the receipt for cart ${event.cart}.`,
          );
        }
      }
    }

    const due = s.dueReads.filter((read) => read.due === t);
    s.dueReads = s.dueReads.filter((read) => read.due !== t);
    for (const read of due) {
      const stale = s.cart.position < read.seq;
      const shown = s.cart.view[read.cart]?.total ?? 0;
      const wrong = s.cart.version === 'v1' && shown !== (s.truth[read.cart]?.total ?? 0);
      s.stats.reads += 1;
      if (wrong) s.stats.wrongReads += 1;
      activity.reads.push({ cart: read.cart, stale, wrong });
      if (!stale) continue;
      s.stats.staleReads += 1;
      s.waiting.push({ cart: read.cart, seq: read.seq, since: t });
      if (!s.seen.stale) {
        s.seen.stale = true;
        const applied = s.cart.position;
        this.note(
          `Stale page: cart ${read.cart} loads ${read.delay * MS_PER_TICK} ms after event ${read.seq}, but the cart page view has applied only ${applied} event${applied === 1 ? '' : 's'}. The shopper sees the cart without that change.`,
        );
      }
    }

    s.waiting = s.waiting.filter((wait) => {
      if (s.cart.position < wait.seq) return true;
      const ticks = t - wait.since;
      s.stats.waitedReads += 1;
      s.stats.waitTicksTotal += ticks;
      s.stats.waitTicksMax = Math.max(s.stats.waitTicksMax, ticks);
      return false;
    });

    s.lags = {
      cart: this.lag(s.cart.position),
      top: this.lag(s.top.position),
      email: this.lag(s.email.position),
      rebuild: s.rebuild ? this.lag(s.rebuild.position) : null,
    };
    if (s.lags.cart.events > s.stats.peakCartLag) s.stats.peakCartLag = s.lags.cart.events;
    if (s.lags.top.events > s.stats.peakTopLag) {
      s.stats.peakTopLag = s.lags.top.events;
      s.stats.peakTopLagTick = t;
    }
    if (!s.seen.topBehind && s.lags.top.events >= TOP_BEHIND_MARK) {
      s.seen.topBehind = true;
      this.note(
        `Top items falls ${s.lags.top.events} events behind. Its numbers are ${(s.lags.top.ms / 1000).toFixed(1)} s old, while the cart page stays current.`,
      );
    }

    if (config.deployAt !== null) {
      s.seriesA.push(this.wrongCarts);
      s.seriesB.push(s.lags.rebuild?.events ?? 0);
    } else {
      s.seriesA.push(s.lags.cart.events);
      s.seriesB.push(s.lags.top.events);
    }

    s.tick += 1;
    if (this.done) this.note(this.wrapUp(), false);
  }

  private wrapUp(): string {
    const st = this.state.stats;
    const head = `Run ends: ${st.appended} events in the log, ${st.rejected} commands rejected.`;
    if (this.scenario.config.deployAt !== null && st.rebuildEndTick !== null) {
      const seconds = ((st.rebuildEndTick - (st.rebuildStartTick ?? 0)) * TICK_SECONDS).toFixed(1);
      return `${head} v2 replayed ${st.replayed} events in ${seconds} s and fixed ${st.wrongCartsAtSwap} wrong totals. Before that, ${st.wrongReads} page loads showed a wrong total.`;
    }
    return `${head} ${st.staleReads} of ${st.reads} cart page loads were stale. Top items peaked ${st.peakTopLag} events behind.`;
  }
}
