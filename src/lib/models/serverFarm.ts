import { createRng, poisson, type Rng } from '../rng';

/**
 * A deliberately small model of servers behind a load balancer.
 *
 * Time advances in fixed ticks. Each server works through a FIFO queue at a
 * fixed capacity. A request that finds a full queue gets rejected (HTTP 503).
 * A request routed to a crashed server fails until health checks remove it.
 * The model is the source of truth; animations only display its state.
 */
export type Strategy = 'round-robin' | 'random' | 'least-connections';

export interface FarmConfig {
  /** Requests per second each server can finish, for an average request. */
  capacities: number[];
  strategy: Strategy;
  /** Requests per second arriving at the load balancer. */
  arrivalRate: number;
  /** Maximum requests waiting in one server's queue. */
  queueLimit: number;
  /** Share of requests that are expensive, from 0 to 1. */
  heavyShare: number;
  /** How many times longer an expensive request takes than a cheap one. */
  heavyFactor: number;
  /** Seconds between a crash and the load balancer noticing it. */
  healthCheckSeconds: number;
  tickSeconds: number;
  seed: number;
}

export const defaultFarmConfig: FarmConfig = {
  capacities: [100],
  strategy: 'round-robin',
  arrivalRate: 60,
  queueLimit: 50,
  heavyShare: 0,
  heavyFactor: 10,
  healthCheckSeconds: 2,
  tickSeconds: 0.1,
  seed: 42,
};

interface QueuedRequest {
  arrivedAt: number;
  remaining: number;
}

export interface ServerState {
  id: number;
  capacity: number;
  queue: QueuedRequest[];
  up: boolean;
  /** Whether the load balancer currently sends traffic here. */
  inPool: boolean;
  crashedAt: number | null;
  /** Leaving the pool after a scale-in; finishes its queue, then disappears. */
  draining: boolean;
}

export interface ServerTick {
  id: number;
  assigned: number;
  served: number;
  rejected: number;
  failed: number;
  queueLength: number;
  up: boolean;
  inPool: boolean;
  draining: boolean;
  utilization: number;
}

export interface FarmTick {
  time: number;
  arrived: number;
  served: number;
  rejected: number;
  failed: number;
  servers: ServerTick[];
}

export interface FarmStats {
  windowSeconds: number;
  arrivedPerSecond: number;
  servedPerSecond: number;
  rejectedPerSecond: number;
  failedPerSecond: number;
  /** Share of arriving requests that did not succeed, from 0 to 1. */
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  utilization: number;
}

const STATS_WINDOW_SECONDS = 5;

export class ServerFarm {
  private config: FarmConfig;
  private rng: Rng;
  private servers: ServerState[] = [];
  private nextId = 0;
  private cursor = 0;
  private time = 0;
  private history: FarmTick[] = [];
  private latencies: { time: number; ms: number }[] = [];

  constructor(config: Partial<FarmConfig> = {}) {
    this.config = { ...defaultFarmConfig, ...config };
    this.rng = createRng(this.config.seed);
    for (const capacity of this.config.capacities) this.addServer(capacity);
  }

  get now(): number {
    return this.time;
  }

  get serverStates(): readonly ServerState[] {
    return this.servers;
  }

  setArrivalRate(rate: number): void {
    this.config.arrivalRate = Math.max(0, rate);
  }

  setStrategy(strategy: Strategy): void {
    this.config.strategy = strategy;
  }

  setHeavyShare(share: number): void {
    this.config.heavyShare = Math.min(1, Math.max(0, share));
  }

  /** Resize servers that are still serving. Extra servers drain; missing ones join. */
  setCapacities(capacities: number[]): void {
    const active = this.servers.filter((server) => !server.draining);
    capacities.forEach((capacity, index) => {
      const server = active[index];
      if (server) server.capacity = capacity;
      else this.addServer(capacity);
    });
    for (const server of active.slice(capacities.length)) {
      server.draining = true;
      server.inPool = false;
    }
    this.config.capacities = [...capacities];
  }

  crash(id: number): void {
    const server = this.servers.find((candidate) => candidate.id === id);
    if (!server?.up) return;
    server.up = false;
    server.crashedAt = this.time;
  }

  recover(id: number): void {
    const server = this.servers.find((candidate) => candidate.id === id);
    if (!server || server.up) return;
    server.up = true;
    server.crashedAt = null;
    server.inPool = !server.draining;
  }

  step(): FarmTick {
    const dt = this.config.tickSeconds;
    const ticks = new Map<number, ServerTick>();
    for (const server of this.servers) {
      ticks.set(server.id, {
        id: server.id,
        assigned: 0,
        served: 0,
        rejected: 0,
        failed: 0,
        queueLength: 0,
        up: server.up,
        inPool: server.inPool,
        draining: server.draining,
        utilization: 0,
      });
    }

    let failed = this.runHealthChecks(ticks);

    const arrived = poisson(this.rng, this.config.arrivalRate * dt);
    let rejected = 0;
    for (let i = 0; i < arrived; i += 1) {
      const target = this.pickServer();
      if (!target) {
        rejected += 1;
        continue;
      }
      const tick = ticks.get(target.id);
      if (!tick) continue;
      tick.assigned += 1;
      if (!target.up) {
        tick.failed += 1;
        failed += 1;
      } else if (target.queue.length >= this.config.queueLimit) {
        tick.rejected += 1;
        rejected += 1;
      } else {
        target.queue.push({ arrivedAt: this.time, remaining: this.drawCost() });
      }
    }

    let served = 0;
    for (const server of this.servers) {
      const tick = ticks.get(server.id);
      if (!tick) continue;
      if (server.up) {
        const done = this.process(server, dt);
        tick.served = done.served;
        tick.utilization = done.utilization;
        served += done.served;
      }
      tick.queueLength = server.queue.length;
    }

    this.servers = this.servers.filter((server) => !(server.draining && server.queue.length === 0));
    this.time = round(this.time + dt);

    const result: FarmTick = {
      time: this.time,
      arrived,
      served,
      rejected,
      failed,
      servers: [...ticks.values()],
    };
    this.history.push(result);
    const cutoff = this.time - STATS_WINDOW_SECONDS;
    while (this.history.length > 0 && (this.history[0]?.time ?? 0) <= cutoff) this.history.shift();
    while (this.latencies.length > 0 && (this.latencies[0]?.time ?? 0) <= cutoff) {
      this.latencies.shift();
    }
    return result;
  }

  stats(): FarmStats {
    const seconds = Math.max(this.config.tickSeconds, this.history.length * this.config.tickSeconds);
    const sum = (pick: (tick: FarmTick) => number) =>
      this.history.reduce((total, tick) => total + pick(tick), 0);
    const arrived = sum((tick) => tick.arrived);
    const served = sum((tick) => tick.served);
    const rejected = sum((tick) => tick.rejected);
    const failed = sum((tick) => tick.failed);
    const sorted = this.latencies.map((entry) => entry.ms).sort((a, b) => a - b);
    const utilSamples = this.history.flatMap((tick) =>
      tick.servers.filter((server) => server.up && !server.draining).map((server) => server.utilization),
    );
    return {
      windowSeconds: seconds,
      arrivedPerSecond: arrived / seconds,
      servedPerSecond: served / seconds,
      rejectedPerSecond: rejected / seconds,
      failedPerSecond: failed / seconds,
      errorRate: arrived === 0 ? 0 : (rejected + failed) / arrived,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      utilization:
        utilSamples.length === 0
          ? 0
          : utilSamples.reduce((total, value) => total + value, 0) / utilSamples.length,
    };
  }

  private addServer(capacity: number): void {
    this.servers.push({
      id: this.nextId,
      capacity,
      queue: [],
      up: true,
      inPool: true,
      crashedAt: null,
      draining: false,
    });
    this.nextId += 1;
  }

  /** Returns how many queued requests died with crashed servers. */
  private runHealthChecks(ticks: Map<number, ServerTick>): number {
    let lost = 0;
    for (const server of this.servers) {
      if (!server.up && server.crashedAt !== null) {
        // A crash loses everything the server was holding.
        const tick = ticks.get(server.id);
        if (tick) tick.failed += server.queue.length;
        lost += server.queue.length;
        server.queue = [];
        if (server.inPool && this.time - server.crashedAt >= this.config.healthCheckSeconds - 1e-9) {
          server.inPool = false;
          if (tick) tick.inPool = false;
        }
      }
    }
    return lost;
  }

  private pickServer(): ServerState | undefined {
    const pool = this.servers.filter((server) => server.inPool);
    if (pool.length === 0) return undefined;
    switch (this.config.strategy) {
      case 'random':
        return pool[Math.floor(this.rng() * pool.length)];
      case 'least-connections': {
        // Start the scan at a rotating offset so ties do not always favor server 0.
        let best: ServerState | undefined;
        for (let offset = 0; offset < pool.length; offset += 1) {
          const candidate = pool[(this.cursor + offset) % pool.length];
          if (candidate && (!best || candidate.queue.length < best.queue.length)) best = candidate;
        }
        this.cursor = (this.cursor + 1) % pool.length;
        return best;
      }
      default: {
        const server = pool[this.cursor % pool.length];
        this.cursor = (this.cursor + 1) % pool.length;
        return server;
      }
    }
  }

  /** Request cost in "average requests", so capacity stays in requests per second. */
  private drawCost(): number {
    const { heavyShare, heavyFactor } = this.config;
    const light = 1 / (1 - heavyShare + heavyShare * heavyFactor);
    return this.rng() < heavyShare ? light * heavyFactor : light;
  }

  private process(server: ServerState, dt: number): { served: number; utilization: number } {
    const budget = server.capacity * dt;
    let remaining = budget;
    let clock = this.time;
    let served = 0;
    while (server.queue.length > 0 && remaining > 1e-9) {
      const head = server.queue[0];
      if (!head) break;
      const work = Math.min(head.remaining, remaining);
      head.remaining -= work;
      remaining -= work;
      clock += work / server.capacity;
      if (head.remaining <= 1e-9) {
        server.queue.shift();
        served += 1;
        this.latencies.push({ time: this.time + dt, ms: (clock - head.arrivedAt) * 1000 });
      }
    }
    return { served, utilization: budget === 0 ? 0 : (budget - remaining) / budget };
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
