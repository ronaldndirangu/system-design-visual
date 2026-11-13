import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyPractice,
  PRACTICE_STORAGE_KEY,
  PRACTICE_VERSION,
  type PracticeData,
  readPractice,
  type SavedRound,
  saveRound,
} from '../../src/lib/practiceProgress';
import {
  emptyProgress,
  PROGRESS_STORAGE_KEY,
  PROGRESS_VERSION,
  readProgress,
  recordQuiz,
  recordVisit,
  setComplete,
} from '../../src/lib/progress';
import {
  emptyReview,
  REVIEW_STORAGE_KEY,
  REVIEW_VERSION,
  readReview,
  replaceReview,
} from '../../src/lib/review';
import {
  applyStudyImport,
  exportStudyData,
  mergePractice,
  mergeReview,
  parseStudyImport,
  resetStudyData,
  STUDY_KIND,
  STUDY_VERSION,
} from '../../src/lib/studyData';

function round(finishedAt: string, overrides: Partial<SavedRound> = {}): SavedRound {
  return {
    promptId: 'url-shortener',
    pace: 'drill',
    finishedAt,
    usedSeconds: [120, 100, 90, 130, 300, 280, 60],
    budgetSeconds: 1200,
    rubricTotal: 9,
    rubricMax: 14,
    ...overrides,
  };
}

function day(n: number): string {
  return new Date(Date.UTC(2025, 2, n)).toISOString();
}

function seedBrowser() {
  setComplete('scaling/caching', true, new Date('2025-02-03T00:00:00Z'));
  recordQuiz('scaling/caching', 4, 5, ['q2'], 'set-a');
  recordVisit('scaling/load-balancing');
  replaceReview({
    version: REVIEW_VERSION,
    cards: { 'scaling/caching#q2': { box: 2, due: day(5) } },
    checkpoints: { scaling: { score: 6, total: 10, at: day(2) } },
  });
  saveRound(round(day(1)));
}

describe('study data in storage', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const target = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
  });

  afterEach(() => {
    resetStudyData();
    vi.unstubAllGlobals();
  });

  it('round trips lessons, schedules, checkpoint scores, and practice rounds into a fresh browser', () => {
    seedBrowser();
    const before = { progress: readProgress(), review: readReview(), practice: readPractice() };
    const file = exportStudyData();
    const snapshot = JSON.parse(file);
    expect(snapshot).toMatchObject({ kind: STUDY_KIND, version: STUDY_VERSION });

    store.clear();
    expect(readProgress()).toEqual(emptyProgress());
    const parsed = parseStudyImport(file);
    if (!parsed.ok) throw new Error(parsed.error);
    applyStudyImport(parsed.data, 'merge');

    expect(readProgress()).toEqual(before.progress);
    expect(readReview()).toEqual(before.review);
    expect(readPractice()).toEqual(before.practice);
  });

  it('imports a legacy lesson-only file into progress and leaves the other stores alone', () => {
    seedBrowser();
    const review = readReview();
    const practice = readPractice();
    const legacy = JSON.stringify({
      version: PROGRESS_VERSION,
      lessons: { 'scaling/sharding': { completedAt: '2025-01-01T00:00:00Z' } },
    });
    const parsed = parseStudyImport(legacy);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(Object.keys(parsed.data)).toEqual(['progress']);

    applyStudyImport(parsed.data, 'replace');
    expect(Object.keys(readProgress().lessons)).toEqual(['scaling/sharding']);
    expect(readReview()).toEqual(review);
    expect(readPractice()).toEqual(practice);
  });

  it('still reads version 1 progress exports', () => {
    const parsed = parseStudyImport(JSON.stringify({ version: 1, completed: { 'scaling/caching': day(1) } }));
    expect(parsed.ok && parsed.data.progress?.lessons['scaling/caching']?.completedAt).toBe(day(1));
  });

  it('rejects the whole file when any section is invalid, changing nothing', () => {
    seedBrowser();
    const before = new Map(store);
    const valid = JSON.parse(exportStudyData());
    const broken = [
      'not json',
      JSON.stringify({ hello: 'world' }),
      JSON.stringify({ ...valid, version: 99 }),
      JSON.stringify({ ...valid, kind: 'other' }),
      JSON.stringify({ kind: STUDY_KIND, version: STUDY_VERSION }),
      JSON.stringify({ ...valid, review: { ...valid.review, cards: { a: { box: 9, due: day(1) } } } }),
      JSON.stringify({ ...valid, practice: { version: PRACTICE_VERSION, rounds: [{ finishedAt: day(1) }] } }),
      JSON.stringify({ ...valid, progress: { version: 99, lessons: {} } }),
    ];
    for (const text of broken) {
      const parsed = parseStudyImport(text);
      expect(parsed.ok, text).toBe(false);
    }
    expect(store).toEqual(before);
  });

  it('replaces only the sections the file supplies', () => {
    seedBrowser();
    const progress = readProgress();
    const file = JSON.stringify({
      kind: STUDY_KIND,
      version: STUDY_VERSION,
      practice: { version: PRACTICE_VERSION, rounds: [round(day(9))] },
    });
    const parsed = parseStudyImport(file);
    if (!parsed.ok) throw new Error(parsed.error);
    applyStudyImport(parsed.data, 'replace');

    expect(readPractice().rounds.map((entry) => entry.finishedAt)).toEqual([day(9)]);
    expect(readProgress()).toEqual(progress);
    expect(readReview().checkpoints.scaling?.score).toBe(6);
  });

  it('clears all three stores on reset', () => {
    seedBrowser();
    expect(store.has(PROGRESS_STORAGE_KEY)).toBe(true);
    expect(store.has(REVIEW_STORAGE_KEY)).toBe(true);
    expect(store.has(PRACTICE_STORAGE_KEY)).toBe(true);

    resetStudyData();
    expect(store.size).toBe(0);
    expect(readProgress()).toEqual(emptyProgress());
    expect(readReview()).toEqual(emptyReview());
    expect(readPractice()).toEqual(emptyPractice());
  });
});

describe('merging study data', () => {
  it('keeps current schedules for duplicate cards and adds new ones', () => {
    const current = { ...emptyReview(), cards: { a: { box: 3, due: day(10) } } };
    const incoming = {
      ...emptyReview(),
      cards: { a: { box: 1, due: day(1) }, b: { box: 2, due: day(4) } },
    };
    expect(mergeReview(current, incoming).cards).toEqual({
      a: { box: 3, due: day(10) },
      b: { box: 2, due: day(4) },
    });
  });

  it('keeps the better comparable checkpoint score and the current one when totals differ', () => {
    const current = {
      ...emptyReview(),
      checkpoints: {
        scaling: { score: 6, total: 10, at: day(1) },
        storage: { score: 8, total: 10, at: day(1) },
        async: { score: 3, total: 8, at: day(1) },
      },
    };
    const incoming = {
      ...emptyReview(),
      checkpoints: {
        scaling: { score: 9, total: 10, at: day(2) },
        storage: { score: 5, total: 10, at: day(2) },
        async: { score: 10, total: 10, at: day(2) },
        thinking: { score: 4, total: 5, at: day(2) },
      },
    };
    expect(mergeReview(current, incoming).checkpoints).toEqual({
      scaling: { score: 9, total: 10, at: day(2) },
      storage: { score: 8, total: 10, at: day(1) },
      async: { score: 3, total: 8, at: day(1) },
      thinking: { score: 4, total: 5, at: day(2) },
    });
  });

  it('unions practice rounds by finish time, keeps current duplicates, and keeps the newest ten', () => {
    const current: PracticeData = {
      version: PRACTICE_VERSION,
      rounds: [round(day(8), { rubricTotal: 12 }), round(day(4)), round(day(2))],
    };
    const incoming: PracticeData = {
      version: PRACTICE_VERSION,
      rounds: Array.from({ length: 10 }, (_, index) => round(day(index + 1), { rubricTotal: 1 })),
    };
    const merged = mergePractice(current, incoming).rounds;
    expect(merged).toHaveLength(10);
    expect(merged.map((entry) => entry.finishedAt)).toEqual(
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => day(n)),
    );
    expect(merged.find((entry) => entry.finishedAt === day(8))?.rubricTotal).toBe(12);
    expect(merged.find((entry) => entry.finishedAt === day(4))?.rubricTotal).toBe(9);
    expect(merged.find((entry) => entry.finishedAt === day(10))?.rubricTotal).toBe(1);
  });
});
