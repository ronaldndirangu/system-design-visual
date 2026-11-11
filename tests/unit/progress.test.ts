import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyProgress,
  isComplete,
  PROGRESS_STORAGE_KEY,
  PROGRESS_VERSION,
  parseProgress,
  readProgress,
  resetProgress,
  setComplete,
} from '../../src/lib/progress';

describe('parseProgress', () => {
  it('returns empty progress for missing or broken data', () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress('not json')).toEqual(emptyProgress());
    expect(parseProgress('[]')).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ version: 99, completed: {} }))).toEqual(emptyProgress());
  });

  it('keeps valid entries and drops malformed ones', () => {
    const raw = JSON.stringify({
      version: PROGRESS_VERSION,
      completed: { 'scaling/caching': '2025-01-01T00:00:00.000Z', bad: 42 },
    });
    expect(parseProgress(raw).completed).toEqual({ 'scaling/caching': '2025-01-01T00:00:00.000Z' });
  });
});

describe('progress store', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const target = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
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

  it('marks, unmarks, and resets lessons', () => {
    setComplete('scaling/caching', true, new Date('2025-02-03T00:00:00Z'));
    expect(isComplete('scaling/caching')).toBe(true);
    expect(JSON.parse(store.get(PROGRESS_STORAGE_KEY) ?? '{}').version).toBe(PROGRESS_VERSION);

    setComplete('scaling/caching', false);
    expect(isComplete('scaling/caching')).toBe(false);

    setComplete('scaling/sharding', true);
    resetProgress();
    expect(store.has(PROGRESS_STORAGE_KEY)).toBe(false);
    expect(readProgress()).toEqual(emptyProgress());
  });

  it('returns the same object until storage changes', () => {
    setComplete('a', true);
    expect(readProgress()).toBe(readProgress());
  });
});
