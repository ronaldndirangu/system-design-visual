import { describe, expect, it } from 'vitest';
import {
  duelScenarioIds,
  MAX_ATTEMPTS,
  makePayments,
  PAYMENTS,
  PayDuel,
  type PayScenarioId,
  paymentsEstimates,
  payScenarios,
  summarize,
  tileView,
} from '../../src/lib/models/payments';

function run(duel: PayDuel): PayDuel {
  while (!duel.done) duel.step();
  return duel;
}

function finished(id: PayScenarioId, seed = 42) {
  const duel = run(new PayDuel(payScenarios[id], seed));
  return { duel, a: summarize(duel.lanes[0], duel.payments), b: summarize(duel.lanes[1], duel.payments) };
}

function eventLines(duel: PayDuel): string[] {
  return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
}

const allIds = Object.keys(payScenarios) as PayScenarioId[];
const seeds = Array.from({ length: 12 }, (_, i) => i + 1);

describe('payments workload', () => {
  it('gives every payment one arrival, an amount, and dice for every attempt', () => {
    const payments = makePayments(42);
    expect(payments).toHaveLength(PAYMENTS);
    expect(Math.max(...payments.map((payment) => payment.arrival))).toBeLessThan(200);
    for (const payment of payments) {
      expect(payment.amount % 5).toBe(0);
      expect(payment.amount).toBeGreaterThanOrEqual(10);
      expect(payment.amount).toBeLessThanOrEqual(90);
      expect(payment.attempts).toHaveLength(MAX_ATTEMPTS);
    }
  });

  it('shares the shoppers across every scenario', () => {
    const first = new PayDuel(payScenarios['slow-bank'], 9).payments;
    for (const id of allIds) expect(new PayDuel(payScenarios[id], 9).payments).toEqual(first);
  });

  it('lists each duel scenario once', () => {
    expect([...duelScenarioIds.retries, ...duelScenarioIds.reconcile].sort()).toEqual([...allIds].sort());
  });
});

describe('payments duel', () => {
  it('replays the same seed exactly', () => {
    for (const id of allIds) {
      const first = finished(id, 7);
      const second = finished(id, 7);
      expect(second.duel.lanes[0].state).toEqual(first.duel.lanes[0].state);
      expect(second.duel.lanes[1].state).toEqual(first.duel.lanes[1].state);
      expect(second.duel.events).toEqual(first.duel.events);
    }
  });

  it('accounts for every payment that arrived on every tick', () => {
    for (const id of allIds) {
      const duel = new PayDuel(payScenarios[id], 3);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel.payments);
          expect(sum.paid + sum.unknown + sum.failed + sum.inFlight).toBe(sum.arrived);
        }
      }
    }
  });

  it('keeps the money consistent: the ledger never shows money the bank did not take', () => {
    for (const seed of seeds) {
      for (const id of allIds) {
        const duel = run(new PayDuel(payScenarios[id], seed));
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel.payments);
          expect(sum.gapDollars).toBeGreaterThanOrEqual(0);
          for (let id = 0; id < PAYMENTS; id += 1) {
            const charges = lane.state.charges[id] ?? 0;
            if (lane.state.phase[id] === 'paid') expect(charges).toBeGreaterThan(0);
            if (lane.state.phase[id] === 'failed') expect(charges).toBe(0);
          }
        }
      }
    }
  });

  it('never charges a shopper twice with an idempotency key', () => {
    for (const seed of seeds) {
      for (const id of allIds) {
        const duel = run(new PayDuel(payScenarios[id], seed));
        for (const lane of duel.lanes) {
          if (!lane.config.idempotencyKey) continue;
          expect(lane.state.charges.every((charges) => charges <= 1)).toBe(true);
          expect(summarize(lane, duel.payments).doubled).toBe(0);
        }
      }
    }
  });

  it('double charges without a key on every seed, and more with a shorter timeout', () => {
    for (const seed of seeds) {
      const slow = finished('slow-bank', seed);
      const short = finished('short-timeout', seed);
      expect(slow.a.doubled).toBeGreaterThan(5);
      expect(short.a.doubled).toBeGreaterThan(slow.a.doubled);
      expect(slow.b.deduped).toBeGreaterThan(0);
      expect(slow.a.retries).toBe(slow.b.retries);
      expect(slow.a.paid).toBe(slow.b.paid);
    }
  });

  it('settles every unknown payment when it reconciles', () => {
    for (const seed of seeds) {
      const { a, b } = finished('outage', seed);
      expect(a.unknown).toBeGreaterThan(0);
      expect(a.gapDollars).toBeGreaterThan(0);
      expect(b.unknown).toBe(0);
      expect(b.gapDollars).toBe(0);
      expect(b.recovered + b.failed).toBe(a.unknown);
      expect(b.paid).toBe(a.paid + b.recovered);
    }
  });

  it('ties when the bank always answers in time', () => {
    for (const seed of seeds) {
      for (const id of ['healthy-bank', 'calm-day'] as const) {
        const { duel, a, b } = finished(id, seed);
        expect(b).toEqual(a);
        expect(a.retries).toBe(0);
        expect(a.bankCharges).toBe(PAYMENTS);
        expect(duel.lanes[1].state.series).toEqual(duel.lanes[0].state.series);
        expect(duel.events.every((event) => !event.marker)).toBe(true);
      }
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const slow = finished('slow-bank');
    expect([slow.a.paid, slow.a.retries, slow.a.bankCharges, slow.a.doubled, slow.a.extraDollars]).toEqual([
      120, 24, 139, 17, 940,
    ]);
    expect([slow.a.bankDollars, slow.a.ledgerDollars]).toEqual([7080, 6140]);
    expect([slow.b.bankCharges, slow.b.doubled, slow.b.deduped, slow.b.gapDollars]).toEqual([120, 0, 19, 0]);

    const short = finished('short-timeout');
    expect([short.a.retries, short.a.doubled, short.a.extraDollars, short.a.unknown]).toEqual([
      55, 40, 2555, 3,
    ]);
    expect([short.b.doubled, short.b.unknown, short.b.gapDollars]).toEqual([0, 3, 95]);

    const outage = finished('outage');
    expect([outage.a.paid, outage.a.unknown, outage.a.gapDollars]).toEqual([114, 6, 195]);
    expect([outage.b.paid, outage.b.recovered, outage.b.failed, outage.b.gapDollars]).toEqual([119, 5, 1, 0]);

    expect(finished('healthy-bank').a.bankDollars).toBe(6140);
  });

  it('pins the illustrative estimates the lesson quotes', () => {
    expect(paymentsEstimates()).toEqual({
      averagePerSecond: 116,
      peakPerSecond: 579,
      ledgerEntriesPerDay: 20_000_000,
      ledgerGigabytesPerDay: 4,
      keyStoreGigabytes: 1,
    });
  });

  it('writes the transcript the lesson describes', () => {
    expect(eventLines(finished('slow-bank').duel)).toEqual([
      '3.1 Retry without a key: payment 71 timed out, and its retry charges the card again. The shopper pays $40 twice.',
      '3.1 Retry with an idempotency key: payment 71 timed out, and its retry carries the same key. The bank returns the first result and charges nothing.',
      '30.0 Run ends. Shoppers charged more than once: retry without a key 17, retry with an idempotency key 0. Extra money taken: $940 and $0.',
    ]);
    expect(eventLines(finished('outage').duel)).toEqual([
      '8.0 The bank slows down. Most replies now arrive after the 2 s timeout, and some requests never reach it.',
      '15.7 Both lanes: payment 61 gives up after 3 attempts that all timed out. The service cannot tell whether the bank charged the card.',
      '16.0 The bank recovers. Replies arrive in time again.',
      "20.0 Reconcile every 10 s: the bank's file shows 5 charges the ledger lacks, so those payments complete, and 1 unknown payment with no charge, which is marked failed so the shopper can pay again.",
      '30.0 Run ends. Payments with an unknown outcome: trust the ledger 6, reconcile every 10 s 0. Money the bank took that the ledger never recorded: $195 and $0.',
    ]);
  });

  it('shows a doubled tile with its charge count', () => {
    const { duel } = finished('slow-bank');
    const lane = duel.lanes[0];
    const doubled = lane.state.charges.findIndex((charges) => charges >= 2);
    expect(tileView(lane, doubled)).toEqual({ view: 'doubled', charges: lane.state.charges[doubled] });
    const fresh = new PayDuel(payScenarios['slow-bank']);
    expect(tileView(fresh.lanes[0], 0).view).toBe('future');
  });

  it('stops at the run length', () => {
    const duel = run(new PayDuel(payScenarios.outage));
    expect(duel.ticks).toBe(duel.length);
    const before = structuredClone(duel.lanes[0].state);
    duel.step();
    expect(duel.lanes[0].state).toEqual(before);
    expect(duel.lanes[0].state.series).toHaveLength(duel.length);
    expect(duel.lanes[1].state.series).toHaveLength(duel.length);
  });

  it('resets and resumes from a checkpoint', () => {
    const reference = finished('outage', 5).duel;
    const duel = new PayDuel(payScenarios.outage, 5);
    const start = duel.checkpoint();
    for (let i = 0; i < 150; i += 1) duel.step();
    const middle = duel.checkpoint();
    run(duel);

    duel.restore(start);
    expect(duel.ticks).toBe(0);
    expect(duel.lanes[0].state.phase.every((phase) => phase === 'future')).toBe(true);
    run(duel);
    expect(duel.lanes[1].state).toEqual(reference.lanes[1].state);
    expect(duel.events).toEqual(reference.events);

    const fresh = new PayDuel(payScenarios.outage, 5);
    fresh.restore(middle);
    run(fresh);
    expect(fresh.lanes[0].state).toEqual(reference.lanes[0].state);
    expect(fresh.events).toEqual(reference.events);
  });

  it('keeps checkpoints independent of later steps', () => {
    const duel = new PayDuel(payScenarios['slow-bank']);
    for (let i = 0; i < 10; i += 1) duel.step();
    const saved = duel.checkpoint();
    const copy = structuredClone(saved);
    run(duel);
    expect(saved).toEqual(copy);
  });
});
