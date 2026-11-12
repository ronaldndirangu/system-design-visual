import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completedCount,
  continueTarget,
  emptyProgress,
  exportProgress,
  type FingerprintQuestion,
  importProgress,
  isComplete,
  isProgressPersistent,
  PROGRESS_STORAGE_KEY,
  PROGRESS_VERSION,
  type ProgressData,
  parseImport,
  parseProgress,
  questionSetFingerprint,
  readProgress,
  recordQuiz,
  recordVisit,
  resetProgress,
  setComplete,
} from '../../src/lib/progress';

describe('parseProgress', () => {
  it('returns empty progress for missing or broken data', () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress('not json')).toEqual(emptyProgress());
    expect(parseProgress('[]')).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ version: 99, lessons: {} }))).toEqual(emptyProgress());
  });

  it('migrates version 1 completion dates into current lessons', () => {
    const raw =
      '{"version":1,"completed":{"scaling/caching":"2025-01-01T00:00:00.000Z","bad":42,"__proto__":"2025-01-01T00:00:00.000Z"}}';
    expect(parseProgress(raw)).toEqual({
      version: PROGRESS_VERSION,
      lessons: { 'scaling/caching': { completedAt: '2025-01-01T00:00:00.000Z' } },
    });
  });

  it('keeps valid fields and drops malformed ones', () => {
    const raw = JSON.stringify({
      version: PROGRESS_VERSION,
      last: 'scaling/sharding',
      lessons: {
        'scaling/caching': {
          completedAt: '2025-01-01T00:00:00.000Z',
          quizBest: { score: 4, total: 5, set: 'abc' },
          missed: ['caching-ttl', 7],
        },
        'scaling/sharding': { quizBest: { score: 6, total: 5 }, completedAt: 3 },
        nothing: {},
      },
    });
    expect(parseProgress(raw)).toEqual({
      version: PROGRESS_VERSION,
      last: 'scaling/sharding',
      lessons: {
        'scaling/caching': {
          completedAt: '2025-01-01T00:00:00.000Z',
          quizBest: { score: 4, total: 5, set: 'abc' },
          missed: ['caching-ttl'],
        },
      },
    });
  });

  it('loads version 2 quiz scores as legacy results without a set', () => {
    const raw = JSON.stringify({ version: 2, lessons: { a: { quizBest: { score: 3, total: 5 } } } });
    expect(parseProgress(raw).lessons.a?.quizBest).toEqual({ score: 3, total: 5 });
  });
});

describe('questionSetFingerprint', () => {
  const question: FingerprintQuestion = {
    id: 'q1',
    prompt: 'Which cache?',
    options: [{ text: 'LRU', correct: true }, { text: 'FIFO' }],
  };
  const quiz = [question];

  it('is stable for the same questions and changes with the prompt or the answer', () => {
    const base = questionSetFingerprint(quiz);
    expect(questionSetFingerprint(structuredClone(quiz))).toBe(base);
    expect(questionSetFingerprint([{ ...question, prompt: 'Which eviction?' }])).not.toBe(base);
    expect(
      questionSetFingerprint([{ ...question, options: [{ text: 'LRU' }, { text: 'FIFO', correct: true }] }]),
    ).not.toBe(base);
  });
});

describe('continueTarget', () => {
  const lessons = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const data = (patch: Partial<ProgressData>): ProgressData => ({ ...emptyProgress(), ...patch });

  it('offers nothing before any progress exists', () => {
    expect(continueTarget(emptyProgress(), lessons)).toBeNull();
  });

  it('resumes the last lesson when it is unfinished', () => {
    expect(continueTarget(data({ last: 'b' }), lessons)).toEqual({ id: 'b' });
  });

  it('moves past finished lessons and wraps to the start', () => {
    const done = { completedAt: '2025-01-01T00:00:00.000Z' };
    expect(continueTarget(data({ last: 'b', lessons: { b: done } }), lessons)).toEqual({ id: 'c' });
    expect(continueTarget(data({ last: 'c', lessons: { b: done, c: done } }), lessons)).toEqual({ id: 'a' });
    expect(continueTarget(data({ lessons: { a: done, b: done, c: done } }), lessons)).toBeNull();
    expect(completedCount(data({ lessons: { a: done, b: { missed: [] } } }), ['a', 'b', 'c'])).toBe(1);
  });
});

describe('progress store', () => {
  let store: Map<string, string>;
  let failWrites: boolean;

  beforeEach(() => {
    store = new Map();
    failWrites = false;
    const target = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          store.set(key, value);
        },
        removeItem: (key: string) => store.delete(key),
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
  });

  afterEach(() => {
    resetProgress();
    vi.unstubAllGlobals();
  });

  it('marks, unmarks, and resets lessons', () => {
    setComplete('scaling/caching', true, new Date('2025-02-03T00:00:00Z'));
    expect(isComplete(readProgress(), 'scaling/caching')).toBe(true);
    expect(JSON.parse(store.get(PROGRESS_STORAGE_KEY) ?? '{}').version).toBe(PROGRESS_VERSION);

    setComplete('scaling/caching', false);
    expect(isComplete(readProgress(), 'scaling/caching')).toBe(false);
    expect(readProgress().lessons).toEqual({});

    setComplete('scaling/sharding', true);
    resetProgress();
    expect(store.has(PROGRESS_STORAGE_KEY)).toBe(false);
    expect(readProgress()).toEqual(emptyProgress());
  });

  it('returns the same object until storage changes', () => {
    setComplete('a', true);
    expect(readProgress()).toBe(readProgress());
  });

  it('upgrades stored version 1 data on the next write', () => {
    store.set(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({ version: 1, completed: { a: '2025-01-01T00:00:00.000Z' } }),
    );
    recordVisit('b');
    expect(JSON.parse(store.get(PROGRESS_STORAGE_KEY) ?? '{}')).toEqual({
      version: PROGRESS_VERSION,
      last: 'b',
      lessons: { a: { completedAt: '2025-01-01T00:00:00.000Z' } },
    });
  });

  it('keeps the best quiz score per question set and the latest missed ids', () => {
    setComplete('a', true, new Date('2025-02-03T00:00:00Z'));
    recordQuiz('a', 3, 5, ['q1', 'q2'], 's1');
    recordQuiz('a', 2, 5, ['q1', 'q2', 'q4'], 's1');
    expect(readProgress().lessons.a).toEqual({
      completedAt: '2025-02-03T00:00:00.000Z',
      quizBest: { score: 3, total: 5, set: 's1' },
      missed: ['q1', 'q2', 'q4'],
    });
    recordQuiz('a', 5, 6, [], 's2');
    expect(readProgress().lessons.a?.quizBest).toEqual({ score: 5, total: 6, set: 's2' });
    recordQuiz('a', 7, 6, [], 's2');
    expect(readProgress().lessons.a?.quizBest).toEqual({ score: 5, total: 6, set: 's2' });
  });

  it('starts a fresh best when questions change at the same count and keeps completion', () => {
    setComplete('a', true, new Date('2025-02-03T00:00:00Z'));
    recordQuiz('a', 5, 5, [], 'old');
    recordQuiz('a', 2, 5, ['q1', 'q2', 'q3'], 'new');
    expect(readProgress().lessons.a).toEqual({
      completedAt: '2025-02-03T00:00:00.000Z',
      quizBest: { score: 2, total: 5, set: 'new' },
      missed: ['q1', 'q2', 'q3'],
    });
  });

  it('replaces a legacy score with the first fingerprinted attempt', () => {
    store.set(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({ version: 2, lessons: { a: { quizBest: { score: 5, total: 5 } } } }),
    );
    recordQuiz('a', 3, 5, ['q1', 'q2'], 's1');
    expect(readProgress().lessons.a?.quizBest).toEqual({ score: 3, total: 5, set: 's1' });
  });

  it('round-trips an export through import', () => {
    setComplete('a', true, new Date('2025-02-03T00:00:00Z'));
    recordQuiz('b', 4, 5, ['b-q3'], 'set-b');
    recordVisit('b');
    const exported = exportProgress();
    const before = readProgress();

    resetProgress();
    expect(importProgress(exported, 'replace')).toEqual({ ok: true, lessons: 2 });
    expect(readProgress()).toEqual(before);
  });

  describe('importing an older partial export into populated storage', () => {
    const older = JSON.stringify({
      version: 2,
      last: 'c',
      lessons: {
        a: { completedAt: '2025-01-01T00:00:00.000Z', quizBest: { score: 5, total: 5 } },
        c: { completedAt: '2025-01-05T00:00:00.000Z' },
      },
    });

    beforeEach(() => {
      setComplete('a', true, new Date('2025-03-01T00:00:00Z'));
      recordQuiz('a', 3, 5, ['q1', 'q2'], 's1');
      setComplete('b', true, new Date('2025-03-02T00:00:00Z'));
      recordVisit('b');
    });

    it('previews both sides before anything is written', () => {
      const parsed = parseImport(older);
      expect(parsed.ok).toBe(true);
      expect(readProgress().lessons.c).toBeUndefined();
    });

    it('merges by keeping every completion and the better score', () => {
      expect(importProgress(older, 'merge')).toEqual({ ok: true, lessons: 3 });
      expect(readProgress()).toEqual({
        version: PROGRESS_VERSION,
        last: 'b',
        lessons: {
          a: {
            completedAt: '2025-01-01T00:00:00.000Z',
            quizBest: { score: 3, total: 5, set: 's1' },
            missed: ['q1', 'q2'],
          },
          b: { completedAt: '2025-03-02T00:00:00.000Z' },
          c: { completedAt: '2025-01-05T00:00:00.000Z' },
        },
      });
    });

    it('replaces everything only when asked', () => {
      expect(importProgress(older, 'replace')).toEqual({ ok: true, lessons: 2 });
      expect(readProgress()).toEqual({
        version: PROGRESS_VERSION,
        last: 'c',
        lessons: {
          a: { completedAt: '2025-01-01T00:00:00.000Z', quizBest: { score: 5, total: 5 } },
          c: { completedAt: '2025-01-05T00:00:00.000Z' },
        },
      });
    });
  });

  it('rejects files that are not progress exports and keeps current progress', () => {
    setComplete('a', true);
    expect(importProgress('{oops', 'replace')).toEqual({ ok: false, error: 'That file is not valid JSON.' });
    expect(importProgress(JSON.stringify({ version: 2, rounds: [] }), 'replace').ok).toBe(false);
    expect(isComplete(readProgress(), 'a')).toBe(true);
  });

  it('reports memory-only saves when storage refuses writes', () => {
    setComplete('a', true);
    expect(isProgressPersistent()).toBe(true);

    failWrites = true;
    setComplete('b', true);
    expect(isProgressPersistent()).toBe(false);
    expect(isComplete(readProgress(), 'b')).toBe(true);

    failWrites = false;
    setComplete('c', true);
    expect(isProgressPersistent()).toBe(true);
  });
});
