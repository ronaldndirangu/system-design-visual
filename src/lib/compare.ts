/** Gaps smaller than this share of the larger value count as a tie, so seed noise never earns a badge. */
export const TIE_MARGIN = 0.05;

/**
 * Index of the better value, or -1 for a tie. Values that look the same once formatted
 * also tie, so a learner never sees "Better" next to two identical numbers.
 */
export function betterIndex(
  values: readonly [number, number],
  better: 'lower' | 'higher' | undefined,
  shown: readonly [string, string],
): -1 | 0 | 1 {
  const [a, b] = values;
  if (!better || shown[0] === shown[1]) return -1;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0 || Math.abs(a - b) / scale < TIE_MARGIN) return -1;
  return (better === 'lower' ? a < b : a > b) ? 0 : 1;
}
