/** Inclusive range of powers of ten, so `{ min: -2, max: 6 }` spans 0.01 to 1,000,000. */
export interface LogRange {
  min: number;
  max: number;
}

export interface LogTick {
  exponent: number;
  /** Text for the tick, or null when the tick keeps its gridline but drops its label to avoid overlap. */
  label: string | null;
}

const EPSILON = 1e-9;
const SUFFIXES = ['', 'K', 'M', 'B', 'T'];

/**
 * Smallest whole-decade range that contains every positive value and the
 * default span, so no value is ever clamped against the edge of the axis.
 */
export function logRange(values: readonly number[], fallback: LogRange = { min: -2, max: 6 }): LogRange {
  let { min, max } = fallback;
  for (const value of values) {
    if (!(value > 0) || !Number.isFinite(value)) continue;
    const exponent = Math.log10(value);
    min = Math.min(min, Math.floor(exponent + EPSILON));
    max = Math.max(max, Math.ceil(exponent - EPSILON));
  }
  return { min, max };
}

/** Position of `value` along the range, from 0 at the low edge to 1 at the high edge. */
export function logFraction(value: number, range: LogRange): number {
  const span = range.max - range.min;
  if (!(value > 0) || span <= 0) return 0;
  const fraction = (Math.log10(value) - range.min) / span;
  return Math.min(1, Math.max(0, fraction));
}

/** 0.01, 0.1, 1, 10, 100, 1K, 10K, ... for a power of ten. */
export function formatDecade(exponent: number): string {
  if (exponent < 0) return (10 ** exponent).toFixed(-exponent);
  const group = Math.min(SUFFIXES.length - 1, Math.floor(exponent / 3));
  return `${10 ** (exponent - group * 3)}${SUFFIXES[group]}`;
}

/**
 * One tick per decade. When decades sit closer than `minSpacing` pixels, only
 * every nth decade keeps its label, always including 1 so the scale stays anchored.
 */
export function logTicks(range: LogRange, plotWidth: number, minSpacing = 44): LogTick[] {
  const decades = Math.max(1, range.max - range.min);
  const spacing = plotWidth / decades;
  const every = Math.max(1, Math.ceil(minSpacing / Math.max(spacing, EPSILON)));
  const ticks: LogTick[] = [];
  for (let exponent = range.min; exponent <= range.max; exponent += 1) {
    const keep = ((exponent % every) + every) % every === 0;
    ticks.push({ exponent, label: keep ? formatDecade(exponent) : null });
  }
  return ticks;
}
