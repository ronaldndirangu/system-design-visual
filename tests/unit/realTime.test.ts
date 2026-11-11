import { describe, expect, it } from 'vitest';
import {
  makeClicks,
  makeRun,
  RT_DURATION_MS,
  RT_LONG_POLL_TIMEOUT_MS,
  RT_ONE_WAY_MS,
  RT_TICK_MS,
  RT_TICKS,
  RT_TRANSPORTS,
  type RtScenarioId,
  totalsAt,
} from '../../src/lib/models/realTime';

const scenarios: RtScenarioId[] = ['quiet', 'steady', 'burst'];

function endTotals(scenario: RtScenarioId) {
  const run = makeRun(scenario);
  return Object.fromEntries(
    RT_TRANSPORTS.map((transport) => [transport, totalsAt(run.plans[transport], run.clicks, RT_DURATION_MS)]),
  );
}

describe('real-time transport model', () => {
  it('replays the same clicks and plans for the same scenario', () => {
    for (const scenario of scenarios) expect(makeRun(scenario)).toEqual(makeRun(scenario));
  });

  it('gives the same answer for a moment no matter what was asked before', () => {
    const run = makeRun('burst');
    const fresh = totalsAt(run.plans.longPolling, run.clicks, 31_000);
    totalsAt(run.plans.longPolling, run.clicks, RT_DURATION_MS);
    makeRun('steady');
    expect(totalsAt(run.plans.longPolling, run.clicks, 31_000)).toEqual(fresh);
    expect(makeClicks('burst')).toEqual(run.clicks);
  });

  it('keeps clicks on a 100 ms grid inside the minute', () => {
    for (const scenario of scenarios) {
      for (const click of makeClicks(scenario)) {
        expect(click.at % 100).toBe(0);
        expect(click.at).toBeGreaterThanOrEqual(500);
        expect(click.at).toBeLessThanOrEqual(54_500);
      }
    }
    expect(makeClicks('quiet')).toHaveLength(4);
    expect(makeClicks('steady')).toHaveLength(20);
    const burst = makeClicks('burst');
    expect(burst).toHaveLength(19);
    expect(burst.filter((click) => click.at >= 30_000 && click.at <= 34_000)).toHaveLength(16);
  });

  it('accounts for every click at every tick: happened = shown + waiting', () => {
    for (const scenario of scenarios) {
      const run = makeRun(scenario);
      for (const transport of RT_TRANSPORTS) {
        for (let tick = 0; tick <= RT_TICKS; tick += 1) {
          const totals = totalsAt(run.plans[transport], run.clicks, tick * RT_TICK_MS);
          expect(totals.delivered + totals.waiting).toBe(totals.clicks);
          expect(totals.waiting).toBeGreaterThanOrEqual(0);
        }
        const end = totalsAt(run.plans[transport], run.clicks, RT_DURATION_MS);
        expect(end.clicks).toBe(run.clicks.length);
        expect(end.waiting).toBe(0);
      }
    }
  });

  it('never shows a click sooner than one network hop after it happens', () => {
    for (const scenario of scenarios) {
      const run = makeRun(scenario);
      for (const transport of RT_TRANSPORTS) {
        for (const delivery of run.plans[transport].deliveries) {
          expect(delivery.deliveredAt - delivery.at).toBeGreaterThanOrEqual(RT_ONE_WAY_MS);
        }
      }
    }
  });

  it('holds a long poll no longer than the timeout and reconnects as each answer lands', () => {
    for (const scenario of scenarios) {
      const exchanges = makeRun(scenario).plans.longPolling.exchanges;
      exchanges.forEach((exchange, index) => {
        expect(exchange.respondAt - exchange.serverAt).toBeLessThanOrEqual(RT_LONG_POLL_TIMEOUT_MS);
        const next = exchanges[index + 1];
        if (next) expect(next.start).toBe(exchange.end);
      });
    }
  });

  it('pins the quiet minute the card quotes', () => {
    const totals = endTotals('quiet');
    expect(totals.polling).toMatchObject({
      requests: 12,
      emptyResponses: 10,
      meanDelayMs: 1975,
      maxDelayMs: 2800,
    });
    expect(totals.longPolling).toMatchObject({ requests: 7, emptyResponses: 2, maxDelayMs: 100 });
    expect(totals.sse).toMatchObject({ requests: 1, emptyResponses: 0, maxDelayMs: 100, heldMs: 59_900 });
  });

  it('pins the steady minute the card quotes', () => {
    const totals = endTotals('steady');
    expect(totals.polling).toMatchObject({
      requests: 12,
      emptyResponses: 1,
      meanDelayMs: 2525,
      maxDelayMs: 4700,
    });
    expect(totals.longPolling).toMatchObject({ requests: 21, emptyResponses: 0, maxDelayMs: 100 });
    expect(totals.websocket).toMatchObject({ requests: 1, maxDelayMs: 100 });
  });

  it('pins the burst the card quotes', () => {
    const run = makeRun('burst');
    const totals = endTotals('burst');
    const biggest = Math.max(...run.plans.polling.exchanges.map((exchange) => exchange.clickIds.length));
    expect(biggest).toBe(16);
    expect(totals.polling).toMatchObject({ requests: 12, maxDelayMs: 4500 });
    expect(totals.longPolling).toMatchObject({ requests: 15, emptyResponses: 1, maxDelayMs: 200 });
    expect(totals.sse).toMatchObject({ requests: 1, maxDelayMs: 100 });
  });
});
