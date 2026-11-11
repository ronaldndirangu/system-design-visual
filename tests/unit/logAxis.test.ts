import { describe, expect, it } from 'vitest';
import { formatDecade, logFraction, logRange, logTicks } from '../../src/lib/logAxis';
import { estimate } from '../../src/lib/models/estimates';

describe('logRange', () => {
  it('keeps the default span when every value fits inside it', () => {
    expect(logRange([0.5, 120, 3_500])).toEqual({ min: -2, max: 6 });
  });

  it('grows to the next decade so values above 1M are never clamped', () => {
    const peak = estimate({
      newLinksPerDay: 1_000_000_000,
      readsPerWrite: 1_000,
      bytesPerLink: 500,
      retentionYears: 5,
      peakToAverage: 10,
      requestsPerServer: 2_000,
      hotFraction: 0.2,
    }).peakRequestsPerSecond;
    const range = logRange([peak]);
    expect(peak).toBeGreaterThan(1e8);
    expect(range.max).toBe(9);
    expect(logFraction(peak, range)).toBeLessThan(1);
  });

  it('grows downward for tiny rates and ignores zero, negative, and non finite values', () => {
    expect(logRange([0.0012, 0, -4, Number.NaN, Number.POSITIVE_INFINITY])).toEqual({ min: -3, max: 6 });
  });

  it('treats exact powers of ten as sitting on the edge of the range', () => {
    expect(logRange([1e7])).toEqual({ min: -2, max: 7 });
    expect(logRange([0.001])).toEqual({ min: -3, max: 6 });
  });
});

describe('logFraction', () => {
  it('maps decades linearly and clamps values outside the range', () => {
    const range = { min: 0, max: 4 };
    expect(logFraction(100, range)).toBeCloseTo(0.5);
    expect(logFraction(0.01, range)).toBe(0);
    expect(logFraction(1e9, range)).toBe(1);
    expect(logFraction(0, range)).toBe(0);
  });
});

describe('formatDecade', () => {
  it('labels powers of ten with short suffixes', () => {
    expect([-3, -2, -1, 0, 1, 2, 3, 4, 6, 8, 9].map(formatDecade)).toEqual([
      '0.001',
      '0.01',
      '0.1',
      '1',
      '10',
      '100',
      '1K',
      '10K',
      '1M',
      '100M',
      '1B',
    ]);
  });
});

describe('logTicks', () => {
  it('labels every decade when there is room', () => {
    const ticks = logTicks({ min: -2, max: 6 }, 400);
    expect(ticks).toHaveLength(9);
    expect(ticks.every((tick) => tick.label !== null)).toBe(true);
  });

  it('thins labels on narrow charts but keeps every gridline and the label for 1', () => {
    const range = { min: -3, max: 9 };
    const plotWidth = 300;
    const ticks = logTicks(range, plotWidth);
    expect(ticks).toHaveLength(13);
    const labelled = ticks.filter((tick) => tick.label !== null);
    expect(labelled.map((tick) => tick.label)).toContain('1');
    const decadeWidth = plotWidth / (range.max - range.min);
    const exponents = labelled.map((tick) => tick.exponent);
    const gaps = exponents
      .slice(1)
      .map((exponent, i) => (exponent - (exponents[i] ?? exponent)) * decadeWidth);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(44);
  });
});
