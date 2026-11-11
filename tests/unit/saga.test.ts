import { describe, expect, it } from 'vitest';
import {
  createWorkload,
  INITIAL_STOCK,
  type LaneState,
  orderCells,
  runSaga,
  SAGA_LENGTH,
  SagaDuel,
  type SagaScenarioId,
  sagaScenarioOrder,
  sagaScenarios,
  summarizeLane,
  whereIs,
} from '../../src/lib/models/saga';

function laneOf(duel: SagaDuel, style: 'orchestration' | 'choreography'): LaneState {
  const lane = duel.lanes.find((candidate) => candidate.style === style);
  if (!lane) throw new Error(`Missing ${style} lane`);
  return lane;
}

function stepTo(duel: SagaDuel, tick: number) {
  while (duel.ticks < tick) duel.step();
}

describe('saga workload', () => {
  it('is seeded and pinned for the lesson prose', () => {
    expect(createWorkload()).toEqual([
      { id: 1, items: 2, amount: 65, startTick: 0 },
      { id: 2, items: 3, amount: 90, startTick: 4 },
      { id: 3, items: 1, amount: 75, startTick: 8 },
      { id: 4, items: 1, amount: 85, startTick: 12 },
      { id: 5, items: 3, amount: 65, startTick: 16 },
      { id: 6, items: 1, amount: 110, startTick: 20 },
    ]);
    expect(createWorkload(7)).toEqual(createWorkload(7));
  });

  it('gives every scenario chip a label, a diff, and a focus order', () => {
    for (const id of sagaScenarioOrder) {
      const scenario = sagaScenarios[id];
      expect(scenario.id).toBe(id);
      expect(scenario.label.length).toBeGreaterThan(0);
      expect(scenario.diff.length).toBeGreaterThan(0);
      expect(scenario.focusOrder).toBeGreaterThan(0);
    }
  });
});

describe('SagaDuel playback', () => {
  it('replays a scenario exactly', () => {
    for (const id of sagaScenarioOrder) {
      const a = runSaga(id);
      const b = runSaga(id);
      expect(b.lanes).toEqual(a.lanes);
      expect(b.events).toEqual(a.events);
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const duel = new SagaDuel('courier');
    const start = duel.checkpoint();
    stepTo(duel, SAGA_LENGTH);
    const firstLanes = structuredClone(duel.lanes);
    const firstEvents = structuredClone(duel.events);
    duel.restore(start);
    expect(duel.ticks).toBe(0);
    expect(duel.events).toEqual([]);
    stepTo(duel, SAGA_LENGTH);
    expect(duel.lanes).toEqual(firstLanes);
    expect(duel.events).toEqual(firstEvents);
  });

  it('resumes from a midway checkpoint without sharing state', () => {
    const duel = new SagaDuel('no-dedupe');
    stepTo(duel, 9);
    const saved = duel.checkpoint();
    stepTo(duel, SAGA_LENGTH);
    const finished = structuredClone(duel.lanes);
    duel.restore(saved);
    expect(duel.ticks).toBe(9);
    stepTo(duel, SAGA_LENGTH);
    expect(duel.lanes).toEqual(finished);
  });

  it('runs both lanes on the same orders and stops at the run length', () => {
    const duel = runSaga('courier');
    expect(duel.ticks).toBe(SAGA_LENGTH);
    duel.step();
    expect(duel.ticks).toBe(SAGA_LENGTH);
    for (const lane of duel.lanes) {
      expect(lane.stockSeries).toHaveLength(SAGA_LENGTH);
      expect(summarizeLane(lane, duel.workload).started).toBe(duel.workload.length);
    }
    const checkouts = duel.events.filter((event) => event.lane === null && event.text.includes('checks out'));
    expect(checkouts).toHaveLength(duel.workload.length);
  });

  it('keeps inFlight to the messages sent in the last tick', () => {
    const duel = new SagaDuel('happy');
    duel.step();
    const [orchestration, choreography] = duel.lanes;
    expect(orchestration.inFlight.map((msg) => msg.kind)).toEqual(['Reserve']);
    expect(choreography.inFlight.map((msg) => [msg.kind, msg.to])).toEqual([['OrderPlaced', 'bus']]);
    duel.step();
    expect(orchestration.inFlight.map((msg) => msg.kind)).toEqual(['Reserved']);
    expect(choreography.inFlight.map((msg) => [msg.kind, msg.to])).toEqual([['OrderPlaced', 'inventory']]);
  });
});

describe('saga conservation', () => {
  it('balances orders, money, and stock in every scenario and at every tick', () => {
    for (const id of sagaScenarioOrder) {
      const duel = new SagaDuel(id);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          const summary = summarizeLane(lane, duel.workload);
          const running = lane.orders.filter((state) => state.outcome === 'running').length;
          expect(summary.started).toBe(summary.completed + summary.compensated + running);

          const completed = duel.workload.filter(
            (order) => lane.orders[order.id - 1]?.outcome === 'completed',
          );
          const held = duel.workload.filter((order) => lane.orders[order.id - 1]?.inventory === 'reserved');
          const unitsHeld = held.reduce((sum, order) => sum + order.items, 0);
          expect(summary.reservedUnits - summary.releasedUnits).toBe(unitsHeld);
          expect(summary.stock).toBe(INITIAL_STOCK - unitsHeld);

          const charged = duel.workload.filter((order) => lane.orders[order.id - 1]?.payment === 'charged');
          const moneyHeld = charged.reduce((sum, order) => sum + order.amount, 0);
          expect(summary.charged - summary.refunded - summary.overcharged).toBe(moneyHeld);

          if (duel.done) {
            expect(running).toBe(0);
            expect(unitsHeld).toBe(completed.reduce((sum, order) => sum + order.items, 0));
            expect(moneyHeld).toBe(completed.reduce((sum, order) => sum + order.amount, 0));
          }
        }
      }
    }
  });
});

describe('compensation', () => {
  it('refunds before releasing, in reverse order of the finished steps', () => {
    const duel = runSaga('courier');
    for (const lane of duel.lanes) {
      const order3 = lane.orders[2];
      expect(order3?.outcome).toBe('compensated');
      expect(order3?.shipping).toBe('rejected');
      expect(order3?.payment).toBe('refunded');
      expect(order3?.inventory).toBe('released');
      expect(order3?.refundedAt ?? 0).toBeLessThan(order3?.releasedAt ?? 0);
      expect(order3?.reservedAt ?? 0).toBeLessThan(order3?.chargedAt ?? 0);
    }
  });

  it('releases stock without a refund when the card is declined', () => {
    const duel = runSaga('declined');
    for (const lane of duel.lanes) {
      const order2 = lane.orders[1];
      expect(order2?.payment).toBe('declined');
      expect(order2?.inventory).toBe('released');
      expect(order2?.shipping).toBe('none');
      expect(lane.refundedTotal).toBe(0);
    }
  });

  it('shows the order grid as each service records it', () => {
    const duel = runSaga('courier');
    const order3 = duel.workload[2];
    if (!order3) throw new Error('Missing order 3');
    const cells = orderCells(laneOf(duel, 'orchestration'), order3);
    expect(cells.map((cell) => [cell.status, cell.text])).toEqual([
      ['undone', 'Released 1 item'],
      ['undone', 'Refunded $75'],
      ['failed', 'No courier'],
    ]);

    const declined = runSaga('declined');
    const order2 = declined.workload[1];
    if (!order2) throw new Error('Missing order 2');
    expect(orderCells(laneOf(declined, 'choreography'), order2).map((cell) => cell.status)).toEqual([
      'undone',
      'failed',
      'skipped',
    ]);
  });
});

describe('retries and idempotency', () => {
  it('charges once when Payments dedupes the retried charge', () => {
    const duel = runSaga('lost-reply');
    for (const lane of duel.lanes) {
      expect(lane.orders[1]?.charges).toBe(1);
      expect(lane.overcharged).toBe(0);
      expect(lane.orders[1]?.outcome).toBe('completed');
    }
  });

  it('charges order 2 twice when Payments does not dedupe', () => {
    const duel = runSaga('no-dedupe');
    const order2 = duel.workload[1];
    if (!order2) throw new Error('Missing order 2');
    for (const lane of duel.lanes) {
      expect(lane.orders[1]?.charges).toBe(2);
      expect(lane.overcharged).toBe(order2.amount);
      expect(orderCells(lane, order2)[1]).toEqual({
        step: 'charge',
        status: 'doubled',
        text: 'Charged $90 twice',
      });
    }
  });
});

describe('where is the order', () => {
  it('asks one saga log under orchestration and four services under choreography', () => {
    const duel = new SagaDuel('courier');
    stepTo(duel, 15);
    const order3 = duel.workload[2];
    if (!order3) throw new Error('Missing order 3');
    expect(whereIs(laneOf(duel, 'orchestration'), order3)).toEqual([
      { place: 'Saga log', answer: 'Compensating, refunding card' },
    ]);
    const spread = whereIs(laneOf(duel, 'choreography'), order3);
    expect(spread.map((entry) => entry.place)).toEqual(['Orders', 'Inventory', 'Payments', 'Shipping']);
    expect(spread[0]?.answer).toBe('Placed, outcome unknown');
  });
});

describe('pinned lesson numbers', () => {
  const pinned: Record<SagaScenarioId, [number, number]> = {
    happy: [36, 48],
    courier: [40, 52],
    declined: [36, 48],
    'lost-reply': [38, 50],
    'no-dedupe': [38, 50],
  };

  it('pins the message counts for both styles', () => {
    for (const id of sagaScenarioOrder) {
      const duel = runSaga(id);
      expect(duel.lanes.map((lane) => lane.sent)).toEqual(pinned[id]);
    }
  });

  it('pins the happy path timings and the final stock', () => {
    const duel = runSaga('happy');
    const [orchestration, choreography] = duel.lanes.map((lane) => summarizeLane(lane, duel.workload));
    expect(orchestration?.slowestMs).toBe(600);
    expect(choreography?.slowestMs).toBe(800);
    expect(orchestration?.charged).toBe(490);
    expect(orchestration?.stock).toBe(13);
    expect(orchestration?.placesToAsk).toBe(1);
    expect(choreography?.placesToAsk).toBe(4);
  });

  it('pins the courier failure for order 3', () => {
    const duel = runSaga('courier');
    const summaries = duel.lanes.map((lane) => summarizeLane(lane, duel.workload));
    for (const summary of summaries) {
      expect(summary.completed).toBe(5);
      expect(summary.compensated).toBe(1);
      expect(summary.charged).toBe(490);
      expect(summary.refunded).toBe(75);
      expect(summary.longestHoldMs).toBe(800);
      expect(summary.stock).toBe(14);
    }
    expect(summaries.map((summary) => summary.slowestMs)).toEqual([1000, 1200]);
    const refunds = duel.events.filter((event) => event.text.includes('refunds $75 for order 3, 400 ms'));
    expect(refunds).toHaveLength(2);
  });

  it('pins the declined card for order 2', () => {
    const duel = runSaga('declined');
    for (const lane of duel.lanes) {
      const summary = summarizeLane(lane, duel.workload);
      expect(summary.charged).toBe(400);
      expect(summary.releasedUnits).toBe(3);
      expect(summary.longestHoldMs).toBe(400);
    }
  });

  it('pins the double charge without dedupe', () => {
    const duel = runSaga('no-dedupe');
    for (const lane of duel.lanes) {
      const summary = summarizeLane(lane, duel.workload);
      expect(summary.charged).toBe(580);
      expect(summary.overcharged).toBe(90);
    }
  });
});
