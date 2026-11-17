import type { ComponentType } from 'react';
import type { ConceptSlug, ConceptStateId } from '../../data/concepts';
import { CacheWith, CacheWithout } from './CacheScene';
import { CdnWith, CdnWithout } from './CdnScene';
import { LoadBalancerWith, LoadBalancerWithout } from './LoadBalancerScene';
import type { SceneProps } from './parts';

export const scenes: Record<ConceptSlug, Record<ConceptStateId, ComponentType<SceneProps>>> = {
  'load-balancer': { without: LoadBalancerWithout, with: LoadBalancerWith },
  cache: { without: CacheWithout, with: CacheWith },
  cdn: { without: CdnWithout, with: CdnWith },
};
