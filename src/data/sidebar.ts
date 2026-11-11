import { anchorFor, curriculum } from './curriculum';

type Badge = { text: string; variant: 'note' | 'tip' | 'caution' | 'default' };

/** Matches Starlight's sidebar item shapes without importing its internal types. */
type SidebarItem =
  | { slug: string; label?: string }
  | { label: string; link: string; badge?: Badge }
  | { label: string; collapsed?: boolean; items: SidebarItem[] };

/**
 * The sidebar mirrors the curriculum: modules with built lessons list them,
 * and unbuilt lessons collapse into one "Coming soon" link per module.
 * `slug` items make the build fail if a ready lesson has no page.
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

  const modules = curriculum.map((module): SidebarItem => {
    const label = `${module.number}. ${module.title}`;
    const ready = module.lessons.filter((lesson) => lesson.status === 'ready');
    const upcoming = module.lessons.length - ready.length;
    const mapLink = `/curriculum/#${anchorFor(module.id)}`;

    if (ready.length === 0) {
      return { label, link: mapLink, badge: { text: 'Soon', variant: 'default' } };
    }
    const items: SidebarItem[] = ready.map((lesson) => ({ slug: lesson.id, label: lesson.title }));
    if (upcoming > 0) {
      items.push({
        label: 'Coming soon',
        link: mapLink,
        badge: { text: `+${upcoming}`, variant: 'default' },
      });
    }
    return { label, items };
  });

  return [start, ...modules];
}
