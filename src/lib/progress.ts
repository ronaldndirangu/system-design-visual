/**
 * Lesson progress saved in this browser's localStorage. The schema carries a
 * version so future changes can migrate old data instead of crashing on it.
 */
export const PROGRESS_STORAGE_KEY = 'sdv:progress';
export const PROGRESS_VERSION = 1;
const CHANGE_EVENT = 'sdv:progress-change';

export interface ProgressData {
  version: typeof PROGRESS_VERSION;
  /** Lesson id mapped to the ISO date it was completed. */
  completed: Record<string, string>;
}

export function emptyProgress(): ProgressData {
  return { version: PROGRESS_VERSION, completed: {} };
}

/** Accepts anything from storage and always returns valid progress data. */
export function parseProgress(raw: string | null): ProgressData {
  if (!raw) return emptyProgress();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PROGRESS_VERSION || !isRecord(value.completed)) {
      return emptyProgress();
    }
    const completed: Record<string, string> = {};
    for (const [id, date] of Object.entries(value.completed)) {
      if (typeof date === 'string') completed[id] = date;
    }
    return { version: PROGRESS_VERSION, completed };
  } catch {
    return emptyProgress();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function isComplete(id: string): boolean {
  return id in readProgress().completed;
}

export function setComplete(id: string, complete: boolean, now = new Date()): void {
  const completed = { ...readProgress().completed };
  if (complete) completed[id] = now.toISOString();
  else delete completed[id];
  writeRaw(JSON.stringify({ version: PROGRESS_VERSION, completed } satisfies ProgressData));
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
