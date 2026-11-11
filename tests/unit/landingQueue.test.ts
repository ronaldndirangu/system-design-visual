import { describe, expect, it } from 'vitest';
import { LANDING_CAPACITY, LandingQueue } from '../../src/lib/models/landingQueue';

const TICK_MS = 1000 / 60;

/** Feed `rate` requests per second through the balancer for `seconds`, one frame at a time. */
function run(queue: LandingQueue, rate: number, seconds: number) {
  let carry = 0;
  for (let t = 0; t < seconds * 1000; t += TICK_MS) {
    carry += (rate * TICK_MS) / 1000;
    while (carry >= 1) {
      carry -= 1;
      queue.route(queue.arrive());
    }
    queue.advance(TICK_MS);
  }
  return queue.stats();
}

function conserved(queue: LandingQueue) {
  const totals = queue.totals();
  return totals.served + totals.dropped + totals.inSystem === totals.arrived;
}

describe('LandingQueue', () => {
  it('drops nothing while arrivals stay under capacity', () => {
    const queue = new LandingQueue(2);
    run(queue, 8, 30);
    expect(queue.totals().dropped).toBe(0);
    expect(queue.stats().servedPerSecond).toBeCloseTo(8, 0);
  });

  it('drops roughly the excess once one server is overloaded', () => {
    const queue = new LandingQueue(1);
    run(queue, 8, 10);
    const stats = run(queue, 8, 8);
    expect(stats.servedPerSecond).toBeCloseTo(5, 0);
    expect(stats.droppedPerSecond).toBeGreaterThan(2.5);
    expect(stats.droppedPerSecond).toBeLessThan(3.5);
    expect(queue.queueLength(0)).toBeLessThanOrEqual(LANDING_CAPACITY);
  });

  it('never drops when servers are added or removed under light load', () => {
    const queue = new LandingQueue(1);
    for (const servers of [2, 3, 4, 3, 2, 1, 4, 1]) {
      expect(queue.setServers(servers).every((move) => move.accepted)).toBe(true);
      run(queue, 4, 3);
    }
    expect(queue.totals().dropped).toBe(0);
    expect(conserved(queue)).toBe(true);
  });

  it('hands a removed server queue to the survivors', () => {
    const queue = new LandingQueue(2);
    for (let i = 0; i < 6; i += 1) queue.route(queue.arrive());
    expect(queue.queueLength(1)).toBe(3);
    const moves = queue.setServers(1);
    expect(moves).toHaveLength(3);
    expect(moves.every((move) => move.server === 0 && move.accepted)).toBe(true);
    expect(queue.queueLength(0)).toBe(6);
  });

  it('stops dropping after a second server joins an overloaded one', () => {
    const queue = new LandingQueue(1);
    run(queue, 8, 10);
    queue.setServers(2);
    run(queue, 8, 6);
    const dropped = queue.totals().dropped;
    run(queue, 8, 10);
    expect(queue.totals().dropped).toBe(dropped);
  });

  it('keeps every request accounted for under heavy churn', () => {
    const queue = new LandingQueue(1);
    for (const servers of [1, 4, 2, 1, 3]) {
      queue.setServers(servers);
      run(queue, 25, 4);
      expect(conserved(queue)).toBe(true);
    }
  });

  it('ignores a request routed twice', () => {
    const queue = new LandingQueue(1);
    const id = queue.arrive();
    expect(queue.route(id)?.accepted).toBe(true);
    expect(queue.route(id)).toBeUndefined();
    expect(queue.totals().inSystem).toBe(1);
  });
});
