import { type AssignmentEvent, ServerFarm } from './serverFarm';

/** The home page routing challenge: the same traffic replayed through two balancing policies. */
export type HomePolicy = 'round-robin' | 'least-connections';

export const HOME_CAPACITIES: readonly number[] = [5, 5, 1];
export const HOME_FOURTH_SERVER: readonly number[] = [5, 5, 1, 5];
export const HOME_RATE = 8;
export const HOME_RATE_MAX = 24;
export const HOME_QUEUE_LIMIT = 4;
export const HOME_SEED = 42;
export const HOME_TICK_SECONDS = 0.1;
export const HOME_TICKS = 200;
export const HOME_SERVER_NAMES = ['A', 'B', 'C', 'D'] as const;

export const homePolicyLabels: Record<HomePolicy, { plain: string; technical: string }> = {
  'round-robin': { plain: 'Take turns', technical: 'round robin' },
  'least-connections': { plain: 'Fewest unfinished', technical: 'least connections' },
};

export interface RoutingSetup {
  policy: HomePolicy;
  capacities?: readonly number[];
  rate?: number;
  ticks?: number;
}

/** Everything the page needs to draw one moment of a run. Counts are running totals. */
export interface RoutingFrame {
  time: number;
  /** Unfinished requests at each server at the end of the tick. */
  queues: number[];
  assigned: number[];
  arrived: number;
  served: number;
  rejected: number;
  inFlight: number;
  /** Routing decisions made during this tick, in arrival order. */
  events: AssignmentEvent[];
}

export interface RoutingRun {
  policy: HomePolicy;
  capacities: number[];
  rate: number;
  frames: RoutingFrame[];
  totals: { arrived: number; served: number; rejected: number; inFlight: number };
  assigned: number[];
  /** First request turned away, with the frame it happened in. */
  firstRejection: { frame: number; event: AssignmentEvent } | null;
}

export function runRouting({
  policy,
  capacities = HOME_CAPACITIES,
  rate = HOME_RATE,
  ticks = HOME_TICKS,
}: RoutingSetup): RoutingRun {
  const farm = new ServerFarm({
    capacities: [...capacities],
    strategy: policy,
    arrivalRate: rate,
    queueLimit: HOME_QUEUE_LIMIT,
    seed: HOME_SEED,
    tickSeconds: HOME_TICK_SECONDS,
    heavyShare: 0,
  });
  const assigned = capacities.map(() => 0);
  const frames: RoutingFrame[] = [];
  let firstRejection: RoutingRun['firstRejection'] = null;

  for (let index = 0; index < ticks; index += 1) {
    const events: AssignmentEvent[] = [];
    farm.trace = events;
    const tick = farm.step();
    for (const server of tick.servers) {
      if (server.id < assigned.length) assigned[server.id] = (assigned[server.id] ?? 0) + server.assigned;
    }
    if (!firstRejection) {
      const event = events.find((candidate) => candidate.outcome === 'rejected');
      if (event) firstRejection = { frame: index, event };
    }
    const queues = capacities.map(
      (_, id) => tick.servers.find((server) => server.id === id)?.queueLength ?? 0,
    );
    frames.push({
      time: tick.time,
      queues,
      assigned: [...assigned],
      arrived: farm.totals.arrived,
      served: farm.totals.served,
      rejected: farm.totals.rejected,
      inFlight: farm.inFlight,
      events,
    });
  }
  farm.trace = null;

  return {
    policy,
    capacities: [...capacities],
    rate,
    frames,
    totals: {
      arrived: farm.totals.arrived,
      served: farm.totals.served,
      rejected: farm.totals.rejected,
      inFlight: farm.inFlight,
    },
    assigned,
    firstRejection,
  };
}

/** Requests per second each server receives when the balancer takes turns, whatever the queues look like. */
export function turnTakingShare(rate: number, servers: number): number {
  return servers === 0 ? 0 : rate / servers;
}

export interface RoutingSummary {
  policy: HomePolicy;
  servers: number;
  rate: number;
  arrived: number;
  served: number;
  rejected: number;
  inFlight: number;
  assigned: number[];
  firstRejectionSeconds: number | null;
}

export function summarizeRouting(run: RoutingRun): RoutingSummary {
  return {
    policy: run.policy,
    servers: run.capacities.length,
    rate: run.rate,
    ...run.totals,
    assigned: run.assigned,
    firstRejectionSeconds: run.firstRejection ? round1(run.firstRejection.event.time) : null,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
