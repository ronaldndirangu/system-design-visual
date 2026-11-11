/**
 * State machine for a timed design round. The caller passes elapsed time in
 * milliseconds, so the same actions always produce the same state, and the
 * clock keeps real time even while the learner sketches in another tab.
 */
import { createRng, randomInt } from '../rng';

export const STEP_COUNT = 7;

export type PaceId = 'drill' | 'interview';

/**
 * Suggested minutes per checklist step. The split is a rule of thumb: most of
 * the time goes to the high-level design and the deep dive.
 */
export const PACES: Record<PaceId, { label: string; minutes: readonly number[] }> = {
  drill: { label: '20 minute drill', minutes: [2, 2, 2, 2, 5, 5, 2] },
  interview: { label: '45 minute interview', minutes: [5, 5, 4, 5, 10, 11, 5] },
};

export type Phase = 'ready' | 'running' | 'paused' | 'finished';
export type EndReason = 'learner' | 'clock';
export type RubricScore = 0 | 1 | 2;

export interface RoundConfig {
  budgetsMs: readonly number[];
  /** End the round the moment the total budget runs out, as a real interview would. */
  hardStop: boolean;
}

export interface RoundState {
  phase: Phase;
  step: number;
  usedMs: number[];
  reached: boolean[];
  endedBy: EndReason | null;
  scores: (RubricScore | null)[];
  outlineShown: boolean;
}

export type StepStatus = 'not-reached' | 'current' | 'within' | 'over';

export interface StepReport {
  index: number;
  usedMs: number;
  budgetMs: number;
  overMs: number;
  status: StepStatus;
}

export function paceConfig(pace: PaceId, hardStop: boolean): RoundConfig {
  return { budgetsMs: PACES[pace].minutes.map((minutes) => minutes * 60_000), hardStop };
}

export function initialRound(): RoundState {
  return {
    phase: 'ready',
    step: 0,
    usedMs: Array.from({ length: STEP_COUNT }, () => 0),
    reached: Array.from({ length: STEP_COUNT }, (_, index) => index === 0),
    endedBy: null,
    scores: Array.from({ length: STEP_COUNT }, () => null),
    outlineShown: false,
  };
}

export function startRound(state: RoundState): RoundState {
  return state.phase === 'ready' ? { ...state, phase: 'running' } : state;
}

export function pauseRound(state: RoundState): RoundState {
  return state.phase === 'running' ? { ...state, phase: 'paused' } : state;
}

export function resumeRound(state: RoundState): RoundState {
  return state.phase === 'paused' ? { ...state, phase: 'running' } : state;
}

export function totalBudgetMs(config: RoundConfig): number {
  return config.budgetsMs.reduce((sum, ms) => sum + ms, 0);
}

function totalUsedMs(state: RoundState): number {
  return state.usedMs.reduce((sum, ms) => sum + ms, 0);
}

/** Adds elapsed time to the current step. Steps never advance on their own. */
export function tickRound(state: RoundState, deltaMs: number, config: RoundConfig): RoundState {
  if (state.phase !== 'running' || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const remaining = totalBudgetMs(config) - totalUsedMs(state);
  const outOfTime = config.hardStop && deltaMs >= remaining;
  const added = outOfTime ? Math.max(0, remaining) : deltaMs;
  const usedMs = state.usedMs.map((ms, index) => (index === state.step ? ms + added : ms));
  return outOfTime ? { ...state, usedMs, phase: 'finished', endedBy: 'clock' } : { ...state, usedMs };
}

function goToStep(state: RoundState, index: number): RoundState {
  if (state.phase !== 'running' && state.phase !== 'paused') return state;
  if (index < 0 || index >= STEP_COUNT || index === state.step) return state;
  return { ...state, step: index, reached: state.reached.map((value, i) => value || i === index) };
}

export function nextStep(state: RoundState): RoundState {
  return goToStep(state, state.step + 1);
}

/** The checklist loops: a deep dive often sends you back to an earlier step. */
export function previousStep(state: RoundState): RoundState {
  return goToStep(state, state.step - 1);
}

export function finishRound(state: RoundState): RoundState {
  if (state.phase !== 'running' && state.phase !== 'paused') return state;
  return { ...state, phase: 'finished', endedBy: 'learner' };
}

/** Self-assessment opens only after the round, so it cannot steer the design. */
export function scoreCriterion(state: RoundState, index: number, score: RubricScore): RoundState {
  if (state.phase !== 'finished' || index < 0 || index >= STEP_COUNT) return state;
  return { ...state, scores: state.scores.map((value, i) => (i === index ? score : value)) };
}

export function revealOutline(state: RoundState): RoundState {
  return state.phase === 'finished' ? { ...state, outlineShown: true } : state;
}

export function stepReports(state: RoundState, config: RoundConfig): StepReport[] {
  return state.usedMs.map((usedMs, index) => {
    const budgetMs = config.budgetsMs[index] ?? 0;
    const overMs = Math.max(0, usedMs - budgetMs);
    let status: StepStatus;
    if (!state.reached[index]) status = 'not-reached';
    else if (index === state.step && state.phase !== 'finished') status = 'current';
    else status = overMs > 0 ? 'over' : 'within';
    return { index, usedMs, budgetMs, overMs, status };
  });
}

export function roundTotals(state: RoundState, config: RoundConfig) {
  const usedMs = totalUsedMs(state);
  const budgetMs = totalBudgetMs(config);
  return {
    usedMs,
    budgetMs,
    remainingMs: Math.max(0, budgetMs - usedMs),
    overMs: Math.max(0, usedMs - budgetMs),
  };
}

export function rubricTotal(scores: readonly (RubricScore | null)[]) {
  let total = 0;
  let scored = 0;
  for (const score of scores) {
    if (score === null) continue;
    total += score;
    scored += 1;
  }
  return { total, scored, max: scores.length * 2 };
}

/** Picks a different prompt than the current one. The same seed always picks the same prompt. */
export function drawPromptIndex(seed: number, count: number, current: number): number {
  if (count < 2) return 0;
  const pick = randomInt(createRng(seed), 0, count - 2);
  return pick >= current ? pick + 1 : pick;
}

/**
 * "m:ss" for a duration. Elapsed time rounds down; countdowns and overtime round up, so a clock that
 * shows 0:00 left has really run out and used plus left always adds up to the budget.
 */
export function formatClock(ms: number, rounding: 'down' | 'up' = 'down'): string {
  const exact = Math.max(0, ms) / 1000;
  const seconds = rounding === 'up' ? Math.ceil(exact) : Math.floor(exact);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
