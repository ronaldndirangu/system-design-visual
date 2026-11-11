import { createRng, type Rng, randomInt } from '../rng';

/**
 * One primary database takes every write. Replicas replay those writes after a
 * delay (replication lag) and serve reads. Replaying a write costs a replica
 * real work, so heavy writes eat into the reads it can serve. Each replica lags
 * by its own amount. A read that reaches a replica before the write it needs
 * returns "not found": a stale read.
 */
export interface ReplicationConfig {
  replicas: number;
  /** Average ticks between a write landing on the primary and appearing on a replica. */
  lagTicks: number;
  writesPerTick: number;
  readsPerTick: number;
  /** Share of reads where people open a link they created a moment ago. */
  freshReadShare: number;
  /**
   * Reads of a person's own new links carry the log position of their write.
   * A replica that has not applied that position hands the read to the primary.
   */
  readYourWrites: boolean;
  /** Operations per tick a single database node can handle. */
  nodeCapacity: number;
  /** Operations one replayed write costs each replica. */
  replayCost: number;
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
  replayCost: 1,
  seed: 11,
};

export type NodeId = 'primary' | number;

export interface ReplicationEvent {
  kind: 'write' | 'read';
  node: NodeId;
  key: number;
  stale: boolean;
  /** A stale read of a link that an earlier read had already found. */
  timeTravel: boolean;
}

export interface ReplicationTick {
  tick: number;
  writes: number;
  reads: number;
  staleReads: number;
  /** Stale reads after an earlier read had found the same link (monotonic-read violations). */
  timeTravelReads: number;
  /** Operations each node handled this tick: primary first, then replicas. Replays count `replayCost` each. */
  loads: number[];
  /** Operations above a node's capacity, which would queue or time out. */
  overloaded: number;
  sample: ReplicationEvent[];
}

export interface ReplicationStats {
  /** Reads per tick the routing policy can serve: the replicas, or the primary when there are none. */
  readCapacityPerTick: number;
  staleReadRate: number;
  /** Reads in the window that went back in time. */
  timeTravelReads: number;
  primaryUtilization: number;
  maxReplicaUtilization: number;
  overloadedPerTick: number;
}

const WINDOW_TICKS = 20;
const SAMPLE_SIZE = 8;
/** Reads of "fresh" links target links created within this many ticks. */
const FRESH_WINDOW_TICKS = 8;
const OLD_KEYS = 500;
const OLD_WRITE_TICK = -1_000;

export class ReplicationSim {
  private config: ReplicationConfig;
  private rng: Rng;
  /** Separate stream so adding replicas never shifts the read traffic. */
  private lagRng: Rng;
  private lagJitter: number[] = [];
  private applied: number[] = [];
  private tick = 0;
  private writeTicks: number[] = [];
  private found: boolean[] = [];
  private cursor = 0;
  private window: ReplicationTick[] = [];

  constructor(config: Partial<ReplicationConfig> = {}) {
    this.config = { ...defaultReplicationConfig, ...config };
    this.rng = createRng(this.config.seed);
    this.lagRng = createRng(this.config.seed + 1);
    // Pre-existing links that every replica already has.
    for (let i = 0; i < OLD_KEYS; i += 1) {
      this.writeTicks.push(OLD_WRITE_TICK);
      this.found.push(true);
    }
  }

  get settings(): Readonly<ReplicationConfig> {
    return this.config;
  }

  update(changes: Partial<Omit<ReplicationConfig, 'seed'>>): void {
    this.config = { ...this.config, ...changes };
  }

  /** Ticks a replica trails the primary: between half and one and a half times the average lag. */
  replicaLag(replica: number): number {
    while (this.lagJitter.length <= replica) this.lagJitter.push(this.lagRng());
    return Math.round(this.config.lagTicks * (0.5 + (this.lagJitter[replica] ?? 0)));
  }

  replicaLags(): number[] {
    return Array.from({ length: this.config.replicas }, (_, i) => this.replicaLag(i));
  }

  /** Highest tick whose writes this replica has applied. It never moves backwards. */
  replicatedThrough(replica: number): number {
    return this.applied[replica] ?? this.tick - this.replicaLag(replica);
  }

  /**
   * Acknowledged writes each replica has not applied yet: what the primary's
   * crash would lose if that replica were promoted.
   */
  failoverLoss(): number[] {
    return Array.from({ length: this.config.replicas }, (_, i) => {
      const through = this.replicatedThrough(i);
      let lost = 0;
      for (let key = this.writeTicks.length - 1; key >= 0; key -= 1) {
        if ((this.writeTicks[key] ?? OLD_WRITE_TICK) <= through) break;
        lost += 1;
      }
      return lost;
    });
  }

  step(): ReplicationTick {
    this.tick += 1;
    const { replicas, writesPerTick, readsPerTick, freshReadShare, readYourWrites, replayCost } = this.config;
    const loads = new Array<number>(replicas + 1).fill(0);
    const sample: ReplicationEvent[] = [];
    for (let r = 0; r < replicas; r += 1) {
      this.applied[r] = Math.max(this.applied[r] ?? Number.NEGATIVE_INFINITY, this.tick - this.replicaLag(r));
    }

    for (let i = 0; i < writesPerTick; i += 1) {
      this.writeTicks.push(this.tick);
      this.found.push(false);
      loads[0] = (loads[0] ?? 0) + 1;
      if (sample.length < SAMPLE_SIZE / 2) {
        sample.push({
          kind: 'write',
          node: 'primary',
          key: this.writeTicks.length - 1,
          stale: false,
          timeTravel: false,
        });
      }
    }
    for (let r = 1; r <= replicas; r += 1) loads[r] = writesPerTick * replayCost;

    let staleReads = 0;
    let timeTravelReads = 0;
    for (let i = 0; i < readsPerTick; i += 1) {
      const fresh = this.rng() < freshReadShare;
      const key = fresh ? this.pickFreshKey() : randomInt(this.rng, 0, OLD_KEYS - 1);
      const writtenAt = this.writeTicks[key] ?? OLD_WRITE_TICK;
      let node: NodeId = 'primary';
      if (replicas > 0) {
        const replica = this.nextReplica();
        const caughtUp = writtenAt <= this.replicatedThrough(replica);
        node = fresh && readYourWrites && !caughtUp ? 'primary' : replica;
      }
      const index = node === 'primary' ? 0 : node + 1;
      loads[index] = (loads[index] ?? 0) + 1;
      const stale = node !== 'primary' && writtenAt > this.replicatedThrough(node);
      const timeTravel = stale && this.found[key] === true;
      if (stale) staleReads += 1;
      else this.found[key] = true;
      if (timeTravel) timeTravelReads += 1;
      if (sample.length < SAMPLE_SIZE) sample.push({ kind: 'read', node, key, stale, timeTravel });
    }

    const overloaded = loads.reduce((sum, load) => sum + Math.max(0, load - this.config.nodeCapacity), 0);
    const result: ReplicationTick = {
      tick: this.tick,
      writes: writesPerTick,
      reads: readsPerTick,
      staleReads,
      timeTravelReads,
      loads,
      overloaded,
      sample,
    };
    this.window.push(result);
    if (this.window.length > WINDOW_TICKS) this.window.shift();
    return result;
  }

  stats(): ReplicationStats {
    const { replicas, nodeCapacity, writesPerTick, replayCost } = this.config;
    const ticks = Math.max(1, this.window.length);
    const reads = this.window.reduce((sum, tick) => sum + tick.reads, 0);
    const stale = this.window.reduce((sum, tick) => sum + tick.staleReads, 0);
    const average = (index: number) =>
      this.window.reduce((sum, tick) => sum + (tick.loads[index] ?? 0), 0) / ticks;
    const replicaUtilization = Array.from({ length: replicas }, (_, i) => average(i + 1) / nodeCapacity);
    return {
      readCapacityPerTick:
        replicas === 0
          ? Math.max(0, nodeCapacity - writesPerTick)
          : replicas * Math.max(0, nodeCapacity - writesPerTick * replayCost),
      staleReadRate: reads === 0 ? 0 : stale / reads,
      timeTravelReads: this.window.reduce((sum, tick) => sum + tick.timeTravelReads, 0),
      primaryUtilization: average(0) / nodeCapacity,
      maxReplicaUtilization: replicaUtilization.length === 0 ? 0 : Math.max(...replicaUtilization),
      overloadedPerTick: this.window.reduce((sum, tick) => sum + tick.overloaded, 0) / ticks,
    };
  }

  private pickFreshKey(): number {
    const newest = this.writeTicks.length - 1;
    let oldest = newest;
    while (oldest > 0 && (this.writeTicks[oldest - 1] ?? OLD_WRITE_TICK) > this.tick - FRESH_WINDOW_TICKS) {
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
