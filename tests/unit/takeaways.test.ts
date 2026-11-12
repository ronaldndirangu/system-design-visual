import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractTakeaways, inlineMarkdown } from '../../src/lib/takeaways';

describe('extractTakeaways', () => {
  it('returns one string per bullet and joins wrapped lines', () => {
    const source = [
      '<KeyTakeaways>',
      '',
      '- First point.',
      '- Second point that',
      '  wraps onto a new line.',
      '',
      '</KeyTakeaways>',
    ].join('\r\n');
    expect(extractTakeaways(source)).toEqual(['First point.', 'Second point that wraps onto a new line.']);
  });

  it('returns nothing for a page without takeaways', () => {
    expect(extractTakeaways('## Heading\n\n- a list outside the block')).toEqual([]);
  });

  it('reads the bullets from a real lesson', () => {
    const lesson = readFileSync(
      fileURLToPath(new URL('../../src/content/docs/scaling/caching.mdx', import.meta.url)),
      'utf8',
    );
    expect(extractTakeaways(lesson).length).toBeGreaterThanOrEqual(3);
  });
});

describe('inlineMarkdown', () => {
  it('keeps code, bold, and italics and drops link targets', () => {
    expect(inlineMarkdown('Use `GET`, **always**, *then* see [replicas](../read-replicas/).')).toBe(
      'Use <code>GET</code>, <strong>always</strong>, <em>then</em> see replicas.',
    );
  });

  it('escapes HTML', () => {
    expect(inlineMarkdown('p99 < 200 ms & "fast"')).toBe('p99 &lt; 200 ms &amp; &quot;fast&quot;');
  });
});
