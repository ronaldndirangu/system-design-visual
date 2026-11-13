/**
 * Spaced review saved in this browser's localStorage. Each question is a card in
 * a Leitner box: a right answer moves it up a box and spaces the next review out,
 * a miss sends it back to box 1.
 */
import { isCount, isRecord, isSafeId, type ProgressData } from './progress';

export const REVIEW_STORAGE_KEY = 'sdv:review';
export const REVIEW_VERSION = 1;
const CHANGE_EVENT = 'sdv:review-change';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until the next review for boxes 1 through 4. */
export const INTERVAL_DAYS = [1, 3, 7, 21] as const;
export const MAX_BOX = INTERVAL_DAYS.length;
/** Share of checkpoint questions a learner answers correctly to pass. */
export const CHECKPOINT_PASS = 0.7;

export interface ReviewCard {
  /** Leitner box from 1 to MAX_BOX. Higher boxes wait longer. */
  box: number;
  /** ISO date the card comes back. */
  due: string;
}

export interface CheckpointResult {
  score: number;
  total: number;
  /** ISO date of the best attempt. */
  at: string;
}

export interface ReviewData {
  version: typeof REVIEW_VERSION;
  cards: Record<string, ReviewCard>;
  checkpoints: Record<string, CheckpointResult>;
}

/** Question ids per page id, the shape question-bank.json serves. */
export type QuestionIds = Record<string, { questions: readonly { id: string }[] }>;

export function emptyReview(): ReviewData {
  return { version: REVIEW_VERSION, cards: {}, checkpoints: {} };
}

function isBox(value: unknown): value is number {
  return isCount(value) && value >= 1 && value <= MAX_BOX;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseCard(value: unknown): ReviewCard | null {
  return isRecord(value) && isBox(value.box) && isDate(value.due) ? { box: value.box, due: value.due } : null;
}

function parseCheckpoint(value: unknown): CheckpointResult | null {
  if (!isRecord(value) || !isCount(value.score) || !isCount(value.total) || !isDate(value.at)) return null;
  if (value.total === 0 || value.score > value.total) return null;
  return { score: value.score, total: value.total, at: value.at };
}

function parseEntries<T>(value: unknown, parse: (entry: unknown) => T | null): Record<string, T> {
  const entries: Record<string, T> = {};
  if (!isRecord(value)) return entries;
  for (const [id, entry] of Object.entries(value)) {
    const parsed = isSafeId(id) ? parse(entry) : null;
    if (parsed) entries[id] = parsed;
  }
  return entries;
}

/** Accepts anything from storage and always returns valid data. */
export function parseReview(raw: string | null): ReviewData {
  if (!raw) return emptyReview();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== REVIEW_VERSION) return emptyReview();
    return {
      version: REVIEW_VERSION,
      cards: parseEntries(value.cards, parseCard),
      checkpoints: parseEntries(value.checkpoints, parseCheckpoint),
    };
  } catch {
    return emptyReview();
  }
}

function parseEntriesStrict<T>(
  value: unknown,
  parse: (entry: unknown) => T | null,
): Record<string, T> | null {
  if (!isRecord(value)) return null;
  const entries = parseEntries(value, parse);
  return Object.keys(entries).length === Object.keys(value).length ? entries : null;
}

/** Validates review data from an import file, rejecting it when any entry is invalid. */
export function validateReview(value: unknown): ReviewData | null {
  if (!isRecord(value) || value.version !== REVIEW_VERSION) return null;
  const cards = parseEntriesStrict(value.cards, parseCard);
  const checkpoints = parseEntriesStrict(value.checkpoints, parseCheckpoint);
  return cards && checkpoints ? { version: REVIEW_VERSION, cards, checkpoints } : null;
}

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * DAY_MS).toISOString();
}

function intervalFor(box: number): number {
  return INTERVAL_DAYS[box - 1] ?? INTERVAL_DAYS[0];
}

/** A right answer moves the card up one box, capped at MAX_BOX. A miss resets it to box 1. */
export function scheduleCard(card: ReviewCard | undefined, correct: boolean, now: Date): ReviewCard {
  const box = correct ? Math.min((card?.box ?? 0) + 1, MAX_BOX) : 1;
  return { box, due: addDays(now, intervalFor(box)) };
}

/** Ids of cards due at `now`, oldest first. Ties sort by id so the order stays stable. */
export function dueCards(data: ReviewData, now: Date): string[] {
  const at = now.getTime();
  return Object.entries(data.cards)
    .filter(([, card]) => Date.parse(card.due) <= at)
    .sort(([a, x], [b, y]) => Date.parse(x.due) - Date.parse(y.due) || a.localeCompare(b))
    .map(([id]) => id);
}

/** The soonest due date among cards that are not due yet. */
export function nextDue(data: ReviewData, now: Date): string | null {
  const at = now.getTime();
  let next: number | null = null;
  for (const card of Object.values(data.cards)) {
    const due = Date.parse(card.due);
    if (due > at && (next === null || due < next)) next = due;
  }
  return next === null ? null : new Date(next).toISOString();
}

/** A due date as a learner reads it, such as "Friday, November 13". */
export function formatReviewDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * Adds a box 1 card for every question in each lesson quiz the learner finished.
 * Missed questions come due now and the rest come due a day after completion.
 * Cards that already exist keep their schedule.
 */
export function seedCards(
  data: ReviewData,
  progress: ProgressData,
  bank: QuestionIds,
  now: Date,
): ReviewData {
  let cards: Record<string, ReviewCard> | null = null;
  for (const [lessonId, lesson] of Object.entries(progress.lessons)) {
    if (!lesson.quizBest || !Object.hasOwn(bank, lessonId)) continue;
    const missed = new Set(lesson.missed);
    const start = isDate(lesson.completedAt) ? new Date(lesson.completedAt) : now;
    for (const { id } of bank[lessonId]?.questions ?? []) {
      if (!isSafeId(id) || Object.hasOwn(cards ?? data.cards, id)) continue;
      cards ??= { ...data.cards };
      cards[id] = { box: 1, due: missed.has(id) ? now.toISOString() : addDays(start, INTERVAL_DAYS[0]) };
    }
  }
  return cards ? { ...data, cards } : data;
}

/**
 * Keeps the best score per checkpoint. Missed questions go to box 1, due now.
 * Newly answered questions come due tomorrow, and existing cards keep their schedule.
 */
export function withCheckpoint(
  data: ReviewData,
  moduleId: string,
  score: number,
  total: number,
  answered: readonly string[],
  missed: readonly string[],
  now: Date,
): ReviewData {
  const result = parseCheckpoint({ score, total, at: now.toISOString() });
  if (!result || !isSafeId(moduleId)) return data;
  const checkpoints = { ...data.checkpoints };
  const best = Object.hasOwn(checkpoints, moduleId) ? checkpoints[moduleId] : undefined;
  if (!best || best.total !== total || score > best.score) checkpoints[moduleId] = result;
  const cards = { ...data.cards };
  const missedIds = new Set(missed);
  for (const id of answered) {
    if (isSafeId(id) && !missedIds.has(id) && !Object.hasOwn(cards, id)) {
      cards[id] = { box: 1, due: addDays(now, INTERVAL_DAYS[0]) };
    }
  }
  for (const id of missed) {
    if (isSafeId(id)) cards[id] = { box: 1, due: now.toISOString() };
  }
  return { ...data, cards, checkpoints };
}

export function withAnswer(data: ReviewData, id: string, correct: boolean, now: Date): ReviewData {
  if (!isSafeId(id)) return data;
  const card = Object.hasOwn(data.cards, id) ? data.cards[id] : undefined;
  return { ...data, cards: { ...data.cards, [id]: scheduleCard(card, correct, now) } };
}

export function checkpointPassed(result: CheckpointResult | undefined): boolean {
  return result !== undefined && result.score / result.total >= CHECKPOINT_PASS;
}

export function checkpointResult(data: ReviewData, moduleId: string): CheckpointResult | undefined {
  return Object.hasOwn(data.checkpoints, moduleId) ? data.checkpoints[moduleId] : undefined;
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Fallback when storage is blocked or full, so review lasts for this page at least. */
let memoryRaw: string | null = null;
let useMemory = false;
let cachedRaw: string | null | undefined;
let cachedData: ReviewData = emptyReview();

function readRaw(): string | null {
  if (useMemory) return memoryRaw;
  try {
    return storage()?.getItem(REVIEW_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Returns the same object until storage changes, as useSyncExternalStore requires. */
export function readReview(): ReviewData {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedData = parseReview(raw);
  }
  return cachedData;
}

function write(data: ReviewData): void {
  const raw = JSON.stringify(data);
  try {
    const store = storage();
    if (!store) throw new Error('Storage unavailable');
    store.setItem(REVIEW_STORAGE_KEY, raw);
    useMemory = false;
  } catch {
    useMemory = true;
    memoryRaw = raw;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function recordAnswer(id: string, correct: boolean, now = new Date()): void {
  write(withAnswer(readReview(), id, correct, now));
}

export function recordCheckpoint(
  moduleId: string,
  score: number,
  total: number,
  answered: readonly string[],
  missed: readonly string[],
  now = new Date(),
): void {
  write(withCheckpoint(readReview(), moduleId, score, total, answered, missed, now));
}

export function replaceReview(data: ReviewData): void {
  write(data);
}

export function clearReview(): void {
  memoryRaw = null;
  try {
    storage()?.removeItem(REVIEW_STORAGE_KEY);
  } catch {
    // Storage is blocked, so the memory fallback above is all there is to clear.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Seeds cards from lesson progress, writing only when a new card appears. */
export function syncSeeds(progress: ProgressData, bank: QuestionIds, now = new Date()): void {
  const data = readReview();
  const seeded = seedCards(data, progress, bank, now);
  if (seeded !== data) write(seeded);
}

/** Notifies on changes from this tab and from other tabs. */
export function subscribeReview(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === REVIEW_STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
