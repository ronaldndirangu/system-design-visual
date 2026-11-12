import { useSyncExternalStore } from 'react';
import { isProgressPersistent, type ProgressData, readProgress, subscribeProgress } from '../../lib/progress';

/** Progress from this browser, or null while rendering on the server. */
export function useProgress(): ProgressData | null {
  return useSyncExternalStore(subscribeProgress, readProgress, () => null);
}

/** False when progress lasts only for this tab because storage failed. */
export function useProgressPersistent(): boolean {
  return useSyncExternalStore(subscribeProgress, isProgressPersistent, () => true);
}
