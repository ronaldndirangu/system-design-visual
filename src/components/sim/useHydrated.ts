import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * False in server HTML and during hydration, true once React owns the island.
 * Disable inputs until then so a click on the static HTML is never silently lost.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
