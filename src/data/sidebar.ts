import { conceptGroups } from './concepts';
import { curriculum } from './curriculum';

/** Matches Starlight's sidebar item shapes without importing its internal types. */
type SidebarItem =
  | { slug: string; label?: string }
  | { label: string; collapsed?: boolean; items: SidebarItem[] };

/** Slug entries keep navigation checked against published pages at build time. */
export function buildSidebar(): SidebarItem[] {
  const core: SidebarItem = {
    label: 'Core concepts',
    collapsed: true,
    items: [
      { slug: 'concepts', label: 'All concepts' },
      ...conceptGroups().map((group) => ({
        label: group.title,
        collapsed: true,
        items: group.concepts.map((entry) => ({ slug: `concepts/${entry.slug}`, label: entry.title })),
      })),
    ],
  };

  const reference: SidebarItem = {
    label: 'Quick reference',
    collapsed: true,
    items: [
      { slug: 'glossary', label: 'Glossary' },
      { slug: 'reference', label: 'Estimation reference' },
      { slug: 'visual-language', label: 'Diagram key' },
    ],
  };

  const modules = curriculum.map(
    (module): SidebarItem => ({
      label: `${module.number}. ${module.title}`,
      collapsed: true,
      items: [
        ...(module.id === 'practice' ? [{ slug: 'topics', label: 'Interview preparation' }] : []),
        ...module.lessons.map((lesson) => ({ slug: lesson.id, label: lesson.title })),
        { slug: `cheat-sheets/${module.id}`, label: 'Module summary' },
        { slug: `checkpoints/${module.id}`, label: 'Module checkpoint' },
      ],
    }),
  );

  return [
    { slug: 'start-here', label: 'Start here' },
    { slug: 'journeys', label: 'Learning paths' },
    { slug: 'curriculum', label: 'Course map' },
    { slug: 'review', label: 'Review queue' },
    core,
    { label: 'Course lessons', collapsed: true, items: modules },
    reference,
  ];
}
