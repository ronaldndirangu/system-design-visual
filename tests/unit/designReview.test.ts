import { describe, expect, it } from 'vitest';
import { allLessons } from '../../src/data/curriculum';
import { checklistSteps } from '../../src/data/practicePrompts';
import {
  canReview,
  EVENTS,
  eventForItem,
  eventsSoFar,
  FIXES,
  FLAW_COUNT,
  fixResult,
  flagCount,
  ITEM_COUNT,
  initialReview,
  nextEvent,
  pause,
  pickFix,
  play,
  REPLAY_MINUTES,
  REVIEW_ITEMS,
  type ReviewState,
  reveal,
  reviewScore,
  stepToNextEvent,
  tick,
  toggleFlag,
  verdict,
} from '../../src/lib/models/designReview';

type Action = (state: ReviewState) => ReviewState;

function run(actions: Action[]): ReviewState {
  return actions.reduce((state, action) => action(state), initialReview());
}

const flag =
  (index: number): Action =>
  (state) =>
    toggleFlag(state, index);
const choose =
  (index: number, fix: Parameters<typeof pickFix>[2]): Action =>
  (state) =>
    pickFix(state, index, fix);
const ticks = (count: number): Action[] => Array.from({ length: count }, () => tick);

const flawIndexes = REVIEW_ITEMS.flatMap((item, index) => (item.isFlaw ? [index] : []));
const soundIndexes = REVIEW_ITEMS.flatMap((item, index) => (item.isFlaw ? [] : [index]));

describe('design review content', () => {
  it('seeds six flaws among ten items', () => {
    expect(ITEM_COUNT).toBe(10);
    expect(FLAW_COUNT).toBe(6);
    expect(new Set(REVIEW_ITEMS.map((item) => item.id)).size).toBe(ITEM_COUNT);
  });

  it('gives every flaw a distinct real fix and every sound item none', () => {
    const fixIds = new Set(FIXES.map((fix) => fix.id));
    const used = flawIndexes.map((index) => REVIEW_ITEMS[index]?.fixId);
    expect(new Set(used).size).toBe(FLAW_COUNT);
    for (const index of flawIndexes) {
      const item = REVIEW_ITEMS[index];
      expect(item?.fixId && fixIds.has(item.fixId)).toBe(true);
      expect(item?.fixDetail).toBeTruthy();
      expect(item?.lesson).not.toBeNull();
    }
    for (const index of soundIndexes) expect(REVIEW_ITEMS[index]?.fixId).toBeNull();
    const distractors = FIXES.filter((fix) => !used.includes(fix.id));
    expect(distractors.length).toBeGreaterThan(0);
    for (const fix of distractors) expect(fix.whyNot).toBeTruthy();
  });

  it('points every lens at a checklist step and every lesson at the curriculum', () => {
    const steps = new Set(checklistSteps.map((step) => step.title));
    const lessons = new Map(allLessons.map((lesson) => [lesson.id, lesson.title]));
    for (const item of REVIEW_ITEMS) {
      expect(steps.has(item.lens)).toBe(true);
      if (item.lesson) expect(lessons.get(item.lesson.id)).toBe(item.lesson.title);
    }
  });

  it('scripts one event per item, in minute order, inside the hour', () => {
    expect(EVENTS).toHaveLength(ITEM_COUNT);
    expect(new Set(EVENTS.map((event) => event.item)).size).toBe(ITEM_COUNT);
    const minutes = EVENTS.map((event) => event.minute);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(new Set(minutes).size).toBe(minutes.length);
    for (const event of EVENTS) {
      expect(event.minute).toBeGreaterThan(0);
      expect(event.minute).toBeLessThan(REPLAY_MINUTES);
      expect(event.kind).toBe(REVIEW_ITEMS[event.item]?.isFlaw ? 'incident' : 'held');
    }
  });

  it('teaches a durable outbox with at least once delivery and idempotent consumers', () => {
    const byFix = (fixId: string) => REVIEW_ITEMS.find((item) => item.fixId === fixId);
    const outbox = byFix('outbox')?.fixDetail ?? '';
    expect(outbox).toMatch(/same transaction/);
    expect(outbox).toMatch(/at least once/);
    expect(outbox).toMatch(/idempotent/);
    const queue = byFix('bound')?.fixDetail ?? '';
    expect(queue).toMatch(/durable/);
    expect(queue).toMatch(/keep every order event/);
    expect(JSON.stringify({ REVIEW_ITEMS, FIXES, EVENTS })).not.toMatch(/never lose/i);
  });

  it('writes every string without dashes used as punctuation', () => {
    const text = JSON.stringify({ REVIEW_ITEMS, FIXES, EVENTS });
    expect(text).not.toMatch(/[\u2013\u2014]| - |--/);
  });
});

describe('flagging', () => {
  it('toggles flags and clears the pick when an item is unflagged', () => {
    const flagged = run([flag(0), choose(0, 'standby')]);
    expect(flagged.flags[0]).toBe(true);
    expect(flagged.picks[0]).toBe('standby');
    const cleared = toggleFlag(flagged, 0);
    expect(cleared.flags[0]).toBe(false);
    expect(cleared.picks[0]).toBeNull();
  });

  it('ignores picks on unflagged items and out of range flags', () => {
    const state = initialReview();
    expect(pickFix(state, 0, 'standby')).toBe(state);
    expect(toggleFlag(state, -1)).toBe(state);
    expect(toggleFlag(state, ITEM_COUNT)).toBe(state);
  });

  it('needs at least one flag before the replay or the reveal', () => {
    const empty = initialReview();
    expect(canReview(empty)).toBe(false);
    expect(play(empty)).toBe(empty);
    expect(reveal(empty)).toBe(empty);
    expect(stepToNextEvent(empty)).toBe(empty);
    expect(canReview(run([flag(3)]))).toBe(true);
  });

  it('locks flags and picks once the replay starts', () => {
    const replaying = run([flag(0), play]);
    expect(toggleFlag(replaying, 1)).toBe(replaying);
    expect(pickFix(replaying, 0, 'standby')).toBe(replaying);
    const paused = pause(replaying);
    expect(toggleFlag(paused, 1)).toBe(paused);
  });
});

describe('replay', () => {
  it('runs one minute per tick and pauses and resumes', () => {
    const state = run([flag(0), play, ...ticks(5)]);
    expect(state.minute).toBe(5);
    const paused = pause(state);
    expect(paused.phase).toBe('paused');
    expect(tick(paused)).toBe(paused);
    expect(play(paused).phase).toBe('replaying');
  });

  it('lists the events reached so far', () => {
    const state = run([flag(0), play, ...ticks(12)]);
    expect(eventsSoFar(state).map((event) => event.minute)).toEqual([4, 8, 12]);
    expect(nextEvent(state)?.minute).toBe(18);
  });

  it('steps from event to event and pauses on each', () => {
    let state = run([flag(0)]);
    const seen: number[] = [];
    for (let i = 0; i < EVENTS.length; i += 1) {
      state = stepToNextEvent(state);
      expect(state.phase).toBe('paused');
      seen.push(state.minute);
    }
    expect(seen).toEqual(EVENTS.map((event) => event.minute));
    const done = stepToNextEvent(state);
    expect(done.phase).toBe('revealed');
    expect(done.minute).toBe(REPLAY_MINUTES);
  });

  it('reveals the answers when the hour ends', () => {
    const almost = run([flag(0), play, ...ticks(REPLAY_MINUTES - 1)]);
    expect(almost.phase).toBe('replaying');
    const done = tick(almost);
    expect(done.phase).toBe('revealed');
    expect(done.minute).toBe(REPLAY_MINUTES);
    expect(eventsSoFar(done)).toHaveLength(EVENTS.length);
    expect(tick(done)).toBe(done);
  });

  it('reveals early and shows every event', () => {
    const state = run([flag(0), play, ...ticks(3), reveal]);
    expect(state.phase).toBe('revealed');
    expect(eventsSoFar(state)).toHaveLength(EVENTS.length);
    expect(play(state)).toBe(state);
  });

  it('links each item to exactly one event', () => {
    for (let index = 0; index < ITEM_COUNT; index += 1) expect(eventForItem(index)?.item).toBe(index);
  });
});

describe('verdicts and score', () => {
  it('sorts items into found, missed, false alarm, and cleared', () => {
    const flaw = flawIndexes[0] ?? 0;
    const otherFlaw = flawIndexes[1] ?? 0;
    const sound = soundIndexes[0] ?? 0;
    const otherSound = soundIndexes[1] ?? 0;
    const state = run([flag(flaw), flag(sound), reveal]);
    expect(verdict(state, flaw)).toBe('found');
    expect(verdict(state, otherFlaw)).toBe('missed');
    expect(verdict(state, sound)).toBe('false-alarm');
    expect(verdict(state, otherSound)).toBe('cleared');
    expect(reviewScore(state)).toEqual({
      found: 1,
      missed: FLAW_COUNT - 1,
      falseAlarms: 1,
      cleared: ITEM_COUNT - FLAW_COUNT - 1,
      fixesMatched: 0,
    });
  });

  it('scores a perfect review', () => {
    const actions = flawIndexes.flatMap((index) => {
      const fix = REVIEW_ITEMS[index]?.fixId ?? null;
      return [flag(index), choose(index, fix)];
    });
    expect(reviewScore(run([...actions, reveal]))).toEqual({
      found: FLAW_COUNT,
      missed: 0,
      falseAlarms: 0,
      cleared: ITEM_COUNT - FLAW_COUNT,
      fixesMatched: FLAW_COUNT,
    });
  });

  it('explains each kind of wrong fix', () => {
    const lb = REVIEW_ITEMS.findIndex((item) => item.id === 'load-balancer');
    const cache = REVIEW_ITEMS.findIndex((item) => item.id === 'product-cache');
    const cdn = REVIEW_ITEMS.findIndex((item) => item.id === 'cdn');
    expect(fixResult(lb, 'standby')).toEqual({ kind: 'match' });
    expect(fixResult(lb, null)).toEqual({ kind: 'none' });
    expect(fixResult(cdn, 'ttl')).toEqual({ kind: 'not-needed' });
    const other = fixResult(lb, 'ttl');
    expect(other.kind).toBe('mismatch');
    if (other.kind === 'mismatch') expect(other.reason).toContain(`item ${cache + 1}, Product cache`);
    const distractor = fixResult(lb, 'more-servers');
    expect(distractor).toEqual({
      kind: 'mismatch',
      reason: FIXES.find((fix) => fix.id === 'more-servers')?.whyNot,
    });
  });

  it('counts only matched fixes on found flaws', () => {
    const lb = REVIEW_ITEMS.findIndex((item) => item.id === 'load-balancer');
    const state = run([flag(lb), choose(lb, 'bigger-machine'), reveal]);
    expect(reviewScore(state).fixesMatched).toBe(0);
    expect(flagCount(state)).toBe(1);
  });
});

describe('determinism', () => {
  const script: Action[] = [flag(0), choose(0, 'standby'), flag(4), choose(4, 'ttl'), flag(7), play];

  it('replays the same script to the same state', () => {
    const a = run([...script, ...ticks(30), stepToNextEvent]);
    const b = run([...script, ...ticks(30), stepToNextEvent]);
    expect(a).toEqual(b);
    expect(reviewScore(reveal(a))).toEqual(reviewScore(reveal(b)));
  });

  it('starts from the same state after a reset', () => {
    run([...script, ...ticks(20)]);
    const fresh = initialReview();
    expect(fresh).toEqual(initialReview());
    expect(run([...script, ...ticks(20)])).toEqual(run([...script, ...ticks(20)]));
    expect(fresh.phase).toBe('flagging');
    expect(flagCount(fresh)).toBe(0);
    expect(fresh.picks.every((pick) => pick === null)).toBe(true);
  });
});
