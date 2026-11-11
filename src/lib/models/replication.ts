import { createRng, type Rng, randomInt } from '../rng';

/**
 * One primary database takes every write. Replicas copy those writes after a
 * delay (replication lag) and serve reads. A read that reaches a replica
 * before the write it needs returns "not found": a stale read.
 */
export interface ReplicationConfig {
  replicas: number;
  /** Ticks between a write landing on the primary and appearing on replicas. */
  lagTicks: number;
  writesPerTick: number;
  readsPerTick: number;
  /** Share of reads where people open a link they created a moment ago. */
  freshReadShare: number;
  /** Send a person's reads of their own new links to the primary. */
  readYourWrites: boolean;
  /** Operations per tick a single database node can handle. */
  nodeCapacity: number;
  seed: number;
}

export const defaultReplicationConfig: ReplicationConfig = {
  replicas: 0,
  lagTicks: 5,
  writesPerTick: 4,
  readsPerTick: 40,
  freshReadShare: 0.1,
  readYourWrites: false,
  nodeCapacity: 30,
  seed: 11,
};

export type NodeId = 'primary' | number;

export interface ReplicationEvent {
  kind: 'write' | 'read';
  node: NodeId;
  key: number;
  stale: boolean;
}

export interface ReplicationTick {
  tick: number;
  writes: number;
  reads: number;
  staleReads: number;
  /** Operations each node received this tick: primary first, then replicas. */
  loads: number[];
  /** Operations above a node's capacity, which would queue or time out. */
  overloaded: number;
  sample: ReplicationEvent[];
}

export interface ReplicationStats {
  readCapacityPerTick: number;
  staleReadRate: number;
  primaryUtilization: number;
  maxReplicaUtilization: number;
  overloadedPerTick: number;
}

const WINDOW_TICKS = 20;
const SAMPLE_SIZE = 8;
/** Reads of "fresh" links target links created within this many ticks. */
const FRESH_WINDOW_TICKS = 8;

export class ReplicationSim {
  private config: ReplicationConfig;
  private rng: Rng;
  private tick = 0;
  private writeTicks: number[] = [];
  private cursor = 0;
  private window: ReplicationTick[] = [];

  constructor(config: Partial<ReplicationConfig> = {}) {
    this.config = { ...defaultReplicationConfig, ...config };
    this.rng = createRng(this.config.seed);
    // Pre-existing links that every replica already has.
    for (let i = 0; i < 500; i += 1) this.writeTicks.push(-1_000);
  }

  get settings(): Readonly<ReplicationConfig> {
    return this.config;
  }

  update(changes: Partial<Omit<ReplicationConfig, 'seed'>>): void {
    this.config = { ...this.config, ...changes };
  }

  /** Highest tick whose writes a replica has applied. */
  replicatedThrough(): number {
    return this.tick - this.config.lagTicks;
  }

  step(): ReplicationTick {
    this.tick += 1;
    const { replicas, writesPerTick, readsPerTick, freshReadShare, readYourWrites } = this.config;
    const loads = new Array<number>(replicas + 1).fill(0);
    const sample: ReplicationEvent[] = [];

    for (let i = 0; i < writesPerTick; i += 1) {
      this.writeTicks.push(this.tick);
      loads[0] = (loads[0] ?? 0) + 1;
      if (sample.length < SAMPLE_SIZE / 2) {
        sample.push({ kind: 'write', node: 'primary', key: this.writeTicks.length - 1, stale: false });
      }
    }

    let staleReads = 0;
    for (let i = 0; i < readsPerTick; i += 1) {
      const fresh = this.rng() < freshReadShare;
      const key = fresh ? this.pickFreshKey() : randomInt(this.rng, 0, 499);
      const node: NodeId = replicas === 0 || (fresh && readYourWrites) ? 'primary' : this.nextReplica();
      const index = node === 'primary' ? 0 : node + 1;
      loads[index] = (loads[index] ?? 0) + 1;
      const writtenAt = this.writeTicks[key] ?? -1_000;
      const stale = node !== 'primary' && writtenAt > this.replicatedThrough();
      if (stale) staleReads += 1;
      if (sample.length < SAMPLE_SIZE) sample.push({ kind: 'read', node, key, stale });
    }

    const overloaded = loads.reduce((sum, load) => sum + Math.max(0, load - this.config.nodeCapacity), 0);
    const result: ReplicationTick = {
      tick: this.tick,
      writes: writesPerTick,
      reads: readsPerTick,
      staleReads,
      loads,
      overloaded,
      sample,
    };
    this.window.push(result);
    if (this.window.length > WINDOW_TICKS) this.window.shift();
    return result;
  }

  stats(): ReplicationStats {
    const ticks = Math.max(1, this.window.length);
    const reads = this.window.reduce((sum, tick) => sum + tick.reads, 0);
    const stale = this.window.reduce((sum, tick) => sum + tick.staleReads, 0);
    const average = (index: number) =>
      this.window.reduce((sum, tick) => sum + (tick.loads[index] ?? 0), 0) / ticks;
    const replicaUtilization = Array.from(
      { length: this.config.replicas },
      (_, i) => average(i + 1) / this.config.nodeCapacity,
    );
    return {
      readCapacityPerTick: this.config.nodeCapacity * (this.config.replicas + 1) - this.config.writesPerTick,
      staleReadRate: reads === 0 ? 0 : stale / reads,
      primaryUtilization: average(0) / this.config.nodeCapacity,
      maxReplicaUtilization: replicaUtilization.length === 0 ? 0 : Math.max(...replicaUtilization),
      overloadedPerTick: this.window.reduce((sum, tick) => sum + tick.overloaded, 0) / ticks,
    };
  }

  private pickFreshKey(): number {
    const newest = this.writeTicks.length - 1;
    let oldest = newest;
    while (oldest > 0 && (this.writeTicks[oldest - 1] ?? -1_000) > this.tick - FRESH_WINDOW_TICKS) {
      oldest -= 1;
    }
    return randomInt(this.rng, oldest, newest);
  }

  private nextReplica(): number {
    const replica = this.cursor % this.config.replicas;
    this.cursor = (this.cursor + 1) % this.config.replicas;
    return replica;
  }
}
