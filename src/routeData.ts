import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data';
import { coursePath } from './data/coursePath';
import { withBase } from './lib/paths';

type SidebarEntry = StarlightRouteData['sidebar'][number];

/** Starlight's trailing slash setting appends "/" after a hash, which breaks in-page anchors. */
function fixHashLinks(entries: SidebarEntry[]): void {
  for (const entry of entries) {
    if (entry.type === 'group') fixHashLinks(entry.entries);
    else entry.href = entry.href.replace(/(#[^#/]+)\/$/, '$1');
  }
}

/**
 * Previous and next links follow the learning path (intro pages, then ready
 * lessons) so pagination never lands on a "Coming soon" placeholder.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  fixHashLinks(route.sidebar);
  const index = coursePath.findIndex((page) => page.id === route.id);
  if (index === -1) return;
  const toLink = (page: (typeof coursePath)[number] | undefined) =>
    page && {
      type: 'link' as const,
      label: page.title,
      href: withBase(`/${page.id}/`),
      isCurrent: false,
      badge: undefined,
      attrs: {},
    };
  route.pagination = {
    prev: toLink(coursePath[index - 1]),
    next: toLink(coursePath[index + 1]),
  };
});
