import { createRng, createZipf, poisson, type Rng, randomInt } from '../rng';
import { SECONDS_PER_DAY } from './estimates';

/* Back of the envelope numbers. All illustrative. */

/** Label value counts for one request counter: endpoints, status codes, hosts, then users. */
export const LABEL_EXAMPLE = { endpoints: 20, statuses: 5, hosts: 50, users: 100_000 } as const;

/** Worst case: every combination of label values becomes its own series. */
export function seriesCount(cardinalities: readonly number[]): number {
  return cardinalities.reduce((product, values) => product * values, 1);
}

export const FLEET = {
  hosts: 10_000,
  seriesPerHost: 1_000,
  scrapeSeconds: 10,
  /** The Gorilla paper's average after delta of delta timestamps and XOR values. */
  bytesPerSample: 1.37,
  /** An 8 byte timestamp plus an 8 byte float, before compression. */
  rawBytesPerSample: 16,
  /** Index entry, label strings, and the open in-memory chunk. */
  bytesPerActiveSeries: 3_000,
} as const;

export function samplesPerSecond(series: number, scrapeSeconds: number): number {
  return series / scrapeSeconds;
}

export function bytesPerDay(perSecond: number, bytesPerSample: number): number {
  return perSecond * SECONDS_PER_DAY * bytesPerSample;
}

export function headMemoryBytes(series: number, bytesPerSeries: number = FLEET.bytesPerActiveSeries): number {
  return series * bytesPerSeries;
}

/* Downsampling and retention. */

export type TierId = 'raw' | 'minute' | 'hourly';

export interface RetentionTier {
  id: TierId;
  label: string;
  resolutionSeconds: number;
  retentionDays: number;
  /** Raw tiers keep one value; rollups keep min, max, sum, and count. */
  valuesPerPoint: number;
}

export const RETENTION_TIERS: readonly RetentionTier[] = [
  { id: 'raw', label: 'Raw, every 10 s', resolutionSeconds: 10, retentionDays: 7, valuesPerPoint: 1 },
  { id: 'minute', label: '1 min rollups', resolutionSeconds: 60, retentionDays: 30, valuesPerPoint: 4 },
  { id: 'hourly', label: '1 h rollups', resolutionSeconds: 3_600, retentionDays: 365, valuesPerPoint: 4 },
];

export type RangeId = 'hour' | 'day' | 'month' | 'year';

export const DASHBOARD_RANGES: Record<RangeId, { label: string; seconds: number }> = {
  hour: { label: '1 hour', seconds: 3_600 },
  day: { label: '1 day', seconds: SECONDS_PER_DAY },
  month: { label: '30 days', seconds: 30 * SECONDS_PER_DAY },
  year: { label: '1 year', seconds: 365 * SECONDS_PER_DAY },
};

const RAW_TIER = RETENTION_TIERS[0] as RetentionTier;
const COARSEST_TIER = RETENTION_TIERS[RETENTION_TIERS.length - 1] as RetentionTier;

/** The toy query planner: the finest tier that still holds the whole range. */
export function tierFor(rangeSeconds: number): RetentionTier {
  return (
    RETENTION_TIERS.find((tier) => tier.retentionDays * SECONDS_PER_DAY >= rangeSeconds) ?? COARSEST_TIER
  );
}

export function pointsScanned(rangeSeconds: number, tier: RetentionTier = tierFor(rangeSeconds)): number {
  return Math.ceil(rangeSeconds / tier.resolutionSeconds);
}

export function tierBytesPerSeries(
  tier: RetentionTier,
  bytesPerValue: number = FLEET.bytesPerSample,
): number {
  const points = (tier.retentionDays * SECONDS_PER_DAY) / tier.resolutionSeconds;
  return points * tier.valuesPerPoint * bytesPerValue;
}

/** Every tier keeps its own full window, so the newest week is stored three times. */
export function tieredBytesPerSeries(): number {
  return RETENTION_TIERS.reduce((sum, tier) => sum + tierBytesPerSeries(tier), 0);
}

/** Keeping raw 10 s samples for as long as the coarsest tier. */
export function rawOnlyBytesPerSeries(): number {
  return tierBytesPerSeries({ ...RAW_TIER, retentionDays: COARSEST_TIER.retentionDays });
}

/* Alert rules with a `for` duration. */

export const ALERT_THRESHOLD = 0.05;
export const ALERT_EVERY_SECONDS = 30;
/** The evaluation where the real checkout incident begins. */
export const ALERT_INCIDENT_INDEX = 13;

/** Checkout error rate at each evaluation: a spike, a one minute blip, then a real incident. */
export const ALERT_ERROR_RATES: readonly number[] = [
  0.012, 0.015, 0.011, 0.12, 0.014, 0.013, 0.016, 0.02, 0.07, 0.08, 0.065, 0.018, 0.014, 0.16, 0.21, 0.24,
  0.22, 0.25, 0.23, 0.26, 0.24, 0.22, 0.25, 0.23, 0.24, 0.22,
];

export type AlertState = 'ok' | 'pending' | 'firing';

export interface AlertRun {
  states: AlertState[];
  /** Evaluation indexes where the alert started firing and paged someone. */
  pages: number[];
  falsePages: number;
  /** Seconds from the incident's first bad evaluation to its page, or null if it never paged. */
  detectSeconds: number | null;
}

export function evaluateAlert(
  forSeconds: number,
  rates: readonly number[] = ALERT_ERROR_RATES,
  threshold = ALERT_THRESHOLD,
  everySeconds = ALERT_EVERY_SECONDS,
  incidentIndex = ALERT_INCIDENT_INDEX,
): AlertRun {
  const states: AlertState[] = [];
  const pages: number[] = [];
  let activeSince: number | null = null;
  for (const [index, rate] of rates.entries()) {
    if (rate <= threshold) {
      activeSince = null;
      states.push('ok');
      continue;
    }
    activeSince ??= index;
    if ((index - activeSince) * everySeconds >= forSeconds) {
      if (states.at(-1) !== 'firing') pages.push(index);
      states.push('firing');
    } else {
      states.push('pending');
    }
  }
  const realPage = pages.find((index) => index >= incidentIndex);
  return {
    states,
    pages,
    falsePages: pages.filter((index) => index < incidentIndex).length,
    detectSeconds: realPage === undefined ? null : (realPage - incidentIndex) * everySeconds,
  };
}

/* The cardinality duel: one request stream, two labeling policies, one toy ingester each. */

export const DUEL_SECONDS = 30;
export const DUEL_TICK_SECONDS = 0.5;
/** Toy per tenant series limit, in the style of a Mimir or Cortex ingester. */
export const SERIES_LIMIT = 1_000;
export const NEAR_LIMIT = SERIES_LIMIT * 0.8;
export const INCIDENT_SECONDS = 15;
export const CHECKOUT_FAIL_SHARE = 0.4;

export const ROUTES = [
  '/',
  '/search',
  '/product',
  '/cart',
  '/checkout',
  '/login',
  '/account',
  '/api/orders',
] as const;
const CHECKOUT = ROUTES.indexOf('/checkout');
export const HOSTS = 4;
const BOT_PREFIXES = ['/wp-admin/', '/admin/', '/backup/', '/cgi-bin/'];

export type Status = 200 | 404 | 500;

export interface ToyRequest {
  /** Null for anonymous scanner traffic. */
  user: number | null;
  /** Index into ROUTES, or null when the path matches no route. */
  route: number | null;
  path: string;
  status: Status;
  host: number;
}

export interface Workload {
  initialUsers: number;
  /** Mean new users per tick; each makes one request on arrival. */
  newUsersPerTick: number;
  /** Mean requests per tick from users who already arrived. */
  returningPerTick: number;
  botsPerTick: number;
  botStartSeconds: number;
}

export type CardinalityScenarioId = 'launch' | 'steady' | 'bots';

export interface CardinalityScenario {
  id: CardinalityScenarioId;
  label: string;
  diff: string;
  workload: Workload;
}

export const cardinalityScenarios: Record<CardinalityScenarioId, CardinalityScenario> = {
  launch: {
    id: 'launch',
    label: 'Launch day',
    diff: 'About 12 new users every half second, on top of 36 returning requests',
    workload: {
      initialUsers: 20,
      newUsersPerTick: 12,
      returningPerTick: 36,
      botsPerTick: 0,
      botStartSeconds: 0,
    },
  },
  steady: {
    id: 'steady',
    label: 'Steady traffic',
    diff: '40 regular users, a new one every few seconds',
    workload: {
      initialUsers: 40,
      newUsersPerTick: 0.2,
      returningPerTick: 20,
      botsPerTick: 0,
      botStartSeconds: 0,
    },
  },
  bots: {
    id: 'bots',
    label: 'Bot scan',
    diff: 'Steady users, plus a scanner probing 25 random paths every half second from 2 s',
    workload: {
      initialUsers: 40,
      newUsersPerTick: 0.2,
      returningPerTick: 20,
      botsPerTick: 25,
      botStartSeconds: 2,
    },
  },
};

export type LaneId = 'raw' | 'allowlist';

export interface NewSeries {
  labels: string;
  stored: boolean;
}

export interface CardinalityLane {
  id: LaneId;
  label: string;
  /** Series position in creation order, by label set. The ingester stores the first SERIES_LIMIT. */
  index: Map<string, number>;
  /** The three most recently created series, newest first. */
  newest: NewSeries[];
  samplesReceived: number;
  samplesStored: number;
  samplesRejected: number;
  checkoutErrors: number;
  checkoutErrorsCounted: number;
  checkoutSeries: number;
  /** Stored series after each tick. */
  series: number[];
}

export interface CardinalityEvent {
  tick: number;
  text: string;
  marker: boolean;
}

export interface CardinalitySummary {
  requests: number;
  exported: number;
  stored: number;
  memoryBytes: number;
  samplesReceived: number;
  samplesStored: number;
  samplesRejected: number;
  checkoutErrors: number;
  checkoutErrorsCounted: number;
  checkoutSeries: number;
}

function userName(user: number): string {
  return `u${1001 + user}`;
}

function seriesFor(lane: LaneId, request: ToyRequest): { key: string; labels: string } {
  const host = `h${request.host + 1}`;
  if (lane === 'raw') {
    const user = request.user === null ? 'anon' : userName(request.user);
    return {
      key: `${request.path}|${request.status}|${host}|${user}`,
      labels: `requests_total{path="${request.path}",status="${request.status}",host="${host}",user_id="${user}"}`,
    };
  }
  const route = request.route === null ? 'unmatched' : (ROUTES[request.route] ?? 'unmatched');
  return {
    key: `${route}|${request.status}|${host}`,
    labels: `requests_total{route="${route}",status="${request.status}",host="${host}"}`,
  };
}

function baseStatus(rng: Rng, route: number, incident: boolean): Status {
  if (incident && route === CHECKOUT && rng() < CHECKOUT_FAIL_SHARE) return 500;
  const roll = rng();
  if (roll < 0.01) return 500;
  if (roll < 0.04) return 404;
  return 200;
}

const pickRoute = createZipf(ROUTES.length, 1);

function createLane(id: LaneId, label: string): CardinalityLane {
  return {
    id,
    label,
    index: new Map(),
    newest: [],
    samplesReceived: 0,
    samplesStored: 0,
    samplesRejected: 0,
    checkoutErrors: 0,
    checkoutErrorsCounted: 0,
    checkoutSeries: 0,
    series: [],
  };
}

export const LANE_LABELS: Record<LaneId, string> = {
  raw: 'Raw labels',
  allowlist: 'Label allowlist',
};

export class CardinalityDuel {
  readonly scenario: CardinalityScenario;
  readonly length: number;
  readonly tickSeconds = DUEL_TICK_SECONDS;
  readonly lanes: [CardinalityLane, CardinalityLane];
  readonly events: CardinalityEvent[] = [];
  requests = 0;
  users: number;
  private readonly rng: Rng;
  private tickCount = 0;
  private readonly flags = new Set<string>();

  constructor(scenario: CardinalityScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(DUEL_SECONDS / DUEL_TICK_SECONDS);
    this.rng = createRng(seed);
    this.users = scenario.workload.initialUsers;
    this.lanes = [createLane('raw', LANE_LABELS.raw), createLane('allowlist', LANE_LABELS.allowlist)];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    const incidentTick = Math.round(INCIDENT_SECONDS / DUEL_TICK_SECONDS);
    if (tick === incidentTick) {
      this.events.push({
        tick,
        text: `Checkout starts failing: ${Math.round(CHECKOUT_FAIL_SHARE * 10)} in 10 checkout requests return 500, up from the background 1 in 100 on every route.`,
        marker: true,
      });
    }
    const requests = this.generate(tick, tick >= incidentTick);
    this.requests += requests.length;
    for (const lane of this.lanes) this.apply(lane, requests, tick);
    this.tickCount += 1;
    if (this.done) this.events.push({ tick: this.tickCount, text: this.closingNote(), marker: false });
  }

  private generate(tick: number, incident: boolean): ToyRequest[] {
    const { rng } = this;
    const workload = this.scenario.workload;
    const requests: ToyRequest[] = [];
    const visit = (user: number) => {
      const route = pickRoute(rng);
      requests.push({
        user,
        route,
        path: ROUTES[route] ?? '/',
        status: baseStatus(rng, route, incident),
        host: randomInt(rng, 0, HOSTS - 1),
      });
    };
    const arrivals = poisson(rng, workload.newUsersPerTick);
    for (let i = 0; i < arrivals; i += 1) {
      this.users += 1;
      visit(this.users - 1);
    }
    const returning = poisson(rng, workload.returningPerTick);
    for (let i = 0; i < returning; i += 1) visit(randomInt(rng, 0, this.users - 1));
    if (workload.botsPerTick > 0 && tick * DUEL_TICK_SECONDS >= workload.botStartSeconds) {
      const bots = poisson(rng, workload.botsPerTick);
      for (let i = 0; i < bots; i += 1) {
        const prefix = BOT_PREFIXES[randomInt(rng, 0, BOT_PREFIXES.length - 1)] ?? '/admin/';
        const suffix = randomInt(rng, 0, 36 ** 4 - 1)
          .toString(36)
          .padStart(4, '0');
        requests.push({
          user: null,
          route: null,
          path: `${prefix}${suffix}`,
          status: 404,
          host: randomInt(rng, 0, HOSTS - 1),
        });
      }
    }
    return requests;
  }

  private apply(lane: CardinalityLane, requests: ToyRequest[], tick: number): void {
    for (const request of requests) {
      const { key, labels } = seriesFor(lane.id, request);
      let position = lane.index.get(key);
      if (position === undefined) {
        position = lane.index.size;
        lane.index.set(key, position);
        const stored = position < SERIES_LIMIT;
        lane.newest = [{ labels, stored }, ...lane.newest].slice(0, 3);
        if (stored && request.route === CHECKOUT) lane.checkoutSeries += 1;
        if (position + 1 === NEAR_LIMIT) {
          this.once(
            `${lane.id}-near`,
            tick + 1,
            `${lane.label} passes ${formatInt(NEAR_LIMIT)} of ${formatInt(SERIES_LIMIT)} series.`,
          );
        }
        if (position === SERIES_LIMIT) {
          this.once(
            `${lane.id}-limit`,
            tick + 1,
            `${lane.label} hits the ${formatInt(SERIES_LIMIT)} series limit. The ingester now rejects every sample for a new series; older series keep working.`,
          );
        }
      }
      if (request.route === CHECKOUT && request.status === 500) {
        lane.checkoutErrors += 1;
        if (position < SERIES_LIMIT) lane.checkoutErrorsCounted += 1;
        else {
          const kind =
            tick < Math.round(INCIDENT_SECONDS / DUEL_TICK_SECONDS)
              ? 'checkout 500, a background error before the incident'
              : 'checkout 500';
          this.once(
            `${lane.id}-lost-checkout`,
            tick + 1,
            `${lane.label} drops its first ${kind}: the error landed in a new series past the limit, so no panel or alert can see it.`,
          );
        }
      }
    }
    // Every counter the app ever created is exported on every scrape.
    const exported = lane.index.size;
    const stored = Math.min(exported, SERIES_LIMIT);
    lane.samplesReceived += exported;
    lane.samplesStored += stored;
    lane.samplesRejected += exported - stored;
    lane.series.push(stored);
  }

  private once(flag: string, tick: number, text: string): void {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    this.events.push({ tick, text, marker: true });
  }

  private closingNote(): string {
    const [raw, allow] = this.lanes.map((lane) => summarize(lane)) as [
      CardinalitySummary,
      CardinalitySummary,
    ];
    const rawPart =
      raw.exported > SERIES_LIMIT
        ? `${LANE_LABELS.raw} created ${formatInt(raw.exported)} series, stored ${formatInt(raw.stored)}, and counted ${raw.checkoutErrorsCounted} of ${raw.checkoutErrors} checkout 500s.`
        : `${LANE_LABELS.raw} stayed under the limit with ${formatInt(raw.exported)} series, but it gained ${formatInt(raw.exported - (this.lanes[0].series[this.length / 2 - 1] ?? 0))} in the second half alone.`;
    return `Run over. ${rawPart} ${LANE_LABELS.allowlist} needed ${formatInt(allow.exported)} series and counted all ${allow.checkoutErrors} checkout 500s.`;
  }
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function summarize(lane: CardinalityLane, requests = 0): CardinalitySummary {
  const exported = lane.index.size;
  const stored = Math.min(exported, SERIES_LIMIT);
  return {
    requests,
    exported,
    stored,
    memoryBytes: headMemoryBytes(stored),
    samplesReceived: lane.samplesReceived,
    samplesStored: lane.samplesStored,
    samplesRejected: lane.samplesRejected,
    checkoutErrors: lane.checkoutErrors,
    checkoutErrorsCounted: lane.checkoutErrorsCounted,
    checkoutSeries: lane.checkoutSeries,
  };
}
