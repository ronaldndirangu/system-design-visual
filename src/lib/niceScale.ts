/**
 * Rounds an axis maximum up to a readable value with whole number steps of
 * 1, 2, or 5 times a power of ten, so gridlines land on numbers people use.
 */
export function niceScale(max: number, targetTicks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: targetTicks, step: 1 };
  const raw = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude);
  return { max: Math.ceil(max / step) * step, step };
}
