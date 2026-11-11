import { curriculum } from './curriculum';

/** Matches Starlight's sidebar item shapes without importing its internal types. */
type SidebarItem =
  | { slug: string; label?: string }
  | { label: string; collapsed?: boolean; items: SidebarItem[] };

/**
 * The sidebar mirrors the curriculum: one group per module listing every
 * lesson. `slug` items make the build fail if a lesson has no page.
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

  const modules = curriculum.map(
    (module): SidebarItem => ({
      label: `${module.number}. ${module.title}`,
      items: module.lessons.map((lesson) => ({ slug: lesson.id, label: lesson.title })),
    }),
  );

  return [start, ...modules];
}
