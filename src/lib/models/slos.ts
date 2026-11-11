import { createRng, poisson } from '../rng';
import { percentile } from './serverFarm';

/**
 * Toy model of the URL shortener's redirect path, timed at the load balancer.
 * Every redirect passes four stages: network, app code, a cache lookup, and a
 * database read on a cache miss. Each stage takes a fixed floor plus a random
 * extra with a long right tail. Stages are drawn independently and nothing
 * queues, so the numbers are illustrative: they show how averages and
 * percentiles react to a fix, and they make no claim about any real system.
 * Two lanes replay one pre-generated set of redirects. At FIX_AT one lane
 * halves the app stage and the other halves the database stage.
 */
export type SloScenarioId = 'healthy' | 'slow-misses' | 'slow-app';
export type SloFix = 'app' | 'miss';
export type Stage = 'network' | 'app' | 'cache' | 'database';

export const stages: Stage[] = ['network', 'app', 'cache', 'database'];

export const stageLabels: Record<Stage, string> = {
  network: 'Network',
  app: 'App code',
  cache: 'Cache lookup',
  database: 'Database (misses only)',
};

/** A stage takes `floor` ms plus a random extra that averages `extra` ms. */
export interface StageShape {
  floor: number;
  extra: number;
}

export interface SloScenario {
  id: SloScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  shapes: Record<Stage, StageShape>;
}

export const SLO_SECONDS = 20;
export const TICK_SECONDS = 0.1;
export const REQUEST_RATE = 1000;
export const HIT_RATE = 0.95;
/** The SLO: SLO_TARGET of redirects finish in under SLO_THRESHOLD_MS. */
export const SLO_THRESHOLD_MS = 100;
export const SLO_TARGET = 0.99;
/** Tick at which both fixes ship. */
export const FIX_AT = 20;
/** Each fix halves the time its stage takes. */
export const FIX_FACTOR = 0.5;
const WINDOW_TICKS = Math.round(1 / TICK_SECONDS);

const healthy: Record<Stage, StageShape> = {
  network: { floor: 8, extra: 4 },
  app: { floor: 12, extra: 4 },
  cache: { floor: 1, extra: 1 },
  database: { floor: 20, extra: 15 },
};

export const sloScenarios: Record<SloScenarioId, SloScenario> = {
  healthy: {
    id: 'healthy',
    label: 'Healthy',
    diff: 'Baseline: app code averages 16 ms, a database read on a miss 35 ms.',
    shapes: healthy,
  },
  'slow-misses': {
    id: 'slow-misses',
    label: 'Slow misses',
    diff: 'Database read on a miss: average 35 ms to 85 ms.',
    shapes: { ...healthy, database: { floor: 50, extra: 35 } },
  },
  'slow-app': {
    id: 'slow-app',
    label: 'Slow app code',
    diff: 'App code: average 16 ms to 32 ms, with a long tail.',
    shapes: { ...healthy, app: { floor: 12, extra: 20 } },
  },
};

export const fixLabels: Record<SloFix, string> = {
  app: 'Faster app code',
  miss: 'Faster miss path',
};

/** Time in ms one redirect spends in each stage before any fix. Database is 0 on a cache hit. */
export type Spans = Record<Stage, number>;

/** One set of redirects per scenario and seed, shared by both lanes. */
export function generateRequests(scenario: SloScenario, seed: number): Spans[][] {
  const rng = createRng(seed);
  const length = Math.round(SLO_SECONDS / TICK_SECONDS);
  // Every scenario consumes the same random draws, so scenarios differ only in their stage shapes.
  const draw = (shape: StageShape) => shape.floor - shape.extra * Math.log(1 - rng());
  const ticks: Spans[][] = [];
  for (let tick = 0; tick < length; tick += 1) {
    const count = poisson(rng, REQUEST_RATE * TICK_SECONDS);
    const requests: Spans[] = [];
    for (let i = 0; i < count; i += 1) {
      const network = draw(scenario.shapes.network);
      const app = draw(scenario.shapes.app);
      const cache = draw(scenario.shapes.cache);
      const miss = rng() >= HIT_RATE;
      const database = draw(scenario.shapes.database);
      requests.push({ network, app, cache, database: miss ? database : 0 });
    }
    ticks.push(requests);
  }
  return ticks;
}

export function totalMs(spans: Spans): number {
  return spans.network + spans.app + spans.cache + spans.database;
}

/** Redirect time once a lane's fix has shipped. */
export function fixedMs(spans: Spans, fix: SloFix): number {
  if (fix === 'app') return totalMs(spans) - spans.app * (1 - FIX_FACTOR);
  return totalMs(spans) - spans.database * (1 - FIX_FACTOR);
}

export interface SloLane {
  fix: SloFix;
  label: string;
  /** Every redirect's time in ms, whole run, in arrival order. */
  latencies: number[];
  /** Redirect times for each of the last ticks, up to one second. */
  recent: number[][];
  good: number;
  slow: number;
  /** p99 over the last second, in ms, one value per tick. */
  series: number[];
  /** Tick at which slow redirects passed the error budget. */
  budgetGoneTick: number | null;
  /** First tick after the fix at which the last second's p99 fell under the threshold. */
  underTick: number | null;
}

export interface SloEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface Percentiles {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    mean: sorted.length > 0 ? sum / sorted.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

/** Allowed slow redirects for a window: the share the SLO leaves over, rounded down. */
export function errorBudget(requests: number, target = SLO_TARGET): number {
  return Math.floor(requests * (1 - target) + 1e-9);
}

export class SloRun {
  readonly scenario: SloScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly lanes: [SloLane, SloLane];
  readonly events: SloEvent[] = [];
  readonly requests: Spans[][];
  /** Every redirect the run will see, fixed up front so the budget is known from the start. */
  readonly total: number;
  /** Slow redirects the whole run may have and still meet the SLO. */
  readonly budget: number;
  private tickCount = 0;

  constructor(scenario: SloScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(SLO_SECONDS / TICK_SECONDS);
    this.requests = generateRequests(scenario, seed);
    this.total = this.requests.reduce((sum, tick) => sum + tick.length, 0);
    this.budget = errorBudget(this.total);
    const lane = (fix: SloFix): SloLane => ({
      fix,
      label: fixLabels[fix],
      latencies: [],
      recent: [],
      good: 0,
      slow: 0,
      series: [],
      budgetGoneTick: null,
      underTick: null,
    });
    this.lanes = [lane('app'), lane('miss')];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  get fixed(): boolean {
    return this.tickCount > FIX_AT;
  }

  /** Redirects that have arrived so far, the same for both lanes. */
  get arrived(): number {
    let count = 0;
    for (const tick of this.requests.slice(0, this.tickCount)) count += tick.length;
    return count;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (tick === FIX_AT) {
      this.events.push({
        tick,
        text: `Both fixes ship. ${fixLabels.app} halves the app stage on every redirect. ${fixLabels.miss} halves the database read, which only the ${Math.round((1 - HIT_RATE) * 100)}% of redirects that miss the cache make.`,
        marker: true,
      });
    }
    const requests = this.requests[tick] ?? [];
    for (const lane of this.lanes) {
      const times = requests.map((spans) => (tick >= FIX_AT ? fixedMs(spans, lane.fix) : totalMs(spans)));
      for (const time of times) {
        if (time < SLO_THRESHOLD_MS) lane.good += 1;
        else lane.slow += 1;
      }
      lane.latencies.push(...times);
      lane.recent.push(times);
      if (lane.recent.length > WINDOW_TICKS) lane.recent.shift();
      const p99 = percentiles(lane.recent.flat()).p99;
      const before = lane.series.at(-1) ?? 0;
      lane.series.push(p99);
      if (tick >= FIX_AT && lane.underTick === null && before >= SLO_THRESHOLD_MS && p99 < SLO_THRESHOLD_MS) {
        lane.underTick = tick + 1;
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: p99 over the last second falls to ${Math.round(p99)} ms, under the ${SLO_THRESHOLD_MS} ms line.`,
          marker: true,
        });
      }
      if (lane.budgetGoneTick === null && lane.slow > this.budget) {
        lane.budgetGoneTick = tick + 1;
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: slow redirects pass the error budget of ${this.budget}, so this run misses the SLO.`,
          marker: true,
        });
      }
    }
    this.tickCount += 1;
    if (this.done) {
      const [first, second] = this.lanes.map((lane) => summarizeLane(lane, this.budget));
      if (!first || !second) return;
      this.events.push({
        tick: this.tickCount,
        text: `Run ends. Whole run p99: ${this.lanes[0].label.toLowerCase()} ${Math.round(first.p99)} ms, ${this.lanes[1].label.toLowerCase()} ${Math.round(second.p99)} ms. Mean: ${Math.round(first.mean)} ms and ${Math.round(second.mean)} ms. Error budget left: ${first.budgetLeft} and ${second.budgetLeft} of ${this.budget}.`,
        marker: false,
      });
    }
  }

  /** Percentiles and slow share over the last second for one lane. */
  window(lane: SloLane): Percentiles & { slowShare: number; values: number[] } {
    const values = lane.recent.flat();
    const slow = values.filter((value) => value >= SLO_THRESHOLD_MS).length;
    return { ...percentiles(values), slowShare: values.length > 0 ? slow / values.length : 0, values };
  }

  /**
   * Where the time goes for the average redirect and for the slowest 1%,
   * measured on redirects before either fix ships, so both lanes see it.
   */
  breakdown(): Breakdown {
    const measured = this.requests.slice(0, Math.min(this.tickCount, FIX_AT)).flat();
    const slowest = [...measured].sort((a, b) => totalMs(b) - totalMs(a));
    const tail = slowest.slice(0, Math.ceil(measured.length * (1 - SLO_TARGET)));
    return {
      count: measured.length,
      average: averageSpans(measured),
      tailCount: tail.length,
      tail: averageSpans(tail),
    };
  }
}

export interface Breakdown {
  count: number;
  average: Spans;
  tailCount: number;
  tail: Spans;
}

function averageSpans(requests: Spans[]): Spans {
  const sum: Spans = { network: 0, app: 0, cache: 0, database: 0 };
  for (const spans of requests) for (const stage of stages) sum[stage] += spans[stage];
  const count = Math.max(1, requests.length);
  return {
    network: sum.network / count,
    app: sum.app / count,
    cache: sum.cache / count,
    database: sum.database / count,
  };
}

export interface SloSummary extends Percentiles {
  arrived: number;
  good: number;
  slow: number;
  budgetLeft: number;
}

/** The SLI as a percentage, floored to one decimal so 98.96% never reads as a passing 99.0%. */
export function sliPercent(good: number, arrived: number): number {
  return arrived > 0 ? Math.floor((good * 1000) / arrived) / 10 : 100;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarizeLane(lane: SloLane, budget: number): SloSummary {
  const arrived = lane.good + lane.slow;
  return {
    ...percentiles(lane.latencies),
    arrived,
    good: lane.good,
    slow: lane.slow,
    budgetLeft: Math.max(0, budget - lane.slow),
  };
}
