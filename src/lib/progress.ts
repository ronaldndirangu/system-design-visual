/**
 * Lesson progress saved in this browser's localStorage. The schema carries a
 * version so old data migrates on read instead of crashing the page.
 */
export const PROGRESS_STORAGE_KEY = 'sdv:progress';
export const PROGRESS_VERSION = 2;
const CHANGE_EVENT = 'sdv:progress-change';
const PROBE_KEY = 'sdv:probe';

export interface QuizResult {
  score: number;
  total: number;
}

export interface LessonProgress {
  /** ISO date the learner marked the lesson complete. */
  completedAt?: string;
  /** Best full quiz attempt for the current question set. */
  quizBest?: QuizResult;
  /** Question ids missed on the latest full quiz attempt. */
  missed?: string[];
}

export interface ProgressData {
  version: typeof PROGRESS_VERSION;
  lessons: Record<string, LessonProgress>;
  /** Id of the lesson page opened most recently. */
  last?: string;
}

export function emptyProgress(): ProgressData {
  return { version: PROGRESS_VERSION, lessons: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isResult(value: unknown): value is QuizResult {
  return (
    isRecord(value) &&
    isCount(value.score) &&
    isCount(value.total) &&
    value.total > 0 &&
    value.score <= value.total
  );
}

/** JSON keys that would reach Object.prototype through plain object assignment. */
function isSafeId(id: string): boolean {
  return id !== '__proto__' && id !== 'constructor' && id !== 'prototype';
}

function parseLesson(value: unknown): LessonProgress | null {
  if (!isRecord(value)) return null;
  const lesson: LessonProgress = {};
  if (typeof value.completedAt === 'string') lesson.completedAt = value.completedAt;
  if (isResult(value.quizBest))
    lesson.quizBest = { score: value.quizBest.score, total: value.quizBest.total };
  if (Array.isArray(value.missed)) lesson.missed = value.missed.filter((id) => typeof id === 'string');
  return Object.keys(lesson).length > 0 ? lesson : null;
}

/** Version 1 stored only completion dates: `{ version: 1, completed: { [id]: iso } }`. */
function migrateV1(completed: Record<string, unknown>): ProgressData {
  const data = emptyProgress();
  for (const [id, date] of Object.entries(completed)) {
    if (typeof date === 'string' && isSafeId(id)) data.lessons[id] = { completedAt: date };
  }
  return data;
}

/** Accepts anything from storage and always returns valid version 2 data. */
export function parseProgress(raw: string | null): ProgressData {
  if (!raw) return emptyProgress();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return emptyProgress();
    if (value.version === 1) return isRecord(value.completed) ? migrateV1(value.completed) : emptyProgress();
    if (value.version !== PROGRESS_VERSION || !isRecord(value.lessons)) return emptyProgress();
    const data = emptyProgress();
    for (const [id, entry] of Object.entries(value.lessons)) {
      const lesson = isSafeId(id) ? parseLesson(entry) : null;
      if (lesson) data.lessons[id] = lesson;
    }
    if (typeof value.last === 'string') data.last = value.last;
    return data;
  } catch {
    return emptyProgress();
  }
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Fallback when storage is blocked or full, so progress lasts for this page at least. */
let memoryRaw: string | null = null;
let useMemory = false;
let probedOk = false;
let cachedRaw: string | null | undefined;
let cachedData: ProgressData = emptyProgress();

function readRaw(): string | null {
  if (useMemory) return memoryRaw;
  try {
    return storage()?.getItem(PROGRESS_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Returns the same object until storage changes, as useSyncExternalStore requires. */
export function readProgress(): ProgressData {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedData = parseProgress(raw);
  }
  return cachedData;
}

function writeRaw(raw: string | null): void {
  try {
    const store = storage();
    if (!store) throw new Error('Storage unavailable');
    if (raw === null) store.removeItem(PROGRESS_STORAGE_KEY);
    else store.setItem(PROGRESS_STORAGE_KEY, raw);
    useMemory = false;
  } catch {
    useMemory = true;
    memoryRaw = raw;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function write(data: ProgressData): void {
  writeRaw(JSON.stringify(data));
}

/**
 * False when progress lives only in this tab's memory: storage is blocked,
 * full, or the last write failed. The UI then says so instead of "Saved".
 */
export function isProgressPersistent(): boolean {
  if (useMemory) return false;
  if (probedOk) return true;
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(PROBE_KEY, '1');
    store.removeItem(PROBE_KEY);
    probedOk = true;
  } catch {
    return false;
  }
  return true;
}

function withLesson(data: ProgressData, id: string, lesson: LessonProgress): ProgressData {
  const lessons = { ...data.lessons };
  if (Object.keys(lesson).length > 0) lessons[id] = lesson;
  else delete lessons[id];
  return { ...data, lessons };
}

const NO_PROGRESS: LessonProgress = Object.freeze({});

export function lessonProgress(progress: ProgressData, id: string): LessonProgress {
  return (Object.hasOwn(progress.lessons, id) && progress.lessons[id]) || NO_PROGRESS;
}

export function isComplete(progress: ProgressData, id: string): boolean {
  return Boolean(lessonProgress(progress, id).completedAt);
}

export function completedCount(progress: ProgressData, ids: readonly string[]): number {
  return ids.filter((id) => isComplete(progress, id)).length;
}

export function setComplete(id: string, complete: boolean, now = new Date()): void {
  if (!isSafeId(id)) return;
  const data = readProgress();
  const lesson = { ...lessonProgress(data, id) };
  if (complete) lesson.completedAt = now.toISOString();
  else delete lesson.completedAt;
  write(withLesson(data, id, lesson));
}

/**
 * Saves a full quiz attempt. The best score is kept per question count, so a
 * changed quiz starts a fresh best. Missed ids always reflect the latest attempt.
 */
export function recordQuiz(id: string, score: number, total: number, missed: readonly string[]): void {
  const result = { score, total };
  if (!isSafeId(id) || !isResult(result)) return;
  const data = readProgress();
  const lesson = { ...lessonProgress(data, id) };
  const best = lesson.quizBest;
  if (!best || best.total !== total || score > best.score) lesson.quizBest = result;
  lesson.missed = [...missed];
  write(withLesson(data, id, lesson));
}

/** Remembers the lesson for the "Continue" links. Skips the write when nothing changes. */
export function recordVisit(id: string): void {
  if (!isSafeId(id)) return;
  const data = readProgress();
  if (data.last === id) return;
  write({ ...data, last: id });
}

/** The lesson to resume: the last one opened if unfinished, else the next unfinished one. */
export function continueTarget<T extends { id: string }>(
  progress: ProgressData,
  lessons: readonly T[],
): T | null {
  if (progress.last === undefined && Object.keys(progress.lessons).length === 0) return null;
  const at = lessons.findIndex((lesson) => lesson.id === progress.last);
  for (let offset = 0; offset < lessons.length; offset++) {
    const lesson = lessons[(Math.max(at, 0) + offset) % lessons.length];
    if (lesson && !isComplete(progress, lesson.id)) return lesson;
  }
  return null;
}

export function exportProgress(): string {
  return `${JSON.stringify(readProgress(), null, 2)}\n`;
}

export type ImportResult = { ok: true; lessons: number } | { ok: false; error: string };

/** Replaces progress with an exported file. Accepts version 1 and version 2 exports. */
export function importProgress(text: string): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  const v1 = isRecord(value) && value.version === 1 && isRecord(value.completed);
  const v2 = isRecord(value) && value.version === PROGRESS_VERSION && isRecord(value.lessons);
  if (!v1 && !v2) return { ok: false, error: 'That file is not a progress export from this course.' };
  const data = parseProgress(text);
  write(data);
  return { ok: true, lessons: Object.keys(data.lessons).length };
}

export function resetProgress(): void {
  writeRaw(null);
}

/** Notifies on changes from this tab and from other tabs. */
export function subscribeProgress(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PROGRESS_STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
