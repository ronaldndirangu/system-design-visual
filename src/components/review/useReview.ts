import { useSyncExternalStore } from 'react';
import { type ReviewData, readReview, subscribeReview } from '../../lib/review';

/** Review data from this browser, or null while rendering on the server. */
export function useReview(): ReviewData | null {
  return useSyncExternalStore(subscribeReview, readReview, () => null);
}
