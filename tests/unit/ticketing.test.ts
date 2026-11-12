import { describe, expect, it } from 'vitest';
import {
  countSeats,
  duelScenarioIds,
  makeWorkload,
  phaseCounts,
  reacquireTimeline,
  SEATS,
  SeatLedger,
  summarize,
  TicketDuel,
  type TicketScenarioId,
  ticketingEstimates,
  ticketScenarios,
} from '../../src/lib/models/ticketing';

function run(duel: TicketDuel): TicketDuel {
  while (!duel.done) duel.step();
  return duel;
}

function finished(id: TicketScenarioId, seed = 42) {
  const duel = run(new TicketDuel(ticketScenarios[id], seed));
  return { duel, a: summarize(duel.lanes[0]), b: summarize(duel.lanes[1]) };
}

function eventLines(duel: TicketDuel): string[] {
  return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
}

const allIds = Object.keys(ticketScenarios) as TicketScenarioId[];

describe('ticketing workload', () => {
  it('gives every buyer one arrival inside the window', () => {
    const buyers = makeWorkload(ticketScenarios.rush.workload, 42);
    expect(buyers).toHaveLength(600);
    expect(new Set(buyers.map((buyer) => buyer.id)).size).toBe(600);
    expect(Math.max(...buyers.map((buyer) => buyer.arrival))).toBeLessThan(30);
  });

  it('shares the crowd between scenarios that only change the claiming rules', () => {
    expect(makeWorkload(ticketScenarios.rush.workload, 9)).toEqual(
      makeWorkload(ticketScenarios['waiting-room'].workload, 9),
    );
    const abandon = makeWorkload(ticketScenarios.abandon.workload, 9);
    const allPay = makeWorkload(ticketScenarios['all-pay'].workload, 9);
    expect(allPay.map((buyer) => buyer.arrival)).toEqual(abandon.map((buyer) => buyer.arrival));
    expect(allPay.some((buyer) => buyer.abandons)).toBe(false);
  });

  it('lists each duel scenario once', () => {
    expect([...duelScenarioIds.oversell, ...duelScenarioIds.holds].sort()).toEqual([...allIds].sort());
  });
});

describe('ticketing duel', () => {
  it('replays the same seed exactly', () => {
    for (const id of allIds) {
      const first = finished(id, 7);
      const second = finished(id, 7);
      expect(second.duel.lanes[0].state).toEqual(first.duel.lanes[0].state);
      expect(second.duel.lanes[1].state).toEqual(first.duel.lanes[1].state);
      expect(second.duel.events).toEqual(first.duel.events);
    }
  });

  it('accounts for every buyer who arrived on every tick', () => {
    for (const id of allIds) {
      const duel = new TicketDuel(ticketScenarios[id], 3);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          const counts = phaseCounts(lane);
          const accounted =
            counts.queued +
            counts.choosing +
            counts.checkout +
            counts.ticketed +
            counts.abandoned +
            counts.lost +
            counts.soldOut;
          expect(accounted).toBe(lane.state.totals.arrived);
          expect(counts.ticketed).toBe(lane.state.totals.ticketed);
          expect(counts.soldOut).toBe(lane.state.totals.soldOut);
          expect(counts.lost).toBe(lane.state.totals.lost);
        }
      }
    }
  });

  it('never promises a seat twice with conditional writes', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of allIds) {
        const duel = run(new TicketDuel(ticketScenarios[id], seed));
        for (const lane of duel.lanes) {
          if (lane.config.write !== 'conditional') continue;
          expect(summarize(lane).doubledSeats).toBe(0);
          expect(summarize(lane).ticketed).toBeLessThanOrEqual(SEATS);
          expect(lane.state.holders.every((holders) => holders.length <= 1)).toBe(true);
        }
      }
    }
  });

  it('oversells with read, then write in a rush on every seed', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { a, b } = finished('rush', seed);
      expect(a.doubledSeats).toBeGreaterThan(40);
      expect(a.ticketed).toBeGreaterThan(SEATS);
      expect(b.ticketed).toBe(SEATS);
      expect(b.peakQueries).toBeGreaterThan(a.peakQueries * 2);
    }
  });

  it('lets a waiting room cut the load but leaves read, then write unsafe', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const rush = finished('rush', seed);
      const room = finished('waiting-room', seed);
      expect(room.b.peakQueries).toBeLessThan(rush.b.peakQueries / 10);
      expect(room.a.doubledSeats).toBeGreaterThan(0);
      expect(room.a.doubledSeats).toBeLessThan(rush.a.doubledSeats);
      expect(room.b.doubledSeats).toBe(0);
    }
  });

  it('ties when buyers never collide or never walk away', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ['trickle', 'all-pay'] as const) {
        const { duel, a, b } = finished(id, seed);
        expect(b).toEqual(a);
        expect(duel.lanes[1].state.series).toEqual(duel.lanes[0].state.series);
      }
    }
  });

  it('sells more seats when abandoned holds expire', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { a, b } = finished('abandon', seed);
      expect(a.released).toBe(0);
      expect(b.released).toBeGreaterThan(0);
      expect(b.ticketed).toBeGreaterThan(a.ticketed + 10);
      expect(b.stuck).toBeLessThan(a.stuck);
      expect(b.soldOut).toBeLessThan(a.soldOut);
    }
  });

  it('releases every hold at its deadline, whatever its buyer is doing', () => {
    for (const id of duelScenarioIds.holds) {
      const duel = new TicketDuel(ticketScenarios[id], 4);
      while (!duel.done) {
        duel.step();
        const tick = duel.ticks - 1;
        for (const lane of duel.lanes) {
          const s = lane.state;
          s.phase.forEach((phase, buyer) => {
            if ((s.seat[buyer] ?? -1) < 0 || phase === 'ticketed' || phase === 'future') return;
            const deadline = s.expiresAt[buyer] ?? -1;
            if (deadline >= 0) expect(deadline).toBeGreaterThan(tick);
          });
        }
      }
    }
  });

  it('voids a slow payment once its hold has expired and keeps the seat when Pay claims the hold', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { duel, a, b } = finished('slow-pay', seed);
      expect(a.voided).toBeGreaterThan(20);
      expect(a.ticketed).toBeLessThan(SEATS);
      expect(b.voided).toBe(0);
      expect(b.ticketed).toBe(SEATS);
      for (const lane of duel.lanes) {
        expect(lane.state.holders.every((holders) => holders.length <= 1)).toBe(true);
        expect(summarize(lane).ticketed).toBeLessThanOrEqual(SEATS);
      }
    }
  });

  it('voids a claimed checkout that outlasts its own deadline', () => {
    const slower = {
      ...ticketScenarios['slow-pay'],
      workload: { ...ticketScenarios['slow-pay'].workload, paymentSeconds: { min: 11, max: 14 } },
    };
    const duel = run(new TicketDuel(slower, 42));
    const claimed = summarize(duel.lanes[1]);
    expect(claimed.ticketed).toBe(0);
    expect(claimed.voided).toBeGreaterThan(0);
    expect(claimed.voided).toBe(claimed.lost);
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const rush = finished('rush');
    expect([rush.a.ticketed, rush.a.doubledSeats, rush.a.peakQueries]).toEqual([243, 70, 411]);
    expect([rush.b.ticketed, rush.b.doubledSeats, rush.b.rejected, rush.b.peakQueries]).toEqual([
      100, 0, 715, 1702,
    ]);

    const room = finished('waiting-room');
    expect([room.a.ticketed, room.a.doubledSeats, room.a.peakQueries]).toEqual([110, 10, 40]);
    expect([room.b.ticketed, room.b.doubledSeats, room.b.rejected, room.b.peakQueries]).toEqual([
      100, 0, 14, 52,
    ]);

    expect(finished('trickle').a.ticketed).toBe(52);

    const abandon = finished('abandon');
    expect([abandon.a.ticketed, abandon.a.stuck, abandon.a.soldOut]).toEqual([73, 27, 300]);
    expect([abandon.b.ticketed, abandon.b.stuck, abandon.b.released, abandon.b.soldOut]).toEqual([
      97, 3, 40, 260,
    ]);

    expect(finished('all-pay').a.ticketed).toBe(100);

    const slow = finished('slow-pay');
    expect([slow.a.ticketed, slow.a.voided, slow.a.released]).toEqual([90, 59, 61]);
    expect([slow.b.ticketed, slow.b.voided, slow.b.released]).toEqual([100, 0, 0]);
  });

  it('pins the illustrative estimates the lesson quotes', () => {
    expect(ticketingEstimates()).toEqual({
      buyersPerSeat: 100,
      peakRequestsPerSecond: 100_000,
      holdAttemptsPerSecond: 16_667,
      seatTableKilobytes: 1000,
    });
  });

  it('writes the transcript the lesson describes', () => {
    expect(eventLines(finished('rush').duel)).toEqual([
      '0.2 Read, then write: seat A10 is promised to 2 buyers. Each one saw it free a moment earlier.',
      '6.9 Conditional write: all 100 seats are paid for, as 100 tickets.',
      '7.3 Read, then write: all 100 seats are paid for, as 243 tickets.',
      '20.0 Run ends. Seats promised to two or more buyers: read, then write 70, conditional write 0. Tickets issued for 100 seats: 243 and 100.',
    ]);
    expect(eventLines(finished('abandon').duel)).toEqual([
      '6.8 Holds never expire: the first buyer sees "sold out" while 8 seats sit in holds whose buyers already left.',
      '6.8 Holds expire after 8 s: the first buyer sees "sold out" while 8 seats sit in holds whose buyers already left.',
      '8.8 Holds expire after 8 s: the hold on B5 expires after 8 s, so the seat its buyer abandoned goes back on sale.',
      '30.0 Run ends. Tickets sold: holds never expire 73, holds expire after 8 s 97. Seats stuck with buyers who left: 27 and 3.',
    ]);
    expect(finished('all-pay').duel.events[0]?.text).toBe(
      'Holds never expire: the first buyer sees "sold out". Every held seat belongs to a buyer who is still paying.',
    );
    expect(eventLines(finished('slow-pay').duel).slice(2)).toEqual([
      '8.2 Holds expire after 8 s: the hold on A10 expires after 8 s, while its buyer still waits on the bank, so the seat goes back on sale.',
      '8.3 Holds expire after 8 s: the bank approves a payment after its hold expired, so the system voids the authorization and that buyer gets no ticket.',
      '16.1 Pay claims the hold: all 100 seats are paid for, as 100 tickets.',
      '30.0 Run ends. Tickets sold: holds expire after 8 s 90, pay claims the hold 100. Approved payments voided because the hold expired first: 59 and 0.',
    ]);
    expect(finished('trickle').duel.events.every((event) => !event.marker)).toBe(true);
  });

  it('stops at the run length', () => {
    const duel = run(new TicketDuel(ticketScenarios.abandon));
    expect(duel.ticks).toBe(duel.length);
    const before = structuredClone(duel.lanes[0].state);
    duel.step();
    expect(duel.lanes[0].state).toEqual(before);
    expect(duel.lanes[0].state.series).toHaveLength(duel.length);
    expect(duel.lanes[1].state.series).toHaveLength(duel.length);
  });

  it('resets and resumes from a checkpoint', () => {
    const reference = finished('abandon', 5).duel;
    const duel = new TicketDuel(ticketScenarios.abandon, 5);
    const start = duel.checkpoint();
    for (let i = 0; i < 120; i += 1) duel.step();
    const middle = duel.checkpoint();
    run(duel);

    duel.restore(start);
    expect(duel.ticks).toBe(0);
    expect(countSeats(duel.lanes[0], 'free')).toBe(SEATS);
    run(duel);
    expect(duel.lanes[1].state).toEqual(reference.lanes[1].state);
    expect(duel.events).toEqual(reference.events);

    const fresh = new TicketDuel(ticketScenarios.abandon, 5);
    fresh.restore(middle);
    run(fresh);
    expect(fresh.lanes[0].state).toEqual(reference.lanes[0].state);
    expect(fresh.events).toEqual(reference.events);
  });

  it('keeps checkpoints independent of later steps', () => {
    const duel = new TicketDuel(ticketScenarios.rush);
    for (let i = 0; i < 10; i += 1) duel.step();
    const saved = duel.checkpoint();
    const copy = structuredClone(saved);
    run(duel);
    expect(saved).toEqual(copy);
  });
});

describe('seat claims fenced by hold id', () => {
  it('gives every claim a fresh hold id and refuses a live or sold seat', () => {
    const ledger = new SeatLedger('E1', 'A10');
    const first = ledger.claim('Ana', 0, 8);
    expect(first?.holdId).toBe(1);
    expect(ledger.claim('Ben', 7, 8)).toBeNull();
    const second = ledger.claim('Ana', 8, 8);
    expect(second?.holdId).toBe(2);
    if (!second) throw new Error('claim failed');
    expect(ledger.pay(second, 9, 10)).toBe(true);
    expect(ledger.sell(second, 10)).toBe(true);
    expect(ledger.claim('Ben', 100, 8)).toBeNull();
  });

  it('voids a stale approval from the same buyer and sells once on the live claim', () => {
    const timeline = reacquireTimeline('claim');
    expect(timeline.lapsesAt).toBe(11);
    expect(
      timeline.steps.map(({ at, checkout, action, named, seatHoldId, ok }) => [
        at,
        checkout,
        action,
        named,
        seatHoldId,
        ok,
      ]),
    ).toEqual([
      [0, 'A', 'claim', null, 1, true],
      [1, 'A', 'pay', 1, 1, true],
      [12, 'B', 'claim', null, 2, true],
      [13, 'B', 'pay', 2, 2, true],
      [14, 'A', 'approve', 1, 2, false],
      [15, 'B', 'approve', 2, 2, true],
    ]);
    expect(timeline.captured).toEqual([2]);
    expect(timeline.voided).toEqual([1]);
    expect(timeline.final).toEqual({ status: 'sold', holdId: 2, orderHoldId: 2 });
  });

  it('lets a holder-only guard sell the new claim on the stale approval', () => {
    const timeline = reacquireTimeline('holder');
    expect(timeline.steps.filter((step) => step.action === 'approve').map((step) => step.ok)).toEqual([
      true,
      false,
    ]);
    expect(timeline.captured).toEqual([1]);
    expect(timeline.voided).toEqual([2]);
    expect(timeline.final.orderHoldId).not.toBe(timeline.final.holdId);
  });

  it('ignores a stale pay or release and voids an approval past the deadline', () => {
    const ledger = new SeatLedger('E1', 'A10');
    const old = ledger.claim('Ana', 0, 8);
    if (!old) throw new Error('claim failed');
    const live = ledger.claim('Ana', 8, 8);
    if (!live) throw new Error('reclaim failed');
    expect(ledger.release(old, 9)).toBe(false);
    expect(ledger.pay(old, 9, 10)).toBe(false);
    expect(ledger.row).toMatchObject({ status: 'held', holder: 'Ana', holdId: 2 });
    expect(ledger.pay(live, 9, 10)).toBe(true);
    expect(ledger.sell(live, 19)).toBe(false);
    expect(ledger.order).toBeNull();
    const next = ledger.claim('Ben', 19, 8);
    expect(next?.holdId).toBe(3);
    if (!next) throw new Error('claim failed');
    expect(ledger.release(next, 20)).toBe(true);
    expect(ledger.onSale(20)).toBe(true);
  });
});
