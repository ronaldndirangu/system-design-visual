import type { ConceptScene } from '../parts';

/**
 * One lazy loader per concept slug. Each page awaits only its own scene module, so adding a
 * concept never grows another page's bundle. Register a scene with one line here.
 */
const sceneLoaders: Record<string, () => Promise<{ default: ConceptScene }>> = {
  'load-balancer': () => import('./load-balancer'),
  cache: () => import('./cache'),
  cdn: () => import('./cdn'),
};

export function hasScene(slug: string): boolean {
  return slug in sceneLoaders;
}

export async function loadScene(slug: string): Promise<ConceptScene> {
  const load = sceneLoaders[slug];
  if (!load)
    throw new Error(`no scene registered for concept "${slug}" in components/concepts/scenes/index.ts`);
  return (await load()).default;
}
