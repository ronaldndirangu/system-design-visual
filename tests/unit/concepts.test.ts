import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasScene, loadScene } from '../../src/components/concepts/scenes';
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
