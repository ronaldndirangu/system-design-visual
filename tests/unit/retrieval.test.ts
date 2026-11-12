import { describe, expect, it } from 'vitest';
import {
  ABSTAIN_TEXT,
  cacheKey,
  canRead,
  chunkById,
  chunkPolicy,
  chunkWords,
  compareRetrievers,
  countOutcomes,
  evaluate,
  type FilterMode,
  fuse,
  HybridRun,
  policyWordCount,
  RRF_K,
  retrieve,
  rrfScore,
  scenarioById,
} from '../../src/lib/models/retrieval';
import { EVAL_QUESTIONS, type Query, SCENARIOS } from '../../src/lib/models/retrievalCorpus';

const MODES: FilterMode[] = ['pre', 'post', 'none'];
const ALL_QUERIES: Query[] = [...SCENARIOS.map((s) => s.query), ...EVAL_QUESTIONS.map((q) => q.query)];

function finish(run: HybridRun): HybridRun {
  while (!run.done) run.step();
  return run;
}

describe('reciprocal rank fusion', () => {
  it('sums 1/(k + rank) per list, with ranks starting at 1', () => {
    expect(RRF_K).toBe(60);
    expect(rrfScore([1, 2])).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(rrfScore([1, 2])).toBeCloseTo(0.032522, 6);
    expect(rrfScore([1, 1])).toBeCloseTo(2 / 61, 12);
  });

  it('adds nothing for a list the document is missing from', () => {
    expect(rrfScore([1, null])).toBeCloseTo(1 / 61, 12);
    expect(rrfScore([null, null])).toBe(0);
  });

  it('fuses the unfiltered sale-item lists into the pinned order', () => {
    const { fused } = retrieve(scenarioById('sale').query, 'none');
    expect(fused.slice(0, 3).map((r) => [r.id, r.keywordRank, r.vectorRank])).toEqual([
      ['harbor-returns-1', 1, 2],
      ['pine-returns', 3, 1],
      ['harbor-returns-2', 5, 5],
    ]);
    expect(fused[0]?.score).toBeCloseTo(0.032522, 6);
    expect(fused[1]?.score).toBeCloseTo(1 / 63 + 1 / 61, 12);
  });

  it('fuses the pre-filtered sale-item lists into the order the lesson quotes', () => {
    const { fused } = retrieve(scenarioById('sale').query, 'pre');
    expect(fused.slice(0, 4).map((r) => [r.id, r.keywordRank, r.vectorRank])).toEqual([
      ['harbor-returns-1', 1, 1],
      ['harbor-returns-2', 4, 2],
      ['harbor-sale', 3, 3],
      ['harbor-giftcard', 2, null],
    ]);
    expect(fused[0]?.score).toBeCloseTo(0.0328, 4);
    expect(fused[1]?.score).toBeCloseTo(0.0318, 4);
    expect(fused[2]?.score).toBeCloseTo(0.0317, 4);
    expect(fused[3]?.score).toBeCloseTo(0.0161, 4);
  });

  it('lifts the exact code chunk to first although vector search ranks it fourth', () => {
    const { fused } = retrieve(scenarioById('code').query, 'pre');
    expect(fused.slice(0, 2).map((r) => [r.id, r.keywordRank, r.vectorRank])).toEqual([
      ['harbor-promo', 1, 4],
      ['harbor-sale', null, 1],
    ]);
    expect(fused[0]?.score).toBeCloseTo(0.032, 4);
    expect(fused[1]?.score).toBeCloseTo(0.0164, 4);
    const vector = compareRetrievers(scenarioById('code'), 'pre').find((r) => r.retriever === 'vector');
    expect(vector?.answer.from).toBe('harbor-sale');
  });

  it('lifts the paraphrase answer into the top 3 from the vector list alone', () => {
    const { fused } = retrieve(scenarioById('paraphrase').query, 'pre');
    expect(fused.slice(0, 3).map((r) => [r.id, r.keywordRank, r.vectorRank])).toEqual([
      ['harbor-backorder', 1, 5],
      ['harbor-returns-1', null, 1],
      ['harbor-returns-2', null, 2],
    ]);
  });

  it('breaks ties by chunk id, independent of input order', () => {
    const a = fuse([{ id: 'b', rank: 1, score: 2 }], [{ id: 'a', rank: 1, score: 0.9 }]);
    const b = fuse([{ id: 'a', rank: 1, score: 2 }], [{ id: 'b', rank: 1, score: 0.9 }]);
    expect(a.map((r) => r.id)).toEqual(['a', 'b']);
    expect(b.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('retrieve', () => {
  it('returns the same result every time', () => {
    for (const query of ALL_QUERIES) {
      for (const mode of MODES) {
        expect(retrieve(query, mode)).toEqual(retrieve(query, mode));
      }
    }
  });

  it('never lists or sends another store or staff chunk when pre-filtering', () => {
    for (const query of ALL_QUERIES) {
      const user = { tenant: query.tenant, scope: query.scope };
      const r = retrieve(query, 'pre');
      const seen = [...r.searchable, ...r.keyword.map((x) => x.id), ...r.vector.map((x) => x.id), ...r.sent];
      for (const id of seen) expect(canRead(chunkById(id), user)).toBe(true);
      expect(r.leaks).toEqual([]);
    }
  });

  it('never sends an unreadable chunk when post-filtering', () => {
    for (const query of ALL_QUERIES) expect(retrieve(query, 'post').leaks).toEqual([]);
  });

  it('leaks another store and staff chunks without a filter', () => {
    expect(retrieve(scenarioById('sale').query, 'none').leaks).toEqual([
      { id: 'pine-returns', kind: 'tenant' },
    ]);
    expect(retrieve(scenarioById('other').query, 'none').leaks).toEqual([
      { id: 'pine-price-match', kind: 'tenant' },
      { id: 'pine-staff-price', kind: 'tenant' },
    ]);
    expect(retrieve(scenarioById('paraphrase').query, 'none').leaks).toEqual([
      { id: 'pine-ebooks', kind: 'tenant' },
      { id: 'harbor-staff-returns', kind: 'scope' },
    ]);
  });

  it('answers the other store question from the wrong store without a filter', () => {
    const answer = retrieve(scenarioById('other').query, 'none').answer;
    expect(answer.kind).toBe('answered');
    expect(answer.from).toBe('pine-price-match');
    expect(retrieve(scenarioById('sale').query, 'none').answer.citations).toEqual([
      'harbor-returns-1',
      'pine-returns',
    ]);
  });

  it('can leave too few chunks when filtering after top-k', () => {
    const other = retrieve(scenarioById('other').query, 'post');
    expect(other.dropped).toEqual(['pine-price-match', 'pine-staff-price']);
    expect(other.sent).toEqual(['harbor-sale']);

    const paraphrase = retrieve(scenarioById('paraphrase').query, 'post');
    expect(paraphrase.sent).toEqual(['harbor-backorder']);
    expect(paraphrase.answer.kind).toBe('abstained');

    const pre = retrieve(scenarioById('paraphrase').query, 'pre');
    expect(pre.sent).toEqual(['harbor-backorder', 'harbor-returns-1', 'harbor-returns-2']);
    expect(pre.answer.from).toBe('harbor-returns-1');
  });

  it('cites only sent chunks that clear the evidence threshold', () => {
    const r = retrieve(scenarioById('sale').query, 'pre');
    expect(r.answer.citations).toEqual(['harbor-returns-1']);
    for (const id of r.answer.citations) expect(r.sent).toContain(id);
  });

  it('abstains with the handoff text when evidence is weak', () => {
    const r = retrieve(scenarioById('other').query, 'pre');
    expect(r.answer).toEqual({ kind: 'abstained', from: null, text: ABSTAIN_TEXT, citations: [] });
  });
});

describe('compareRetrievers', () => {
  const correct = (id: Parameters<typeof scenarioById>[0]) =>
    Object.fromEntries(compareRetrievers(scenarioById(id), 'pre').map((r) => [r.retriever, r.correct]));

  it('shows keyword search missing the paraphrase', () => {
    expect(correct('paraphrase')).toEqual({ keyword: false, vector: true, hybrid: true });
  });

  it('shows vector search missing the exact code', () => {
    expect(correct('code')).toEqual({ keyword: true, vector: false, hybrid: true });
  });

  it('gets every pre-filtered scenario right with hybrid search', () => {
    for (const s of SCENARIOS) {
      const hybrid = compareRetrievers(s, 'pre').find((r) => r.retriever === 'hybrid');
      expect(hybrid?.correct).toBe(true);
    }
  });
});

describe('HybridRun', () => {
  it('replays the same events for the same inputs', () => {
    for (const s of SCENARIOS) {
      for (const mode of MODES) {
        expect(finish(new HybridRun(s.id, mode)).events).toEqual(finish(new HybridRun(s.id, mode)).events);
      }
    }
  });

  it('matches a fresh run after reset', () => {
    const run = new HybridRun('sale', 'post');
    run.step();
    run.step();
    run.step();
    run.reset();
    expect(run.cursor).toBe(0);
    expect(run.events).toEqual([]);
    expect(finish(run).events).toEqual(finish(new HybridRun('sale', 'post')).events);
  });

  it('reveals one fused row per fuse step and stops at the end', () => {
    const run = new HybridRun('sale', 'pre');
    expect(run.stages.map((s) => s.kind)).toEqual([
      'filter',
      'keyword',
      'vector',
      'fuse',
      'fuse',
      'fuse',
      'fuse',
      'fuse',
      'fuse',
      'topk',
      'answer',
    ]);
    for (let i = 0; i < 4; i += 1) run.step();
    expect(run.fusedShown).toBe(1);
    finish(run);
    run.step();
    expect(run.events).toHaveLength(run.stages.length);
    expect(run.fusedShown).toBe(run.result.fused.length);
  });

  it('adds a post-filter stage only in post mode', () => {
    expect(new HybridRun('other', 'post').stages.some((s) => s.kind === 'postfilter')).toBe(true);
    expect(new HybridRun('other', 'none').stages.some((s) => s.kind === 'postfilter')).toBe(false);
    expect(new HybridRun('other', 'none').stages.some((s) => s.kind === 'filter')).toBe(false);
  });
});

describe('chunking', () => {
  it('splits the rule from its exception at 16 words with no overlap', () => {
    expect(policyWordCount()).toBe(45);
    const split = chunkPolicy(16, 0);
    expect(split.chunks).toHaveLength(3);
    expect(split.sent.hasRule).toBe(true);
    expect(split.sent.hasException).toBe(false);
    expect(split.correct).toBe(false);
  });

  it('keeps the rule and exception together at 16 words with 8 overlap', () => {
    const r = chunkPolicy(16, 8);
    expect(r.chunks).toHaveLength(5);
    expect(r.together).toBe(true);
    expect(r.correct).toBe(true);
  });

  it('matches the pinned table of sizes and overlaps', () => {
    const correct = (size: number, overlap: number) => chunkPolicy(size, overlap).correct;
    expect([
      correct(8, 0),
      correct(8, 4),
      correct(12, 0),
      correct(12, 4),
      correct(12, 8),
      correct(16, 0),
      correct(16, 4),
      correct(20, 0),
      correct(20, 4),
      correct(20, 8),
    ]).toEqual(Array(10).fill(false));
    expect([correct(16, 8), correct(16, 12), correct(20, 12), correct(24, 0)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(chunkPolicy(24, 0).chunks).toHaveLength(2);
  });

  it('keeps the exception with the rule at every slider setting from 24 words up', () => {
    for (let size = 24; size <= 32; size += 4) {
      for (let overlap = 0; overlap < size; overlap += 4) {
        expect(chunkPolicy(size, overlap).correct).toBe(true);
      }
    }
  });

  it('covers every word and rejects bad sizes', () => {
    const chunks = chunkWords(16, 8);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(policyWordCount());
    expect(() => chunkWords(0, 0)).toThrow(RangeError);
    expect(() => chunkWords(8, 8)).toThrow(RangeError);
    expect(() => chunkWords(8, -1)).toThrow(RangeError);
  });
});

describe('abstention threshold', () => {
  it('pins the eval counts the lesson quotes', () => {
    expect(EVAL_QUESTIONS).toHaveLength(12);
    expect(countOutcomes(evaluate(0.5))).toEqual({ correct: 8, wrong: 4, abstained: 0, rightToAbstain: 0 });
    expect(countOutcomes(evaluate(0.8))).toEqual({ correct: 7, wrong: 1, abstained: 4, rightToAbstain: 3 });
    expect(countOutcomes(evaluate(0.85))).toEqual({ correct: 6, wrong: 0, abstained: 6, rightToAbstain: 4 });
    expect(countOutcomes(evaluate(0.9))).toEqual({ correct: 6, wrong: 0, abstained: 6, rightToAbstain: 4 });
  });

  it('pins the two misses the lesson names at the default threshold', () => {
    const rows = Object.fromEntries(evaluate(0.8).map((r) => [r.question.id, r]));
    expect([rows.E8?.outcome, rows.E8?.top, rows.E8?.support.toFixed(2)]).toEqual([
      'wrong',
      'harbor-giftcard',
      '0.85',
    ]);
    expect([rows.E11?.outcome, rows.E11?.question.expected]).toEqual(['abstained', 'pine-gift']);
  });

  it('trades the back-order answer for the last wrong answer at 0.85', () => {
    const rows = Object.fromEntries(evaluate(0.85).map((r) => [r.question.id, r]));
    expect([rows.E5?.outcome, rows.E5?.question.expected]).toEqual(['abstained', 'harbor-backorder']);
    expect(rows.E8?.outcome).toBe('abstained');
  });

  it('never adds wrong answers as the threshold rises', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let t = 0.5; t <= 0.951; t += 0.05) {
      const { wrong } = countOutcomes(evaluate(t));
      expect(wrong).toBeLessThanOrEqual(previous);
      previous = wrong;
    }
  });
});

describe('cacheKey', () => {
  const base = {
    tenant: 'harbor',
    scope: 'customer',
    model: 'Medium',
    promptVersion: 'v3',
    sampling: 't0',
    corpusVersion: 'idx7',
    conversation: [],
    query: 'Can I return a sale item?',
  } as const;

  it('separates stores and permission scopes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, tenant: 'pine' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, scope: 'staff' }));
  });

  it('starts with the store and scope and ignores case and spacing in the query', () => {
    expect(cacheKey(base).startsWith('harbor|customer|Medium|v3|t0|idx7|h:new|q:')).toBe(true);
    expect(cacheKey({ ...base, query: '  can I return a   SALE item? ' })).toBe(cacheKey(base));
  });

  it('misses after a reindex and on a follow-up turn', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, corpusVersion: 'idx8' }));
    const followUp = { ...base, conversation: ['Is my order 1042 a sale item?'] };
    expect(cacheKey(base)).not.toBe(cacheKey(followUp));
    expect(cacheKey(followUp)).not.toBe(
      cacheKey({ ...base, conversation: ['Is my order 1077 a sale item?'] }),
    );
  });

  it('separates models, prompt versions, and sampling settings', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'Large' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, promptVersion: 'v4' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, sampling: 't0.7' }));
  });
});
