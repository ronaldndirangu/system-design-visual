import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_SCORE,
  CapstoneRun,
  type CapstoneScenarioId,
  CORPUS_VERSION,
  capstoneScenarioOrder,
  capstoneScenarios,
  EVIDENCE_THRESHOLD,
  finishedCapstone,
  getDoc,
  type PipelineSummary,
  SupportPipeline,
  searchHits,
  summarizePipeline,
  TOP_K,
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

  it('guarded search filters before ranking: a full top k of documents the asker may read', () => {
    for (const id of capstoneScenarioOrder) {
      for (const request of capstoneScenarios[id].requests) {
        const scoped = searchHits(request, true);
        expect(scoped).toHaveLength(TOP_K);
        for (const hit of scoped) {
          const doc = getDoc(hit.doc);
          expect(doc?.tenant).toBe(request.tenant);
          if (request.role !== 'staff') expect(doc?.staffOnly).toBe(false);
        }
        const scores = scoped.map((hit) => hit.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        expect(searchHits(request, false)[0]).toEqual(request.hits[0]);
      }
    }
  });

  it('a blocked top hit frees its slot for the next document the asker may read', () => {
    const request = capstoneScenarios.leak.requests.find((r) => r.id === 'L3');
    if (!request) throw new Error('missing L3');
    expect(getDoc(request.hits[0]?.doc ?? '')?.tenant).not.toBe(request.tenant);
    expect(searchHits(request, true).map((hit) => hit.doc)).toEqual(['pine/returns', 'pine/ebooks']);
    expect(searchHits(request, true)[1]?.score).toBe(BACKGROUND_SCORE);
    const run = new CapstoneRun('leak');
    run.finish();
    const result = run.lanes[1]?.results.find((r) => r.request.id === 'L3');
    expect(result).toMatchObject({ outcome: 'handoff', cost: 0, cites: [] });
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
    expect(prototype).toMatchObject({ answered: 6, handoff: 0, spent: 18 });
    expect(prototype.harms.unsupported).toBe(4);
    expect(guarded).toMatchObject({ answered: 2, handoff: 4, staffTouches: 4, spent: 12, totalHarms: 0 });
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

  it('the support check catches a real citation that does not back the claim', () => {
    const run = new CapstoneRun('weak');
    run.finish();
    const request = capstoneScenarios.weak.requests.find((r) => r.id === 'W6');
    expect(request?.cites).toBeUndefined();
    expect(request?.hits[0]?.score).toBeGreaterThanOrEqual(EVIDENCE_THRESHOLD);
    const [prototype, guarded] = run.lanes.map((lane) => lane.results.find((r) => r.request.id === 'W6'));
    expect(prototype).toMatchObject({ outcome: 'answered', harm: 'unsupported' });
    expect(guarded).toMatchObject({ outcome: 'handoff', cost: 3, cites: [] });
    expect(guarded?.path.slice(-2)).toEqual(['checks', 'staff']);
  });

  it('the guarded cache key misses on a follow-up turn, so it never reuses a first-turn answer', () => {
    const pipeline = new SupportPipeline('guarded', 60);
    const first = {
      id: 'K1',
      tenant: 'harbor' as const,
      role: 'customer' as const,
      text: 'Can I return it?',
      cacheable: true,
      hits: [],
    };
    const followUp = { ...first, id: 'K2', conversation: ['I bought a sale jacket.'] };
    expect(pipeline.cacheKey(first)).toContain(`|${CORPUS_VERSION}|h:new|`);
    expect(pipeline.cacheKey(followUp)).not.toBe(pipeline.cacheKey(first));
    expect(pipeline.cacheKey({ ...first, id: 'K3' })).toBe(pipeline.cacheKey(first));
    expect(new SupportPipeline('prototype', 60).cacheKey(followUp)).toBe('can i return it?');
  });

  it('keys refunds by tenant, so two stores can refund the same order number', () => {
    const pipeline = new SupportPipeline('guarded', 60);
    const ask = { order: '2201', amount: 89, valid: true, reason: 'fixture approval' };
    const results = (['harbor', 'pine'] as const).map((tenant) =>
      pipeline.handle({
        id: `X-${tenant}`,
        tenant,
        role: 'customer',
        text: 'Please refund order 2201.',
        cacheable: false,
        hits: [{ doc: `${tenant}/returns`, score: 0.9 }],
        refund: ask,
      }),
    );
    expect(results.map((r) => r.outcome)).toEqual(['refunded', 'refunded']);
    expect(results[1]?.note).toContain('refund:pine:2201');
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
      staffTouches: 1,
      spent: 12,
      totalHarms: 0,
    });
  });

  it('code enforces the refund policy, and staff approval only gates refunds that pass it', () => {
    const run = new CapstoneRun('refund');
    run.finish();
    const guarded = run.lanes[1].results;
    const declined = guarded.filter((r) => r.outcome === 'declined');
    expect(declined.map((r) => r.request.id)).toEqual(['F2', 'F3']);
    for (const r of declined) {
      expect(r.path).toContain('checks');
      expect(r.path).not.toContain('staff');
      expect(r.path).not.toContain('tool');
    }
    const refunded = guarded.filter((r) => r.outcome === 'refunded');
    expect(refunded.map((r) => r.request.id)).toEqual(['F1']);
    expect(refunded[0]?.path.slice(-3)).toEqual(['checks', 'staff', 'tool']);
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
