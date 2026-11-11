import { type ScheduledCommand, stepScheduled } from './adapter';
import {
  type FarmCommand,
  type FarmConfig,
  type FarmTick,
  percentile,
  ServerFarm,
  type Strategy,
} from './serverFarm';

/**
 * Two load balancers side by side on identical traffic. Each lane owns a
 * ServerFarm with the same seed, so both see the same arrivals and request
 * costs; only the routing differs.
 */
export type DuelScenarioId = 'equal' | 'slow' | 'crash';
export type DuelMetric = 'longest-queue' | 'failed-total';

export interface DuelScenario {
  id: DuelScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  config: Partial<FarmConfig>;
  schedule: ScheduledCommand<FarmCommand>[];
  metric: DuelMetric;
}

export interface DuelEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export const DUEL_SECONDS = 20;
/** Fifteen requests at an average of 10 ms each make a newcomer wait about 150 ms. */
export const STUCK_QUEUE = 15;

const baseline: Partial<FarmConfig> = {
  capacities: [100, 100, 100],
  arrivalRate: 210,
  heavyShare: 0,
  heavyFactor: 20,
  queueLimit: 60,
  healthCheckSeconds: 2,
  tickSeconds: 0.1,
};

export const duelScenarios: Record<DuelScenarioId, DuelScenario> = {
  equal: {
    id: 'equal',
    label: 'Equal requests',
    diff: 'Baseline: 3 servers at 100 req/s each, 210 req/s arriving, every request takes 10 ms.',
    config: baseline,
    schedule: [],
    metric: 'longest-queue',
  },
  slow: {
    id: 'slow',
    label: 'Some slow requests',
    diff: 'Slow requests: none to 10%. Each slow one takes 20 times as long; the average stays 10 ms.',
    config: { ...baseline, heavyShare: 0.1 },
    schedule: [],
    metric: 'longest-queue',
  },
  crash: {
    id: 'crash',
    label: 'Server 1 crashes',
    diff: 'Server 1 crashes at 3 s. Health checks need 2 s to notice and remove it.',
    config: baseline,
    schedule: [{ at: 30, command: { type: 'crash', server: 0 } }],
    metric: 'failed-total',
  },
};

export const strategyLabels: Record<Strategy, string> = {
  'round-robin': 'Round robin',
  random: 'Random',
  'least-connections': 'Least connections',
};

export interface DuelLane {
  strategy: Strategy;
  label: string;
  farm: ServerFarm;
  /** One value per tick for the scenario's metric. */
  series: number[];
  latencies: number[];
  /** The last second of ticks, for per server send rates. */
  recent: FarmTick[];
  peak: { value: number; tick: number; server: number };
  stuck: boolean;
}

export class Duel {
  readonly scenario: DuelScenario;
  readonly length: number;
  readonly tickSeconds: number;
  readonly lanes: [DuelLane, DuelLane];
  readonly events: DuelEvent[] = [];
  private tickCount = 0;

  constructor(
    scenario: DuelScenario,
    strategies: [Strategy, Strategy] = ['round-robin', 'least-connections'],
    seed = 42,
  ) {
    this.scenario = scenario;
    this.tickSeconds = scenario.config.tickSeconds ?? 0.1;
    this.length = Math.round(DUEL_SECONDS / this.tickSeconds);
    const lane = (strategy: Strategy): DuelLane => ({
      strategy,
      label: strategyLabels[strategy],
      farm: new ServerFarm({ ...scenario.config, strategy, seed }),
      series: [],
      latencies: [],
      recent: [],
      peak: { value: 0, tick: 0, server: 0 },
      stuck: false,
    });
    this.lanes = [lane(strategies[0]), lane(strategies[1])];
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
      if (entry.at === tick) this.events.push({ tick, text: describeCommand(entry.command), marker: true });
    }
    const pooledBefore = this.lanes.map((lane) => pooled(lane.farm));
    this.lanes.forEach((lane) => {
      const result = stepScheduled(lane.farm, this.scenario.schedule);
      lane.latencies.push(...result.latencies);
      lane.recent.push(result);
      if (lane.recent.length > Math.round(1 / this.tickSeconds)) lane.recent.shift();
      const longest = longestQueue(lane.farm);
      lane.series.push(this.scenario.metric === 'failed-total' ? lane.farm.totals.failed : longest.length);
      if (longest.length > lane.peak.value) {
        lane.peak = { value: longest.length, tick: tick + 1, server: longest.server };
      }
      if (!lane.stuck && longest.length >= STUCK_QUEUE) {
        lane.stuck = true;
        this.events.push({
          tick: tick + 1,
          text: `${lane.label}: ${longest.length} requests wait at server ${longest.server + 1}.`,
          marker: true,
        });
      }
    });
    const [first, second] = this.lanes;
    for (const id of pooledBefore[0] ?? []) {
      if (!pooled(first.farm).includes(id)) {
        this.events.push({
          tick,
          text: `Health checks remove server ${id + 1}. Failed so far: ${first.label.toLowerCase()} ${first.farm.totals.failed}, ${second.label.toLowerCase()} ${second.farm.totals.failed}.`,
          marker: true,
        });
      }
    }
    this.tickCount += 1;
    if (this.done && this.scenario.metric === 'longest-queue') {
      this.events.push({
        tick: this.tickCount,
        text: `Run ends. Largest queue sampled every 0.1 s: ${first.label.toLowerCase()} ${first.peak.value}, ${second.label.toLowerCase()} ${second.peak.value}.`,
        marker: false,
      });
    }
  }
}

export interface LaneSummary {
  arrived: number;
  served: number;
  failed: number;
  rejected: number;
  p50Ms: number;
  p95Ms: number;
  longestQueue: number;
}

/** Whole run numbers, so the comparison never depends on a moving window. */
export function summarize(lane: DuelLane): LaneSummary {
  const sorted = [...lane.latencies].sort((a, b) => a - b);
  const totals = lane.farm.totals;
  return {
    arrived: totals.arrived,
    served: totals.served,
    failed: totals.failed,
    rejected: totals.rejected,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    longestQueue: lane.peak.value,
  };
}

/** Requests sent to each server over the last second, by server id. */
export function sentPerSecond(lane: DuelLane, tickSeconds: number): Map<number, number> {
  const sent = new Map<number, number>();
  for (const tick of lane.recent) {
    for (const server of tick.servers) sent.set(server.id, (sent.get(server.id) ?? 0) + server.assigned);
  }
  const seconds = Math.max(tickSeconds, lane.recent.length * tickSeconds);
  for (const [id, count] of sent) sent.set(id, count / seconds);
  return sent;
}

function pooled(farm: ServerFarm): number[] {
  return farm.serverStates.filter((server) => server.inPool).map((server) => server.id);
}

function longestQueue(farm: ServerFarm): { length: number; server: number } {
  let best = { length: 0, server: 0 };
  for (const server of farm.serverStates) {
    if (server.queue.length > best.length) best = { length: server.queue.length, server: server.id };
  }
  return best;
}

function describeCommand(command: FarmCommand): string {
  switch (command.type) {
    case 'crash':
      return `Server ${command.server + 1} crashes.`;
    case 'recover':
      return `Server ${command.server + 1} comes back.`;
    case 'rate':
      return `Traffic changes to ${command.value} req/s.`;
    case 'heavy-share':
      return `Slow requests change to ${Math.round(command.value * 100)}%.`;
    case 'capacities':
      return `The farm changes to ${command.value.length} servers.`;
    case 'strategy':
      return `Strategy changes to ${strategyLabels[command.value].toLowerCase()}.`;
  }
}
