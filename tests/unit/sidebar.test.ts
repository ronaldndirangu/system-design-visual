import { describe, expect, it } from 'vitest';
import { concepts } from '../../src/data/concepts';
import { curriculum } from '../../src/data/curriculum';
import { buildSidebar } from '../../src/data/sidebar';

type Items = ReturnType<typeof buildSidebar>;

function slugs(items: Items): string[] {
  return items.flatMap((item) => ('slug' in item ? [item.slug] : slugs(item.items)));
}

function group(items: Items, label: string): Items {
  const found = items.find((item) => 'items' in item && item.label === label);
  if (!found || !('items' in found)) throw new Error(`Missing navigation group: ${label}`);
  return found.items;
}

describe('lean course navigation', () => {
  it('lists every destination once and limits the top level to seven entries', () => {
    const sidebar = buildSidebar();
    const links = slugs(sidebar);
    expect(new Set(links).size).toBe(links.length);
    expect(sidebar.length).toBeLessThanOrEqual(7);
    for (const entry of concepts) expect(links).toContain(`concepts/${entry.slug}`);
    for (const module of curriculum) {
      for (const lesson of module.lessons) expect(links).toContain(lesson.id);
    }
  });

  it('keeps summaries and checkpoints with their own module', () => {
    const modules = group(buildSidebar(), 'Course lessons');
    for (const module of curriculum) {
      const links = slugs(group(modules, `${module.number}. ${module.title}`));
      expect(links).toContain(`cheat-sheets/${module.id}`);
      expect(links).toContain(`checkpoints/${module.id}`);
    }
    expect(slugs(group(modules, '8. Practice'))).toContain('topics');
  });

  it('reserves quick reference for definitions, estimates and diagram symbols', () => {
    const links = slugs(group(buildSidebar(), 'Quick reference'));
    expect(links).toEqual(['glossary', 'reference', 'visual-language']);
    expect(links).not.toContain('topics');
    expect(links).not.toContain('review');
  });
});
