import { describe, expect, it } from 'vitest';
import { scopeFromChanges } from '../../scripts/e2e-scope';

const sources: Record<string, string> = {
  'src/content/docs/index.mdx': "import Hero from '../../components/landing/Hero';",
  'src/content/docs/scaling/caching.mdx': [
    "import Quiz from '../../../components/lesson/Quiz';",
    "import CacheWidget from '../../../components/widgets/CacheWidget';",
  ].join('\n'),
  'src/content/docs/reliability/queues.mdx':
    "import QueueWidget from '../../../components/widgets/QueueWidget';",
  'src/content/docs/404.mdx': "import Lost from '../../components/widgets/LostWidget';",
  'src/components/landing/Hero.tsx': "import { flow } from '../../lib/models/flow';",
  'src/components/lesson/Quiz.tsx': "import { motion } from 'motion/react';",
  'src/components/sim/SimShell.tsx': '',
  'src/components/widgets/CacheWidget.tsx': [
    "import { SimShell } from '../sim/SimShell';",
    "import { cacheModel } from '../../lib/models/cache';",
  ].join('\n'),
  'src/components/widgets/QueueWidget.tsx': [
    "import { queueModel } from '../../lib/models/queue';",
    "const scene = () => import('../physics/QueueScene');",
  ].join('\n'),
  'src/components/widgets/LostWidget.tsx': '',
  'src/components/physics/QueueScene.ts': "import { rng } from '../../lib/models/rng';",
  'src/lib/models/cache.ts': "import { rng } from './rng';",
  'src/lib/models/queue.ts': '',
  'src/lib/models/rng.ts': '',
  'src/lib/models/flow.ts': '',
  'src/data/curriculum.ts': '',
};

const specs: Record<string, string> = {
  'tests/e2e/site.spec.ts': '',
  'tests/e2e/hydration.spec.ts': "await page.goto('scaling/caching/');",
  'tests/e2e/scaling.spec.ts': "await page.goto('scaling/caching/');",
  'tests/e2e/reliability.spec.ts': "for (const id of ids) await page.goto('reliability/' + id + '/');",
  'tests/e2e/thinking.spec.ts': "await page.goto('thinking/requirements/');",
};

const always = ['tests/e2e/hydration.spec.ts', 'tests/e2e/site.spec.ts'];

describe('scopeFromChanges', () => {
  it('maps a changed lesson page to itself and the specs for its module', () => {
    expect(scopeFromChanges(['src/content/docs/scaling/caching.mdx'], sources, specs)).toEqual({
      mode: 'pr',
      pages: ['scaling/caching/'],
      specs: [...always, 'tests/e2e/scaling.spec.ts'].sort(),
    });
  });

  it('maps a model change through every widget that imports it, directly or not', () => {
    expect(scopeFromChanges(['src/lib/models/rng.ts'], sources, specs)).toMatchObject({
      mode: 'pr',
      pages: ['reliability/queues/', 'scaling/caching/'],
    });
  });

  it('follows dynamic imports of physics scenes to their lesson', () => {
    expect(scopeFromChanges(['src/components/physics/QueueScene.ts'], sources, specs)).toEqual({
      mode: 'pr',
      pages: ['reliability/queues/'],
      specs: [...always, 'tests/e2e/reliability.spec.ts'].sort(),
    });
  });

  it('adds a changed spec and skips unit tests, root docs, and the curriculum data', () => {
    const changed = [
      'tests/e2e/thinking.spec.ts',
      'tests/unit/cache.test.ts',
      'README.md',
      'src/data/curriculum.ts',
    ];
    expect(scopeFromChanges(changed, sources, specs)).toEqual({
      mode: 'pr',
      pages: [],
      specs: [...always, 'tests/e2e/thinking.spec.ts'].sort(),
    });
  });

  it.each([
    ['a shared simulation component', 'src/components/sim/SimShell.tsx'],
    ['a model that the landing page uses', 'src/lib/models/flow.ts'],
    ['a widget on the 404 page', 'src/components/widgets/LostWidget.tsx'],
    ['a config file', 'astro.config.mjs'],
    ['the lockfile', 'pnpm-lock.yaml'],
    ['the always run site spec', 'tests/e2e/site.spec.ts'],
    ['a deleted spec', 'tests/e2e/removed.spec.ts'],
    ['a deleted source file', 'src/components/widgets/Removed.tsx'],
  ])('runs the full suite when a PR changes %s', (_label, file) => {
    expect(scopeFromChanges([file], sources, specs)).toMatchObject({ mode: 'full' });
  });
});
