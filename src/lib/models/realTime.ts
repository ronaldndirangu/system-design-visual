import { createRng, randomInt } from '../rng';

/**
 * Toy model of four ways a URL shortener dashboard can learn about new clicks.
 * Every number is illustrative: one minute of traffic, a fixed 100 ms one-way
 * network delay, and no server processing time. Times are integer milliseconds
 * so a click that lands on a poll boundary always resolves the same way.
 */

export const RT_DURATION_MS = 60_000;
export const RT_ONE_WAY_MS = 100;
export const RT_POLL_INTERVAL_MS = 5_000;
export const RT_LONG_POLL_TIMEOUT_MS = 25_000;
/** Simulated time per animation tick: 120 ticks cover the minute. */
export const RT_TICK_MS = 500;
export const RT_TICKS = RT_DURATION_MS / RT_TICK_MS;

export type RtTransportId = 'polling' | 'longPolling' | 'sse' | 'websocket';
export type RtScenarioId = 'quiet' | 'steady' | 'burst';

export const RT_TRANSPORTS: readonly RtTransportId[] = ['polling', 'longPolling', 'sse', 'websocket'];

export const rtTransportLabels: Record<RtTransportId, string> = {
  polling: 'Polling',
  longPolling: 'Long polling',
  sse: 'Server-sent events',
  websocket: 'WebSocket',
};

export const rtTransportShort: Record<RtTransportId, string> = {
  polling: 'Polling',
  longPolling: 'Long poll',
  sse: 'SSE',
  websocket: 'WebSocket',
};

export interface RtScenario {
  id: RtScenarioId;
  label: string;
  diff: string;
  seed: number;
}

export const rtScenarios: Record<RtScenarioId, RtScenario> = {
  quiet: { id: 'quiet', label: 'Quiet link', diff: '4 clicks in the minute', seed: 11 },
  steady: { id: 'steady', label: 'Steady link', diff: '20 clicks spread across the minute', seed: 23 },
  burst: {
    id: 'burst',
    label: 'Viral burst',
    diff: '3 scattered clicks, then 16 clicks between 30 s and 34 s',
    seed: 37,
  },
};

export interface RtClick {
  id: number;
  at: number;
}

export interface RtExchange {
  /** The dashboard sends the request (or opens the stream). */
  start: number;
  /** The request reaches the server. */
  serverAt: number;
  /** The server answers. For a stream this is the end of the run. */
  respondAt: number;
  /** The answer reaches the dashboard. */
  end: number;
  clickIds: number[];
  stream: boolean;
}

export interface RtDelivery {
  clickId: number;
  at: number;
  deliveredAt: number;
}

export interface RtPlan {
  transport: RtTransportId;
  exchanges: RtExchange[];
  /** One entry per click, in click order. */
  deliveries: RtDelivery[];
}

export interface RtTotals {
  requests: number;
  emptyResponses: number;
  clicks: number;
  delivered: number;
  waiting: number;
  meanDelayMs: number | null;
  maxDelayMs: number | null;
  heldMs: number;
}

/** Click times in 100 ms steps between 0.5 s and 54.5 s, sorted. */
export function makeClicks(scenarioId: RtScenarioId): RtClick[] {
  const scenario = rtScenarios[scenarioId];
  const rng = createRng(scenario.seed);
  const anywhere = () => randomInt(rng, 5, 545) * 100;
  let times: number[];
  if (scenarioId === 'quiet') times = Array.from({ length: 4 }, anywhere);
  else if (scenarioId === 'steady') times = Array.from({ length: 20 }, anywhere);
  else {
    const strays = Array.from({ length: 3 }, anywhere);
    const spike = Array.from({ length: 16 }, () => randomInt(rng, 300, 340) * 100);
    times = [...strays, ...spike];
  }
  return times.sort((a, b) => a - b).map((at, index) => ({ id: index + 1, at }));
}

function deliveriesFrom(exchanges: RtExchange[], clicks: RtClick[]): RtDelivery[] {
  const deliveredAt = new Map<number, number>();
  for (const exchange of exchanges) {
    for (const id of exchange.clickIds) {
      const click = clicks.find((candidate) => candidate.id === id);
      if (!click) continue;
      // A stream pushes each click the moment it happens, once the stream is open.
      const sent = exchange.stream ? Math.max(click.at, exchange.serverAt) + RT_ONE_WAY_MS : exchange.end;
      deliveredAt.set(id, sent);
    }
  }
  return clicks.map((click) => ({
    clickId: click.id,
    at: click.at,
    deliveredAt: deliveredAt.get(click.id) ?? Number.POSITIVE_INFINITY,
  }));
}

/** Ask every 5 s. Each answer carries whatever clicked since the last one, often nothing. */
function planPolling(clicks: RtClick[]): RtExchange[] {
  const exchanges: RtExchange[] = [];
  let next = 0;
  for (let start = 0; start < RT_DURATION_MS; start += RT_POLL_INTERVAL_MS) {
    const serverAt = start + RT_ONE_WAY_MS;
    const clickIds: number[] = [];
    while (next < clicks.length && (clicks[next]?.at ?? Number.POSITIVE_INFINITY) <= serverAt) {
      clickIds.push(clicks[next]?.id ?? 0);
      next += 1;
    }
    exchanges.push({
      start,
      serverAt,
      respondAt: serverAt,
      end: serverAt + RT_ONE_WAY_MS,
      clickIds,
      stream: false,
    });
  }
  return exchanges;
}

/**
 * The server holds each request until a click arrives or 25 s pass, then the
 * dashboard asks again at once. Clicks during the reconnect wait for the next request.
 */
function planLongPolling(clicks: RtClick[]): RtExchange[] {
  const exchanges: RtExchange[] = [];
  let next = 0;
  let start = 0;
  while (start < RT_DURATION_MS) {
    const serverAt = start + RT_ONE_WAY_MS;
    const upcoming = clicks[next]?.at;
    let respondAt = serverAt + RT_LONG_POLL_TIMEOUT_MS;
    if (upcoming !== undefined && upcoming <= respondAt) respondAt = Math.max(serverAt, upcoming);
    const clickIds: number[] = [];
    while (next < clicks.length && (clicks[next]?.at ?? Number.POSITIVE_INFINITY) <= respondAt) {
      clickIds.push(clicks[next]?.id ?? 0);
      next += 1;
    }
    const end = respondAt + RT_ONE_WAY_MS;
    exchanges.push({ start, serverAt, respondAt, end, clickIds, stream: false });
    start = end;
  }
  return exchanges;
}

/** One request opens a stream that stays open; each click is pushed as it happens. */
function planStream(clicks: RtClick[]): RtExchange[] {
  return [
    {
      start: 0,
      serverAt: RT_ONE_WAY_MS,
      respondAt: RT_DURATION_MS,
      end: RT_DURATION_MS,
      clickIds: clicks.map((click) => click.id),
      stream: true,
    },
  ];
}

export function planTransport(transport: RtTransportId, clicks: RtClick[]): RtPlan {
  const exchanges =
    transport === 'polling'
      ? planPolling(clicks)
      : transport === 'longPolling'
        ? planLongPolling(clicks)
        : planStream(clicks);
  return { transport, exchanges, deliveries: deliveriesFrom(exchanges, clicks) };
}

/** Everything the dashboard and server have seen by `now` (ms). */
export function totalsAt(plan: RtPlan, clicks: RtClick[], now: number): RtTotals {
  const started = plan.exchanges.filter((exchange) => exchange.start < now);
  const emptyResponses = started.filter(
    (exchange) => !exchange.stream && exchange.end <= now && exchange.clickIds.length === 0,
  ).length;
  const happened = clicks.filter((click) => click.at <= now).length;
  const arrived = plan.deliveries.filter((delivery) => delivery.deliveredAt <= now);
  const delays = arrived.map((delivery) => delivery.deliveredAt - delivery.at);
  const heldMs = started.reduce(
    (sum, exchange) => sum + Math.max(0, Math.min(exchange.respondAt, now) - exchange.serverAt),
    0,
  );
  return {
    requests: started.length,
    emptyResponses,
    clicks: happened,
    delivered: arrived.length,
    waiting: happened - arrived.length,
    meanDelayMs: delays.length === 0 ? null : delays.reduce((sum, delay) => sum + delay, 0) / delays.length,
    maxDelayMs: delays.length === 0 ? null : Math.max(...delays),
    heldMs,
  };
}

export interface RtRun {
  scenario: RtScenario;
  clicks: RtClick[];
  plans: Record<RtTransportId, RtPlan>;
}

/** All four transports replay the same pre-generated clicks. */
export function makeRun(scenarioId: RtScenarioId): RtRun {
  const clicks = makeClicks(scenarioId);
  const plans = Object.fromEntries(
    RT_TRANSPORTS.map((transport) => [transport, planTransport(transport, clicks)]),
  ) as Record<RtTransportId, RtPlan>;
  return { scenario: rtScenarios[scenarioId], clicks, plans };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
