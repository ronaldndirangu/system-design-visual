import { describe, expect, it } from 'vitest';
import { ReplicationSim } from '../../src/lib/models/replication';

function run(sim: ReplicationSim, ticks = 60) {
  for (let i = 0; i < ticks; i += 1) sim.step();
  return sim.stats();
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

  it('serves no stale reads with zero lag', () => {
    expect(run(new ReplicationSim({ replicas: 2, lagTicks: 0 })).staleReadRate).toBe(0);
  });

  it('read-your-writes removes stale reads of fresh links', () => {
    expect(run(new ReplicationSim({ replicas: 2, readYourWrites: true })).staleReadRate).toBe(0);
  });

  it('more lag means more stale reads', () => {
    const short = run(new ReplicationSim({ replicas: 2, lagTicks: 1 })).staleReadRate;
    const long = run(new ReplicationSim({ replicas: 2, lagTicks: 8 })).staleReadRate;
    expect(long).toBeGreaterThan(short);
  });

  it('reports read capacity as every node minus the writes', () => {
    const sim = new ReplicationSim({ replicas: 3, nodeCapacity: 30, writesPerTick: 4 });
    expect(sim.stats().readCapacityPerTick).toBe(30 * 4 - 4);
  });
});
