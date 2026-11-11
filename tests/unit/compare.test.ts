import { describe, expect, it } from 'vitest';
import { betterIndex } from '../../src/lib/compare';

describe('betterIndex', () => {
  it('picks the clearly better side in the requested direction', () => {
    expect(betterIndex([139, 211], 'lower', ['139', '211'])).toBe(0);
    expect(betterIndex([139, 211], 'higher', ['139', '211'])).toBe(1);
  });

  it('calls a tie when the shown values match even if the raw values differ', () => {
    expect(betterIndex([586.6, 587.2], 'lower', ['587 ms', '587 ms'])).toBe(-1);
  });

  it('calls a tie when the gap is within seed noise', () => {
    expect(betterIndex([118, 121], 'lower', ['118 ms', '121 ms'])).toBe(-1);
  });

  it('never ranks rows without a direction or with all zeros', () => {
    expect(betterIndex([4216, 4000], undefined, ['4216', '4000'])).toBe(-1);
    expect(betterIndex([0, 0], 'lower', ['0', '0'])).toBe(-1);
    expect(betterIndex([0, 1], 'lower', ['0', '1'])).toBe(0);
  });
});
