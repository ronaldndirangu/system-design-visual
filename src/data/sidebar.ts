import { curriculum } from './curriculum';

/** Matches Starlight's sidebar item shapes without importing its internal types. */
type SidebarItem =
  | { slug: string; label?: string }
  | { label: string; collapsed?: boolean; items: SidebarItem[] };

/**
 * The sidebar mirrors the curriculum: one group per module listing every
 * lesson, then its checkpoint. `slug` items make the build fail if a page is missing.
 */
export function buildSidebar(): SidebarItem[] {
  const start: SidebarItem = {
    label: 'Start here',
    items: [
      { slug: 'start-here', label: 'How this course works' },
      { slug: 'curriculum', label: 'Course map' },
      { slug: 'visual-language', label: 'Visual language' },
      { slug: 'reference', label: 'Reference sheet' },
    ],
  };

  const review: SidebarItem = {
    label: 'Review and reference',
    items: [
      { slug: 'review', label: 'Review queue' },
      { slug: 'glossary', label: 'Glossary' },
      { slug: 'topics', label: 'Interview topics' },
      {
        label: 'Cheat sheets',
        collapsed: true,
        items: curriculum.map((module) => ({
          slug: `cheat-sheets/${module.id}`,
          label: `${module.number}. ${module.title}`,
        })),
      },
    ],
  };

  const modules = curriculum.map(
    (module): SidebarItem => ({
      label: `${module.number}. ${module.title}`,
      collapsed: true,
      items: [
        ...module.lessons.map((lesson) => ({ slug: lesson.id, label: lesson.title })),
        { slug: `checkpoints/${module.id}`, label: 'Module checkpoint' },
      ],
    }),
  );

  return [start, review, ...modules];
}
