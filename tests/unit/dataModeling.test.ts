import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  counterChoices,
  DM_CLICKS,
  DM_LINKS,
  DM_QUERY_IDS,
  DM_SHAPES,
  type DmQueryId,
  DmRun,
  dashboardPlans,
  datasetStats,
  fitTable,
  formatMs,
  MS_PER_TICK,
  planQuery,
} from '../../src/lib/models/dataModeling';

function runToEnd(run: DmRun): DmRun {
  while (!run.done) run.step();
  return run;
}

function snapshot(run: DmRun) {
  return {
    ticks: run.ticks,
    panes: run.panes.map((pane) => ({
      done: pane.done,
      finished: pane.finished,
      best: pane.best,
      lit: pane.lit,
    })),
    events: run.events,
  };
}

describe('data modeling model', () => {
  it('builds and replays identically for the same seed', () => {
    const a = buildDataset(7);
    const b = buildDataset(7);
    expect(datasetStats(a)).toEqual(datasetStats(b));
    for (const id of DM_QUERY_IDS) {
      expect(snapshot(runToEnd(new DmRun(id, a)))).toEqual(snapshot(runToEnd(new DmRun(id, b))));
    }
  });

  it('restores a checkpoint into the same state as a fresh run', () => {
    const data = buildDataset();
    for (const id of DM_QUERY_IDS) {
      const run = new DmRun(id, data);
      const start = run.checkpoint();
      for (let i = 0; i < 3; i += 1) run.step();
      const midway = run.checkpoint();
      runToEnd(run);
      const finished = snapshot(run);

      run.restore(start);
      expect(run.ticks).toBe(0);
      expect(run.events).toEqual([]);
      runToEnd(run);
      expect(snapshot(run)).toEqual(finished);

      const other = new DmRun(id, data);
      other.restore(midway);
      runToEnd(other);
      expect(snapshot(other)).toEqual(finished);
    }
  });

  it('stores the same links and clicks in all three shapes', () => {
    const data = buildDataset();
    const { tables, documents, keyvalue } = data.stores;
    expect(documents.totalKb).toBeCloseTo(tables.totalKb, 1);
    expect(keyvalue.totalKb).toBeCloseTo(tables.totalKb, 1);
    expect(tables.keys.filter((key) => key.startsWith('link:'))).toHaveLength(DM_LINKS);
    expect(keyvalue.keys.filter((key) => key.startsWith('link:'))).toHaveLength(DM_LINKS);
    expect(data.owned.flat()).toHaveLength(DM_LINKS);
    expect(new Set(data.owned.flat().map((link) => link.code)).size).toBe(DM_LINKS);
    const stats = datasetStats(data);
    expect(stats.clicks).toBe(DM_CLICKS);
    expect(tables.keys.filter((key) => key.startsWith('day:'))).toHaveLength(stats.dailyRows);
  });

  it('moves each pane forward until it has touched every planned record', () => {
    const data = buildDataset();
    for (const id of DM_QUERY_IDS) {
      const run = new DmRun(id, data);
      let previous = run.panes.map((pane) => pane.done);
      while (!run.done) {
        run.step();
        const panes = run.panes;
        panes.forEach((pane, index) => {
          expect(pane.done).toBeGreaterThanOrEqual(previous[index] ?? 0);
          expect(pane.done).toBeLessThanOrEqual(pane.plan.records);
          expect(pane.finished).toBe(run.elapsedMs + 1e-9 >= pane.plan.costMs);
        });
        previous = panes.map((pane) => pane.done);
      }
      for (const pane of run.panes) {
        expect(pane.finished).toBe(true);
        expect(pane.done).toBe(pane.plan.records);
        expect(pane.lit.some(Boolean)).toBe(true);
      }
      expect(run.length).toBe(
        Math.max(...run.plans.map((plan) => Math.ceil(plan.costMs / MS_PER_TICK - 1e-9))),
      );
    }
  });

  it('closes every run with one wrap up on the final tick', () => {
    for (const id of DM_QUERY_IDS) {
      const run = runToEnd(new DmRun(id));
      const wrapUps = run.events.filter((event) => event.wrapUp);
      expect(wrapUps).toHaveLength(1);
      expect(wrapUps[0]?.tick).toBe(run.length);
      expect(wrapUps[0]?.text).toMatch(/^Run ends\./);
      expect(run.events.at(-1)?.wrapUp).toBe(true);
      expect(run.events.filter((event) => !event.wrapUp)).toHaveLength(DM_SHAPES.length);
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const data = buildDataset();
    const stats = datasetStats(data);
    expect(stats).toMatchObject({
      dailyRows: 11_702,
      totalKb: 981.06,
      powerUser: 0,
      powerUserLinks: 469,
      powerDocKb: 148.47,
      powerDocShare: 15,
      medianUserLinks: 4,
      hottestCode: 'bATJ4g',
      hottestClicks: 3507,
      hottestDays: 21,
      takedownLinks: 103,
      expiringToday: 9,
    });

    const shown = (id: DmQueryId) =>
      DM_SHAPES.map((shape) => {
        const plan = planQuery(data, shape.id, id);
        return [plan.access, plan.records, plan.roundTrips, formatMs(plan.costMs)];
      });
    expect(shown('redirect')).toEqual([
      ['key', 1, 1, '0.51'],
      ['scan', 300, 1, '11.8'],
      ['key', 1, 1, '0.51'],
    ]);
    expect(shown('dashboard')).toEqual([
      ['index', 49, 1, '0.89'],
      ['key', 1, 1, '2.0'],
      ['scan', 3300, 33, '42.8'],
    ]);
    expect(shown('analytics')).toEqual([
      ['key', 21, 1, '0.61'],
      ['scan', 300, 1, '11.8'],
      ['key', 1, 1, '0.51'],
    ]);
    expect(shown('takedown')).toEqual([
      ['index', 103, 1, '1.7'],
      ['scan', 300, 1, '11.8'],
      ['scan', 3300, 33, '42.8'],
    ]);
    expect(shown('create')).toEqual([
      ['key', 1, 1, '0.52'],
      ['key', 1, 1, '2.0'],
      ['key', 1, 1, '0.51'],
    ]);
    expect(planQuery(data, 'tables', 'create').indexEntries).toBe(2);
    expect(planQuery(data, 'documents', 'create').kb).toBeCloseTo(148.67, 2);

    const typical = dashboardPlans(data, stats.medianUser).map((plan) => [
      plan.records,
      formatMs(plan.costMs),
    ]);
    expect(typical).toEqual([
      [23, '0.65'],
      [1, '0.52'],
      [3300, '42.8'],
    ]);
    expect(dashboardPlans(data, stats.medianUser)[1]?.kb).toBeCloseTo(1.47, 2);

    expect(fitTable(data).map((row) => row.cells.map((cell) => cell.best))).toEqual([
      [true, false, true],
      [true, false, true],
      [true, false, false],
      [false, false, true],
      [true, false, false],
    ]);

    const [normalized, denormalized] = counterChoices(data);
    expect([normalized.dashboardRows, formatMs(normalized.dashboardMs), normalized.writesPerSecond]).toEqual([
      49,
      '0.89',
      20_000,
    ]);
    expect([
      denormalized.dashboardRows,
      formatMs(denormalized.dashboardMs),
      denormalized.writesPerSecond,
    ]).toEqual([20, '0.74', 40_000]);

    const redirect = runToEnd(new DmRun('redirect', data));
    expect(redirect.length).toBe(24);
    expect(redirect.events.at(-1)?.text).toBe(
      'Run ends. Tables and Key-value tie for the redirect. At 20,000 a second, Documents would move 19.6 GB/s.',
    );
    const dashboard = runToEnd(new DmRun('dashboard', data));
    expect(dashboard.length).toBe(86);
    expect(dashboard.events.at(-1)?.text).toBe(
      'Run ends. Tables fits the dashboard best. At 50 a second, Key-value would move 49.1 MB/s.',
    );
  });
});
