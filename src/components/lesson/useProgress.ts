import { useSyncExternalStore } from 'react';
import { type ProgressData, readProgress, subscribeProgress } from '../../lib/progress';

/** Progress from this browser, or null while rendering on the server. */
export function useProgress(): ProgressData | null {
  return useSyncExternalStore(subscribeProgress, readProgress, () => null);
}
