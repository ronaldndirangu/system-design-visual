import { describe, expect, it } from 'vitest';
import { findModule } from '../../src/data/curriculum';
import { checklistSteps, practicePrompts } from '../../src/data/practicePrompts';
import {
  drawPromptIndex,
  finishRound,
  formatClock,
  initialRound,
  nextStep,
  PACES,
  paceConfig,
  pauseRound,
  previousStep,
  type RoundState,
  resumeRound,
  revealOutline,
  roundTotals,
  rubricTotal,
  STEP_COUNT,
  scoreCriterion,
  startRound,
  stepReports,
  tickRound,
  weakestSteps,
} from '../../src/lib/models/timedRound';

const drill = paceConfig('drill', true);
const soft = paceConfig('drill', false);

function run(actions: ((state: RoundState) => RoundState)[]): RoundState {
  return actions.reduce((state, action) => action(state), initialRound());
}

describe('timed round content', () => {
  it('has one entry per checklist step everywhere', () => {
    expect(checklistSteps).toHaveLength(STEP_COUNT);
    for (const pace of Object.values(PACES)) expect(pace.minutes).toHaveLength(STEP_COUNT);
    for (const prompt of practicePrompts) {
      expect(prompt.outline).toHaveLength(STEP_COUNT);
      for (const section of prompt.outline) expect(section.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('points every prompt at a real module before practice, with unique ids', () => {
    const practice = findModule('practice');
    for (const prompt of practicePrompts) {
      expect(findModule(prompt.bestAfter)?.number ?? 99, prompt.id).toBeLessThan(practice?.number ?? 0);
    }
    expect(new Set(practicePrompts.map((prompt) => prompt.id)).size).toBe(practicePrompts.length);
  });

  it('adds up to the pace names', () => {
    expect(PACES.drill.minutes.reduce((a, b) => a + b, 0)).toBe(20);
    expect(PACES.interview.minutes.reduce((a, b) => a + b, 0)).toBe(45);
  });

  it('gives the deep dive and the high-level design the largest share', () => {
    for (const { minutes } of Object.values(PACES)) {
      const largest = Math.max(...minutes);
      expect([minutes[4], minutes[5]]).toContain(largest);
    }
  });
});

describe('timed round clock', () => {
  it('counts time only while running', () => {
    const ready = tickRound(initialRound(), 5_000, drill);
    expect(ready.usedMs[0]).toBe(0);

    const running = tickRound(startRound(initialRound()), 5_000, drill);
    expect(running.usedMs[0]).toBe(5_000);

    const paused = tickRound(pauseRound(running), 60_000, drill);
    expect(paused.usedMs[0]).toBe(5_000);
    expect(paused.phase).toBe('paused');

    const resumed = tickRound(resumeRound(paused), 1_000, drill);
    expect(resumed.usedMs[0]).toBe(6_000);
  });

  it('ignores negative and non-finite deltas', () => {
    const running = startRound(initialRound());
    expect(tickRound(running, -10, drill)).toBe(running);
    expect(tickRound(running, Number.NaN, drill)).toBe(running);
  });

  it('charges time to the step you are on, including after going back', () => {
    const state = run([
      startRound,
      (s) => tickRound(s, 1_000, drill),
      nextStep,
      (s) => tickRound(s, 2_000, drill),
      previousStep,
      (s) => tickRound(s, 3_000, drill),
    ]);
    expect(state.step).toBe(0);
    expect(state.usedMs.slice(0, 2)).toEqual([4_000, 2_000]);
    expect(state.reached.slice(0, 3)).toEqual([true, true, false]);
  });

  it('keeps the step when its budget runs out', () => {
    const state = run([startRound, (s) => tickRound(s, 3 * 60_000, drill)]);
    expect(state.step).toBe(0);
    expect(state.phase).toBe('running');
    const report = stepReports(state, drill)[0];
    expect(report?.overMs).toBe(60_000);
    expect(report?.status).toBe('current');
  });

  it('stops at exactly the total budget when the hard stop is on', () => {
    const state = run([
      startRound,
      (s) => tickRound(s, 19 * 60_000, drill),
      (s) => tickRound(s, 5 * 60_000, drill),
    ]);
    expect(state.phase).toBe('finished');
    expect(state.endedBy).toBe('clock');
    expect(roundTotals(state, drill)).toMatchObject({ usedMs: 20 * 60_000, remainingMs: 0, overMs: 0 });
  });

  it('runs past the budget when the hard stop is off', () => {
    const state = run([startRound, (s) => tickRound(s, 25 * 60_000, soft)]);
    expect(state.phase).toBe('running');
    expect(roundTotals(state, soft).overMs).toBe(5 * 60_000);
  });

  it('gives the same result for one big tick or many small ones', () => {
    let small = startRound(initialRound());
    for (let i = 0; i < 100; i += 1) small = tickRound(small, 250, drill);
    const big = tickRound(startRound(initialRound()), 25_000, drill);
    expect(small).toEqual(big);
  });
});

describe('timed round steps', () => {
  it('stays within the seven steps', () => {
    let state = startRound(initialRound());
    expect(previousStep(state)).toBe(state);
    for (let i = 0; i < 10; i += 1) state = nextStep(state);
    expect(state.step).toBe(STEP_COUNT - 1);
    expect(state.reached.every(Boolean)).toBe(true);
  });

  it('moves only during a round', () => {
    expect(nextStep(initialRound()).step).toBe(0);
    const finished = finishRound(startRound(initialRound()));
    expect(nextStep(finished)).toBe(finished);
  });

  it('marks unreached steps and the over budget ones in the report', () => {
    const state = run([
      startRound,
      (s) => tickRound(s, 3 * 60_000, soft),
      nextStep,
      (s) => tickRound(s, 60_000, soft),
      finishRound,
    ]);
    expect(stepReports(state, soft).map((r) => r.status)).toEqual([
      'over',
      'within',
      'not-reached',
      'not-reached',
      'not-reached',
      'not-reached',
      'not-reached',
    ]);
    expect(state.endedBy).toBe('learner');
  });
});

describe('timed round self-assessment', () => {
  it('opens the rubric and the outline only after the round', () => {
    const running = startRound(initialRound());
    expect(scoreCriterion(running, 0, 2)).toBe(running);
    expect(revealOutline(running)).toBe(running);

    const finished = finishRound(running);
    const scored = scoreCriterion(scoreCriterion(finished, 0, 2), 4, 1);
    expect(scored.scores).toEqual([2, null, null, null, 1, null, null]);
    expect(revealOutline(scored).outlineShown).toBe(true);
  });

  it('totals only the scored criteria', () => {
    expect(rubricTotal([2, null, null, null, 1, null, null])).toEqual({ total: 3, scored: 2, max: 14 });
    expect(rubricTotal(Array.from({ length: STEP_COUNT }, () => 2 as const))).toEqual({
      total: 14,
      scored: 7,
      max: 14,
    });
  });

  it('rejects scores for steps that do not exist', () => {
    const finished = finishRound(startRound(initialRound()));
    expect(scoreCriterion(finished, 7, 2)).toBe(finished);
    expect(scoreCriterion(finished, -1, 2)).toBe(finished);
  });

  it('names the lowest scored steps, and none when every scored step is solid', () => {
    expect(weakestSteps([null, null, null, null, null, null, null])).toEqual([]);
    expect(weakestSteps([2, null, 2, 2, null, 2, 2])).toEqual([]);
    expect(weakestSteps([2, 1, 2, null, 1, 2, 2])).toEqual([1, 4]);
    expect(weakestSteps([1, 0, 2, 2, 1, 0, null])).toEqual([1, 5]);
  });
});

describe('timed round helpers', () => {
  it('draws the same prompt for the same seed and never repeats the current one', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      for (let current = 0; current < 4; current += 1) {
        const pick = drawPromptIndex(seed, 4, current);
        expect(pick).toBe(drawPromptIndex(seed, 4, current));
        expect(pick).not.toBe(current);
        expect(pick).toBeGreaterThanOrEqual(0);
        expect(pick).toBeLessThan(4);
      }
    }
  });

  it('draws from the preferred prompts when one other than the current is free', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      expect([1, 3]).toContain(drawPromptIndex(seed, 4, 0, [1, 3]));
      expect(drawPromptIndex(seed, 4, 1, [1, 3])).toBe(3);
      expect(drawPromptIndex(seed, 4, 2, [2])).not.toBe(2);
    }
  });

  it('formats the clock in minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59_999)).toBe('0:59');
    expect(formatClock(125_000)).toBe('2:05');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(59_001, 'up')).toBe('1:00');
    expect(formatClock(60_000, 'up')).toBe('1:00');
    const used = 10_600;
    const left = 1_200_000 - used;
    expect([formatClock(used), formatClock(left, 'up')]).toEqual(['0:10', '19:50']);
  });

  it('replays the same actions to the same state, and a reset round matches a fresh one', () => {
    const actions = [startRound, (s: RoundState) => tickRound(s, 90_000, drill), nextStep, finishRound];
    const first = run(actions);
    expect(run(actions)).toEqual(first);
    expect(first).not.toEqual(initialRound());

    const fresh = initialRound();
    fresh.usedMs[0] = 1;
    expect(initialRound().usedMs[0]).toBe(0);
  });
});
