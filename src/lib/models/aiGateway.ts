import { createRng, hashString, poisson, type Rng, randomInt } from '../rng';
import { EVAL_SEED } from './evalBudget';

/**
 * A toy AI gateway for the multi-tenant support assistant. Three stores send
 * requests. With gateway policies on, each request passes a per-store quota,
 * a response cache for common questions, the model call, an output
 * validator, and a fallback path. With policies off, every request goes
 * straight to the shared Medium model. Arrival rates, timings, and failure
 * odds are illustrative: no model was called.
 */

export type TenantId = 'a' | 'b' | 'c';
export type GatewayScenarioId = 'noisy' | 'outage' | 'malformed';
export type BreakerState = 'closed' | 'open' | 'halfOpen';
export type ModelTier = 'medium' | 'small';
export type FailureKind = 'rateLimited' | 'outage' | 'malformed';
export type Outcome = 'primary' | 'cache' | 'fallback' | 'handoff' | 'quota' | FailureKind;

export interface Tenant {
  id: TenantId;
  label: string;
  /** Normal arrival rate, requests per second. */
  rate: number;
  /** Quota bucket refill, requests per second. */
  quota: number;
}

export interface GatewayScenario {
  id: GatewayScenarioId;
  label: string;
  diff: string;
}

export interface GatewayCall {
  /** Unique within a run, for example `b-12` or `a-burst-3`. */
  id: string;
  tenant: TenantId;
  arrivalTick: number;
  /** Index of a common question, or null for a one off question. */
  faq: number | null;
  mediumTicks: number;
  smallTicks: number;
  /** Whether Medium’s first reply and its one retry would miss a required field (malformed scenario only). */
  malformed: [boolean, boolean];
}

export interface TenantTally {
  arrived: number;
  primary: number;
  cache: number;
  fallback: number;
  handoff: number;
  quota: number;
  rateLimited: number;
  outage: number;
  malformed: number;
  inFlight: number;
}

export interface Resolution {
  callId: string;
  tenant: TenantId;
  tick: number;
  outcome: Outcome;
}

/** One hop the widget can draw as a moving dot. */
export interface GatewayHop {
  callId: string;
  tenant: TenantId;
  kind: 'toMedium' | 'toSmall' | 'cacheHit' | 'shed' | 'answer' | 'fallbackAnswer' | 'failure' | 'retry';
}

export interface GatewayEvent {
  tick: number;
  text: string;
  marker: boolean;
}

interface Pending {
  call: GatewayCall;
  tier: ModelTier;
  doneTick: number;
  attempt: 0 | 1;
  erred: boolean;
  probe: boolean;
}

export const GATEWAY_SEED = EVAL_SEED;
export const TICK_SECONDS = 0.1;
export const TICKS_PER_SECOND = 10;
/** Arrivals stop after 30 seconds; the run ends when the last call resolves. */
export const RUN_TICKS = 300;

export const tenantOrder: TenantId[] = ['a', 'b', 'c'];

export const tenants: Record<TenantId, Tenant> = {
  a: { id: 'a', label: 'Store A', rate: 4, quota: 6 },
  b: { id: 'b', label: 'Store B', rate: 3, quota: 4.5 },
  c: { id: 'c', label: 'Store C', rate: 3, quota: 4.5 },
};

/** The shared Medium rate limit, requests per second. */
export const UPSTREAM_LIMIT = 15;
/** Every bucket, shared or per store, holds this many seconds of its rate as burst room. */
export const BURST_SECONDS = 2;

export const NOISY_BURST = { tenant: 'a' as TenantId, extraRate: 21, startTick: 50, endTick: 200 };
export const OUTAGE = { startTick: 80, endTick: 160, errorTicks: 3 };
export const BREAKER = { threshold: 3, coolDownTicks: 30 };
export const MALFORMED_RATE = 0.2;
export const FAQ_SHARE = 0.25;
export const FAQS_PER_TENANT = 3;
export const MEDIUM_TICKS = [8, 14] as const;
export const SMALL_TICKS = [4, 7] as const;

export const gatewayScenarios: Record<GatewayScenarioId, GatewayScenario> = {
  noisy: { id: 'noisy', label: 'Noisy tenant', diff: 'Store A bursts to 25 req/s from 5 s to 20 s' },
  outage: { id: 'outage', label: 'Model outage', diff: 'Medium returns errors from 8 s to 16 s' },
  malformed: {
    id: 'malformed',
    label: 'Malformed output',
    diff: '1 in 5 Medium replies misses a required field',
  },
};

export const gatewayScenarioOrder: GatewayScenarioId[] = ['noisy', 'outage', 'malformed'];

export const outcomeLabels: Record<Outcome, string> = {
  primary: 'Answered by Medium',
  cache: 'Answered from cache',
  fallback: 'Answered by Small (fallback)',
  handoff: 'Handed off: please try again',
  quota: 'Shed by quota (429, retry later)',
  rateLimited: 'Failed: shared rate limit',
  outage: 'Failed: model error',
  malformed: 'Failed: malformed reply',
};

export const outcomeOrder: Outcome[] = [
  'primary',
  'cache',
  'fallback',
  'handoff',
  'quota',
  'rateLimited',
  'outage',
  'malformed',
];

export const failureKinds: FailureKind[] = ['rateLimited', 'outage', 'malformed'];

/** Buckets count hundredths of a request so refills stay exact integers. */
const PERMIT = 100;
const perTick = (perSecond: number) => Math.round(perSecond * TICK_SECONDS * PERMIT);
const capacity = (perSecond: number) => Math.round(perSecond * BURST_SECONDS * PERMIT);

export function emptyTally(): TenantTally {
  return {
    arrived: 0,
    primary: 0,
    cache: 0,
    fallback: 0,
    handoff: 0,
    quota: 0,
    rateLimited: 0,
    outage: 0,
    malformed: 0,
    inFlight: 0,
  };
}

export function failedCount(tally: TenantTally): number {
  return tally.rateLimited + tally.outage + tally.malformed;
}

/** Requests that reached the customer as a real answer. */
export function answeredCount(tally: TenantTally): number {
  return tally.primary + tally.cache + tally.fallback;
}

/** Arrived requests should equal every outcome plus the ones still in flight. */
export function accountedFor(tally: TenantTally): number {
  return outcomeOrder.reduce((sum, outcome) => sum + tally[outcome], 0) + tally.inFlight;
}

function makeCall(id: string, tenant: TenantId, arrivalTick: number, rng: Rng): GatewayCall {
  const faq = rng() < FAQ_SHARE ? randomInt(rng, 0, FAQS_PER_TENANT - 1) : null;
  const mediumTicks = randomInt(rng, MEDIUM_TICKS[0], MEDIUM_TICKS[1]);
  const smallTicks = randomInt(rng, SMALL_TICKS[0], SMALL_TICKS[1]);
  const malformed: [boolean, boolean] = [rng() < MALFORMED_RATE, rng() < MALFORMED_RATE];
  return { id, tenant, arrivalTick, faq, mediumTicks, smallTicks, malformed };
}

/**
 * Arrivals per tick. Each store has its own seeded stream, so Store B sends
 * exactly the same requests in every scenario; the burst uses a separate one.
 */
export function buildArrivals(scenarioId: GatewayScenarioId, seed = GATEWAY_SEED): GatewayCall[][] {
  const ticks: GatewayCall[][] = Array.from({ length: RUN_TICKS }, () => []);
  for (const tenant of tenantOrder) {
    const arrivals = createRng(hashString(`${seed}:${tenant}:arrivals`));
    let count = 0;
    for (let tick = 0; tick < RUN_TICKS; tick += 1) {
      const n = poisson(arrivals, tenants[tenant].rate * TICK_SECONDS);
      for (let k = 0; k < n; k += 1) {
        const id = `${tenant}-${count + 1}`;
        ticks[tick]?.push(makeCall(id, tenant, tick, createRng(hashString(`${seed}:${id}`))));
        count += 1;
      }
    }
  }
  if (scenarioId === 'noisy') {
    const { tenant, extraRate, startTick, endTick } = NOISY_BURST;
    const burst = createRng(hashString(`${seed}:${tenant}:burst`));
    let count = 0;
    for (let tick = startTick; tick < endTick; tick += 1) {
      const n = poisson(burst, extraRate * TICK_SECONDS);
      for (let k = 0; k < n; k += 1) {
        const id = `${tenant}-burst-${count + 1}`;
        ticks[tick]?.push(makeCall(id, tenant, tick, createRng(hashString(`${seed}:${id}`))));
        count += 1;
      }
    }
  }
  ticks.forEach((calls, tick) => {
    shuffle(calls, createRng(hashString(`${seed}:${scenarioId}:${tick}:order`)));
  });
  return ticks;
}

export class GatewaySim {
  readonly scenario: GatewayScenario;
  readonly policies: boolean;
  readonly arrivals: GatewayCall[][];
  readonly tallies: Record<TenantId, TenantTally>;
  readonly events: GatewayEvent[] = [];
  /** Resolutions in order, newest last. */
  readonly resolutions: Resolution[] = [];
  /** Hops from the latest tick only, for drawing. */
  hops: GatewayHop[] = [];
  breaker: BreakerState = 'closed';
  breakerOpens = 0;
  retries = 0;
  private readonly cache = new Set<string>();
  private readonly quotaTokens: Record<TenantId, number>;
  private upstreamTokens = capacity(UPSTREAM_LIMIT);
  private pending: Pending[] = [];
  private tickCount = 0;
  private consecutiveErrors = 0;
  private openedTick = 0;
  private readonly seen = new Set<string>();

  constructor(scenarioId: GatewayScenarioId, policies: boolean, seed = GATEWAY_SEED) {
    this.scenario = gatewayScenarios[scenarioId];
    this.policies = policies;
    this.arrivals = buildArrivals(scenarioId, seed);
    this.tallies = { a: emptyTally(), b: emptyTally(), c: emptyTally() };
    this.quotaTokens = {
      a: capacity(tenants.a.quota),
      b: capacity(tenants.b.quota),
      c: capacity(tenants.c.quota),
    };
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= RUN_TICKS && this.pending.length === 0;
  }

  get seconds(): number {
    return this.tickCount * TICK_SECONDS;
  }

  /** Whether Medium is failing on the latest tick. */
  get primaryDown(): boolean {
    const tick = this.tickCount - 1;
    return this.scenario.id === 'outage' && tick >= OUTAGE.startTick && tick < OUTAGE.endTick;
  }

  get total(): TenantTally {
    const sum = emptyTally();
    for (const tenant of tenantOrder) {
      const tally = this.tallies[tenant];
      for (const key of Object.keys(sum) as (keyof TenantTally)[]) sum[key] += tally[key];
    }
    return sum;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    this.hops = [];
    this.refill();
    this.announce(tick);
    const finishing = this.pending.filter((p) => p.doneTick <= tick);
    this.pending = this.pending.filter((p) => p.doneTick > tick);
    for (const item of finishing) this.finish(item, tick);
    for (const call of this.arrivals[tick] ?? []) this.admit(call, tick);
    this.tickCount += 1;
    if (this.done) this.events.push({ tick: this.tickCount, text: this.wrapUp(), marker: false });
  }

  private refill(): void {
    if (this.tickCount === 0) return;
    this.upstreamTokens = Math.min(capacity(UPSTREAM_LIMIT), this.upstreamTokens + perTick(UPSTREAM_LIMIT));
    for (const tenant of tenantOrder) {
      const { quota } = tenants[tenant];
      this.quotaTokens[tenant] = Math.min(capacity(quota), this.quotaTokens[tenant] + perTick(quota));
    }
  }

  private announce(tick: number): void {
    const id = this.scenario.id;
    if (id === 'noisy' && tick === NOISY_BURST.startTick) {
      this.note(
        tick,
        `Store A starts a bulk backfill: about ${tenants.a.rate + NOISY_BURST.extraRate} requests per second for 15 s.`,
      );
    }
    if (id === 'noisy' && tick === NOISY_BURST.endTick) this.note(tick, 'Store A’s backfill ends.');
    if (id === 'outage' && tick === OUTAGE.startTick) this.note(tick, 'Medium starts returning errors.');
    if (id === 'outage' && tick === OUTAGE.endTick) this.note(tick, 'Medium is healthy again.');
  }

  private note(tick: number, text: string): void {
    this.events.push({ tick: tick + 1, text, marker: true });
  }

  private first(key: string, tick: number, text: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.note(tick, text);
  }

  private resolve(call: GatewayCall, tick: number, outcome: Outcome): void {
    const tally = this.tallies[call.tenant];
    tally[outcome] += 1;
    this.resolutions.push({ callId: call.id, tenant: call.tenant, tick, outcome });
  }

  private settle(call: GatewayCall, tick: number, outcome: Outcome): void {
    this.tallies[call.tenant].inFlight -= 1;
    this.resolve(call, tick, outcome);
  }

  private hop(call: GatewayCall, kind: GatewayHop['kind']): void {
    this.hops.push({ callId: call.id, tenant: call.tenant, kind });
  }

  private admit(call: GatewayCall, tick: number): void {
    const tally = this.tallies[call.tenant];
    tally.arrived += 1;
    const name = tenants[call.tenant].label;
    if (this.policies) {
      if (this.quotaTokens[call.tenant] < PERMIT) {
        this.resolve(call, tick, 'quota');
        this.hop(call, 'shed');
        this.first(
          `quota-${call.tenant}`,
          tick,
          `The gateway shed a ${name} request with a 429 and a retry-after hint: ${name} is over its quota of ${tenants[call.tenant].quota} requests per second.`,
        );
        return;
      }
      this.quotaTokens[call.tenant] -= PERMIT;
      if (call.faq !== null && this.cache.has(`${call.tenant}:${call.faq}`)) {
        this.resolve(call, tick, 'cache');
        this.hop(call, 'cacheHit');
        this.first(
          'cache',
          tick,
          `${name} asked a common question that Medium already answered for this store, so the response cache replied with no model call.`,
        );
        return;
      }
    }
    tally.inFlight += 1;
    this.route(call, tick);
  }

  private route(call: GatewayCall, tick: number): void {
    if (this.policies && this.breaker === 'open' && tick - this.openedTick >= BREAKER.coolDownTicks) {
      this.breaker = 'halfOpen';
      this.note(tick, 'The breaker goes half open: one probe request tries Medium again.');
      this.sendMedium(call, tick, 0, true);
      return;
    }
    if (this.policies && this.breaker !== 'closed') {
      this.sendSmall(call, tick);
      return;
    }
    this.sendMedium(call, tick, 0, false);
  }

  private sendMedium(call: GatewayCall, tick: number, attempt: 0 | 1, probe: boolean): void {
    if (this.upstreamTokens < PERMIT) {
      this.settle(call, tick, 'rateLimited');
      this.hop(call, 'failure');
      if (call.tenant !== 'a') {
        this.first(
          'rateLimited-other',
          tick,
          `A ${tenants[call.tenant].label} request failed with a 429 from the shared Medium rate limit. Store A’s backfill used up the limit for everyone.`,
        );
      }
      return;
    }
    this.upstreamTokens -= PERMIT;
    const erred = this.scenario.id === 'outage' && tick >= OUTAGE.startTick && tick < OUTAGE.endTick;
    const duration = erred ? OUTAGE.errorTicks : call.mediumTicks;
    this.pending.push({ call, tier: 'medium', doneTick: tick + duration, attempt, erred, probe });
    this.hop(call, attempt === 1 ? 'retry' : 'toMedium');
  }

  private sendSmall(call: GatewayCall, tick: number): void {
    this.pending.push({
      call,
      tier: 'small',
      doneTick: tick + call.smallTicks,
      attempt: 0,
      erred: false,
      probe: false,
    });
    this.hop(call, 'toSmall');
  }

  private finish(item: Pending, tick: number): void {
    const { call } = item;
    if (item.tier === 'small') {
      this.settle(call, tick, 'fallback');
      this.hop(call, 'fallbackAnswer');
      return;
    }
    if (item.erred) {
      this.onError(item, tick);
      return;
    }
    this.onSuccess(item, tick);
    if (this.scenario.id === 'malformed' && call.malformed[item.attempt]) {
      this.onMalformed(item, tick);
      return;
    }
    this.settle(call, tick, 'primary');
    this.hop(call, 'answer');
    if (this.policies && call.faq !== null) this.cache.add(`${call.tenant}:${call.faq}`);
  }

  private onError(item: Pending, tick: number): void {
    const { call } = item;
    if (!this.policies) {
      this.settle(call, tick, 'outage');
      this.hop(call, 'failure');
      this.first(
        'outage-fail',
        tick,
        `A ${tenants[call.tenant].label} request failed: Medium returned an error.`,
      );
      return;
    }
    if (item.probe) {
      this.breaker = 'open';
      this.openedTick = tick;
      this.breakerOpens += 1;
      this.note(tick, 'The probe failed, so the breaker opens again for another 3 s.');
    } else if (this.breaker === 'closed') {
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= BREAKER.threshold) {
        this.breaker = 'open';
        this.openedTick = tick;
        this.breakerOpens += 1;
        this.note(
          tick,
          `${BREAKER.threshold} errors in a row: the circuit breaker opens. New requests skip Medium and go straight to Small for 3 s.`,
        );
      }
    }
    this.first(
      'fallback',
      tick,
      `Medium returned an error, so the gateway sent the ${tenants[call.tenant].label} request to Small instead.`,
    );
    this.sendSmall(call, tick);
  }

  private onSuccess(item: Pending, tick: number): void {
    if (!this.policies) return;
    if (item.probe) {
      this.breaker = 'closed';
      this.consecutiveErrors = 0;
      this.note(tick, 'The probe succeeded, so the breaker closes and traffic returns to Medium.');
      return;
    }
    if (this.breaker === 'closed') this.consecutiveErrors = 0;
  }

  private onMalformed(item: Pending, tick: number): void {
    const { call } = item;
    if (!this.policies) {
      this.settle(call, tick, 'malformed');
      this.hop(call, 'failure');
      this.first(
        'malformed-fail',
        tick,
        `Medium’s reply to a ${tenants[call.tenant].label} refund request had no amount field. Nothing checked it, so the refund form broke.`,
      );
      return;
    }
    if (item.attempt === 0 && this.quotaTokens[call.tenant] >= PERMIT && this.upstreamTokens >= PERMIT) {
      this.quotaTokens[call.tenant] -= PERMIT;
      this.retries += 1;
      this.first(
        'retry',
        tick,
        'The validator rejected a reply with no amount field and retried once. The retry counts against the store’s quota.',
      );
      this.sendMedium(call, tick, 1, false);
      return;
    }
    this.settle(call, tick, 'handoff');
    this.hop(call, 'failure');
    this.first(
      'handoff',
      tick,
      item.attempt === 1
        ? 'The retry was malformed too, so the gateway sent a canned reply: “We could not finish this. Please try again or talk to an agent.”'
        : 'The store had no quota left for a retry, so the gateway sent the canned reply instead.',
    );
  }

  private wrapUp(): string {
    const b = this.tallies.b;
    const total = this.total;
    const lostB = failedCount(b) + b.quota + b.handoff;
    const lostAll = failedCount(total) + total.handoff;
    const intro = `Run complete: ${total.arrived.toLocaleString('en-US')} requests arrived.`;
    if (this.scenario.id === 'noisy') {
      return this.policies
        ? `${intro} Quotas shed ${this.tallies.a.quota} of Store A’s requests; Store B lost ${lostB} of ${b.arrived}.`
        : `${intro} The shared limit failed ${total.rateLimited} requests, including ${b.rateLimited} of Store B’s ${b.arrived}.`;
    }
    if (this.scenario.id === 'outage') {
      return this.policies
        ? `${intro} Small answered ${total.fallback} as the fallback, the breaker opened ${this.breakerOpens} times, and ${lostAll} failed.`
        : `${intro} ${total.outage} failed with a model error.`;
    }
    return this.policies
      ? `${intro} The validator caught bad replies and retried ${this.retries} times; ${total.handoff} customers got the canned handoff and none got a broken form.`
      : `${intro} ${total.malformed} malformed replies reached the refund form.`;
  }
}

/** A finished run, for prose and comparisons that only need the final tallies. */
export function finishedGateway(
  scenarioId: GatewayScenarioId,
  policies: boolean,
  seed = GATEWAY_SEED,
): GatewaySim {
  const sim = new GatewaySim(scenarioId, policies, seed);
  while (!sim.done) sim.step();
  return sim;
}

/* ---------- Response cache keys ---------- */

export type KeyField = 'tenant' | 'role' | 'promptVersion' | 'model' | 'settings';

export interface CacheRequest {
  step: number;
  /** What happens before this request, in plain words. */
  context: string;
  tenant: TenantId;
  role: 'customer' | 'agent';
  question: string;
  promptVersion: 'v3' | 'v4';
  model: 'Medium' | 'Small';
  settings: 'temp 0, prose' | 'temp 0, JSON';
  /** The answer a fresh model call would give: two requests match only if these match. */
  answerId: string;
  answer: string;
}

export type CacheOutcome = 'miss' | 'hit' | 'wrongHit';

export interface CacheStepResult {
  request: CacheRequest;
  key: string;
  outcome: CacheOutcome;
  /** The answer the customer receives. */
  served: string;
  /** For a wrong hit: the earlier request whose answer leaked, and the field that should have kept them apart. */
  from?: number;
  reason?: KeyField;
}

export const keyFieldOrder: KeyField[] = ['tenant', 'role', 'promptVersion', 'model', 'settings'];

export const keyFieldLabels: Record<KeyField, string> = {
  tenant: 'Store (tenant)',
  role: 'User role (permissions)',
  promptVersion: 'Prompt version',
  model: 'Model',
  settings: 'Settings (temperature, output format)',
};

export const wrongHitLabels: Record<KeyField, string> = {
  tenant: 'Leak: another store’s answer',
  role: 'Leak: an agent only note',
  promptVersion: 'Stale: an old prompt’s answer',
  model: 'Wrong model: the fallback’s answer',
  settings: 'Wrong format: prose where the form needs JSON',
};

const RETURNS = 'What is your return window?';
const SALE = 'Can I refund a sale item?';
const SHIPPING = 'Do you ship to Canada?';

export const cacheRequests: CacheRequest[] = [
  {
    step: 1,
    context: 'A Store A customer asks about returns.',
    tenant: 'a',
    role: 'customer',
    question: RETURNS,
    promptVersion: 'v3',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'a-returns-v3',
    answer: 'Store A accepts returns within 30 days.',
  },
  {
    step: 2,
    context: 'Another Store A customer asks the same thing.',
    tenant: 'a',
    role: 'customer',
    question: RETURNS,
    promptVersion: 'v3',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'a-returns-v3',
    answer: 'Store A accepts returns within 30 days.',
  },
  {
    step: 3,
    context: 'A Store B customer asks the same question.',
    tenant: 'b',
    role: 'customer',
    question: RETURNS,
    promptVersion: 'v3',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'b-returns-v3',
    answer: 'Store B accepts returns within 14 days.',
  },
  {
    step: 4,
    context: 'A Store A support agent asks about sale items.',
    tenant: 'a',
    role: 'agent',
    question: SALE,
    promptVersion: 'v3',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'a-sale-agent',
    answer: 'Sale items are final. Internal note: a manager can approve an exception.',
  },
  {
    step: 5,
    context: 'A Store A customer asks the same sale question.',
    tenant: 'a',
    role: 'customer',
    question: SALE,
    promptVersion: 'v3',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'a-sale-customer',
    answer: 'Sale items are final sale, except damaged items.',
  },
  {
    step: 6,
    context: 'Store A ships prompt v4 with its new 45 day policy. A customer asks about returns.',
    tenant: 'a',
    role: 'customer',
    question: RETURNS,
    promptVersion: 'v4',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'a-returns-v4',
    answer: 'Store A accepts returns within 45 days.',
  },
  {
    step: 7,
    context: 'Medium is down, so Small answers a Store A customer as the fallback.',
    tenant: 'a',
    role: 'customer',
    question: SHIPPING,
    promptVersion: 'v4',
    model: 'Small',
    settings: 'temp 0, prose',
    answerId: 'a-shipping-small',
    answer: 'Yes, we ship to Canada.',
  },
  {
    step: 8,
    context: 'Medium is back. Another Store A customer asks the same shipping question.',
    tenant: 'a',
    role: 'customer',
    question: SHIPPING,
    promptVersion: 'v4',
    model: 'Medium',
    settings: 'temp 0, prose',
    answerId: 'a-shipping-medium',
    answer: 'Yes. Canada orders arrive in 5 to 8 business days, and duties are paid at checkout.',
  },
  {
    step: 9,
    context: 'The Store A refund form asks about returns and needs JSON.',
    tenant: 'a',
    role: 'customer',
    question: RETURNS,
    promptVersion: 'v4',
    model: 'Medium',
    settings: 'temp 0, JSON',
    answerId: 'a-returns-v4-json',
    answer: '{"windowDays": 45}',
  },
];

const fieldValue = (request: CacheRequest, field: KeyField): string => {
  if (field === 'tenant') return `store-${request.tenant}`;
  return request[field];
};

export function cacheKey(request: CacheRequest, fields: readonly KeyField[]): string {
  const parts = keyFieldOrder
    .filter((field) => fields.includes(field))
    .map((field) => fieldValue(request, field));
  return [...parts, request.question].join(' | ');
}

/** Replays the fixture requests through an exact match response cache keyed on the chosen fields. */
export function runResponseCache(fields: readonly KeyField[], requests = cacheRequests): CacheStepResult[] {
  const stored = new Map<string, CacheRequest>();
  return requests.map((request) => {
    const key = cacheKey(request, fields);
    const cached = stored.get(key);
    if (!cached) {
      stored.set(key, request);
      return { request, key, outcome: 'miss', served: request.answer };
    }
    if (cached.answerId === request.answerId) {
      return { request, key, outcome: 'hit', served: cached.answer, from: cached.step };
    }
    const reason = keyFieldOrder.find((field) => fieldValue(cached, field) !== fieldValue(request, field));
    return { request, key, outcome: 'wrongHit', served: cached.answer, from: cached.step, reason };
  });
}

/* ---------- Prefix (KV) cache ---------- */

export const BLOCK_TOKENS = 16;
export type Segment = 'system' | 'policy' | 'timestamp' | 'question';

export const segmentTokens: Record<Segment, number> = {
  system: 160,
  policy: 192,
  timestamp: 12,
  question: 36,
};

export const segmentLabels: Record<Segment, string> = {
  system: 'System prompt',
  policy: 'Store policy',
  timestamp: 'Timestamp',
  question: 'Question',
};

/** Toy prefill timing for the time to first token. */
export const PREFIX_TIMING = {
  queueSeconds: 0.05,
  prefillSecondsPerToken: 0.000625,
  firstTokenSeconds: 0.05,
};

export interface PrefixOptions {
  /** The second request comes from the same store or another one. */
  secondStore: 'same' | 'other';
  timestampFirst: boolean;
  salt: boolean;
  prefixCache: boolean;
}

export interface PrefixBlock {
  index: number;
  /** The segment holding most of this block’s tokens. */
  segment: Segment;
  /** Every segment with tokens in this block, in prompt order. */
  segments: Segment[];
  reused: boolean;
}

export interface PrefixResult {
  blocks: PrefixBlock[];
  totalTokens: number;
  reusedBlocks: number;
  reusedTokens: number;
  computedTokens: number;
  ttftSeconds: number;
  coldTtftSeconds: number;
}

interface PromptSpec {
  store: TenantId;
  request: number;
  timestampFirst: boolean;
}

function promptTokens(spec: PromptSpec): { segment: Segment; token: string }[] {
  const order: Segment[] = spec.timestampFirst
    ? ['timestamp', 'system', 'policy', 'question']
    : ['system', 'policy', 'timestamp', 'question'];
  const variant: Record<Segment, string> = {
    system: 'shared',
    policy: `store-${spec.store}`,
    timestamp: `request-${spec.request}`,
    question: `request-${spec.request}`,
  };
  return order.flatMap((segment) =>
    Array.from({ length: segmentTokens[segment] }, (_, i) => ({
      segment,
      token: `${segment}:${variant[segment]}:${i}`,
    })),
  );
}

export function ttftFor(computedTokens: number): number {
  const { queueSeconds, prefillSecondsPerToken, firstTokenSeconds } = PREFIX_TIMING;
  return Math.round((queueSeconds + computedTokens * prefillSecondsPerToken + firstTokenSeconds) * 1e4) / 1e4;
}

/**
 * The first request (Store A) warms the cache; the second request reuses a
 * block only if it and every block before it match exactly, salt included.
 * Only full blocks are cached. The model still computes a fresh answer.
 */
export function prefixCacheResult(options: PrefixOptions): PrefixResult {
  const first = promptTokens({ store: 'a', request: 1, timestampFirst: options.timestampFirst });
  const second = promptTokens({
    store: options.secondStore === 'same' ? 'a' : 'b',
    request: 2,
    timestampFirst: options.timestampFirst,
  });
  const saltMatches = !options.salt || options.secondStore === 'same';
  const blockCount = Math.ceil(second.length / BLOCK_TOKENS);
  let chainIntact = options.prefixCache && saltMatches;
  const blocks: PrefixBlock[] = [];
  for (let index = 0; index < blockCount; index += 1) {
    const slice = second.slice(index * BLOCK_TOKENS, (index + 1) * BLOCK_TOKENS);
    const cachedSlice = first.slice(index * BLOCK_TOKENS, (index + 1) * BLOCK_TOKENS);
    const full = slice.length === BLOCK_TOKENS && cachedSlice.length === BLOCK_TOKENS;
    const same = full && slice.every((t, i) => t.token === cachedSlice[i]?.token);
    chainIntact = chainIntact && same;
    const counts = new Map<Segment, number>();
    for (const t of slice) counts.set(t.segment, (counts.get(t.segment) ?? 0) + 1);
    const segments = [...counts.keys()];
    const segment = segments.reduce((best, s) => ((counts.get(s) ?? 0) > (counts.get(best) ?? 0) ? s : best));
    blocks.push({ index, segment, segments, reused: chainIntact });
  }
  const reusedBlocks = blocks.filter((b) => b.reused).length;
  const reusedTokens = reusedBlocks * BLOCK_TOKENS;
  const computedTokens = second.length - reusedTokens;
  return {
    blocks,
    totalTokens: second.length,
    reusedBlocks,
    reusedTokens,
    computedTokens,
    ttftSeconds: ttftFor(computedTokens),
    coldTtftSeconds: ttftFor(second.length),
  };
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}
