import { describe, expect, it } from 'vitest';
import {
  buildWorkload,
  CascadeDuel,
  type CascadeSummary,
  cascadeRequest,
  finishedCascadeSummaries,
  type GatewayRequest,
  type MixId,
  mediumOnlySummary,
  missedBudgets,
  routeRequest,
  tierCost,
} from '../../src/lib/models/gatewayCascade';

function finish(duel: CascadeDuel): CascadeDuel {
  while (!duel.done) duel.step();
  return duel;
}

function pair(mixId: MixId): [CascadeSummary, CascadeSummary] {
  const [routing, cascade] = finishedCascadeSummaries(mixId);
  if (!routing || !cascade) throw new Error('expected two lanes');
  return [routing, cascade];
}

function request(overrides: Partial<GatewayRequest>): GatewayRequest {
  return {
    id: 1,
    difficulty: 'easy',
    outputTokens: 60,
    passes: { small: true, medium: true },
    predicted: 'easy',
    checkerDraw: 0.5,
    jitter: { small: 0, medium: 0 },
    ...overrides,
  };
}

describe('CascadeDuel', () => {
  it('replays the same duel for the same seed, and a fresh duel is a clean reset', () => {
    const played = finish(new CascadeDuel('easy'));
    const fresh = new CascadeDuel('easy');
    expect(fresh.ticks).toBe(0);
    expect(fresh.lanes.every((lane) => lane.results.length === 0)).toBe(true);
    finish(fresh);
    expect(fresh.lanes).toEqual(played.lanes);
    expect(fresh.events).toEqual(played.events);
  });

  it('sends the same requests through both lanes, one per tick, and stops at the end', () => {
    const duel = new CascadeDuel('hard');
    duel.step();
    expect(duel.lanes.map((lane) => lane.results.length)).toEqual([1, 1]);
    finish(duel);
    duel.step();
    expect(duel.ticks).toBe(60);
    const [routing, cascade] = duel.lanes;
    expect(routing?.results.map((r) => r.requestId)).toEqual(cascade?.results.map((r) => r.requestId));
    expect(routing?.results.map((r) => r.difficulty)).toEqual(duel.workload.map((r) => r.difficulty));
  });

  it('builds each mix with the counts its chip promises', () => {
    const easy = buildWorkload('easy');
    const hard = buildWorkload('hard');
    expect(easy.filter((r) => r.difficulty === 'easy')).toHaveLength(48);
    expect(hard.filter((r) => r.difficulty === 'hard')).toHaveLength(42);
  });
});

describe('routing and cascade rules', () => {
  it('routes on the classifier’s guess, so a hard question called easy goes to Small', () => {
    const result = routeRequest(
      request({ difficulty: 'hard', predicted: 'easy', passes: { small: false, medium: true } }),
    );
    expect(result.tiers).toEqual(['small']);
    expect(result.misrouted).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('makes an escalated request pay for both calls', () => {
    const r = request({ difficulty: 'hard', passes: { small: false, medium: true }, checkerDraw: 0.1 });
    const result = cascadeRequest(r);
    expect(result.tiers).toEqual(['small', 'medium']);
    expect(result.pass).toBe(true);
    expect(result.cost).toBeGreaterThan(tierCost('small', r) + tierCost('medium', r));
  });

  it('lets a failing Small answer through when the checker misses it', () => {
    const result = cascadeRequest(request({ passes: { small: false, medium: true }, checkerDraw: 0.95 }));
    expect(result.tiers).toEqual(['small']);
    expect(result.missedBad).toBe(true);
    expect(result.pass).toBe(false);
  });
});

describe('pinned results, seed 42', () => {
  it('mostly easy: routing fits every budget; the cascade is cheaper but misses p95', () => {
    const [routing, cascade] = pair('easy');
    const medium = mediumOnlySummary('easy');
    expect(routing).toMatchObject({ passed: 53, costPer1k: 1870, misroutes: 8 });
    expect(routing.p95Seconds).toBeCloseTo(1.595, 3);
    expect(cascade).toMatchObject({ passed: 59, costPer1k: 1709, escalations: 10 });
    expect(cascade.p95Seconds).toBeCloseTo(2.3074, 3);
    expect(medium).toMatchObject({ passed: 55, costPer1k: 3949 });
    expect(missedBudgets(routing)).toEqual([]);
    expect(missedBudgets(cascade)).toEqual(['latency']);
    expect(missedBudgets(medium)).toEqual([]);
  });

  it('mostly hard: the cascade’s savings shrink and routing falls under the quality bar', () => {
    const [routing, cascade] = pair('hard');
    const medium = mediumOnlySummary('hard');
    expect(routing).toMatchObject({ passed: 49, costPer1k: 3142, misroutes: 7 });
    expect(cascade).toMatchObject({ passed: 51, costPer1k: 2743, escalations: 24 });
    expect(cascade.passRate).toBeCloseTo(0.85, 6);
    expect(medium).toMatchObject({ passed: 53, costPer1k: 4123 });
    expect(missedBudgets(routing)).toEqual(['quality']);
    expect(missedBudgets(cascade)).toEqual(['latency']);
    expect(missedBudgets(medium)).toEqual([]);
    const easySaving = 1 - pair('easy')[1].costPer1k / mediumOnlySummary('easy').costPer1k;
    const hardSaving = 1 - cascade.costPer1k / medium.costPer1k;
    expect(easySaving).toBeGreaterThan(0.5);
    expect(hardSaving).toBeLessThan(0.4);
  });

  it('flags first-time events once each and ends with an unmarked wrap up', () => {
    const duel = finish(new CascadeDuel('hard'));
    const marked = duel.events.filter((e) => e.marker);
    expect(marked).toHaveLength(5);
    expect(new Set(marked.map((e) => e.text)).size).toBe(5);
    expect(duel.events.at(-1)?.marker).toBe(false);
    expect(duel.events.at(-1)?.text).toContain('routing misses quality');
  });
});
