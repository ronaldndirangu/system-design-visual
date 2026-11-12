import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { segmentedFitBucket, segmentedWidthRem } from '../../src/components/ui/Segmented';

const css = readFileSync(new URL('../../src/styles/components.css', import.meta.url), 'utf8');

describe('segmented fit fallback', () => {
  const labelSets = [
    ['On', 'Off'],
    ['0.5x', '1x', '2x'],
    ['Leader', 'Follower', 'Candidate'],
    ['Requirements', 'Data model', 'API', 'Scaling', 'Tradeoffs'],
    Array.from({ length: 12 }, (_, i) => `Option number ${i}`),
  ];

  it('rounds every width up to a bucket that the CSS defines', () => {
    for (const labels of labelSets) {
      const bucket = segmentedFitBucket(labels);
      if (bucket === 'max') {
        expect(segmentedWidthRem(labels)).toBeGreaterThan(48);
        expect(css).toContain('.sdv-segmented[data-fit="max"]');
        continue;
      }
      expect(Number(bucket)).toBeGreaterThanOrEqual(segmentedWidthRem(labels));
      const rule = new RegExp(
        String.raw`@container sdv-seg \(width < ${bucket}rem\) \{\s*\.sdv-segmented\[data-fit="${bucket}"\]`,
      );
      expect(css).toMatch(rule);
    }
  });

  it('grows the bucket with the label text', () => {
    expect(Number(segmentedFitBucket(['A', 'B']))).toBeLessThan(
      Number(segmentedFitBucket(['Alpha', 'Bravo', 'Charlie'])),
    );
  });
});
