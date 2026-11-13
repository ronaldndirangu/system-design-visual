/**
 * One file for everything the course saves in this browser: lesson progress,
 * review schedules and checkpoint scores, and practice rounds.
 */
import {
  clearPractice,
  MAX_SAVED_ROUNDS,
  type PracticeData,
  readPractice,
  replacePractice,
  validatePractice,
} from './practiceProgress';
import {
  applyImport,
  type ImportMode,
  isRecord,
  type ProgressData,
  parseImport,
  readProgress,
  resetProgress,
  summarizeProgress,
} from './progress';
import { clearReview, type ReviewData, readReview, replaceReview, validateReview } from './review';

export const STUDY_KIND = 'sdv-study';
export const STUDY_VERSION = 1;

export interface StudyData {
  progress?: ProgressData;
  review?: ReviewData;
  practice?: PracticeData;
}

export interface StudySnapshot extends Required<StudyData> {
  kind: typeof STUDY_KIND;
  version: typeof STUDY_VERSION;
}

export type ParsedStudyImport = { ok: true; data: StudyData } | { ok: false; error: string };

export function readStudyData(): Required<StudyData> {
  return { progress: readProgress(), review: readReview(), practice: readPractice() };
}

export function exportStudyData(): string {
  const snapshot: StudySnapshot = { kind: STUDY_KIND, version: STUDY_VERSION, ...readStudyData() };
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

const NOT_AN_EXPORT = 'That file is not a progress export from this course.';

/** Reads an exported file without saving it. Rejects the whole file when any section is invalid. */
export function parseStudyImport(text: string): ParsedStudyImport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isRecord(value)) return { ok: false, error: NOT_AN_EXPORT };
  if (value.kind === undefined) {
    const legacy = parseImport(text);
    return legacy.ok ? { ok: true, data: { progress: legacy.data } } : legacy;
  }
  if (value.kind !== STUDY_KIND) return { ok: false, error: NOT_AN_EXPORT };
  if (value.version !== STUDY_VERSION) {
    return { ok: false, error: 'That file comes from a newer version of this course.' };
  }

  const data: StudyData = {};
  if (value.progress !== undefined) {
    const progress = parseImport(JSON.stringify(value.progress));
    if (!progress.ok) return { ok: false, error: 'The lesson progress in that file is not valid.' };
    data.progress = progress.data;
  }
  if (value.review !== undefined) {
    const review = validateReview(value.review);
    if (!review) return { ok: false, error: 'The review schedule in that file is not valid.' };
    data.review = review;
  }
  if (value.practice !== undefined) {
    const practice = validatePractice(value.practice);
    if (!practice) return { ok: false, error: 'The practice rounds in that file are not valid.' };
    data.practice = practice;
  }
  if (Object.keys(data).length === 0) return { ok: false, error: 'That file holds no study data.' };
  return { ok: true, data };
}

/** Current schedules win duplicate cards. A checkpoint keeps the better score when the totals match. */
export function mergeReview(current: ReviewData, incoming: ReviewData): ReviewData {
  const checkpoints = { ...current.checkpoints };
  for (const [id, theirs] of Object.entries(incoming.checkpoints)) {
    const ours = checkpoints[id];
    if (!ours || (ours.total === theirs.total && theirs.score > ours.score)) checkpoints[id] = theirs;
  }
  return { ...current, cards: { ...incoming.cards, ...current.cards }, checkpoints };
}

/** Rounds are identified by finish time. Current duplicates win, and the newest ten stay. */
export function mergePractice(current: PracticeData, incoming: PracticeData): PracticeData {
  const byFinish = new Map(incoming.rounds.map((round) => [round.finishedAt, round]));
  for (const round of current.rounds) byFinish.set(round.finishedAt, round);
  const rounds = [...byFinish.values()]
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, MAX_SAVED_ROUNDS);
  return { ...current, rounds };
}

/** Saves each section the file supplies, merged into or replacing what this browser holds. */
export function applyStudyImport(data: StudyData, mode: ImportMode): void {
  if (data.progress) applyImport(data.progress, mode);
  if (data.review) replaceReview(mode === 'merge' ? mergeReview(readReview(), data.review) : data.review);
  if (data.practice) {
    replacePractice(mode === 'merge' ? mergePractice(readPractice(), data.practice) : data.practice);
  }
}

export function resetStudyData(): void {
  resetProgress();
  clearReview();
  clearPractice();
}

export interface StudySummary {
  completed: number;
  quizScores: number;
  cards: number;
  checkpoints: number;
  rounds: number;
}

export function summarizeStudy(data: StudyData): StudySummary {
  const { completed, quizScores } = data.progress
    ? summarizeProgress(data.progress)
    : { completed: 0, quizScores: 0 };
  return {
    completed,
    quizScores,
    cards: Object.keys(data.review?.cards ?? {}).length,
    checkpoints: Object.keys(data.review?.checkpoints ?? {}).length,
    rounds: data.practice?.rounds.length ?? 0,
  };
}

export function hasStudyData({ progress, review, practice }: Required<StudyData>): boolean {
  return (
    Object.keys(progress.lessons).length > 0 ||
    progress.last !== undefined ||
    Object.keys(review.cards).length > 0 ||
    Object.keys(review.checkpoints).length > 0 ||
    practice.rounds.length > 0
  );
}
