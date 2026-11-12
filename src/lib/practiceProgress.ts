/**
 * Finished practice rounds saved in this browser's localStorage, using the
 * same versioned pattern as lesson progress. Nothing leaves the device.
 */
import { PACES, type PaceId, type RubricScore, STEP_COUNT } from './models/timedRound';

export const PRACTICE_STORAGE_KEY = 'sdv:practice-rounds';
export const PRACTICE_VERSION = 1;
export const MAX_SAVED_ROUNDS = 10;
const CHANGE_EVENT = 'sdv:practice-rounds-change';
const PROBE_KEY = 'sdv:probe';

export interface SavedRound {
  promptId: string;
  pace: PaceId;
  /** ISO date the round was first saved. It also identifies the round when its score is updated. */
  finishedAt: string;
  /** Whole seconds spent on each checklist step. */
  usedSeconds: number[];
  budgetSeconds: number;
  /** Null when the learner skipped the self-assessment. */
  rubricTotal: number | null;
  rubricMax: number;
  /** Self-assessed score for each checklist step, null where skipped. Rounds saved before scores existed have none. */
  scores?: (RubricScore | null)[];
}

export interface PracticeData {
  version: typeof PRACTICE_VERSION;
  /** Newest first. */
  rounds: SavedRound[];
}

export function emptyPractice(): PracticeData {
  return { version: PRACTICE_VERSION, rounds: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isScore(value: unknown): value is RubricScore | null {
  return value === null || value === 0 || value === 1 || value === 2;
}

/** A malformed score list costs only the per-step detail, so the round itself survives. */
function parseScores(value: unknown): (RubricScore | null)[] | undefined {
  if (!Array.isArray(value) || value.length !== STEP_COUNT || !value.every(isScore)) return undefined;
  return [...value];
}

function parseRound(value: unknown): SavedRound | null {
  if (!isRecord(value)) return null;
  const { promptId, pace, finishedAt, usedSeconds, budgetSeconds, rubricTotal, rubricMax } = value;
  if (typeof promptId !== 'string' || typeof finishedAt !== 'string') return null;
  if (typeof pace !== 'string' || !Object.hasOwn(PACES, pace)) return null;
  if (!Array.isArray(usedSeconds) || usedSeconds.length !== STEP_COUNT || !usedSeconds.every(isCount))
    return null;
  if (!isCount(budgetSeconds) || !isCount(rubricMax)) return null;
  if (rubricTotal !== null && (!isCount(rubricTotal) || rubricTotal > rubricMax)) return null;
  const scores = parseScores(value.scores);
  return {
    promptId,
    pace: pace as PaceId,
    finishedAt,
    usedSeconds: [...usedSeconds],
    budgetSeconds,
    rubricTotal,
    rubricMax,
    ...(scores ? { scores } : {}),
  };
}

/** Accepts anything from storage and always returns valid data. Invalid rounds are dropped. */
export function parsePractice(raw: string | null): PracticeData {
  if (!raw) return emptyPractice();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PRACTICE_VERSION || !Array.isArray(value.rounds)) {
      return emptyPractice();
    }
    const rounds = value.rounds
      .map(parseRound)
      .filter((round): round is SavedRound => round !== null)
      .slice(0, MAX_SAVED_ROUNDS);
    return { version: PRACTICE_VERSION, rounds };
  } catch {
    return emptyPractice();
  }
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Fallback when storage is blocked or full, so saved rounds last for this page at least. */
let memoryRaw: string | null = null;
let useMemory = false;
let probedOk = false;
let cachedRaw: string | null | undefined;
let cachedData: PracticeData = emptyPractice();

function readRaw(): string | null {
  if (useMemory) return memoryRaw;
  try {
    return storage()?.getItem(PRACTICE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Returns the same object until storage changes, as useSyncExternalStore requires. */
export function readPractice(): PracticeData {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedData = parsePractice(raw);
  }
  return cachedData;
}

function writeRaw(raw: string | null): void {
  try {
    const store = storage();
    if (!store) throw new Error('Storage unavailable');
    if (raw === null) store.removeItem(PRACTICE_STORAGE_KEY);
    else store.setItem(PRACTICE_STORAGE_KEY, raw);
    useMemory = false;
  } catch {
    useMemory = true;
    memoryRaw = raw;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Adds a round to the front of the list and keeps the newest ten. Saving the same round again updates it. */
export function saveRound(round: SavedRound): void {
  const existing = readPractice().rounds;
  const index = existing.findIndex((entry) => entry.finishedAt === round.finishedAt);
  const rounds =
    index === -1
      ? [round, ...existing].slice(0, MAX_SAVED_ROUNDS)
      : existing.map((entry, at) => (at === index ? round : entry));
  writeRaw(JSON.stringify({ version: PRACTICE_VERSION, rounds } satisfies PracticeData));
}

export function clearPractice(): void {
  writeRaw(null);
}

/**
 * False when saved rounds live only in this tab's memory: storage is blocked,
 * full, or the last write failed. The UI then says so instead of "Saved".
 */
export function isPracticePersistent(): boolean {
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

/** Notifies on changes from this tab and from other tabs. */
export function subscribePractice(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PRACTICE_STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
