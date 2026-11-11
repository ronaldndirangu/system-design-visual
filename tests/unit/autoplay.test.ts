import { describe, expect, it } from 'vitest';
import { AUTOPLAY_MS, autoplayBudget } from '../../src/lib/useAutoplay';

describe('autoplayBudget', () => {
  it('rests after two loops when two loops finish within five seconds', () => {
    expect(autoplayBudget(1400)).toBe(2800);
  });

  it('never autoplays longer than five seconds', () => {
    expect(autoplayBudget(4000)).toBe(AUTOPLAY_MS);
    expect(AUTOPLAY_MS).toBeLessThanOrEqual(5000);
  });
});
