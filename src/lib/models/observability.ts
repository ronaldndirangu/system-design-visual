import { createRng, hashString, poisson, randomInt } from '../rng';

/**
 * A toy model of a small shop that emits logs, metrics, and traces. Requests
 * pass a gateway, an auth check, and an API that reads a cache and, on a miss
 * or a checkout, borrows a connection from a shared database pool. All
 * numbers are illustrative.
 *
 * The workload stream draws every request and every span length once, so all
 * scenarios replay the same requests. The pool and the samplers are
 * deterministic policies on top: the pool hands out connections first come,
 * first served, and samplers decide from a hash of the trace ID.
 */

export type Route = 'browse' | 'checkout';

export interface Span {
  id: string;
  parent: string | null;
  name: string;
  service: string;
  /** Milliseconds after the trace started. */
  start: number;
  duration: number;
  error?: string;
}

export interface Trace {
  id: string;
  index: number;
  route: Route;
  /** Milliseconds after the run started. */
  start: number;
  end: number;
  duration: number;
  status: 200 | 503;
  cacheHit: boolean;
  /** Time spent waiting for a database connection, when the request needed one. */
  poolWait: number | null;
  slowQuery: boolean;
  spans: Span[];
}

export interface LogLine {
  /** Milliseconds after the run started. */
  at: number;
  traceId: string;
  service: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface IncidentConfig {
  seconds: number;
  tickMs: number;
  /** Requests per second. */
  rate: number;
  checkoutShare: number;
  cacheHitRate: number;
  poolSize: number;
  poolTimeoutMs: number;
  /** When deploy v42 ships its unindexed checkout query, or null for no deploy. */
  deployAtMs: number | null;
  seed: number;
}

export const INCIDENT_DEFAULTS: IncidentConfig = {
  seconds: 60,
  tickMs: 100,
  rate: 40,
  checkoutShare: 0.25,
  cacheHitRate: 0.8,
  poolSize: 5,
  poolTimeoutMs: 1000,
  deployAtMs: 20_000,
  seed: 42,
};

export const SLOW_MS = 1000;
export const CHECKOUT_SLOW_MS = 500;

export interface TickPoint {
  arrived: number;
  completed: number;
  failed: number;
  inFlight: number;
  busy: number;
  waiters: number;
  browseRate: number;
  checkoutRate: number;
  browseErrors: number;
  checkoutErrors: number;
  browseP99: number;
  checkoutP99: number;
}

export interface IncidentEvent {
  tick: number;
  text: string;
  marker: boolean;
}

export interface IncidentResult {
  config: IncidentConfig;
  traces: Trace[];
  ticks: TickPoint[];
  events: IncidentEvent[];
}

interface Draw {
  start: number;
  route: Route;
  cacheHit: boolean;
  gateway: number;
  auth: number;
  cache: number;
  query: number;
  slowQuery: number;
  payments: number;
  render: number;
}

/** Draws every request from the workload stream. The same seed always gives the same list. */
function drawWorkload(config: IncidentConfig): Draw[] {
  const rng = createRng(config.seed);
  const draws: Draw[] = [];
  const ticks = Math.round((config.seconds * 1000) / config.tickMs);
  const mean = (config.rate * config.tickMs) / 1000;
  for (let tick = 0; tick < ticks; tick += 1) {
    const count = poisson(rng, mean);
    const offsets: number[] = [];
    for (let i = 0; i < count; i += 1) offsets.push(randomInt(rng, 0, config.tickMs - 1));
    offsets.sort((a, b) => a - b);
    for (const offset of offsets) {
      const route: Route = rng() < config.checkoutShare ? 'checkout' : 'browse';
      const hitRoll = rng();
      draws.push({
        start: tick * config.tickMs + offset,
        route,
        cacheHit: route === 'browse' && hitRoll < config.cacheHitRate,
        gateway: randomInt(rng, 1, 3),
        auth: randomInt(rng, 6, 14),
        cache: randomInt(rng, 1, 3),
        query: randomInt(rng, 20, 40),
        slowQuery: randomInt(rng, 380, 620),
        payments: randomInt(rng, 90, 160),
        render: randomInt(rng, 5, 15),
      });
    }
  }
  return draws;
}

export function traceIdFor(seed: number, index: number): string {
  const hash = hashString(`trace-${seed}-${index}`).toString(16).padStart(8, '0');
  return `${hash}${index.toString(16).padStart(4, '0')}`;
}

interface DbOp {
  index: number;
  at: number;
  wait: number;
  failed: boolean;
  query: number;
  slow: boolean;
}

/** First come, first served pool: each request takes the connection that frees up soonest. */
function runPool(draws: Draw[], config: IncidentConfig): Map<number, DbOp> {
  const ops = draws
    .map((draw, index) => ({ draw, index, at: draw.start + draw.gateway + draw.auth + draw.cache }))
    .filter(({ draw }) => draw.route === 'checkout' || !draw.cacheHit)
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const freeAt = new Array<number>(config.poolSize).fill(0);
  const result = new Map<number, DbOp>();
  for (const { draw, index, at } of ops) {
    let slot = 0;
    for (let i = 1; i < freeAt.length; i += 1) if ((freeAt[i] ?? 0) < (freeAt[slot] ?? 0)) slot = i;
    const wait = Math.max(0, (freeAt[slot] ?? 0) - at);
    const slow = draw.route === 'checkout' && config.deployAtMs !== null && at >= config.deployAtMs;
    const query = slow ? draw.slowQuery : draw.query;
    if (wait > config.poolTimeoutMs) {
      result.set(index, { index, at, wait: config.poolTimeoutMs, failed: true, query: 0, slow });
      continue;
    }
    freeAt[slot] = at + wait + query;
    result.set(index, { index, at, wait, failed: false, query, slow });
  }
  return result;
}

function buildTrace(draw: Draw, index: number, op: DbOp | undefined, seed: number): Trace {
  const id = traceIdFor(seed, index);
  const spans: Span[] = [];
  const add = (span: Omit<Span, 'id'>) => {
    const full = { ...span, id: `${id}-${spans.length + 1}` };
    spans.push(full);
    return full;
  };
  const root = add({ parent: null, name: `GET /${draw.route}`, service: 'gateway', start: 0, duration: 0 });
  let cursor = draw.gateway;
  add({ parent: root.id, name: 'auth.verify', service: 'auth', start: cursor, duration: draw.auth });
  cursor += draw.auth;
  const api = add({ parent: root.id, name: `api.${draw.route}`, service: 'api', start: cursor, duration: 0 });
  const apiStart = cursor;
  add({ parent: api.id, name: 'cache.get', service: 'cache', start: cursor, duration: draw.cache });
  cursor += draw.cache;
  let failed = false;
  if (op) {
    add({
      parent: api.id,
      name: 'db.pool.acquire',
      service: 'db',
      start: cursor,
      duration: op.wait,
      error: op.failed ? 'pool timeout' : undefined,
    });
    cursor += op.wait;
    failed = op.failed;
    if (!failed) {
      add({
        parent: api.id,
        name: draw.route === 'checkout' ? 'db.query orders' : 'db.query products',
        service: 'db',
        start: cursor,
        duration: op.query,
      });
      cursor += op.query;
    }
  }
  if (!failed && draw.route === 'checkout') {
    add({
      parent: api.id,
      name: 'payments.charge',
      service: 'payments',
      start: cursor,
      duration: draw.payments,
    });
    cursor += draw.payments;
  }
  api.duration = cursor - apiStart;
  if (failed) api.error = '503';
  if (!failed) {
    add({ parent: root.id, name: 'render', service: 'api', start: cursor, duration: draw.render });
    cursor += draw.render;
  }
  root.duration = cursor;
  if (failed) root.error = '503';
  return {
    id,
    index,
    route: draw.route,
    start: draw.start,
    end: draw.start + cursor,
    duration: cursor,
    status: failed ? 503 : 200,
    cacheHit: draw.cacheHit,
    poolWait: op ? op.wait : null,
    slowQuery: op?.slow ?? false,
    spans,
  };
}

function p99(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.99) - 1] ?? 0;
}

function measure(traces: Trace[], config: IncidentConfig): TickPoint[] {
  const ticks = Math.round((config.seconds * 1000) / config.tickMs);
  const intervals = traces.flatMap((trace) => {
    const acquire = trace.spans.find((span) => span.name === 'db.pool.acquire');
    if (!acquire) return [];
    const waitStart = trace.start + acquire.start;
    const waitEnd = waitStart + acquire.duration;
    const query = trace.spans.find((span) => span.name.startsWith('db.query'));
    return [{ waitStart, waitEnd, busyEnd: query ? waitEnd + query.duration : waitEnd }];
  });
  const byEnd = [...traces].sort((a, b) => a.end - b.end);
  const points: TickPoint[] = [];
  let arrived = 0;
  let completed = 0;
  let failed = 0;
  let windowStart = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const now = (tick + 1) * config.tickMs;
    while (arrived < traces.length && (traces[arrived]?.start ?? Infinity) < now) arrived += 1;
    while (completed < byEnd.length && (byEnd[completed]?.end ?? Infinity) <= now) {
      if (byEnd[completed]?.status === 503) failed += 1;
      completed += 1;
    }
    while (windowStart < completed && (byEnd[windowStart]?.end ?? Infinity) <= now - 1000) windowStart += 1;
    const recent = byEnd.slice(windowStart, completed);
    const browse = recent.filter((trace) => trace.route === 'browse');
    const checkout = recent.filter((trace) => trace.route === 'checkout');
    let busy = 0;
    let waiters = 0;
    for (const span of intervals) {
      if (span.waitStart <= now && now < span.waitEnd) waiters += 1;
      else if (span.waitEnd <= now && now < span.busyEnd) busy += 1;
    }
    points.push({
      arrived,
      completed,
      failed,
      inFlight: arrived - completed,
      busy,
      waiters,
      browseRate: browse.length,
      checkoutRate: checkout.length,
      browseErrors: browse.filter((trace) => trace.status === 503).length,
      checkoutErrors: checkout.filter((trace) => trace.status === 503).length,
      browseP99: p99(browse.map((trace) => trace.duration)),
      checkoutP99: p99(checkout.map((trace) => trace.duration)),
    });
  }
  return points;
}

function detectEvents(points: TickPoint[], config: IncidentConfig): IncidentEvent[] {
  const events: IncidentEvent[] = [];
  const deployTick = config.deployAtMs === null ? null : Math.round(config.deployAtMs / config.tickMs);
  const first = (test: (point: TickPoint) => boolean, from = 0) => {
    const tick = points.findIndex((point, index) => index >= from && test(point));
    return tick < 0 ? null : tick;
  };
  const found: { tick: number | null; text: string }[] = [
    { tick: deployTick, text: 'Deploy v42 ships: checkout now runs an unindexed orders query' },
    {
      tick: first((p) => p.checkoutP99 > CHECKOUT_SLOW_MS),
      text: `Checkout p99 passes ${CHECKOUT_SLOW_MS} ms`,
    },
    {
      tick: first((p) => p.busy === config.poolSize && p.waiters > 0),
      text: `Pool saturated: ${config.poolSize} of ${config.poolSize} connections busy, requests queue for one`,
    },
    {
      tick: first((p) => p.browseP99 > SLOW_MS),
      text: 'Browse p99 passes 1 s, though browse never runs the new query',
    },
    {
      tick: first((p) => p.failed > 0),
      text: '503s begin: requests give up after 1 s waiting for a connection',
    },
  ];
  for (const event of found) {
    if (event.tick !== null) events.push({ tick: event.tick, text: event.text, marker: true });
  }
  events.sort((a, b) => a.tick - b.tick);
  return events;
}

export function simulateIncident(overrides: Partial<IncidentConfig> = {}): IncidentResult {
  const config = { ...INCIDENT_DEFAULTS, ...overrides };
  const draws = drawWorkload(config);
  const ops = runPool(draws, config);
  const traces = draws.map((draw, index) => buildTrace(draw, index, ops.get(index), config.seed));
  const ticks = measure(traces, config);
  return { config, traces, ticks, events: detectEvents(ticks, config) };
}

export type IncidentId = 'deploy' | 'noDeploy' | 'biggerPool';

export interface IncidentScenario {
  id: IncidentId;
  label: string;
  diff: string;
  overrides: Partial<IncidentConfig>;
}

export const incidentScenarios: Record<IncidentId, IncidentScenario> = {
  deploy: {
    id: 'deploy',
    label: 'Deploy v42 at 20 s',
    diff: 'Checkout query: 30 to 500 ms',
    overrides: {},
  },
  noDeploy: {
    id: 'noDeploy',
    label: 'No deploy',
    diff: 'Checkout query: stays 30 ms',
    overrides: { deployAtMs: null },
  },
  biggerPool: {
    id: 'biggerPool',
    label: 'Deploy v42, bigger pool',
    diff: 'Pool: 5 to 12 connections',
    overrides: { poolSize: 12 },
  },
};

/** Reveals a precomputed incident one tick at a time, so Play, Skip, and Reset all agree. */
export class IncidentRun {
  readonly scenario: IncidentScenario;
  readonly result: IncidentResult;
  readonly length: number;
  readonly tickSeconds: number;
  private tickCount = 0;

  constructor(scenario: IncidentScenario, seed = 42) {
    this.scenario = scenario;
    this.result = simulateIncident({ ...scenario.overrides, seed });
    this.length = this.result.ticks.length;
    this.tickSeconds = this.result.config.tickMs / 1000;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step() {
    if (!this.done) this.tickCount += 1;
  }

  /** The latest measured point, or null before the first tick. */
  get current(): TickPoint | null {
    return this.result.ticks[this.tickCount - 1] ?? null;
  }

  series(pick: (point: TickPoint) => number): number[] {
    return this.result.ticks.slice(0, this.tickCount).map(pick);
  }

  get events(): IncidentEvent[] {
    const shown = this.result.events.filter((event) => event.tick < this.tickCount);
    if (!this.done) return shown;
    const end = this.result.ticks.at(-1);
    if (!end) return shown;
    const share = end.completed > 0 ? Math.round((end.failed / end.completed) * 100) : 0;
    return [
      ...shown,
      {
        tick: this.length,
        text: `Run complete: ${end.completed} requests finished, ${end.failed} failed with 503 (${share}%).`,
        marker: false,
      },
    ];
  }
}

/**
 * Time a span spends outside its children: its duration minus the time its
 * children cover. Parallel children overlap, so they count once, as a union.
 */
export function selfTime(trace: Trace, span: Span): number {
  const end = span.start + span.duration;
  const covered = trace.spans
    .filter((child) => child.parent === span.id)
    .map((child) => [Math.max(span.start, child.start), Math.min(end, child.start + child.duration)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reached = span.start;
  for (const [from, to] of covered) {
    if (to <= reached) continue;
    total += to - Math.max(from, reached);
    reached = to;
  }
  return Math.max(0, span.duration - total);
}

export function slowestSelfSpan(trace: Trace): Span {
  let best = trace.spans[0] as Span;
  for (const span of trace.spans) if (selfTime(trace, span) > selfTime(trace, best)) best = span;
  return best;
}

export function depthOf(trace: Trace, span: Span): number {
  let depth = 0;
  let parent = span.parent;
  while (parent) {
    depth += 1;
    parent = trace.spans.find((candidate) => candidate.id === parent)?.parent ?? null;
  }
  return depth;
}

export type ExemplarId = 'typical' | 'slowCheckout' | 'slowBrowse' | 'failedBrowse';

export interface Exemplar {
  id: ExemplarId;
  label: string;
  diff: string;
  trace: Trace;
}

/** Picks four teaching traces from the deploy run by fixed rules, so the picks never drift. */
export function findExemplars(result: IncidentResult): Record<ExemplarId, Exemplar> {
  const deployAt = result.config.deployAtMs ?? 0;
  const traces = result.traces;
  const pick = (test: (trace: Trace) => boolean) => traces.find(test) ?? (traces[0] as Trace);
  const typical = pick((t) => t.route === 'checkout' && t.start >= 5000 && t.status === 200);
  const slowCheckout = pick(
    (t) => t.route === 'checkout' && t.slowQuery && t.status === 200 && (t.poolWait ?? 0) < 20,
  );
  const slowBrowse = pick(
    (t) =>
      t.route === 'browse' && t.start >= deployAt + 15_000 && t.status === 200 && (t.poolWait ?? 0) > 700,
  );
  const failedBrowse = pick((t) => t.route === 'browse' && t.start >= deployAt + 15_000 && t.status === 503);
  const at = (trace: Trace) => `${(trace.start / 1000).toFixed(1)} s`;
  return {
    typical: {
      id: 'typical',
      label: 'Before the deploy',
      diff: `checkout at ${at(typical)}`,
      trace: typical,
    },
    slowCheckout: {
      id: 'slowCheckout',
      label: 'Right after the deploy',
      diff: `checkout at ${at(slowCheckout)}`,
      trace: slowCheckout,
    },
    slowBrowse: {
      id: 'slowBrowse',
      label: 'Slow browse',
      diff: `browse at ${at(slowBrowse)}`,
      trace: slowBrowse,
    },
    failedBrowse: {
      id: 'failedBrowse',
      label: 'Failed browse',
      diff: `503 at ${at(failedBrowse)}`,
      trace: failedBrowse,
    },
  };
}

/** The log lines one trace writes, each tagged with its trace ID as the correlation ID. */
export function logsFor(trace: Trace, poolSize: number): LogLine[] {
  const lines: LogLine[] = [];
  const log = (offset: number, service: string, level: LogLine['level'], message: string) =>
    lines.push({ at: trace.start + offset, traceId: trace.id, service, level, message });
  const path = `/${trace.route}`;
  log(0, 'gateway', 'info', `GET ${path} received`);
  for (const span of trace.spans) {
    const done = span.start + span.duration;
    switch (span.name) {
      case 'auth.verify':
        log(done, 'auth', 'info', `token ok in ${span.duration} ms`);
        break;
      case 'cache.get':
        log(done, 'api', 'info', trace.cacheHit ? 'cache hit' : 'cache miss, reading the database');
        break;
      case 'db.pool.acquire':
        if (span.error) {
          log(
            done,
            'db',
            'error',
            `gave up after ${span.duration} ms waiting for a connection (${poolSize} of ${poolSize} busy)`,
          );
        } else if (span.duration >= 50) {
          log(
            done,
            'db',
            'warn',
            `waited ${span.duration} ms for a connection (${poolSize} of ${poolSize} busy)`,
          );
        }
        break;
      case 'db.query orders':
        if (trace.slowQuery) {
          log(done, 'db', 'warn', `slow query ${span.duration} ms: orders by customer_id, no index (v42)`);
        } else {
          log(done, 'db', 'info', `orders query ${span.duration} ms`);
        }
        break;
      case 'db.query products':
        log(done, 'db', 'info', `products query ${span.duration} ms`);
        break;
      case 'payments.charge':
        log(done, 'payments', 'info', `charge approved in ${span.duration} ms`);
        break;
    }
  }
  log(
    trace.duration,
    'gateway',
    trace.status === 503 ? 'error' : 'info',
    `${trace.status} GET ${path} in ${trace.duration} ms`,
  );
  return lines;
}

/** Every log line written while the given trace ran, from all requests, in time order. */
export function logsDuring(result: IncidentResult, trace: Trace, limit = 40): LogLine[] {
  const lines = result.traces
    .filter((other) => other.start <= trace.end && other.end >= trace.start)
    .flatMap((other) => logsFor(other, result.config.poolSize))
    .filter((line) => line.at >= trace.start && line.at <= trace.end)
    .sort((a, b) => a.at - b.at || a.traceId.localeCompare(b.traceId));
  if (lines.length <= limit) return lines;
  const own = new Set(lines.filter((line) => line.traceId === trace.id));
  const others = lines.filter((line) => line.traceId !== trace.id).slice(0, limit - own.size);
  const keep = new Set([...own, ...others]);
  return lines.filter((line) => keep.has(line));
}

/**
 * Both samplers spend the same budget, a share of all requests. Head sampling spends it as a coin flip at the start.
 * Tail sampling spends it as a quota per decision window: failed traces first, then slow ones, then ordinary ones.
 */
export type SamplerConfig =
  | { kind: 'head'; rate: number }
  | { kind: 'tail'; budget: number; slowMs: number; decisionWaitMs: number; windowMs: number };

export function samplerBudget(sampler: SamplerConfig): number {
  return sampler.kind === 'head' ? sampler.rate : sampler.budget;
}

export function describeSampler(sampler: SamplerConfig): string {
  const percent = `${Math.round(samplerBudget(sampler) * 100)}%`;
  return sampler.kind === 'head' ? `Head sampling, ${percent}` : `Tail sampling, ${percent}, errors first`;
}

/** A hash of the trace ID, so every service and both samplers agree on the same coin flip. */
export function sampleRoll(traceId: string): number {
  return (hashString(traceId) % 10_000) / 10_000;
}

export interface SamplingDecision {
  /** The request start for head sampling; the close of the trace's decision window for tail sampling. */
  at: number;
  kept: boolean;
}

/** Decides every trace in the run once. Tail sampling keeps the run total at the budget, rounded down. */
export function decideSampling(sampler: SamplerConfig, traces: Trace[]): SamplingDecision[] {
  if (sampler.kind === 'head') {
    return traces.map((trace) => ({ at: trace.start, kept: sampleRoll(trace.id) < sampler.rate }));
  }
  const { budget, decisionWaitMs, slowMs, windowMs } = sampler;
  const decisions = traces.map((trace) => ({
    at: (Math.floor((trace.end + decisionWaitMs) / windowMs) + 1) * windowMs,
    kept: false,
  }));
  const windows = new Map<
    number,
    { decision: SamplingDecision; rank: number; roll: number; index: number }[]
  >();
  traces.forEach((trace, index) => {
    const decision = decisions[index] as SamplingDecision;
    const rank = trace.status === 503 ? 0 : trace.duration > slowMs ? 1 : 2;
    const members = windows.get(decision.at) ?? [];
    members.push({ decision, rank, roll: sampleRoll(trace.id), index });
    windows.set(decision.at, members);
  });
  let decided = 0;
  let kept = 0;
  for (const at of [...windows.keys()].sort((a, b) => a - b)) {
    const members = windows.get(at) ?? [];
    decided += members.length;
    // Unused fractions of a slot carry into the next window, so the whole run keeps the budget, rounded down.
    const slots = Math.floor(budget * decided + 1e-9) - kept;
    members.sort((a, b) => a.rank - b.rank || a.roll - b.roll || a.index - b.index);
    for (const member of members.slice(0, slots)) member.decision.kept = true;
    kept += slots;
  }
  return decisions;
}

export interface SamplingTotals {
  completed: number;
  /** Finished requests whose tail sampler is still waiting for late spans before it decides. */
  pending: number;
  kept: number;
  dropped: number;
  errors: number;
  errorsKept: number;
  slow: number;
  slowKept: number;
  baselineKept: number;
  /** Failed or slow requests dropped: by the coin flip for head sampling, by a full budget for tail sampling. */
  missed: number;
  spansStored: number;
  buffered: number;
  peakBuffered: number;
}

export type SamplingDuelId = 'incident' | 'quiet' | 'budget';

export interface SamplingScenario {
  id: SamplingDuelId;
  label: string;
  diff: string;
  incident: Partial<IncidentConfig>;
  lanes: [SamplerConfig, SamplerConfig];
  chart: 'errorsKept' | 'kept';
}

const TAIL = { kind: 'tail', slowMs: SLOW_MS, decisionWaitMs: 2000, windowMs: 1000 } as const;

export const samplingScenarios: Record<SamplingDuelId, SamplingScenario> = {
  incident: {
    id: 'incident',
    label: 'Incident day',
    diff: 'Deploy v42 at 20 s, 503s appear',
    incident: {},
    lanes: [
      { kind: 'head', rate: 0.1 },
      { ...TAIL, budget: 0.1 },
    ],
    chart: 'errorsKept',
  },
  quiet: {
    id: 'quiet',
    label: 'Quiet day',
    diff: 'Deploy: v42 to none',
    incident: { deployAtMs: null },
    lanes: [
      { kind: 'head', rate: 0.1 },
      { ...TAIL, budget: 0.1 },
    ],
    chart: 'kept',
  },
  budget: {
    id: 'budget',
    label: 'Tight budget',
    diff: 'Budget: 10% to 1%',
    incident: {},
    lanes: [
      { kind: 'head', rate: 0.01 },
      { ...TAIL, budget: 0.01 },
    ],
    chart: 'errorsKept',
  },
};

/** Totals for one sampler at a moment in the run. Head sampling decides at the start, so it buffers nothing. */
export function samplingTotals(
  sampler: SamplerConfig,
  traces: Trace[],
  now: number,
  decisions: SamplingDecision[] = decideSampling(sampler, traces),
): SamplingTotals {
  const totals: SamplingTotals = {
    completed: 0,
    pending: 0,
    kept: 0,
    dropped: 0,
    errors: 0,
    errorsKept: 0,
    slow: 0,
    slowKept: 0,
    baselineKept: 0,
    missed: 0,
    spansStored: 0,
    buffered: 0,
    peakBuffered: 0,
  };
  traces.forEach((trace, index) => {
    const decision = decisions[index] ?? { at: trace.start, kept: false };
    if (sampler.kind === 'tail' && trace.start < now && now < decision.at) {
      totals.buffered += trace.spans.length;
    }
    if (trace.end > now) return;
    totals.completed += 1;
    const error = trace.status === 503;
    const slow = !error && trace.duration > SLOW_MS;
    if (error) totals.errors += 1;
    if (slow) totals.slow += 1;
    if (decision.at > now) {
      totals.pending += 1;
      return;
    }
    if (!decision.kept) {
      totals.dropped += 1;
      if (error || slow) totals.missed += 1;
      return;
    }
    totals.kept += 1;
    totals.spansStored += trace.spans.length;
    if (error) totals.errorsKept += 1;
    else if (slow) totals.slowKept += 1;
    else totals.baselineKept += 1;
  });
  return totals;
}

/** Two samplers watching the identical stream of finished traces. */
export class SamplingRun {
  readonly scenario: SamplingScenario;
  readonly result: IncidentResult;
  readonly length: number;
  readonly tickSeconds: number;
  readonly series: [number[], number[]] = [[], []];
  readonly peaks: [number, number] = [0, 0];
  readonly events: IncidentEvent[] = [];
  private tickCount = 0;
  private latest: [SamplingTotals, SamplingTotals];
  private readonly decisions: [SamplingDecision[], SamplingDecision[]];
  private seenError = false;
  private readonly firstKept = [false, false];

  constructor(scenario: SamplingScenario, seed = 42) {
    this.scenario = scenario;
    this.result = simulateIncident({ ...scenario.incident, seed });
    this.length = this.result.ticks.length;
    this.tickSeconds = this.result.config.tickMs / 1000;
    this.decisions = [
      decideSampling(scenario.lanes[0], this.result.traces),
      decideSampling(scenario.lanes[1], this.result.traces),
    ];
    this.latest = this.totalsAt(0);
  }

  private totalsAt(now: number): [SamplingTotals, SamplingTotals] {
    const lanes = this.scenario.lanes;
    return [
      samplingTotals(lanes[0], this.result.traces, now, this.decisions[0]),
      samplingTotals(lanes[1], this.result.traces, now, this.decisions[1]),
    ];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  get labels(): [string, string] {
    return [describeSampler(this.scenario.lanes[0]), describeSampler(this.scenario.lanes[1])];
  }

  totals(): [SamplingTotals, SamplingTotals] {
    return [
      { ...this.latest[0], peakBuffered: this.peaks[0] },
      { ...this.latest[1], peakBuffered: this.peaks[1] },
    ];
  }

  step() {
    if (this.done) return;
    const tick = this.tickCount;
    // The last tick drains the run, so tail sampling decides every trace it still holds.
    const now = tick + 1 >= this.length ? Number.POSITIVE_INFINITY : (tick + 1) * this.result.config.tickMs;
    this.latest = this.totalsAt(now);
    const deployAt = this.result.config.deployAtMs;
    if (deployAt !== null && tick === Math.round(deployAt / this.result.config.tickMs)) {
      this.events.push({ tick, text: 'Deploy v42 ships', marker: true });
    }
    this.latest.forEach((totals, index) => {
      this.peaks[index as 0 | 1] = Math.max(this.peaks[index as 0 | 1], totals.buffered);
      this.series[index as 0 | 1].push(this.scenario.chart === 'kept' ? totals.kept : totals.errorsKept);
      if (totals.errors > 0 && !this.seenError) {
        this.seenError = true;
        this.events.push({ tick, text: 'First failed request finishes', marker: true });
      }
      if (totals.errorsKept > 0 && !this.firstKept[index]) {
        this.firstKept[index] = true;
        const name = this.scenario.lanes[index]?.kind === 'head' ? 'Head' : 'Tail';
        this.events.push({ tick, text: `${name} sampling keeps its first failed trace`, marker: true });
      }
    });
    this.tickCount += 1;
    if (this.done) {
      const [a, b] = this.totals();
      const note =
        a.errors === 0 && a.slow === 0
          ? `Both spent the budget on ordinary traces: head kept ${a.kept}, tail kept ${b.kept}. Tail sampling still held up to ${b.peakBuffered} spans in memory while it waited to decide.`
          : `Same budget: head kept ${a.kept} traces, tail kept ${b.kept}. Head kept ${a.errorsKept} of ${a.errors} failed requests; tail kept ${b.errorsKept} of ${b.errors}. ${b.missed} failed or slow requests overflowed the tail budget.`;
      this.events.push({ tick: this.length, text: note, marker: false });
    }
  }
}
