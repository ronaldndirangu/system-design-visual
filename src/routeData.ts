import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data';
import { type CoursePage, pathNeighbours } from './data/coursePath';
import { findLesson } from './data/curriculum';
import { withBase } from './lib/paths';

type SidebarEntry = StarlightRouteData['sidebar'][number];

/** Starlight's trailing slash setting appends "/" after a hash, which breaks in-page anchors. */
function fixHashLinks(entries: SidebarEntry[]): void {
  for (const entry of entries) {
    if (entry.type === 'group') fixHashLinks(entry.entries);
    else entry.href = entry.href.replace(/(#[^#/]+)\/$/, '$1');
  }
}

/** Lesson completion owns the next action. Lookup pages have no arbitrary sidebar-order pagination. */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  fixHashLinks(route.sidebar);
  route.pagination = { prev: undefined, next: undefined };
  if (!findLesson(route.id)) return;
  const neighbours = pathNeighbours(route.id);
  if (!neighbours) return;
  const toLink = (page: CoursePage | undefined) =>
    page && {
      type: 'link' as const,
      label: page.title,
      href: withBase(`/${page.id}/`),
      isCurrent: false,
      badge: undefined,
      attrs: {},
    };
  route.pagination = {
    prev: toLink(neighbours.prev),
    next: undefined,
  };
});
