import { createRng, createZipf, type Rng, type SeededRng } from '../rng';
import { type ModelAdapter, type ScheduledCommand, stepScheduled } from './adapter';

/**
 * A toy model of a CDN in front of the URL shortener. People in five cities
 * click short links served from one origin in Virginia. Latency comes only
 * from distance: light in fiber, a fixed number of round trips per fresh
 * click, and a small fixed server time. Real networks add last mile delay,
 * routing detours, and queues; this model leaves them out so distance stands
 * alone. All distances and shares are illustrative.
 */

/** Light in fiber covers about 200 km each millisecond, one way. */
export const FIBER_KM_PER_MS = 200;
/** A fresh HTTPS click pays three round trips: TCP, TLS 1.3, then the request. DNS is left out. */
export const FRESH_CLICK_RTTS = 3;
/** Work time at whichever server answers the click. */
export const SERVER_MS = 2;
/** Distance from people to the edge server in their own city. */
export const EDGE_KM = 50;
/** Distance from the origin shield to the origin. */
export const SHIELD_KM = 50;
/** Length of every run, in seconds. */
export const CDN_SECONDS = 20;
/** How many clicks the rolling chart window covers. */
const WINDOW_TICKS = 10;

export interface City {
  name: string;
  /** Straight-line distance to the origin in Virginia. */
  km: number;
  /** Share of all clicks that come from this city. */
  share: number;
}

/** Straight-line distances from an origin in Virginia. Illustrative. */
export const CITIES: readonly City[] = [
  { name: 'New York', km: 350, share: 0.3 },
  { name: 'London', km: 5900, share: 0.25 },
  { name: 'São Paulo', km: 7600, share: 0.15 },
  { name: 'Tokyo', km: 10900, share: 0.15 },
  { name: 'Sydney', km: 15700, share: 0.15 },
];

/** One round trip over fiber, in milliseconds. */
export function rttMs(km: number): number {
  return (2 * km) / FIBER_KM_PER_MS;
}

/**
 * Where a click was answered.
 * direct: the origin, with no CDN in the way.
 * edge-hit: the edge in the person's city.
 * shield-hit: the origin shield, after an edge miss.
 * edge-miss: the origin, after an edge miss (and a shield miss when a shield exists).
 */
export type ClickPath = 'direct' | 'edge-hit' | 'shield-hit' | 'edge-miss';

/**
 * Toy latency of one fresh click. TCP and TLS end at the edge near the
 * person, and the edge reuses a warm connection to the origin, so an edge
 * miss pays the long distance once instead of three times.
 */
export function clickLatencyMs(path: ClickPath, km: number, shield = false): number {
  const nearby = FRESH_CLICK_RTTS * rttMs(EDGE_KM);
  switch (path) {
    case 'direct':
      return FRESH_CLICK_RTTS * rttMs(km) + SERVER_MS;
    case 'edge-hit':
      return nearby + SERVER_MS;
    case 'shield-hit':
      return nearby + rttMs(km) + SERVER_MS;
    case 'edge-miss':
      return nearby + rttMs(km) + (shield ? rttMs(SHIELD_KM) : 0) + SERVER_MS;
  }
}

export interface CdnConfig {
  /** True when edge servers sit in front of the origin. */
  cdn: boolean;
  links: number;
  /** Zipf exponent for link popularity. Around 1 means a few links get most clicks. */
  zipfExponent: number;
  clicksPerTick: number;
  /** How long an edge or shield may reuse a cached redirect. */
  ttlSeconds: number;
  shield: boolean;
  /** Edges log the clicks they answer and ship the log to the origin counter. */
  edgeLogs: boolean;
  logShipSeconds: number;
  /** Every click opens a link nobody has clicked before. */
  newLinks: boolean;
  tickSeconds: number;
  seed: number;
}

export const defaultCdnConfig: CdnConfig = {
  cdn: true,
  links: 1000,
  zipfExponent: 1,
  clicksPerTick: 20,
  ttlSeconds: 60,
  shield: false,
  edgeLogs: false,
  logShipSeconds: 5,
  newLinks: false,
  tickSeconds: 0.1,
  seed: 42,
};

export type CdnCommand = { type: 'purge' };

export interface CdnSample {
  city: number;
  path: ClickPath;
  ms: number;
}

export interface CdnTick {
  clicks: number;
  edgeHits: number;
  shieldHits: number;
  originServed: number;
  /** Sum of click latencies in this tick, in milliseconds. */
  latencyMs: number;
  /** Logged clicks the edges delivered to the counter at the end of this tick. */
  shipped: number;
  /** The first few clicks of the tick, for drawing. */
  samples: CdnSample[];
}

export interface CdnTotals {
  arrived: number;
  edgeHits: number;
  shieldHits: number;
  originServed: number;
  /** Clicks the origin's counter knows about. */
  counted: number;
  /** Clicks sitting in edge logs that have not shipped yet. */
  pending: number;
  /** Clicks answered by the CDN with no log, so the counter never sees them. */
  uncounted: number;
  latencyMs: number;
}

export interface CityStats {
  clicks: number;
  edgeHits: number;
  latencyMs: number;
  last: ClickPath | null;
}

interface CdnState {
  ticks: number;
  nextLink: number;
  totals: CdnTotals;
  cities: CityStats[];
  /** Per city: link to the tick its cached copy expires. */
  edges: Map<number, number>[];
  shieldCache: Map<number, number>;
  latencies: number[];
}

export interface CdnCheckpoint {
  config: CdnConfig;
  state: CdnState;
  rngState: number;
}

const SAMPLES_PER_TICK = 3;

function freshState(): CdnState {
  return {
    ticks: 0,
    nextLink: 0,
    totals: {
      arrived: 0,
      edgeHits: 0,
      shieldHits: 0,
      originServed: 0,
      counted: 0,
      pending: 0,
      uncounted: 0,
      latencyMs: 0,
    },
    cities: CITIES.map(() => ({ clicks: 0, edgeHits: 0, latencyMs: 0, last: null })),
    edges: CITIES.map(() => new Map<number, number>()),
    shieldCache: new Map<number, number>(),
    latencies: [],
  };
}

function pickCity(draw: number): number {
  let total = 0;
  for (let index = 0; index < CITIES.length; index += 1) {
    total += CITIES[index]?.share ?? 0;
    if (draw < total) return index;
  }
  return CITIES.length - 1;
}

/** One lane: the same clicks, answered with or without edge servers. */
export class CdnModel implements ModelAdapter<CdnCommand, CdnTick, CdnCheckpoint> {
  private config: CdnConfig;
  private readonly rng: SeededRng;
  private pickLink: (rng: Rng) => number;
  private state: CdnState = freshState();

  constructor(config: Partial<CdnConfig> = {}) {
    this.config = { ...defaultCdnConfig, ...config };
    this.rng = createRng(this.config.seed);
    this.pickLink = createZipf(this.config.links, this.config.zipfExponent);
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get settings(): Readonly<CdnConfig> {
    return this.config;
  }

  get totals(): Readonly<CdnTotals> {
    return this.state.totals;
  }

  get cityStats(): readonly Readonly<CityStats>[] {
    return this.state.cities;
  }

  get latencies(): readonly number[] {
    return this.state.latencies;
  }

  apply(command: CdnCommand): void {
    switch (command.type) {
      case 'purge':
        for (const edge of this.state.edges) edge.clear();
        this.state.shieldCache.clear();
        break;
    }
  }

  step(): CdnTick {
    const { config, state } = this;
    const { totals } = state;
    const tick = state.ticks;
    const ttlTicks = Math.max(0, Math.round(config.ttlSeconds / config.tickSeconds));
    const out: CdnTick = {
      clicks: 0,
      edgeHits: 0,
      shieldHits: 0,
      originServed: 0,
      latencyMs: 0,
      shipped: 0,
      samples: [],
    };
    for (let index = 0; index < config.clicksPerTick; index += 1) {
      const city = pickCity(this.rng());
      const link = config.newLinks ? config.links + state.nextLink++ : this.pickLink(this.rng);
      const path = this.route(city, link, tick, ttlTicks);
      const ms = clickLatencyMs(path, CITIES[city]?.km ?? 0, config.shield);
      out.clicks += 1;
      out.latencyMs += ms;
      totals.arrived += 1;
      totals.latencyMs += ms;
      state.latencies.push(ms);
      if (path === 'direct' || path === 'edge-miss') {
        out.originServed += 1;
        totals.originServed += 1;
        totals.counted += 1;
      } else {
        if (path === 'edge-hit') {
          out.edgeHits += 1;
          totals.edgeHits += 1;
        } else {
          out.shieldHits += 1;
          totals.shieldHits += 1;
        }
        if (config.edgeLogs) totals.pending += 1;
        else totals.uncounted += 1;
      }
      const stats = state.cities[city];
      if (stats) {
        stats.clicks += 1;
        stats.latencyMs += ms;
        if (path === 'edge-hit') stats.edgeHits += 1;
        stats.last = path;
      }
      if (out.samples.length < SAMPLES_PER_TICK) out.samples.push({ city, path, ms });
    }
    const shipTicks = Math.max(1, Math.round(config.logShipSeconds / config.tickSeconds));
    if (config.edgeLogs && (tick + 1) % shipTicks === 0 && totals.pending > 0) {
      out.shipped = totals.pending;
      totals.counted += totals.pending;
      totals.pending = 0;
    }
    state.ticks += 1;
    return out;
  }

  checkpoint(): CdnCheckpoint {
    return structuredClone({ config: this.config, state: this.state, rngState: this.rng.getState() });
  }

  restore(checkpoint: CdnCheckpoint): void {
    const copy = structuredClone(checkpoint);
    this.config = copy.config;
    this.state = copy.state;
    this.rng.setState(copy.rngState);
    this.pickLink = createZipf(this.config.links, this.config.zipfExponent);
  }

  private route(city: number, link: number, tick: number, ttlTicks: number): ClickPath {
    if (!this.config.cdn) return 'direct';
    const edge = this.state.edges[city];
    if (!edge) return 'direct';
    if ((edge.get(link) ?? -1) > tick) return 'edge-hit';
    if (this.config.shield) {
      const shieldExpiry = this.state.shieldCache.get(link) ?? -1;
      if (shieldExpiry > tick) {
        // The copy keeps its original age, so the edge drops it when the shield does.
        edge.set(link, shieldExpiry);
        return 'shield-hit';
      }
      this.state.shieldCache.set(link, tick + ttlTicks);
    }
    edge.set(link, tick + ttlTicks);
    return 'edge-miss';
  }
}

export type CdnMetric = 'latency' | 'origin' | 'counted';
export type CdnScenarioId = 'worldwide' | 'short-ttl' | 'purge' | 'shield' | 'new-links' | 'edge-logs';
export type CdnLaneId = 'origin' | 'cdn';

export interface CdnScenario {
  id: CdnScenarioId;
  label: string;
  /** The change this scenario makes, shown under the chips. */
  diff: string;
  config: Partial<Omit<CdnConfig, 'cdn' | 'seed'>>;
  schedule: ScheduledCommand<CdnCommand>[];
  metric: CdnMetric;
}

export const cdnScenarios: Record<CdnScenarioId, CdnScenario> = {
  worldwide: {
    id: 'worldwide',
    label: 'Worldwide clicks',
    diff: 'Baseline: 200 clicks/s from five cities on 1,000 links, a 60 s TTL, and no shield. The chart shows average latency.',
    config: {},
    schedule: [],
    metric: 'latency',
  },
  'short-ttl': {
    id: 'short-ttl',
    label: 'Short TTL',
    diff: 'TTL drops from 60 s to 1 s, so an edge refetches a link whenever its copy is over a second old. The chart shows requests reaching origin.',
    config: { ttlSeconds: 1 },
    schedule: [],
    metric: 'origin',
  },
  purge: {
    id: 'purge',
    label: 'Purge at 10 s',
    diff: 'A purge deletes every cached copy at 10 s, as after fixing a bad redirect. The chart shows requests reaching origin.',
    config: {},
    schedule: [{ at: 100, command: { type: 'purge' } }],
    metric: 'origin',
  },
  shield: {
    id: 'shield',
    label: 'Origin shield',
    diff: 'Adds one shared shield cache beside the origin, so edge misses ask it first. The chart shows requests reaching origin.',
    config: { shield: true },
    schedule: [],
    metric: 'origin',
  },
  'new-links': {
    id: 'new-links',
    label: 'Brand new links',
    diff: 'Every click opens a link nobody has clicked yet, so every edge misses. The chart shows requests reaching origin.',
    config: { newLinks: true },
    schedule: [],
    metric: 'origin',
  },
  'edge-logs': {
    id: 'edge-logs',
    label: 'Edge logs',
    diff: 'Edges log every click they answer and ship the log to the click counter every 5 s. The chart shows clicks counted.',
    config: { edgeLogs: true },
    schedule: [],
    metric: 'counted',
  },
};

export const cdnScenarioIds = Object.keys(cdnScenarios) as CdnScenarioId[];

export interface CdnEvent {
  tick: number;
  text: string;
  /** False for the wrap up note, which gets no number on the chart. */
  marker: boolean;
}

export interface CdnLane {
  id: CdnLaneId;
  label: string;
  model: CdnModel;
  /** One chart value per tick, in the scenario's metric. */
  series: number[];
  /** The latest ticks, for the rolling chart window. */
  recent: CdnTick[];
  /** Sampled clicks from every tick, for drawing. */
  samples: CdnSample[][];
}

export function describeCdnCommand(command: CdnCommand): string {
  switch (command.type) {
    case 'purge':
      return 'Purge deletes every cached copy';
  }
}

/** Runs the same clicks through the origin alone and through a CDN, tick by tick. */
export class CdnDuel {
  readonly tickSeconds: number;
  readonly length: number;
  readonly lanes: [CdnLane, CdnLane];
  readonly events: CdnEvent[] = [];
  private tickCount = 0;
  private warm = false;

  constructor(
    readonly scenario: CdnScenario,
    seed = 42,
  ) {
    this.tickSeconds = scenario.config.tickSeconds ?? defaultCdnConfig.tickSeconds;
    this.length = Math.round(CDN_SECONDS / this.tickSeconds);
    const lane = (id: CdnLaneId, label: string): CdnLane => ({
      id,
      label,
      model: new CdnModel({ ...scenario.config, cdn: id === 'cdn', seed }),
      series: [],
      recent: [],
      samples: [],
    });
    this.lanes = [lane('origin', 'Origin only'), lane('cdn', 'With CDN')];
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
    for (const entry of this.scenario.schedule) {
      if (entry.at !== tick) continue;
      this.events.push({ tick, text: describeCdnCommand(entry.command), marker: true });
      if (entry.command.type === 'purge') {
        this.warm = false;
        for (const lane of this.lanes) lane.recent = [];
      }
    }
    for (const lane of this.lanes) {
      const result = stepScheduled(lane.model, this.scenario.schedule);
      lane.recent.push(result);
      if (lane.recent.length > WINDOW_TICKS) lane.recent.shift();
      lane.samples.push(result.samples);
      lane.series.push(this.metricValue(lane));
      if (result.shipped > 0) {
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: edges ship ${result.shipped.toLocaleString('en-US')} logged clicks to the counter`,
          marker: true,
        });
      }
    }
    const cdn = this.lanes[1];
    if (!this.warm && cdn.recent.length === WINDOW_TICKS) {
      const clicks = sum(cdn.recent, (t) => t.clicks);
      const hits = sum(cdn.recent, (t) => t.edgeHits);
      if (clicks > 0 && hits / clicks >= 0.5) {
        this.warm = true;
        this.events.push({
          tick: tick + 1,
          text: `${cdn.label}: edges answer over half of the last second's clicks`,
          marker: true,
        });
      }
    }
    this.tickCount += 1;
    if (this.done) this.events.push({ tick: this.tickCount, text: this.wrapUp(), marker: false });
  }

  private metricValue(lane: CdnLane): number {
    const window = lane.recent;
    switch (this.scenario.metric) {
      case 'latency': {
        const clicks = sum(window, (t) => t.clicks);
        return clicks === 0 ? 0 : sum(window, (t) => t.latencyMs) / clicks;
      }
      case 'origin':
        return window.length === 0
          ? 0
          : sum(window, (t) => t.originServed) / (window.length * this.tickSeconds);
      case 'counted': {
        const totals = lane.model.totals;
        return totals.arrived === 0 ? 100 : (totals.counted / totals.arrived) * 100;
      }
    }
  }

  private wrapUp(): string {
    const [a, b] = this.lanes.map((lane) => summarizeCdnLane(lane.model)) as [CdnSummary, CdnSummary];
    switch (this.scenario.metric) {
      case 'latency':
        return `Run ends. The average click took ${a.meanMs.toFixed(0)} ms from the origin alone and ${b.meanMs.toFixed(0)} ms with a CDN.`;
      case 'origin':
        return `Run ends. ${a.originRequests.toLocaleString('en-US')} requests reached the origin alone and ${b.originRequests.toLocaleString('en-US')} reached it through the CDN.`;
      case 'counted':
        return `Run ends. The counter saw ${a.countedPercent.toFixed(0)}% of clicks without a CDN and ${b.countedPercent.toFixed(0)}% with one.`;
    }
  }
}

export interface CdnSummary {
  clicks: number;
  meanMs: number;
  p95Ms: number;
  edgeHitRatio: number;
  shieldHits: number;
  originRequests: number;
  countedPercent: number;
}

export function summarizeCdnLane(model: CdnModel): CdnSummary {
  const totals = model.totals;
  const sorted = [...model.latencies].sort((x, y) => x - y);
  const clicks = totals.arrived;
  return {
    clicks,
    meanMs: clicks === 0 ? 0 : totals.latencyMs / clicks,
    p95Ms: nearestRank(sorted, 0.95),
    edgeHitRatio: clicks === 0 ? 0 : totals.edgeHits / clicks,
    shieldHits: totals.shieldHits,
    originRequests: totals.originServed,
    countedPercent: clicks === 0 ? 100 : (totals.counted / clicks) * 100,
  };
}

function nearestRank(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}
