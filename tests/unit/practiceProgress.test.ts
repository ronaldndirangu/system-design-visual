import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPractice,
  emptyPractice,
  isPracticePersistent,
  MAX_SAVED_ROUNDS,
  PRACTICE_STORAGE_KEY,
  PRACTICE_VERSION,
  parsePractice,
  readPractice,
  type SavedRound,
  saveRound,
  subscribePractice,
} from '../../src/lib/practiceProgress';

function round(overrides: Partial<SavedRound> = {}): SavedRound {
  return {
    promptId: 'url-shortener',
    pace: 'drill',
    finishedAt: '2025-03-01T10:00:00.000Z',
    usedSeconds: [120, 100, 90, 130, 300, 280, 60],
    budgetSeconds: 1200,
    rubricTotal: 9,
    rubricMax: 14,
    ...overrides,
  };
}

describe('parsePractice', () => {
  it('returns empty data for missing, broken, or old data', () => {
    expect(parsePractice(null)).toEqual(emptyPractice());
    expect(parsePractice('not json')).toEqual(emptyPractice());
    expect(parsePractice('{"version":1}')).toEqual(emptyPractice());
    expect(parsePractice(JSON.stringify({ version: 99, rounds: [round()] }))).toEqual(emptyPractice());
  });

  it('keeps valid rounds and drops malformed ones', () => {
    const raw = JSON.stringify({
      version: PRACTICE_VERSION,
      rounds: [
        round(),
        round({ rubricTotal: null }),
        { ...round(), pace: 'marathon' },
        { ...round(), usedSeconds: [1, 2, 3] },
        { ...round(), rubricTotal: 20 },
        { ...round(), budgetSeconds: -1 },
        'junk',
      ],
    });
    expect(parsePractice(raw).rounds).toEqual([round(), round({ rubricTotal: null })]);
  });
});

describe('practice store', () => {
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
          if (failWrites) throw new Error('QuotaExceededError');
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
    vi.unstubAllGlobals();
  });

  it('saves newest first, keeps ten, and clears', () => {
    for (let i = 0; i < MAX_SAVED_ROUNDS + 2; i += 1) {
      saveRound(round({ rubricTotal: i, finishedAt: `2025-03-01T10:${String(i).padStart(2, '0')}:00.000Z` }));
    }
    const { rounds } = readPractice();
    expect(rounds).toHaveLength(MAX_SAVED_ROUNDS);
    expect(rounds[0]?.rubricTotal).toBe(MAX_SAVED_ROUNDS + 1);
    expect(JSON.parse(store.get(PRACTICE_STORAGE_KEY) ?? '{}').version).toBe(PRACTICE_VERSION);

    clearPractice();
    expect(store.has(PRACTICE_STORAGE_KEY)).toBe(false);
    expect(readPractice()).toEqual(emptyPractice());
  });

  it('updates a saved round in place when it is saved again', () => {
    const older = round({ finishedAt: '2025-03-01T09:00:00.000Z', rubricTotal: 4 });
    saveRound(older);
    saveRound(round({ rubricTotal: null }));
    saveRound(round({ rubricTotal: 11 }));
    expect(readPractice().rounds).toEqual([round({ rubricTotal: 11 }), older]);
  });

  it('returns the same object until storage changes', () => {
    saveRound(round());
    const first = readPractice();
    expect(readPractice()).toBe(first);
    saveRound(round({ finishedAt: '2025-03-02T10:00:00.000Z' }));
    expect(readPractice()).not.toBe(first);
  });

  it('notifies subscribers on save and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePractice(listener);
    saveRound(round());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearPractice();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports tab-only saves when storage refuses writes', () => {
    saveRound(round());
    expect(isPracticePersistent()).toBe(true);

    failWrites = true;
    saveRound(round({ finishedAt: '2025-03-02T10:00:00.000Z' }));
    expect(isPracticePersistent()).toBe(false);
    expect(readPractice().rounds).toHaveLength(2);

    failWrites = false;
    clearPractice();
    expect(isPracticePersistent()).toBe(true);
  });
});
