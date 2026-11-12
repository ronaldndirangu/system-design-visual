import { describe, expect, it } from 'vitest';
import { emptyProgress, type ProgressData } from '../../src/lib/progress';
import {
  checkpointPassed,
  checkpointResult,
  dueCards,
  emptyReview,
  INTERVAL_DAYS,
  MAX_BOX,
  nextDue,
  parseReview,
  REVIEW_VERSION,
  type ReviewData,
  scheduleCard,
  seedCards,
  withAnswer,
  withCheckpoint,
} from '../../src/lib/review';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

describe('scheduleCard', () => {
  it('moves a card up one box per right answer and spaces reviews by the box interval', () => {
    let card = scheduleCard(undefined, true, NOW);
    expect(card).toEqual({ box: 1, due: inDays(INTERVAL_DAYS[0]) });
    for (let box = 2; box <= MAX_BOX; box++) {
      card = scheduleCard(card, true, NOW);
      expect(card).toEqual({ box, due: inDays(INTERVAL_DAYS[box - 1] ?? 0) });
    }
  });

  it('caps the box at the last interval', () => {
    const card = scheduleCard({ box: MAX_BOX, due: NOW.toISOString() }, true, NOW);
    expect(card).toEqual({ box: MAX_BOX, due: inDays(21) });
  });

  it('sends a missed card back to box 1, due tomorrow', () => {
    const card = scheduleCard({ box: 3, due: NOW.toISOString() }, false, NOW);
    expect(card).toEqual({ box: 1, due: inDays(1) });
  });
});

describe('dueCards and nextDue', () => {
  const data: ReviewData = {
    ...emptyReview(),
    cards: {
      'b/q1': { box: 1, due: inDays(-1) },
      'a/q1': { box: 2, due: inDays(-1) },
      'c/q1': { box: 1, due: inDays(-3) },
      'd/q1': { box: 3, due: inDays(2) },
      'e/q1': { box: 4, due: inDays(5) },
    },
  };

  it('lists due cards oldest first with ties sorted by id', () => {
    expect(dueCards(data, NOW)).toEqual(['c/q1', 'a/q1', 'b/q1']);
  });

  it('finds the soonest card that is not due yet', () => {
    expect(nextDue(data, NOW)).toBe(inDays(2));
    expect(nextDue(emptyReview(), NOW)).toBeNull();
  });
});

describe('seedCards', () => {
  const bank = {
    'scaling/caching': { questions: [{ id: 'scaling/caching/q1' }, { id: 'scaling/caching/q2' }] },
    'scaling/cdn': { questions: [{ id: 'scaling/cdn/q1' }] },
  };
  const progress: ProgressData = {
    ...emptyProgress(),
    lessons: {
      'scaling/caching': {
        completedAt: inDays(-10),
        quizBest: { score: 1, total: 2 },
        missed: ['scaling/caching/q2'],
      },
      'scaling/cdn': { completedAt: inDays(-1) },
    },
  };

  it('adds missed questions due now and the rest due a day after completion', () => {
    const seeded = seedCards(emptyReview(), progress, bank, NOW);
    expect(seeded.cards).toEqual({
      'scaling/caching/q1': { box: 1, due: inDays(-9) },
      'scaling/caching/q2': { box: 1, due: NOW.toISOString() },
    });
  });

  it('keeps existing cards and returns the same object when nothing is new', () => {
    const existing = withAnswer(emptyReview(), 'scaling/caching/q2', true, NOW);
    const seeded = seedCards(existing, progress, bank, NOW);
    expect(seeded.cards['scaling/caching/q2']).toEqual(existing.cards['scaling/caching/q2']);
    expect(seedCards(seeded, progress, bank, NOW)).toBe(seeded);
  });
});

describe('checkpoints', () => {
  it('keeps the best score and sends missed questions to box 1', () => {
    let data = withCheckpoint(emptyReview(), 'scaling', 8, 10, ['checkpoint/scaling/q4'], NOW);
    data = withCheckpoint(data, 'scaling', 5, 10, [], NOW);
    expect(checkpointResult(data, 'scaling')).toEqual({ score: 8, total: 10, at: NOW.toISOString() });
    expect(data.cards['checkpoint/scaling/q4']).toEqual({ box: 1, due: NOW.toISOString() });
  });

  it('passes at 70 percent', () => {
    expect(checkpointPassed({ score: 7, total: 10, at: NOW.toISOString() })).toBe(true);
    expect(checkpointPassed({ score: 6, total: 10, at: NOW.toISOString() })).toBe(false);
    expect(checkpointPassed(undefined)).toBe(false);
  });

  it('ignores impossible scores and unsafe ids', () => {
    const data = emptyReview();
    expect(withCheckpoint(data, 'scaling', 11, 10, [], NOW)).toBe(data);
    expect(withCheckpoint(data, '__proto__', 5, 10, [], NOW)).toBe(data);
    expect(checkpointResult(data, 'constructor')).toBeUndefined();
  });
});

describe('parseReview', () => {
  it('returns empty data for missing, broken, or foreign input', () => {
    for (const raw of [null, '', 'not json', '[]', '{"version":2,"cards":{}}']) {
      expect(parseReview(raw)).toEqual(emptyReview());
    }
  });

  it('drops invalid cards, invalid checkpoints, and unsafe ids', () => {
    const raw = JSON.stringify({
      version: REVIEW_VERSION,
      cards: {
        'a/q1': { box: 2, due: NOW.toISOString() },
        'a/q2': { box: 9, due: NOW.toISOString() },
        'a/q3': { box: 1, due: 'someday' },
        constructor: { box: 1, due: NOW.toISOString() },
      },
      checkpoints: {
        scaling: { score: 7, total: 10, at: NOW.toISOString() },
        async: { score: 3, total: 0, at: NOW.toISOString() },
      },
    });
    const data = parseReview(raw);
    expect(Object.keys(data.cards)).toEqual(['a/q1']);
    expect(Object.keys(data.checkpoints)).toEqual(['scaling']);
  });
});
