import { createRng, createZipf, hashString, poisson } from '../rng';
import { percentile } from './serverFarm';

/**
 * Toy model of the URL shortener's cache tier. Every link is already cached,
 * and each link lives on the node its hash picks. Two lanes replay one
 * pre-generated click stream: one routes by hash alone, the other copies a
 * link to every node once it gets hot. Capacities are toy numbers: a real
 * cache node serves tens of thousands of requests per second, but the ratios
 * between nodes behave the same way.
 */
export type HotKeyScenarioId = 'busy' | 'viral' | 'viral-8';
export type HotKeyStrategy = 'hash' | 'copies';

export interface Traffic {
  /** Requests per second, reads and writes together. */
  rate: number;
  /** Share of reads that go to the top link, abc123. */
  topShare: number;
}

export interface HotKeyScenario {
  id: HotKeyScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  nodes: number;
  before: Traffic;
  after: Traffic;
  /** Tick at which traffic switches from before to after. */
  changeAt: number;
  changeText: string;
}

export const HOT_KEY_SECONDS = 20;
export const TICK_SECONDS = 0.1;
/** Toy capacity of one cache node, in requests per second. */
export const NODE_CAPACITY = 150;
/** A node holds at most this many waiting requests and rejects the rest. */
export const QUEUE_LIMIT = 30;
/** A link at or above this many reads per second counts as hot. */
export const HOT_THRESHOLD = 50;
export const WRITE_SHARE = 0.01;
/** Links that exist before the run starts. Writes create new ones. */
export const LINK_COUNT = 1000;
export const TOP_LINK = 'abc123';
const ZIPF_S = 0.6;
const WINDOW_TICKS = Math.round(1 / TICK_SECONDS);
const CHANGE_AT = 30;
const quiet: Traffic = { rate: 40, topShare: 0.05 };

export const hotKeyScenarios: Record<HotKeyScenarioId, HotKeyScenario> = {
  busy: {
    id: 'busy',
    label: 'Busy evening',
    diff: 'At 3 s: rate 40 to 400 req/s, top key share stays 5%.',
    nodes: 4,
    before: quiet,
    after: { rate: 400, topShare: 0.05 },
    changeAt: CHANGE_AT,
    changeText: 'Evening rush: clicks jump from 40 to 400 req/s. abc123 still gets 5% of them.',
  },
  viral: {
    id: 'viral',
    label: 'Viral link',
    diff: 'At 3 s: rate 40 to 400 req/s, top key share 5% to 60%.',
    nodes: 4,
    before: quiet,
    after: { rate: 400, topShare: 0.6 },
    changeAt: CHANGE_AT,
    changeText: 'abc123 goes viral: clicks jump from 40 to 400 req/s and 60% of them go to that one link.',
  },
  'viral-8': {
    id: 'viral-8',
    label: 'Viral link, 8 nodes',
    diff: 'Viral link, plus cache nodes 4 to 8.',
    nodes: 8,
    before: quiet,
    after: { rate: 400, topShare: 0.6 },
    changeAt: CHANGE_AT,
    changeText: 'abc123 goes viral: clicks jump from 40 to 400 req/s and 60% of them go to that one link.',
  },
};

export const strategyLabels: Record<HotKeyStrategy, string> = {
  hash: 'Hash only',
  copies: 'Hot key copies',
};

export interface Click {
  /** Link index. 0 is abc123, below LINK_COUNT are existing links, above are links created in the run. */
  link: number;
  write: boolean;
}

export interface CacheNode {
  id: number;
  capacity: number;
  /** Time in ms each waiting request will spend at the node, in arrival order. */
  queue: number[];
  arrived: number;
  served: number;
  rejected: number;
  /** Requests that arrived in each of the last ticks, up to one second. */
  recent: number[];
}

export interface HotKeyLane {
  strategy: HotKeyStrategy;
  label: string;
  nodes: CacheNode[];
  /** Links copied to every node. */
  hot: Set<number>;
  /** Time at the node for every served request, in ms. */
  latencies: number[];
  /** Busiest node's load, percent of capacity over the last second, one value per tick. */
  series: number[];
  peak: { value: number; tick: number; node: number };
  firstRejectTick: number | null;
  nextCopy: number;
}

export interface HotKeyEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface LinkCount {
  link: number;
  code: string;
  count: number;
}

export interface AccessPattern {
  seconds: number;
  readsPerSecond: number;
  writesPerSecond: number;
  /** Share of reads that went to abc123, 0 to 1. */
  topShare: number;
  /** The most read links, most first. */
  top: LinkCount[];
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Short code for a link index. Stable across runs, so routing never changes between replays. */
export function linkCode(index: number): string {
  if (index === 0) return TOP_LINK;
  let value = hashString(`link-${index}`);
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[value % 62] ?? '0';
    value = Math.floor(value / 62);
  }
  return code;
}

/** The node a link lives on when the tier routes by hash alone. */
export function homeNode(index: number, nodes: number): number {
  return hashString(linkCode(index)) % nodes;
}

/** One click stream per scenario and seed, shared by both lanes. */
export function generateClicks(scenario: HotKeyScenario, seed: number): Click[][] {
  const rng = createRng(seed);
  const zipf = createZipf(LINK_COUNT - 1, ZIPF_S);
  const length = Math.round(HOT_KEY_SECONDS / TICK_SECONDS);
  const ticks: Click[][] = [];
  let created = 0;
  for (let tick = 0; tick < length; tick += 1) {
    const traffic = tick < scenario.changeAt ? scenario.before : scenario.after;
    const count = poisson(rng, traffic.rate * TICK_SECONDS);
    const clicks: Click[] = [];
    for (let i = 0; i < count; i += 1) {
      if (rng() < WRITE_SHARE) {
        clicks.push({ link: LINK_COUNT + created, write: true });
        created += 1;
      } else if (rng() < traffic.topShare) {
        clicks.push({ link: 0, write: false });
      } else {
        clicks.push({ link: 1 + zipf(rng), write: false });
      }
    }
    ticks.push(clicks);
  }
  return ticks;
}

/** Requests per second a node received over the last second. */
export function nodeRate(node: CacheNode, tickSeconds = TICK_SECONDS): number {
  if (node.recent.length === 0) return 0;
  const total = node.recent.reduce((sum, count) => sum + count, 0);
  return total / (node.recent.length * tickSeconds);
}

export class HotKeyRun {
  readonly scenario: HotKeyScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly lanes: [HotKeyLane, HotKeyLane];
  readonly events: HotKeyEvent[] = [];
  readonly clicks: Click[][];
  private readonly homes: number[];
  private readonly windowTicks: { reads: Map<number, number>; writes: number }[] = [];
  private readonly windowReads = new Map<number, number>();
  private windowWrites = 0;
  private tickCount = 0;

  constructor(scenario: HotKeyScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(HOT_KEY_SECONDS / TICK_SECONDS);
    this.clicks = generateClicks(scenario, seed);
    this.homes = Array.from({ length: LINK_COUNT }, (_, index) => homeNode(index, scenario.nodes));
    const lane = (strategy: HotKeyStrategy): HotKeyLane => ({
      strategy,
      label: strategyLabels[strategy],
      nodes: Array.from({ length: scenario.nodes }, (_, id) => ({
        id,
        capacity: NODE_CAPACITY,
        queue: [],
        arrived: 0,
        served: 0,
        rejected: 0,
        recent: [],
      })),
      hot: new Set(),
      latencies: [],
      series: [],
      peak: { value: 0, tick: 0, node: 0 },
      firstRejectTick: null,
      nextCopy: 0,
    });
    this.lanes = [lane('hash'), lane('copies')];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** The node holding abc123 when routing by hash. */
  get topHome(): number {
    return this.homes[0] ?? 0;
  }

  home(link: number): number {
    return this.homes[link] ?? homeNode(link, this.scenario.nodes);
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (tick === this.scenario.changeAt)
      this.events.push({ tick, text: this.scenario.changeText, marker: true });
    const clicks = this.clicks[tick] ?? [];
    const perTick = Math.round(NODE_CAPACITY * TICK_SECONDS);
    for (const lane of this.lanes) {
      const arrivals = lane.nodes.map(() => 0);
      const rejectedBefore = lane.nodes.map((node) => node.rejected);
      for (const click of clicks) {
        const index = this.route(lane, click);
        const node = lane.nodes[index];
        if (!node) continue;
        arrivals[index] = (arrivals[index] ?? 0) + 1;
        node.arrived += 1;
        if (node.queue.length >= QUEUE_LIMIT) node.rejected += 1;
        else node.queue.push(((node.queue.length + 1) / node.capacity) * 1000);
      }
      let busiest = { load: 0, node: 0 };
      lane.nodes.forEach((node, index) => {
        const served = node.queue.splice(0, perTick);
        lane.latencies.push(...served);
        node.served += served.length;
        node.recent.push(arrivals[index] ?? 0);
        if (node.recent.length > WINDOW_TICKS) node.recent.shift();
        const load = Math.round((nodeRate(node) / node.capacity) * 100);
        if (load > busiest.load) busiest = { load, node: index };
      });
      lane.series.push(busiest.load);
      if (busiest.load > lane.peak.value) {
        lane.peak = { value: busiest.load, tick: tick + 1, node: busiest.node };
      }
      if (lane.firstRejectTick === null) {
        const full = lane.nodes.findIndex((node, index) => node.rejected > (rejectedBefore[index] ?? 0));
        if (full >= 0) {
          lane.firstRejectTick = tick + 1;
          this.events.push({
            tick: tick + 1,
            text: `${lane.label}: node ${full + 1} is full and starts turning clicks away.`,
            marker: true,
          });
        }
      }
    }
    this.record(clicks);
    for (const lane of this.lanes) {
      if (lane.strategy !== 'copies') continue;
      for (const [link, count] of this.windowReads) {
        if (count < HOT_THRESHOLD || lane.hot.has(link)) continue;
        lane.hot.add(link);
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: ${linkCode(link)} passes ${HOT_THRESHOLD} req/s, so all ${lane.nodes.length} nodes get a copy.`,
          marker: true,
        });
      }
    }
    this.tickCount += 1;
    if (this.done) {
      const [first, second] = this.lanes;
      const rejected = (lane: HotKeyLane) => lane.nodes.reduce((sum, node) => sum + node.rejected, 0);
      this.events.push({
        tick: this.tickCount,
        text: `Run ends. Clicks turned away: ${first.label.toLowerCase()} ${rejected(first)}, ${second.label.toLowerCase()} ${rejected(second)}. Busiest node peak: ${first.peak.value}% and ${second.peak.value}% of capacity.`,
        marker: false,
      });
    }
  }

  /** Reads, writes, and the most read links over the last second. */
  pattern(limit = 3): AccessPattern {
    const seconds = Math.max(TICK_SECONDS, this.windowTicks.length * TICK_SECONDS);
    let reads = 0;
    for (const count of this.windowReads.values()) reads += count;
    const top = [...this.windowReads.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limit)
      .map(([link, count]) => ({ link, code: linkCode(link), count }));
    return {
      seconds,
      readsPerSecond: reads / seconds,
      writesPerSecond: this.windowWrites / seconds,
      topShare: reads > 0 ? (this.windowReads.get(0) ?? 0) / reads : 0,
      top,
    };
  }

  private route(lane: HotKeyLane, click: Click): number {
    if (lane.strategy === 'copies' && !click.write && lane.hot.has(click.link)) {
      const index = lane.nextCopy % lane.nodes.length;
      lane.nextCopy += 1;
      return index;
    }
    return this.home(click.link);
  }

  private record(clicks: Click[]): void {
    const reads = new Map<number, number>();
    let writes = 0;
    for (const click of clicks) {
      if (click.write) writes += 1;
      else reads.set(click.link, (reads.get(click.link) ?? 0) + 1);
    }
    this.windowTicks.push({ reads, writes });
    for (const [link, count] of reads) this.windowReads.set(link, (this.windowReads.get(link) ?? 0) + count);
    this.windowWrites += writes;
    if (this.windowTicks.length <= WINDOW_TICKS) return;
    const oldest = this.windowTicks.shift();
    if (!oldest) return;
    for (const [link, count] of oldest.reads) {
      const left = (this.windowReads.get(link) ?? 0) - count;
      if (left > 0) this.windowReads.set(link, left);
      else this.windowReads.delete(link);
    }
    this.windowWrites -= oldest.writes;
  }
}

export interface HotKeySummary {
  arrived: number;
  served: number;
  rejected: number;
  inFlight: number;
  p50Ms: number;
  p95Ms: number;
  peakLoad: number;
  /** Extra copies of hot links held beyond the home node. */
  extraCopies: number;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarizeLane(lane: HotKeyLane): HotKeySummary {
  const sorted = [...lane.latencies].sort((a, b) => a - b);
  const total = (pick: (node: CacheNode) => number) => lane.nodes.reduce((sum, node) => sum + pick(node), 0);
  return {
    arrived: total((node) => node.arrived),
    served: total((node) => node.served),
    rejected: total((node) => node.rejected),
    inFlight: total((node) => node.queue.length),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    peakLoad: lane.peak.value,
    extraCopies: lane.hot.size * (lane.nodes.length - 1),
  };
}
