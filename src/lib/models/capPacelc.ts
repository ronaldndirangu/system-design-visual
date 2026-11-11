import { createRng, randomInt } from '../rng';

/**
 * Toy model for the CAP and PACELC lesson: one shared shopping cart, a laptop
 * near the East datacenter, a phone near the West datacenter, and two ways to
 * run the datacenters on the same seeded taps.
 *
 * - Refuse when cut off (PC/EC): East holds the only copy. West forwards the
 *   phone's taps to East and refuses them when East does not answer in time.
 * - Accept everywhere (PA/EL): each side answers from its own copy at once and
 *   sends its versions to the other side. Versions written without seeing each
 *   other survive side by side, and a read shows their union, as in the
 *   Dynamo shopping cart.
 *
 * Every number is illustrative. The whole run is computed up front and
 * revealed tick by tick, so replays and resets match exactly.
 */

export type CapScenarioId = 'partition' | 'calm' | 'far';
export type CapStrategy = 'refuse' | 'accept';
export type CapMetric = 'problems' | 'average-wait';
export type Device = 'laptop' | 'phone';
export type Side = 'east' | 'west';
export type CartAction = 'view' | 'add' | 'remove';

export const CAP_SECONDS = 6;
export const TICK_MS = 100;
/** Time for a datacenter to answer a nearby device from its own copy. */
export const LOCAL_MS = 5;
/** How long West waits for East before it gives up and refuses. */
export const TIMEOUT_MS = 300;
/** Taps stop here so every answer lands inside the run. */
const LAST_TAP_MS = 5600;

export const CATALOG = ['mug', 'book', 'scarf', 'lamp', 'tea', 'pen', 'jam', 'soap'] as const;
export const STARTING_CART: readonly string[] = ['mug', 'book', 'scarf'];

export const homeSide: Record<Device, Side> = { laptop: 'east', phone: 'west' };
export const otherSide: Record<Side, Side> = { east: 'west', west: 'east' };
export const sideLabels: Record<Side, string> = { east: 'East', west: 'West' };
export const deviceLabels: Record<Device, string> = { laptop: 'Laptop', phone: 'Phone' };

export const strategyLabels: Record<CapStrategy, string> = {
  refuse: 'Refuse when cut off (PC/EC)',
  accept: 'Accept everywhere (PA/EL)',
};
const strategyShort: Record<CapStrategy, string> = { refuse: 'Refuse lane', accept: 'Accept lane' };

export interface LinkCut {
  from: number;
  to: number;
}

export interface CapScenario {
  id: CapScenarioId;
  label: string;
  diff: string;
  seed: number;
  /** One-way trip between East and West. */
  linkMs: number;
  cut: LinkCut | null;
  metric: CapMetric;
}

export const capScenarios: Record<CapScenarioId, CapScenario> = {
  partition: {
    id: 'partition',
    label: 'Link cut for 3 s',
    diff: 'link 40 ms each way, cut from 1.5 s to 4.5 s',
    seed: 40,
    linkMs: 40,
    cut: { from: 1500, to: 4500 },
    metric: 'problems',
  },
  calm: {
    id: 'calm',
    label: 'No cut',
    diff: 'link 40 ms each way, never cut',
    seed: 40,
    linkMs: 40,
    cut: null,
    metric: 'average-wait',
  },
  far: {
    id: 'far',
    label: 'Far apart, no cut',
    diff: 'link 120 ms each way, never cut',
    seed: 40,
    linkMs: 120,
    cut: null,
    metric: 'average-wait',
  },
};

export const capScenarioOrder: readonly CapScenarioId[] = ['partition', 'calm', 'far'];

export interface CartRequest {
  /** Also the request's index in the workload. */
  id: number;
  device: Device;
  at: number;
  action: CartAction;
  item: string | null;
}

export interface Answer {
  request: CartRequest;
  ok: boolean;
  /** When a copy applied the write or served the read; null when no copy saw it. */
  servedAt: number | null;
  /** When the device hears back, with an answer or a refusal. */
  replyAt: number;
  /** Reads only: the cart the device saw. */
  seen: string[] | null;
  /** Reads only: writes already confirmed to a device that this read left out. */
  missed: CartRequest[];
}

export interface Message {
  kind: 'forward' | 'reply' | 'sync';
  from: Side;
  to: Side;
  sentAt: number;
  arriveAt: number;
  lost: boolean;
}

export interface CartChange {
  at: number;
  side: Side;
  cart: string[];
  /** Versions this side holds side by side; a read shows their union. */
  versions: number;
}

export interface Comeback {
  at: number;
  side: Side;
  item: string;
  remove: CartRequest;
}

interface Moment {
  at: number;
  text: string;
}

export interface CapLane {
  strategy: CapStrategy;
  label: string;
  answers: Answer[];
  messages: Message[];
  carts: CartChange[];
  comebacks: Comeback[];
  /** One value per tick for the scenario's metric. */
  series: number[];
  moments: Moment[];
}

export interface CapEvent {
  tick: number;
  at: number;
  text: string;
  marker: boolean;
}

export function linkCutDuring(cut: LinkCut | null, from: number, to: number): boolean {
  return cut !== null && from < cut.to && to > cut.from;
}

export function linkDownAt(cut: LinkCut | null, at: number): boolean {
  return cut !== null && at >= cut.from && at < cut.to;
}

const sortCart = (cart: ReadonlySet<string>): string[] => CATALOG.filter((item) => cart.has(item));

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export function describeRequest(request: CartRequest): string {
  if (request.action === 'view') return 'view the cart';
  return `${request.action} ${request.item}`;
}

function applyAction(cart: Set<string>, request: CartRequest): void {
  if (request.item === null) return;
  if (request.action === 'add') cart.add(request.item);
  if (request.action === 'remove') cart.delete(request.item);
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[randomInt(rng, 0, items.length - 1)] as T;
}

/**
 * Seeded taps from both devices. Each device chooses from the cart it would
 * see: while the link is up it sees every change, and while it is cut it sees
 * only its own. Both lanes replay this exact list.
 */
export function generateWorkload(seed: number, cut: LinkCut | null): CartRequest[] {
  const rng = createRng(seed);
  const taps: { device: Device; at: number }[] = [];
  for (const device of ['laptop', 'phone'] as const) {
    let at = randomInt(rng, 100, 300);
    while (at <= LAST_TAP_MS) {
      taps.push({ device, at });
      at += randomInt(rng, 250, 550);
    }
  }
  taps.sort((a, b) => a.at - b.at || (a.device === b.device ? 0 : a.device === 'laptop' ? -1 : 1));

  const views: Record<Device, Set<string>> = {
    laptop: new Set(STARTING_CART),
    phone: new Set(STARTING_CART),
  };
  let healed = cut === null;
  return taps.map(({ device, at }, id) => {
    if (!healed && cut && at >= cut.to) {
      const merged = new Set([...views.laptop, ...views.phone]);
      views.laptop = new Set(merged);
      views.phone = new Set(merged);
      healed = true;
    }
    const own = views[device];
    const present = CATALOG.filter((item) => own.has(item));
    const absent = CATALOG.filter((item) => !own.has(item));
    const roll = rng();
    let action: CartAction = 'view';
    let item: string | null = null;
    if (present.length === 0 || (roll >= 0.4 && roll < 0.75)) {
      if (absent.length > 0) {
        action = 'add';
        item = pick(rng, absent);
      }
    } else if (roll >= 0.75) {
      action = 'remove';
      item = pick(rng, present);
    }
    const request: CartRequest = { id, device, at, action, item };
    applyAction(own, request);
    if (!linkDownAt(cut, at)) applyAction(views[device === 'laptop' ? 'phone' : 'laptop'], request);
    return request;
  });
}

function fillMissed(answers: Answer[], seenIds: Map<number, ReadonlySet<number>>): void {
  for (const answer of answers) {
    const ids = seenIds.get(answer.request.id);
    if (!answer.ok || !ids) continue;
    answer.missed = answers
      .filter(
        (other) =>
          other.ok &&
          other.request.action !== 'view' &&
          other.replyAt < answer.request.at &&
          !ids.has(other.request.id),
      )
      .map((other) => other.request);
  }
}

function emptyLane(strategy: CapStrategy): CapLane {
  return {
    strategy,
    label: strategyLabels[strategy],
    answers: [],
    messages: [],
    carts: [],
    comebacks: [],
    series: [],
    moments: [],
  };
}

function firstStaleMoment(lane: CapLane): void {
  const stale = lane.answers.find((answer) => answer.missed.length > 0);
  if (!stale?.seen) return;
  const miss = stale.missed[0] as CartRequest;
  const who = deviceLabels[stale.request.device].toLowerCase();
  const writer = deviceLabels[miss.device].toLowerCase();
  const confirmed = lane.answers[miss.id]?.replyAt ?? miss.at;
  const verb = miss.action === 'add' ? 'without' : 'still with';
  lane.moments.push({
    at: stale.replyAt,
    text: `${strategyShort[lane.strategy]}: the ${who} sees the cart ${verb} the ${miss.item}, though the ${writer}'s ${miss.action} was confirmed at ${seconds(confirmed)}. An out-of-date read.`,
  });
}

/** East holds the only copy; West forwards and refuses when East is out of reach. */
function runRefuse(scenario: CapScenario, workload: readonly CartRequest[]): CapLane {
  const lane = emptyLane('refuse');
  const d = scenario.linkMs;
  const ops: { at: number; request: CartRequest }[] = [];
  const replyLost = new Set<number>();
  for (const request of workload) {
    if (request.device === 'laptop') {
      ops.push({ at: request.at, request });
      continue;
    }
    const forwardLost = linkCutDuring(scenario.cut, request.at, request.at + d);
    lane.messages.push({
      kind: 'forward',
      from: 'west',
      to: 'east',
      sentAt: request.at,
      arriveAt: request.at + d,
      lost: forwardLost,
    });
    if (forwardLost) continue;
    ops.push({ at: request.at + d, request });
    const lost = linkCutDuring(scenario.cut, request.at + d, request.at + 2 * d);
    if (lost) replyLost.add(request.id);
    lane.messages.push({
      kind: 'reply',
      from: 'east',
      to: 'west',
      sentAt: request.at + d,
      arriveAt: request.at + 2 * d,
      lost,
    });
  }
  ops.sort((a, b) => a.at - b.at || a.request.id - b.request.id);

  const cart = new Set(STARTING_CART);
  const applied = new Set<number>();
  const servedAt = new Map<number, number>();
  const seenIds = new Map<number, ReadonlySet<number>>();
  const seenCart = new Map<number, string[]>();
  lane.carts.push({ at: -1, side: 'east', cart: sortCart(cart), versions: 1 });
  for (const { at, request } of ops) {
    servedAt.set(request.id, at);
    if (request.action === 'view') {
      seenIds.set(request.id, new Set(applied));
      seenCart.set(request.id, sortCart(cart));
      continue;
    }
    applyAction(cart, request);
    applied.add(request.id);
    lane.carts.push({ at, side: 'east', cart: sortCart(cart), versions: 1 });
  }

  lane.answers = workload.map((request) => {
    const served = servedAt.get(request.id) ?? null;
    const ok = request.device === 'laptop' || (served !== null && !replyLost.has(request.id));
    const replyAt = !ok
      ? request.at + TIMEOUT_MS
      : request.device === 'laptop'
        ? request.at + LOCAL_MS
        : request.at + 2 * d + LOCAL_MS;
    return {
      request,
      ok,
      servedAt: served,
      replyAt,
      seen: ok ? (seenCart.get(request.id) ?? null) : null,
      missed: [],
    };
  });
  fillMissed(lane.answers, seenIds);

  const refused = lane.answers.filter((answer) => !answer.ok).sort((a, b) => a.replyAt - b.replyAt);
  const first = refused[0];
  if (first) {
    lane.moments.push({
      at: first.replyAt,
      text: `Refuse lane: West waits ${TIMEOUT_MS} ms for East, then refuses the phone's ${describeRequest(first.request)}. The laptop keeps working through East.`,
    });
  }
  const appliedButRefused = refused.find(
    (answer) => answer.servedAt !== null && answer.request.action !== 'view',
  );
  if (appliedButRefused) {
    lane.moments.push({
      at: appliedButRefused.replyAt,
      text: `Refuse lane: East applied the phone's ${describeRequest(appliedButRefused.request)}, but the cut swallowed East's answer, so the phone hears a refusal for a change that happened.`,
    });
  }
  if (!scenario.cut) {
    const phone = lane.answers.find((answer) => answer.request.device === 'phone');
    if (phone) {
      lane.moments.push({
        at: phone.replyAt,
        text: `Refuse lane: the phone's first answer takes ${phone.replyAt - phone.request.at} ms, because West has to ask East.`,
      });
    }
  }
  firstStaleMoment(lane);
  return lane;
}

interface Version {
  ids: Set<number>;
  cart: Set<string>;
}

const isSubset = (a: ReadonlySet<number>, b: ReadonlySet<number>) => {
  if (a.size > b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

/** Drops every version that another version already includes. */
function keepLatest(versions: readonly Version[]): Version[] {
  return versions.filter(
    (version, index) =>
      !versions.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          isSubset(version.ids, other.ids) &&
          (other.ids.size > version.ids.size || otherIndex < index),
      ),
  );
}

const cloneVersions = (versions: readonly Version[]): Version[] =>
  versions.map((version) => ({ ids: new Set(version.ids), cart: new Set(version.cart) }));

const signature = (versions: readonly Version[]) =>
  versions
    .map((version) => [...version.ids].sort((a, b) => a - b).join('.'))
    .sort()
    .join('|');

/** Both sides accept every tap at once and swap versions over the link. */
function runAccept(scenario: CapScenario, workload: readonly CartRequest[]): CapLane {
  const lane = emptyLane('accept');
  const d = scenario.linkMs;
  const state: Record<Side, Version[]> = {
    east: [{ ids: new Set(), cart: new Set(STARTING_CART) }],
    west: [{ ids: new Set(), cart: new Set(STARTING_CART) }],
  };
  const pending: { arriveAt: number; seq: number; to: Side; versions: Version[] }[] = [];
  let seq = 0;
  const countedRemoves = new Set<number>();
  const seenIds = new Map<number, ReadonlySet<number>>();
  const answers: Answer[] = [];
  let matched = false;

  const visible = (side: Side) => {
    const cart = new Set<string>();
    const ids = new Set<number>();
    for (const version of state[side]) {
      for (const item of version.cart) cart.add(item);
      for (const id of version.ids) ids.add(id);
    }
    return { cart, ids };
  };
  const record = (side: Side, at: number) => {
    lane.carts.push({ at, side, cart: sortCart(visible(side).cart), versions: state[side].length });
  };
  const checkComebacks = (side: Side, at: number) => {
    const { cart, ids } = visible(side);
    for (const item of cart) {
      let latest: CartRequest | null = null;
      for (const id of ids) {
        const request = workload[id] as CartRequest;
        if (request.item !== item) continue;
        if (!latest || request.at > latest.at || (request.at === latest.at && request.id > latest.id)) {
          latest = request;
        }
      }
      if (latest?.action === 'remove' && !countedRemoves.has(latest.id)) {
        countedRemoves.add(latest.id);
        lane.comebacks.push({ at, side, item, remove: latest });
      }
    }
  };
  const send = (from: Side, at: number) => {
    const to = otherSide[from];
    const lost = linkCutDuring(scenario.cut, at, at + d);
    lane.messages.push({ kind: 'sync', from, to, sentAt: at, arriveAt: at + d, lost });
    if (!lost) pending.push({ arriveAt: at + d, seq: seq++, to, versions: cloneVersions(state[from]) });
  };
  const deliverUntil = (until: number) => {
    pending.sort((a, b) => a.arriveAt - b.arriveAt || a.seq - b.seq);
    while (pending.length > 0 && (pending[0] as (typeof pending)[number]).arriveAt <= until) {
      const message = pending.shift() as (typeof pending)[number];
      const before = signature(state[message.to]);
      state[message.to] = keepLatest([...state[message.to], ...message.versions]);
      if (signature(state[message.to]) === before) continue;
      record(message.to, message.arriveAt);
      checkComebacks(message.to, message.arriveAt);
      if (scenario.cut && !matched && message.arriveAt >= scenario.cut.to) {
        if (signature(state.east) === signature(state.west)) {
          matched = true;
          lane.moments.push({
            at: message.arriveAt,
            text: 'Accept lane: East and West hold the same cart again.',
          });
        }
      }
    }
  };

  record('east', -1);
  record('west', -1);
  const steps: { at: number; heal: boolean; request: CartRequest | null }[] = workload.map((request) => ({
    at: request.at,
    heal: false,
    request,
  }));
  if (scenario.cut) steps.push({ at: scenario.cut.to, heal: true, request: null });
  steps.sort((a, b) => a.at - b.at || Number(b.heal) - Number(a.heal));

  for (const step of steps) {
    deliverUntil(step.at);
    if (step.heal || !step.request) {
      send('east', step.at);
      send('west', step.at);
      continue;
    }
    const request = step.request;
    const side = homeSide[request.device];
    if (request.action === 'view') {
      const { cart, ids } = visible(side);
      seenIds.set(request.id, ids);
      answers.push({
        request,
        ok: true,
        servedAt: request.at,
        replyAt: request.at + LOCAL_MS,
        seen: sortCart(cart),
        missed: [],
      });
      continue;
    }
    const { cart, ids } = visible(side);
    applyAction(cart, request);
    ids.add(request.id);
    state[side] = [{ ids, cart }];
    record(side, request.at);
    answers.push({
      request,
      ok: true,
      servedAt: request.at,
      replyAt: request.at + LOCAL_MS,
      seen: null,
      missed: [],
    });
    send(side, request.at);
  }
  deliverUntil(Number.POSITIVE_INFINITY);

  lane.answers = answers.sort((a, b) => a.request.id - b.request.id);
  lane.carts.sort((a, b) => a.at - b.at);
  fillMissed(lane.answers, seenIds);

  if (scenario.cut) {
    const firstCutWrite = lane.answers.find(
      (answer) =>
        answer.request.device === 'phone' &&
        answer.request.action !== 'view' &&
        linkDownAt(scenario.cut, answer.request.at),
    );
    if (firstCutWrite) {
      lane.moments.push({
        at: firstCutWrite.replyAt,
        text: `Accept lane: West applies the phone's ${describeRequest(firstCutWrite.request)} and answers in ${LOCAL_MS} ms. East cannot hear about it until the link returns.`,
      });
    }
  } else {
    const phone = lane.answers.find((answer) => answer.request.device === 'phone');
    if (phone) {
      lane.moments.push({
        at: phone.replyAt,
        text: `Accept lane: West answers the phone in ${LOCAL_MS} ms from its own copy.`,
      });
    }
  }
  firstStaleMoment(lane);
  for (const comeback of lane.comebacks.slice(0, 3)) {
    const who = deviceLabels[comeback.remove.device].toLowerCase();
    lane.moments.push({
      at: comeback.at,
      text: `Accept lane: ${sideLabels[comeback.side]} merges two versions and the ${comeback.item} comes back, though the ${who} removed it at ${seconds(comeback.remove.at)}.`,
    });
  }
  return lane;
}

export interface CapSummary {
  arrived: number;
  answered: number;
  refused: number;
  inFlight: number;
  outOfDate: number;
  comebacks: number;
  averageWaitMs: number;
  longestWaitMs: number;
}

/** Totals for everything that happened before `now` (ms). */
export function summarize(lane: CapLane, now: number): CapSummary {
  let arrived = 0;
  let answered = 0;
  let refused = 0;
  let outOfDate = 0;
  let waitTotal = 0;
  let longestWaitMs = 0;
  for (const answer of lane.answers) {
    if (answer.request.at >= now) continue;
    arrived += 1;
    if (answer.replyAt >= now) continue;
    if (answer.ok) answered += 1;
    else refused += 1;
    if (answer.missed.length > 0) outOfDate += 1;
    const wait = answer.replyAt - answer.request.at;
    waitTotal += wait;
    longestWaitMs = Math.max(longestWaitMs, wait);
  }
  const done = answered + refused;
  return {
    arrived,
    answered,
    refused,
    inFlight: arrived - done,
    outOfDate,
    comebacks: lane.comebacks.filter((comeback) => comeback.at < now).length,
    averageWaitMs: done > 0 ? waitTotal / done : 0,
    longestWaitMs,
  };
}

/** The cart a side shows at `now`; null when the side holds no copy. */
export function cartAt(lane: CapLane, side: Side, now: number): CartChange | null {
  let latest: CartChange | null = null;
  for (const change of lane.carts) {
    if (change.at >= now) break;
    if (change.side === side) latest = change;
  }
  return latest;
}

/** The device's most recent answer or refusal before `now`. */
export function lastAnswer(lane: CapLane, device: Device, now: number): Answer | null {
  let latest: Answer | null = null;
  for (const answer of lane.answers) {
    if (answer.request.device !== device || answer.replyAt >= now) continue;
    if (!latest || answer.replyAt > latest.replyAt) latest = answer;
  }
  return latest;
}

export class CapDuel {
  readonly scenario: CapScenario;
  readonly workload: readonly CartRequest[];
  readonly length = (CAP_SECONDS * 1000) / TICK_MS;
  readonly tickSeconds = TICK_MS / 1000;
  readonly lanes: [CapLane, CapLane];
  readonly events: CapEvent[] = [];
  private readonly timeline: Moment[];
  private revealed = 0;
  private tickCount = 0;

  constructor(scenario: CapScenario) {
    this.scenario = scenario;
    this.workload = generateWorkload(scenario.seed, scenario.cut);
    this.lanes = [runRefuse(scenario, this.workload), runAccept(scenario, this.workload)];
    const shared: Moment[] = scenario.cut
      ? [
          { at: scenario.cut.from, text: 'The link between East and West is cut. Both datacenters stay up.' },
          {
            at: scenario.cut.to,
            text: 'The link is back. In the refuse lane West forwards again; in the accept lane East and West swap versions.',
          },
        ]
      : [];
    this.timeline = [...shared, ...this.lanes[0].moments, ...this.lanes[1].moments].sort(
      (a, b) => a.at - b.at,
    );
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** Simulated time shown on screen, in ms. */
  get now(): number {
    return this.tickCount * TICK_MS;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    this.tickCount += 1;
    const now = this.now;
    while (this.revealed < this.timeline.length) {
      const moment = this.timeline[this.revealed] as Moment;
      if (moment.at >= now) break;
      this.events.push({ tick, at: moment.at, text: moment.text, marker: true });
      this.revealed += 1;
    }
    for (const lane of this.lanes) {
      const sum = summarize(lane, now);
      lane.series.push(
        this.scenario.metric === 'problems' ? sum.refused + sum.outOfDate : Math.round(sum.averageWaitMs),
      );
    }
    if (this.done) {
      const [refuse, accept] = this.lanes.map((lane) => summarize(lane, now)) as [CapSummary, CapSummary];
      const text = this.scenario.cut
        ? `Run complete. Refuse lane: ${refuse.refused} refused, ${refuse.outOfDate} out-of-date reads. Accept lane: ${accept.refused} refused, ${accept.outOfDate} out-of-date reads, ${accept.comebacks} removed ${accept.comebacks === 1 ? 'item' : 'items'} came back.`
        : `Run complete. Average wait: ${Math.round(refuse.averageWaitMs)} ms in the refuse lane against ${Math.round(accept.averageWaitMs)} ms in the accept lane. Out-of-date reads: ${refuse.outOfDate} against ${accept.outOfDate}.`;
      this.events.push({ tick, at: now, text, marker: false });
    }
  }
}
