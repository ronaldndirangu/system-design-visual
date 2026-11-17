import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dotFrames } from '../../src/components/concepts/player';
import { hasScene, loadScene } from '../../src/components/concepts/scenes';
import { keepNumbersWithWords, keepQuizNumbersWithWords } from '../../src/components/concepts/text';
import { CONCEPT_GROUPS, conceptGroups, concepts } from '../../src/data/concepts';

describe('concept registry', () => {
  it('has unique slugs in known groups, each with an MDX page and a scene', async () => {
    const slugs = concepts.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of concepts) {
      expect(CONCEPT_GROUPS.map((group) => group.id)).toContain(entry.group);
      expect(existsSync(new URL(`../../src/content/docs/concepts/${entry.slug}.mdx`, import.meta.url))).toBe(
        true,
      );
      expect(hasScene(entry.slug), `${entry.slug} scene`).toBe(true);
      const scene = await loadScene(entry.slug);
      expect(scene.variants, `${entry.slug} variant drawings`).toHaveLength(entry.variants.length);
    }
  });

  it('lists only groups that have concepts, in group order', () => {
    const groups = conceptGroups();
    const order = CONCEPT_GROUPS.map((group) => group.id);
    expect(groups.every((group) => group.concepts.length > 0)).toBe(true);
    expect(groups.map((group) => order.indexOf(group.id))).toEqual(
      groups.map((group) => order.indexOf(group.id)).sort((a, b) => a - b),
    );
    expect(groups.flatMap((group) => group.concepts)).toHaveLength(concepts.length);
  });
});

describe('concept player keyframes', () => {
  // Browsers reject keyframes with offsets out of order or outside [0, 1]. On a path of length 3,
  // 0 + (0.1 * 3) / 3 rounds to 0.10000000000000002, and 0.2 + (0.8 * 3) / 3 to 1.0000000000000002.
  it.each(['0 0.1', '0.2 1', '0.5 1.5'])('keeps dot offsets ordered and in range for window %s', (at) => {
    const offsets = dotFrames('0,0 3,0', at).map((frame) => frame.offset ?? 0);
    expect(offsets.every((offset) => offset >= 0 && offset <= 1)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe('concept text', () => {
  it('keeps each number on the same line as the word after it', () => {
    expect(keepNumbersWithWords('Each round trip takes about 250 ms')).toBe(
      'Each round trip takes about 250\u00a0ms',
    );
    expect(keepNumbersWithWords('4 × 250 ms = 1,000 ms.')).toBe('4\u00a0× 250\u00a0ms = 1,000\u00a0ms.');
    expect(keepNumbersWithWords('Server B fails')).toBe('Server B fails');
  });

  it('keeps numbers with their words across a concept quiz without touching the source', () => {
    const source = [
      {
        id: 'concepts/demo/q1',
        prompt: 'A server handles 500 requests a second.',
        options: [{ text: '2 servers', correct: true, why: 'Each takes 250 requests.' }],
      },
    ];
    const [question] = keepQuizNumbersWithWords(source);
    expect(question?.prompt).toBe('A server handles 500\u00a0requests a second.');
    expect(question?.options[0]).toEqual({
      text: '2\u00a0servers',
      correct: true,
      why: 'Each takes 250\u00a0requests.',
    });
    expect(source[0]?.prompt).toBe('A server handles 500 requests a second.');
  });
});
