import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPairs, contrast, PAIRS, parseTokens, themePath } from '../../scripts/contrast.mjs';

const css = readFileSync(themePath, 'utf8');

describe('contrast', () => {
  it('matches the WCAG reference ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#ffffff', '#5e5ce6')).toBeCloseTo(5.06, 2);
  });
});

describe('theme tokens', () => {
  const { dark, light } = parseTokens(css);

  it('defines distinct dark and light values for the surface ladder', () => {
    for (const name of ['bg', 'surface-1', 'surface-2', 'surface-3', 'sunken', 'text-1']) {
      expect(dark[name], name).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[name], name).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[name], name).not.toBe(dark[name]);
    }
  });

  it.each(['dark', 'light'] as const)('meets every section 4.2 minimum in the %s theme', (theme) => {
    const results = checkPairs(css).filter((r) => r.theme === theme);
    expect(results).toHaveLength(PAIRS.length);
    const failures = results
      .filter((r) => r.ratio < r.min)
      .map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)} < ${r.min}`);
    expect(failures).toEqual([]);
  });

  it('keeps the legacy aliases that widgets still reference', () => {
    for (const alias of ['surface', 'surface-raised', 'border', 'radius', 'shadow']) {
      expect(css, alias).toMatch(new RegExp(`--sdv-${alias}:\\s*var\\(--sdv-`));
    }
  });
});
