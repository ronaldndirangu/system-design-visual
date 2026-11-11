import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  Checkout,
  type CheckoutCommand,
  type CheckoutConditions,
  type CheckoutTick,
  generateOrders,
  IdemDuel,
  type IdemScenarioId,
  idemScenarios,
  type KeyPolicy,
  summarizeCheckout,
} from '../../src/lib/models/idempotency';

const policies: KeyPolicy[] = ['none', 'after', 'claim'];
const scenarioIds = Object.keys(idemScenarios) as IdemScenarioId[];
const orders42 = generateOrders(42);

function play(
  checkout: Checkout,
  ticks: number,
  schedule: ScheduledCommand<CheckoutCommand>[] = idemScenarios.slow.schedule,
): CheckoutTick[] {
  const out: CheckoutTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(checkout, schedule));
  return out;
}

const slowStart: CheckoutConditions = idemScenarios.slow.conditions;

const run = (duel: IdemDuel) => {
  while (!duel.done) duel.step();
  return duel;
};

const summaries = (id: IdemScenarioId, seed = 42) =>
  run(new IdemDuel(idemScenarios[id], seed)).lanes.map(summarizeCheckout);

describe('Checkout playback', () => {
  it('feeds every policy the same orders, tick by tick', () => {
    for (const id of scenarioIds) {
      const scenario = idemScenarios[id];
      const counts = policies.map((policy) => {
        const checkout = new Checkout(policy, orders42, scenario.conditions);
        return Array.from({ length: 200 }, () => {
          stepScheduled(checkout, scenario.schedule);
          return checkout.totals.orders;
        });
      });
      expect(new Set(counts[0]).size).toBeGreaterThan(30);
      for (const other of counts.slice(1)) expect(other).toEqual(counts[0]);
      expect(counts[0]?.at(-1)).toBe(orders42.length);
    }
  });

  it('draws the same workload for the same seed', () => {
    expect(generateOrders(7)).toEqual(generateOrders(7));
    expect(generateOrders(7)).not.toEqual(generateOrders(8));
  });

  it('replays a scripted run exactly', () => {
    for (const policy of policies) {
      const a = play(new Checkout(policy, generateOrders(7), slowStart), 200);
      const b = play(new Checkout(policy, generateOrders(7), slowStart), 200);
      expect(b).toEqual(a);
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const checkout = new Checkout('after', orders42, slowStart);
    const start = checkout.checkpoint();
    const first = play(checkout, 200);
    checkout.restore(start);
    expect(checkout.ticks).toBe(0);
    expect(play(checkout, 200)).toEqual(first);
  });

  it('resumes from a checkpoint taken mid run, in the same or a fresh checkout', () => {
    const checkout = new Checkout('claim', orders42, slowStart);
    play(checkout, 70);
    const saved = checkout.checkpoint();
    const rest = play(checkout, 130);

    checkout.restore(saved);
    expect(play(checkout, 130)).toEqual(rest);

    const fresh = new Checkout('claim', orders42, slowStart);
    fresh.restore(saved);
    expect(play(fresh, 130)).toEqual(rest);
  });

  it('keeps checkpoints independent of later changes', () => {
    const checkout = new Checkout('after', orders42, slowStart);
    play(checkout, 60);
    const saved = checkout.checkpoint();
    const charges = [...saved.state.charges];
    const total = saved.state.totals.charges;
    play(checkout, 60);
    expect(saved.state.charges).toEqual(charges);
    expect(saved.state.totals.charges).toBe(total);
  });

  it('accounts for every order, attempt, payment, and response at every tick', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const orders = generateOrders(seed);
      for (const id of scenarioIds) {
        const scenario = idemScenarios[id];
        for (const policy of policies) {
          const checkout = new Checkout(policy, orders, scenario.conditions);
          for (let i = 0; i < 200; i += 1) {
            stepScheduled(checkout, scenario.schedule);
            const t = checkout.totals;
            const flight = checkout.inTransit;
            const charged = checkout.snapshot().charges.filter((count) => count > 0).length;
            expect(t.orders).toBe(t.confirmed + t.gaveUp + checkout.open);
            expect(t.attempts).toBe(t.replays + t.conflicts + t.paymentsStarted + flight.toServer);
            expect(t.paymentsStarted).toBe(t.charges + flight.running);
            expect(t.responses).toBe(t.replays + t.conflicts + t.charges);
            expect(t.responses).toBe(t.responsesLost + t.delivered + flight.toClient);
            expect(t.charges).toBe(charged + t.extraCharges);
            if (policy === 'none') expect(t.replays + t.conflicts).toBe(0);
            if (policy !== 'claim') expect(t.conflicts).toBe(0);
          }
        }
      }
    }
  });
});

describe('Idempotency guarantees in the toy model', () => {
  it('never charges an order twice when the key is claimed before charging', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of scenarioIds) {
        const duel = run(new IdemDuel(idemScenarios[id], seed));
        const lane = duel.lanes.find((candidate) => candidate.policy === 'claim');
        const summary = lane && summarizeCheckout(lane);
        expect(summary?.doubleCharged).toBe(0);
        expect(summary?.overlaps).toBe(0);
        expect(summary?.extraCharges).toBe(0);
      }
    }
  });

  it('runs payments that never overlap while every payment beats the client timeout', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ['calm', 'lossy'] as const) {
        for (const lane of summaries(id, seed)) expect(lane.overlaps).toBe(0);
      }
    }
  });

  it('changes only the charges when every payment beats the timeout', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [none, claim] = summaries('lossy', seed);
      expect(claim?.attempts).toBe(none?.attempts);
      expect(claim?.confirmed).toBe(none?.confirmed);
      expect(none?.extraCharges).toBe(claim?.replays);
      expect(none?.charges).toBe((claim?.charges ?? 0) + (none?.extraCharges ?? 0));
    }
  });

  it('double charges a saved-after key only through overlapping payments', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const duel = run(new IdemDuel(idemScenarios.slow, seed));
      const [after] = duel.lanes;
      const summary = summarizeCheckout(after);
      expect(summary.doubleCharged).toBeGreaterThan(0);
      expect(summary.overlaps).toBeGreaterThanOrEqual(summary.doubleCharged);
      expect(after.seen.has('double-repeat')).toBe(false);
    }
  });

  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const [calmNone, calmClaim] = summaries('calm');
    expect(calmNone).toMatchObject({
      orders: 64,
      confirmed: 64,
      attempts: 64,
      charges: 64,
      doubleCharged: 0,
    });
    expect(calmClaim).toMatchObject({ charges: 64, doubleCharged: 0 });

    const [lossyNone, lossyClaim] = summaries('lossy');
    expect(lossyNone).toMatchObject({
      orders: 64,
      confirmed: 64,
      attempts: 73,
      responsesLost: 9,
      charges: 73,
      doubleCharged: 9,
      extraDollars: 45,
    });
    expect(lossyClaim).toMatchObject({
      attempts: 73,
      charges: 64,
      replays: 9,
      doubleCharged: 0,
      extraDollars: 0,
    });

    const [after, claim] = summaries('slow');
    expect(after).toMatchObject({
      confirmed: 64,
      attempts: 78,
      charges: 74,
      overlaps: 10,
      doubleCharged: 10,
      extraDollars: 50,
      replays: 4,
    });
    expect(claim).toMatchObject({
      confirmed: 64,
      gaveUp: 0,
      attempts: 91,
      charges: 64,
      conflicts: 16,
      replays: 11,
      doubleCharged: 0,
    });
  });

  it('annotates the first double charge, replay, and 409 in each lane', () => {
    const texts = (id: IdemScenarioId) => {
      const duel = run(new IdemDuel(idemScenarios[id]));
      expect(duel.events.at(-1)?.marker).toBe(false);
      return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
    };
    expect(texts('calm')).toEqual([
      '20.0 Run ends. Orders charged twice: No key 0, Key claimed first 0. Money taken by mistake: No key $0, Key claimed first $0.',
    ]);
    expect(texts('lossy')).toEqual([
      '7.3 Key claimed first: Order #21: a retry carries the same key, so the server replays the saved receipt and charges nothing.',
      '7.8 No key: Order #21 is charged twice. The client never saw the first receipt, so its retry looked like a new purchase.',
      '20.0 Run ends. Orders charged twice: No key 9, Key claimed first 0. Money taken by mistake: No key $45, Key claimed first $0.',
    ]);
    expect(texts('slow')).toEqual([
      '4.0 The payment provider slows down: 40% of payments take 1.2 to 2 s.',
      '6.3 Key claimed first: Order #15: a retry arrives while the first payment is still running. The key is claimed, so the server answers 409 and charges nothing.',
      '7.0 Key saved after charging: Order #17 is charged twice. A retry arrived while the first payment was still running, and no receipt was saved yet.',
      '7.0 Key claimed first: Order #15: a retry carries the same key, so the server replays the saved receipt and charges nothing.',
      '7.6 Key saved after charging: Order #15: a retry carries the same key, so the server replays the saved receipt and charges nothing.',
      '10.0 The payment provider recovers: payments take 0.2 to 0.6 s again.',
      '20.0 Run ends. Orders charged twice: Key saved after charging 10, Key claimed first 0. Money taken by mistake: Key saved after charging $50, Key claimed first $0.',
    ]);
  });

  it('stops after the run length', () => {
    const duel = run(new IdemDuel(idemScenarios.calm));
    expect(duel.ticks).toBe(200);
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes[0].series).toHaveLength(200);
  });
});
