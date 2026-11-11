/** Gaps smaller than this share of the larger value count as a tie, so seed noise never earns a badge. */
export const TIE_MARGIN = 0.05;

function ties(a: number, b: number, shownA: string | undefined, shownB: string | undefined): boolean {
  if (shownA === shownB) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 || Math.abs(a - b) / scale < TIE_MARGIN;
}

/**
 * Indexes of every value tied for best, or none when all values tie. Values that look the
 * same once formatted also tie, so a learner never sees "Better" next to identical numbers.
 */
export function betterIndices(
  values: readonly number[],
  better: 'lower' | 'higher' | undefined,
  shown: readonly string[],
): number[] {
  if (!better || values.length < 2) return [];
  const best = better === 'lower' ? Math.min(...values) : Math.max(...values);
  const bestAt = values.indexOf(best);
  const winners = values.flatMap((value, index) =>
    ties(value, best, shown[index], shown[bestAt]) ? [index] : [],
  );
  return winners.length === values.length ? [] : winners;
}

/** Two-value form of betterIndices: the better index, or -1 for a tie. */
export function betterIndex(
  values: readonly [number, number],
  better: 'lower' | 'higher' | undefined,
  shown: readonly [string, string],
): -1 | 0 | 1 {
  const [winner] = betterIndices(values, better, shown);
  return winner === 0 || winner === 1 ? winner : -1;
}
