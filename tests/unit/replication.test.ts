import { describe, expect, it } from 'vitest';
import { ReplicationSim } from '../../src/lib/models/replication';

function run(sim: ReplicationSim, ticks = 60) {
  for (let i = 0; i < ticks; i += 1) sim.step();
  return sim.stats();
}

function totals(sim: ReplicationSim, ticks = 200) {
  let stale = 0;
  let timeTravel = 0;
  let primaryReads = 0;
  for (let i = 0; i < ticks; i += 1) {
    const tick = sim.step();
    stale += tick.staleReads;
    timeTravel += tick.timeTravelReads;
    primaryReads += (tick.loads[0] ?? 0) - tick.writes;
  }
  return { stale, timeTravel, primaryReads };
}

describe('ReplicationSim', () => {
  it('overloads a lone primary with the default traffic', () => {
    const stats = run(new ReplicationSim({ replicas: 0 }));
    expect(stats.primaryUtilization).toBeGreaterThan(1);
    expect(stats.overloadedPerTick).toBeGreaterThan(0);
    expect(stats.staleReadRate).toBe(0);
  });

  it('spreads reads over replicas and removes the overload', () => {
    const stats = run(new ReplicationSim({ replicas: 2 }));
    expect(stats.overloadedPerTick).toBe(0);
    expect(stats.primaryUtilization).toBeLessThan(0.5);
    expect(stats.maxReplicaUtilization).toBeLessThan(1);
  });

  it('serves some stale reads from lagging replicas', () => {
    const stats = run(new ReplicationSim({ replicas: 2, lagTicks: 5 }));
    expect(stats.staleReadRate).toBeGreaterThan(0);
  });

  it('serves no stale or time-travel reads with zero lag', () => {
    const result = totals(new ReplicationSim({ replicas: 3, lagTicks: 0 }));
    expect(result.stale).toBe(0);
    expect(result.timeTravel).toBe(0);
  });

  it('more lag means more stale reads', () => {
    const short = run(new ReplicationSim({ replicas: 2, lagTicks: 1 })).staleReadRate;
    const long = run(new ReplicationSim({ replicas: 2, lagTicks: 8 })).staleReadRate;
    expect(long).toBeGreaterThan(short);
  });

  it('charges every replica for replaying each write', () => {
    const sim = new ReplicationSim({ replicas: 2, writesPerTick: 4, readsPerTick: 40, replayCost: 1 });
    const tick = sim.step();
    expect(tick.loads[1]).toBe(4 + 20);
    expect(tick.loads[2]).toBe(4 + 20);
  });

  it('read capacity falls as writes rise, because replicas replay them', () => {
    const capacity = (writesPerTick: number) =>
      new ReplicationSim({ replicas: 3, nodeCapacity: 30, writesPerTick }).stats().readCapacityPerTick;
    expect(capacity(0)).toBe(90);
    expect(capacity(4)).toBe(3 * (30 - 4));
    expect(capacity(8)).toBeLessThan(capacity(4));
    expect(capacity(30)).toBe(0);
  });

  it('counts only the nodes that reads route to', () => {
    const lone = new ReplicationSim({ replicas: 0, nodeCapacity: 30, writesPerTick: 4 });
    expect(lone.stats().readCapacityPerTick).toBe(26);
    const one = new ReplicationSim({ replicas: 1, nodeCapacity: 30, writesPerTick: 4, readsPerTick: 40 });
    expect(one.stats().readCapacityPerTick).toBeLessThan(40);
    expect(run(one).overloadedPerTick).toBeGreaterThan(0);
  });

  it('gives each replica its own lag around the average', () => {
    const sim = new ReplicationSim({ replicas: 4, lagTicks: 10 });
    const lags = sim.replicaLags();
    expect(new Set(lags).size).toBeGreaterThan(1);
    for (const lag of lags) {
      expect(lag).toBeGreaterThanOrEqual(5);
      expect(lag).toBeLessThanOrEqual(15);
    }
  });

  it('counts a stale read as time travel only when an earlier read found the link', () => {
    const sim = new ReplicationSim({
      replicas: 2,
      lagTicks: 5,
      writesPerTick: 1,
      readsPerTick: 7,
      freshReadShare: 0.9,
    });
    const found = new Set<number>();
    let timeTravel = 0;
    let staleBeforeFound = 0;
    for (let i = 0; i < 300; i += 1) {
      const tick = sim.step();
      const reads = tick.sample.filter((event) => event.kind === 'read');
      expect(reads).toHaveLength(tick.reads);
      for (const read of reads) {
        expect(read.timeTravel).toBe(read.stale && found.has(read.key));
        if (read.timeTravel) timeTravel += 1;
        else if (read.stale) staleBeforeFound += 1;
        if (!read.stale) found.add(read.key);
      }
    }
    expect(timeTravel).toBeGreaterThan(0);
    expect(staleBeforeFound).toBeGreaterThan(0);
  });

  it('the read-your-writes token removes stale and time-travel reads', () => {
    const result = totals(new ReplicationSim({ replicas: 3, lagTicks: 8, readYourWrites: true }));
    expect(result.stale).toBe(0);
    expect(result.timeTravel).toBe(0);
    expect(result.primaryReads).toBeGreaterThan(0);
  });

  it('never un-applies writes on a replica when lag rises', () => {
    const sim = new ReplicationSim({ replicas: 2, lagTicks: 2 });
    run(sim, 30);
    const before = sim.replicatedThrough(0);
    sim.update({ lagTicks: 10 });
    sim.step();
    expect(sim.replicatedThrough(0)).toBeGreaterThanOrEqual(before);
  });

  it('a failover loses the acknowledged writes the promoted replica lacks', () => {
    const sim = new ReplicationSim({ replicas: 2, lagTicks: 5, writesPerTick: 4 });
    run(sim, 30);
    const lags = sim.replicaLags();
    expect(sim.failoverLoss()).toEqual(lags.map((lag) => lag * 4));
    const synced = new ReplicationSim({ replicas: 2, lagTicks: 0 });
    run(synced, 30);
    expect(synced.failoverLoss()).toEqual([0, 0]);
  });
});
