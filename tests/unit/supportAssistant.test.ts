import { describe, expect, it } from 'vitest';
import {
  CapstoneRun,
  type CapstoneScenarioId,
  capstoneScenarioOrder,
  capstoneScenarios,
  EVIDENCE_THRESHOLD,
  finishedCapstone,
  getDoc,
  type PipelineSummary,
  summarizePipeline,
} from '../../src/lib/models/supportAssistant';

function byPipeline(id: CapstoneScenarioId): { prototype: PipelineSummary; guarded: PipelineSummary } {
  const [prototype, guarded] = finishedCapstone(id);
  if (!prototype || !guarded) throw new Error('missing pipeline');
  return { prototype, guarded };
}

describe('support assistant capstone model', () => {
  it('replays identically for the same scenario', () => {
    for (const id of capstoneScenarioOrder) {
      expect(finishedCapstone(id)).toEqual(finishedCapstone(id));
    }
  });

  it('a reset run starts cold and inherits no cache, spend, or refunds', () => {
    const first = new CapstoneRun('leak');
    first.finish();
    const reset = new CapstoneRun('leak');
    expect(reset.ticks).toBe(0);
    expect(reset.lanes.map(summarizePipeline).map((s) => s.handled + s.spent)).toEqual([0, 0]);
    reset.step();
    expect(reset.lanes.map((lane) => lane.results[0]?.fromCache)).toEqual([false, false]);
    reset.finish();
    expect(reset.lanes.map(summarizePipeline)).toEqual(first.lanes.map(summarizePipeline));
  });

  it('conserves requests in both pipelines at every tick', () => {
    for (const id of capstoneScenarioOrder) {
      const run = new CapstoneRun(id);
      while (!run.done) {
        run.step();
        for (const lane of run.lanes) {
          const s = summarizePipeline(lane);
          // One tick handles one request end to end, so nothing is in flight.
          expect(s.answered + s.handoff + s.refunded + s.declined + s.budget).toBe(run.ticks);
          expect(s.spent).toBe(s.spentBy.harbor + s.spentBy.pine);
          expect(s.spent).toBeLessThanOrEqual(run.scenario.pool);
        }
      }
    }
  });

  it('feeds both pipelines the same fixture requests and model outputs', () => {
    for (const id of capstoneScenarioOrder) {
      const run = new CapstoneRun(id);
      run.finish();
      const [prototype, guarded] = run.lanes;
      expect(prototype.results.map((r) => r.request)).toEqual(guarded.results.map((r) => r.request));
      expect(prototype.results.map((r) => r.request)).toEqual(capstoneScenarios[id].requests);
    }
  });

  it('every fixture hit points at a real document, best first', () => {
    for (const id of capstoneScenarioOrder) {
      for (const request of capstoneScenarios[id].requests) {
        expect(request.hits.length).toBeGreaterThan(0);
        for (const hit of request.hits) expect(getDoc(hit.doc)).toBeDefined();
        const scores = request.hits.map((hit) => hit.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      }
    }
  });

  it('pins the tenant leak probe', () => {
    const { prototype, guarded } = byPipeline('leak');
    expect(prototype).toMatchObject({ answered: 6, fromCache: 2, cited: 0, handoff: 0, spent: 12 });
    expect(prototype.harms.leak).toBe(4);
    expect(guarded).toMatchObject({
      answered: 4,
      fromCache: 1,
      cited: 4,
      handoff: 2,
      spent: 9,
      totalHarms: 0,
    });
  });

  it('the guarded filter still lets staff read staff only documents', () => {
    const run = new CapstoneRun('leak');
    run.finish();
    const staff = run.lanes[1].results.find((r) => r.request.role === 'staff');
    expect(staff?.outcome).toBe('answered');
    expect(staff?.cites).toEqual(['harbor/refund-review']);
  });

  it('pins the weak evidence scenario', () => {
    const { prototype, guarded } = byPipeline('weak');
    expect(prototype).toMatchObject({ answered: 5, handoff: 0, spent: 15 });
    expect(prototype.harms.unsupported).toBe(3);
    expect(guarded).toMatchObject({ answered: 2, handoff: 3, spent: 9, totalHarms: 0 });
    expect(EVIDENCE_THRESHOLD).toBe(0.6);
  });

  it('the citation check catches an answer that cites a document search never returned', () => {
    const run = new CapstoneRun('weak');
    run.finish();
    const caught = run.lanes[1].results.find((r) => r.request.id === 'W5');
    expect(caught?.outcome).toBe('handoff');
    expect(caught?.path).toContain('checks');
    expect(caught?.cost).toBe(3);
  });

  it('pins the refund scenario', () => {
    const { prototype, guarded } = byPipeline('refund');
    expect(prototype).toMatchObject({
      refunded: 4,
      declined: 0,
      staffTouches: 0,
      spent: 12,
      wrongRefundTotal: 697,
    });
    expect(prototype.harms.badRefund).toBe(3);
    expect(guarded).toMatchObject({
      refunded: 1,
      declined: 2,
      answered: 1,
      staffTouches: 3,
      spent: 12,
      totalHarms: 0,
    });
  });

  it('pins the budget scenario', () => {
    const { prototype, guarded } = byPipeline('budget');
    expect(prototype).toMatchObject({ answered: 6, budget: 3, spent: 18, spentBy: { harbor: 15, pine: 3 } });
    expect(prototype.harms.starved).toBe(2);
    expect(guarded).toMatchObject({ answered: 6, budget: 3, spent: 18, spentBy: { harbor: 9, pine: 9 } });
    expect(guarded.harms.starved).toBe(0);
  });

  it('guards trade harms for staff work', () => {
    for (const id of capstoneScenarioOrder) {
      const { prototype, guarded } = byPipeline(id);
      expect(guarded.totalHarms).toBe(0);
      expect(prototype.totalHarms).toBeGreaterThan(0);
      expect(guarded.staffTouches).toBeGreaterThanOrEqual(prototype.staffTouches);
    }
  });
});
