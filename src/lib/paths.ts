const base = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Prefix an absolute site path with the deploy base, e.g. "/scaling/" -> "/system-design-visual/scaling/". */
export function withBase(path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Link to a lesson page by its curriculum id. */
export function lessonHref(id: string): string {
  return withBase(`/${id}/`);
}
