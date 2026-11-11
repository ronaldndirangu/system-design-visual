import { describe, expect, it } from 'vitest';
import {
  errorBudget,
  FIX_AT,
  fixedMs,
  generateRequests,
  percentiles,
  SLO_THRESHOLD_MS,
  SloRun,
  type SloScenarioId,
  sliPercent,
  sloScenarios,
  summarizeLane,
  totalMs,
} from '../../src/lib/models/slos';

function finish(run: SloRun): SloRun {
  while (!run.done) run.step();
  return run;
}

function snapshot(run: SloRun) {
  return {
    series: run.lanes.map((lane) => lane.series),
    summaries: run.lanes.map((lane) => summarizeLane(lane, run.budget)),
    events: run.events,
    breakdown: run.breakdown(),
  };
}

function summaries(id: SloScenarioId) {
  const run = finish(new SloRun(sloScenarios[id]));
  const [app, miss] = run.lanes;
  if (!app || !miss) throw new Error('missing lanes');
  return { run, app, miss, appSum: summarizeLane(app, run.budget), missSum: summarizeLane(miss, run.budget) };
}

const rounded = (value: number) => Math.round(value);
const tenth = (value: number) => Math.round(value * 10) / 10;

describe('measurement helpers', () => {
  it('reads percentiles by rank from the sorted values', () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(percentiles(values)).toEqual({ count: 100, mean: 50.5, p50: 50, p95: 95, p99: 99 });
    expect(percentiles([])).toEqual({ count: 0, mean: 0, p50: 0, p95: 0, p99: 0 });
  });

  it('allows 1% of redirects to be slow under a 99% SLO, rounded down', () => {
    expect(errorBudget(19921)).toBe(199);
    expect(errorBudget(1000)).toBe(10);
    expect(errorBudget(1000, 0.999)).toBe(1);
  });

  it('halves only the fixed stage', () => {
    const spans = { network: 10, app: 20, cache: 2, database: 40 };
    expect(totalMs(spans)).toBe(72);
    expect(fixedMs(spans, 'app')).toBe(62);
    expect(fixedMs(spans, 'miss')).toBe(52);
    expect(fixedMs({ ...spans, database: 0 }, 'miss')).toBe(32);
  });

  it('draws the same arrivals, network times, and misses in every scenario', () => {
    const [first, ...rest] = Object.values(sloScenarios).map((scenario) => generateRequests(scenario, 42));
    if (!first) throw new Error('missing scenario');
    for (const other of rest) {
      expect(other.map((tick) => tick.length)).toEqual(first.map((tick) => tick.length));
      expect(other.flat().map((spans) => spans.network)).toEqual(first.flat().map((spans) => spans.network));
      expect(other.flat().map((spans) => spans.database > 0)).toEqual(
        first.flat().map((spans) => spans.database > 0),
      );
    }
  });
});

describe('SloRun', () => {
  it('replays the same seed exactly', () => {
    for (const scenario of Object.values(sloScenarios)) {
      expect(snapshot(finish(new SloRun(scenario, 42)))).toEqual(snapshot(finish(new SloRun(scenario, 42))));
    }
  });

  it('starts a fresh run identical to one that never ran, after another run played', () => {
    const scenario = sloScenarios['slow-misses'];
    const fresh = snapshot(finish(new SloRun(scenario)));
    const interrupted = new SloRun(scenario);
    for (let i = 0; i < 57; i += 1) interrupted.step();
    expect(snapshot(finish(new SloRun(scenario)))).toEqual(fresh);
  });

  it('accounts for every redirect in both lanes at every tick', () => {
    for (const scenario of Object.values(sloScenarios)) {
      const run = new SloRun(scenario);
      while (!run.done) {
        run.step();
        for (const lane of run.lanes) {
          expect(lane.good + lane.slow).toBe(run.arrived);
          expect(lane.latencies.length).toBe(run.arrived);
          expect(lane.series.length).toBe(run.ticks);
        }
      }
      expect(run.arrived).toBe(run.requests.reduce((sum, tick) => sum + tick.length, 0));
    }
  });

  it('keeps both lanes identical until the fixes ship', () => {
    const run = new SloRun(sloScenarios['slow-misses']);
    for (let i = 0; i < FIX_AT; i += 1) run.step();
    const [app, miss] = run.lanes;
    expect(app?.latencies).toEqual(miss?.latencies);
    expect(app?.series).toEqual(miss?.series);
    expect(run.fixed).toBe(false);
    run.step();
    expect(run.fixed).toBe(true);
    expect(app?.latencies).not.toEqual(miss?.latencies);
  });

  it('stops at the end of the run', () => {
    const run = finish(new SloRun(sloScenarios.healthy));
    const before = snapshot(run);
    run.step();
    expect(snapshot(run)).toEqual(before);
    expect(run.ticks).toBe(run.length);
  });

  it('measures the breakdown on redirects before the fixes only', () => {
    const run = new SloRun(sloScenarios['slow-misses']);
    expect(run.breakdown()).toMatchObject({ count: 0, tailCount: 0 });
    for (let i = 0; i < FIX_AT; i += 1) run.step();
    const atFix = run.breakdown();
    finish(run);
    expect(run.breakdown()).toEqual(atFix);
    expect(atFix).toMatchObject({ count: 1969, tailCount: 20 });
  });
});

describe('pinned illustrative numbers (seed 42, quoted in the lesson)', () => {
  it('healthy: both lanes keep the SLO', () => {
    const { run, app, miss, appSum, missSum } = summaries('healthy');
    expect(run.budget).toBe(199);
    expect(appSum).toMatchObject({ arrived: 19921, slow: 30, budgetLeft: 169 });
    expect(missSum).toMatchObject({ arrived: 19921, slow: 4, budgetLeft: 195 });
    expect([rounded(appSum.mean), rounded(appSum.p99)]).toEqual([25, 69]);
    expect([rounded(missSum.mean), rounded(missSum.p99)]).toEqual([31, 59]);
    expect(app.budgetGoneTick).toBeNull();
    expect(miss.budgetGoneTick).toBeNull();
    expect(rounded(app.series[FIX_AT - 1] ?? 0)).toBe(72);
  });

  it('marks the budget gone only once slow redirects pass it', () => {
    const run = new SloRun(sloScenarios['slow-misses']);
    const [app] = run.lanes;
    if (!app) throw new Error('missing lane');
    while (run.ticks < 76) run.step();
    expect(app.slow).toBe(run.budget);
    expect(app.budgetGoneTick).toBeNull();
    run.step();
    expect(app.slow).toBeGreaterThan(run.budget);
    expect(app.budgetGoneTick).toBe(77);
  });

  it('slow misses: the average favours app code, the tail needs the miss path', () => {
    const { run, app, miss, appSum, missSum } = summaries('slow-misses');
    expect(appSum).toMatchObject({ slow: 479, budgetLeft: 0 });
    expect(missSum).toMatchObject({ slow: 158, budgetLeft: 41 });
    expect([rounded(appSum.mean), rounded(appSum.p50), rounded(appSum.p95), rounded(appSum.p99)]).toEqual([
      27, 22, 70, 129,
    ]);
    expect([rounded(missSum.mean), rounded(missSum.p50), rounded(missSum.p95), rounded(missSum.p99)]).toEqual(
      [32, 29, 54, 93],
    );
    expect(appSum.mean).toBeLessThan(missSum.mean);
    expect(missSum.p99).toBeLessThan(SLO_THRESHOLD_MS);
    expect(appSum.p99).toBeGreaterThan(SLO_THRESHOLD_MS);
    expect(sliPercent(appSum.good, appSum.arrived)).toBe(97.5);
    expect(sliPercent(missSum.good, missSum.arrived)).toBe(99.2);
    expect(sliPercent(990, 1000)).toBe(99);
    expect(sliPercent(9899, 10000)).toBe(98.9);
    expect(app.budgetGoneTick).toBe(77);
    expect(app.underTick).toBeNull();
    expect(miss.underTick).toBe(28);
    expect(miss.budgetGoneTick).toBeNull();
    expect(rounded(app.series[FIX_AT - 1] ?? 0)).toBe(131);
    expect(run.events.filter((event) => event.marker).map((event) => event.tick)).toEqual([20, 28, 77]);

    const { average, tail } = run.breakdown();
    expect(average.app).toBeGreaterThan(average.database);
    expect(tail.database).toBeGreaterThan(tail.app);
    expect([tenth(average.app), tenth(average.database)]).toEqual([16, 5.2]);
    expect([tenth(tail.app), tenth(tail.database)]).toEqual([17.9, 141.2]);
    expect([tenth(totalMs(average)), tenth(totalMs(tail))]).toEqual([35.2, 171.4]);

    const early = new SloRun(sloScenarios['slow-misses']);
    for (let i = 0; i < FIX_AT; i += 1) early.step();
    const beforeFix = percentiles(early.lanes[0]?.latencies ?? []);
    expect([rounded(beforeFix.mean), rounded(beforeFix.p99)]).toEqual([35, 140]);
  });

  it('slow app code: the mirror image, so the app fix wins', () => {
    const { run, app, miss, appSum, missSum } = summaries('slow-app');
    expect(appSum).toMatchObject({ slow: 125, budgetLeft: 74 });
    expect(missSum).toMatchObject({ slow: 523, budgetLeft: 0 });
    expect([rounded(appSum.mean), rounded(appSum.p99)]).toEqual([33, 92]);
    expect([rounded(missSum.mean), rounded(missSum.p99)]).toEqual([47, 119]);
    expect(app.underTick).toBe(28);
    expect(miss.budgetGoneTick).toBe(70);
    expect(run.events.filter((event) => event.marker).map((event) => event.tick)).toEqual([20, 28, 70]);

    const { average, tail } = run.breakdown();
    expect([tenth(average.app), tenth(tail.app), tenth(tail.database)]).toEqual([31.9, 119.6, 19.8]);
  });

  it('closes the transcript with the whole run numbers', () => {
    const { run } = summaries('healthy');
    expect(run.events.at(-1)).toEqual({
      tick: 200,
      marker: false,
      text: 'Run ends. Whole run p99: faster app code 69 ms, faster miss path 59 ms. Mean: 25 ms and 31 ms. Error budget left: 169 and 195 of 199.',
    });
  });
});
