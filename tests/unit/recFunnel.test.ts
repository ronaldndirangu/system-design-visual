import { describe, expect, it } from 'vitest';
import {
  budgetCrossing,
  CATALOG_SIZE,
  CURVE_CANDIDATES,
  candidateCurve,
  crowdDotCount,
  crowdDots,
  type FunnelResult,
  ineligibleReason,
  itemById,
  REC_BUDGET_MS,
  RELEVANT_TOTAL,
  RecRun,
  type RecScenarioId,
  recScenarioIds,
  recScenarios,
  runFunnel,
  splitBudget,
} from '../../src/lib/models/recFunnel';

function finish(run: RecRun): RecRun {
  while (!run.done) run.step();
  return run;
}

function result(id: RecScenarioId): FunnelResult {
  return runFunnel(recScenarios[id].config);
}

function stageCounts(r: FunnelResult) {
  return r.stages.map((s) => [s.in, s.passed, s.ms]);
}

describe('RecRun', () => {
  it('replays the same transcript for the same scenario', () => {
    for (const id of recScenarioIds) {
      expect(finish(new RecRun(id)).events).toEqual(finish(new RecRun(id)).events);
    }
  });

  it('gives a fresh run the same result as a played one, so reset is a rebuild', () => {
    const played = finish(new RecRun('funnel'));
    const fresh = new RecRun('funnel');
    expect(fresh.ticks).toBe(0);
    expect(fresh.stages).toEqual([]);
    expect(fresh.events).toEqual([]);
    expect(finish(fresh).stages).toEqual(played.stages);
    expect(fresh.elapsedMs).toBe(played.result.totalMs);
  });

  it('reveals one stage per step and stops at the end', () => {
    const run = new RecRun('few');
    run.step();
    expect(run.stages.map((s) => s.stage)).toEqual(['candidates']);
    finish(run);
    expect(run.ticks).toBe(4);
    run.step();
    expect(run.ticks).toBe(4);
  });

  it('marks the budget breach, the missed best item, and a weak final list', () => {
    const marked = (id: RecScenarioId) =>
      finish(new RecRun(id))
        .events.filter((e) => e.marker)
        .map((e) => e.stage);
    expect(marked('score')).toEqual(['ranker']);
    expect(marked('funnel')).toEqual([]);
    expect(marked('few')).toEqual(['candidates', 'final']);
    expect(marked('popular')).toEqual(['candidates', 'final']);
  });
});

describe('runFunnel', () => {
  it('conserves items at every stage: in equals passed plus dropped', () => {
    for (const id of recScenarioIds) {
      const r = result(id);
      for (const s of r.stages) {
        expect(s.in).toBe(s.passed + s.dropped);
        expect(s.namedIn.length).toBe(s.namedPassed.length + s.namedDropped.length);
        expect(new Set([...s.namedPassed, ...s.namedDropped.map((d) => d.id)])).toEqual(new Set(s.namedIn));
      }
      for (let index = 1; index < r.stages.length; index += 1) {
        expect(r.stages[index]?.in).toBe(r.stages[index - 1]?.passed);
        expect(r.stages[index]?.namedIn).toEqual(r.stages[index - 1]?.namedPassed);
      }
      expect(r.stages[0]?.in).toBe(CATALOG_SIZE);
    }
  });

  it('removes ineligible items before the ranker in every run', () => {
    const runs = [
      ...recScenarioIds.map(result),
      ...CURVE_CANDIDATES.map((candidates) => runFunnel(splitBudget(candidates))),
    ];
    for (const r of runs) {
      const ranker = r.stages.find((s) => s.stage === 'ranker');
      expect(ranker?.namedIn.filter((id) => ineligibleReason(itemById(id)) !== null)).toEqual([]);
      for (const s of r.stages.slice(1)) {
        expect(s.namedDropped.filter((d) => d.reason === 'noShip' || d.reason === 'recalled')).toEqual([]);
      }
    }
  });

  it('pins score everything: perfect list, 30,001 ms', () => {
    const r = result('score');
    expect(stageCounts(r)).toEqual([
      [3_000_000, 2_999_998, 0],
      [2_999_998, 15, 29_999.98],
      [15, 14, 0.5],
      [14, 5, 0.5],
    ]);
    expect(r.stages[0]?.skipped).toBe(false);
    expect(r.stages[0]?.namedDropped).toEqual([
      { id: 'g8', reason: 'noShip' },
      { id: 'n10', reason: 'recalled' },
    ]);
    expect(r.totalMs).toBe(30_000.98);
    expect(r.overBudget).toBe(true);
    expect(RELEVANT_TOTAL).toBe(9);
    expect(r.relevantReached).toBe(9);
    expect(r.shown).toEqual(['g1', 'g2', 'g9', 'g3', 'g7']);
    expect(r.goodShown).toBe(5);
  });

  it('pins the funnel: same top 5 in 14.87 ms', () => {
    const r = result('funnel');
    expect(r.sources.map((s) => [s.source, s.returned, s.ms])).toEqual([
      ['embed', 300, 8],
      ['together', 125, 2.5],
      ['category', 75, 1.3],
    ]);
    expect(r.rawEntries).toBe(500);
    expect(r.duplicates).toBe(11);
    expect(stageCounts(r)).toEqual([
      [3_000_000, 487, 9],
      [487, 15, 4.87],
      [15, 14, 0.5],
      [14, 5, 0.5],
    ]);
    expect(r.totalMs).toBe(14.87);
    expect(r.relevantReached).toBe(8);
    expect(
      r.stages[0]?.namedDropped
        .filter((d) => d.reason === 'missed' && itemById(d.id).relevant)
        .map((d) => d.id),
    ).toEqual(['g10']);
    expect(r.stages[0]?.namedDropped.filter((d) => d.reason !== 'missed')).toEqual([
      { id: 'g8', reason: 'noShip' },
      { id: 'n10', reason: 'recalled' },
    ]);
    expect(r.shown).toEqual(result('score').shown);
    expect(r.stages[3]?.namedDropped[0]).toEqual({ id: 'g5', reason: 'diversity' });
  });

  it('pins too few candidates: the best replacement never reaches the ranker', () => {
    const r = result('few');
    expect(r.sources.map((s) => s.returned)).toEqual([12, 5, 3]);
    expect(r.duplicates).toBe(7);
    expect(stageCounts(r)).toEqual([
      [3_000_000, 12, 6.12],
      [12, 12, 0.12],
      [12, 11, 0.5],
      [11, 5, 0.5],
    ]);
    expect(r.totalMs).toBe(7.24);
    expect(r.relevantReached).toBe(4);
    expect(r.stages[0]?.namedDropped).toContainEqual({ id: 'g1', reason: 'missed' });
    expect(r.shown).toEqual(['g2', 'g9', 'g5', 'n1', 'n4']);
    expect(r.goodShown).toBe(3);
  });

  it('pins popularity only: fast and irrelevant', () => {
    const r = result('popular');
    expect(stageCounts(r)).toEqual([
      [3_000_000, 5, 1.02],
      [5, 5, 0],
      [5, 5, 0.5],
      [5, 5, 0.5],
    ]);
    expect(r.stages[1]?.skipped).toBe(true);
    expect(r.totalMs).toBe(2.02);
    expect(r.relevantReached).toBe(0);
    expect(r.shown).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(r.goodShown).toBe(0);
  });

  it('shows at most two items from one brand', () => {
    for (const id of recScenarioIds) {
      const brands = result(id).shown.map((shownId) => itemById(shownId).brand);
      for (const brand of brands) expect(brands.filter((b) => b === brand).length).toBeLessThanOrEqual(2);
    }
  });
});

describe('candidateCurve', () => {
  it('splits a budget 60, 25, and 15 percent across the sources', () => {
    expect(splitBudget(500).sources).toEqual({ embed: 300, together: 125, category: 75 });
    expect(splitBudget(10).sources).toEqual({ embed: 6, together: 3, category: 1 });
  });

  it('pins recall rising then saturating while latency keeps growing', () => {
    const curve = candidateCurve();
    expect(curve.map((p) => Math.round(p.recall * RELEVANT_TOTAL))).toEqual([
      3, 4, 7, 7, 8, 8, 8, 9, 9, 9, 9,
    ]);
    expect(curve.map((p) => p.totalMs)).toEqual([
      7.13, 7.24, 7.71, 8.49, 10.08, 14.87, 22.87, 38.87, 86.87, 166.87, 326.87,
    ]);
    const firstOver = curve.find((p) => p.totalMs > REC_BUDGET_MS);
    expect(firstOver?.candidates).toBe(5000);
    expect(curve.map((p) => p.bestShown)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(Math.round(budgetCrossing(curve) ?? 0)).toBe(2696);
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index]?.recall).toBeGreaterThanOrEqual(curve[index - 1]?.recall ?? 0);
      expect(curve[index]?.totalMs).toBeGreaterThan(curve[index - 1]?.totalMs ?? 0);
    }
  });
});

describe('crowd dots', () => {
  it('caps the sample and repeats it for the same key', () => {
    expect(crowdDotCount(0)).toBe(0);
    expect(crowdDotCount(469)).toBe(11);
    expect(crowdDotCount(CATALOG_SIZE)).toBe(24);
    expect(crowdDots('catalog', 24)).toEqual(crowdDots('catalog', 24));
    expect(crowdDots('catalog', 500)).toHaveLength(24);
  });
});
