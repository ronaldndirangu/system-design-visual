import { describe, expect, it } from 'vitest';
import {
  type Budgets,
  candidates,
  checkBudgets,
  DEFAULT_BUDGETS,
  EvalRun,
  evalCases,
  evalScenarios,
  finishedSummaries,
  type LaneSummary,
  latencyFor,
  summarizeLane,
} from '../../src/lib/models/evalBudget';

function threeSummaries(scenario: 'demo' | 'full'): [LaneSummary, LaneSummary, LaneSummary] {
  const [small, medium, large] = finishedSummaries(scenario);
  if (!small || !medium || !large) throw new Error('expected three lanes');
  return [small, medium, large];
}

function finish(run: EvalRun): EvalRun {
  while (!run.done) run.step();
  return run;
}

describe('EvalRun', () => {
  it('replays the same run for the same seed', () => {
    const a = finish(new EvalRun('full'));
    const b = finish(new EvalRun('full'));
    expect(b.lanes).toEqual(a.lanes);
    expect(b.events).toEqual(a.events);
  });

  it('gives a fresh run the same results as a finished one, so reset is a rebuild', () => {
    const played = finish(new EvalRun('full'));
    const fresh = new EvalRun('full');
    expect(fresh.ticks).toBe(0);
    expect(fresh.lanes.every((lane) => lane.results.length === 0)).toBe(true);
    expect(finish(fresh).lanes).toEqual(played.lanes);
  });

  it('grades one question per tick with every candidate and stops at the end', () => {
    const run = new EvalRun('demo');
    run.step();
    expect(run.lanes.map((lane) => lane.results.length)).toEqual([1, 1, 1]);
    expect(run.current?.id).toBe('q01');
    finish(run);
    run.step();
    expect(run.ticks).toBe(5);
    expect(run.lanes.map((lane) => lane.results.length)).toEqual([5, 5, 5]);
  });

  it('accounts for every graded question as a pass or a fail', () => {
    const run = new EvalRun('full');
    for (let i = 0; i < 10; i += 1) run.step();
    for (const summary of run.lanes.map(summarizeLane)) {
      expect(summary.passed + summary.failed).toBe(summary.graded);
      expect(summary.graded).toBe(run.ticks);
    }
  });

  it('times a question the same way in both scenarios', () => {
    const demo = finish(new EvalRun('demo'));
    const full = finish(new EvalRun('full'));
    for (let lane = 0; lane < 3; lane += 1) {
      expect(full.lanes[lane]?.results.slice(0, 5)).toEqual(demo.lanes[lane]?.results);
    }
  });

  it('logs one event per failing question plus a wrap up note', () => {
    const run = finish(new EvalRun('full'));
    const failing = evalCases.filter((item) => item.fails.length > 0).length;
    expect(run.events.filter((event) => event.marker)).toHaveLength(failing);
    expect(run.events.at(-1)?.marker).toBe(false);
    expect(run.events.at(-1)?.text).toContain('Medium fits every budget');
  });

  it('cannot tell the candidates apart on the demo questions', () => {
    const run = finish(new EvalRun('demo'));
    expect(evalScenarios.demo.caseIds).toHaveLength(5);
    expect(run.events.filter((event) => event.marker)).toHaveLength(0);
    expect(run.events.at(-1)?.text).toContain('cannot tell them apart');
  });

  it('keeps latency positive and grows it with answer length', () => {
    for (const item of evalCases) {
      for (const candidate of Object.values(candidates)) {
        const latency = latencyFor(candidate, item);
        expect(latency).toBeGreaterThan(candidate.firstTokenSeconds);
        expect(latency).toBeLessThanOrEqual(
          candidate.firstTokenSeconds * 1.5 + item.outputTokens * candidate.secondsPerToken + 1e-4,
        );
      }
    }
  });
});

describe('budget gate', () => {
  it('pins the full set numbers the lesson quotes', () => {
    const [small, medium, large] = threeSummaries('full');
    expect(small).toMatchObject({
      passed: 17,
      graded: 24,
      declinesHandled: 3,
      declineCases: 6,
      costPer1k: 987,
    });
    expect(medium).toMatchObject({ passed: 21, graded: 24, declinesHandled: 6, costPer1k: 3949 });
    expect(large).toMatchObject({ passed: 23, graded: 24, declinesHandled: 6, costPer1k: 14809 });
    expect(small.p95Seconds).toBeCloseTo(0.8, 2);
    expect(medium.p95Seconds).toBeCloseTo(1.5, 2);
    expect(large.p95Seconds).toBeCloseTo(3.01, 2);
  });

  it('lets only Medium through the default budgets on the full set', () => {
    const verdicts = finishedSummaries('full').map((summary) => checkBudgets(summary, DEFAULT_BUDGETS));
    expect(verdicts).toEqual([
      { fits: false, failed: ['quality', 'declines'] },
      { fits: true, failed: [] },
      { fits: false, failed: ['latency', 'cost'] },
    ]);
  });

  it('lets Small through on the demo questions, which is the trap', () => {
    const [small, medium, large] = threeSummaries('demo');
    expect(checkBudgets(small, DEFAULT_BUDGETS).fits).toBe(true);
    expect(checkBudgets(medium, DEFAULT_BUDGETS).fits).toBe(true);
    expect(checkBudgets(large, DEFAULT_BUDGETS).fits).toBe(false);
    expect(small.costPer1k).toBeLessThan(medium.costPer1k);
  });

  it('leaves nobody when the p95 ceiling drops to 1.2 seconds', () => {
    const tight: Budgets = { ...DEFAULT_BUDGETS, maxP95Seconds: 1.2 };
    const fits = finishedSummaries('full').map((summary) => checkBudgets(summary, tight).fits);
    expect(fits).toEqual([false, false, false]);
  });

  it('skips the decline check when the toggle is off', () => {
    const [small] = threeSummaries('full');
    const loose: Budgets = { ...DEFAULT_BUDGETS, minPassRate: 0.7, requireDeclines: false };
    expect(checkBudgets(small, loose)).toEqual({ fits: true, failed: [] });
  });
});
