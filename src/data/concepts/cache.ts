import type { Concept } from './types';

const cache: Concept = {
  slug: 'cache',
  group: 'speed',
  title: 'Cache',
  definition:
    'A cache keeps a copy of often-read data in fast memory, so repeat reads skip the slower database.',
  analogy: 'keeping the snacks you eat most in your desk drawer, so you rarely walk to the kitchen.',
  lesson: 'scaling/caching',
  illustrative: true,
  labels: { app: 'App', cache: 'Cache', database: 'Database', slow: '10 ms', fast: '1 ms', hits: 'Hits' },
  states: {
    without: {
      label: 'Without',
      title: 'Without a cache',
      description:
        'The app sends every read to the database and waits about 10 milliseconds each time, even for the same data.',
      captions: [
        'Every read goes to the database',
        'Each read waits about 10 ms',
        'The database repeats the same work',
      ],
    },
    with: {
      label: 'With',
      title: 'With a cache',
      description:
        'The first read misses the cache, goes to the database, and the app stores a copy in the cache. The next reads hit the cache in about 1 millisecond, and the hit counter rises to 3.',
      captions: [
        'First read misses, then fills the cache',
        'Repeat reads hit in about 1 ms',
        'The database gets fewer reads',
      ],
    },
  },
  steps: [
    'The app asks the cache first.',
    'On a miss, it reads the database and stores a copy in the cache.',
    'Repeat reads hit the cache and skip the database.',
    'Each copy expires after its time to live (TTL), so the next read fetches fresh data.',
  ],
  example: {
    title: 'A busy product page',
    lines: [
      'A cache hit takes 1\u00a0ms. A miss checks the cache, then the database: 11\u00a0ms.',
      'With 90% hits: 0.9 × 1 + 0.1 × 11 = 2\u00a0ms on average.',
      'Without the cache every read takes 10\u00a0ms, so reads get 5\u00a0times faster.',
    ],
  },
  variants: [
    {
      name: 'Cache-aside',
      caption: 'On a miss, the app reads the database and fills the cache.',
      description:
        'The app asks the cache first. On a miss it reads the database, then writes the value into the cache.',
      labels: {},
    },
    {
      name: 'Write-through',
      caption: 'Each write updates the cache and database before it reports success.',
      description:
        'The app writes to the cache and the database, and the write finishes only when both have it.',
      labels: {},
    },
    {
      name: 'Write-behind',
      caption: 'The database updates later; a cache crash can lose pending writes.',
      description: 'The app writes to the cache, which passes the writes to the database later in a batch.',
      labels: { later: 'Later' },
    },
  ],
  tradeoffs: {
    useWhen: 'the same data is read far more often than it changes.',
    costs: 'stale data, work to clear old copies, and extra memory.',
    realExample: 'a popular product page.',
    watchOut: 'if many copies expire at once, every read hits the database together.',
  },
  quiz: [
    {
      id: 'concepts/cache/q1',
      prompt:
        'A price changes in the database, but the product page shows the old price for another minute. Why?',
      options: [
        {
          text: 'The database write failed',
          why: 'The database holds the new price. Reads skip it while the cached copy stays fresh.',
        },
        {
          text: 'The cache is too small',
          why: 'A full cache evicts entries, which causes misses. Misses read the new price.',
        },
        {
          text: 'The cache serves its old copy until the TTL expires',
          correct: true,
          why: 'Reads hit the cached copy. Delete it when the price changes, or use a shorter TTL.',
        },
      ],
    },
    {
      id: 'concepts/cache/q2',
      prompt: 'Your cache answers 90% of reads. What share of reads still reach the database?',
      ordered: true,
      options: [
        { text: '1%', why: 'Every miss goes to the database, and 10% of reads miss.' },
        { text: '10%', correct: true, why: 'The 10% of reads that miss go on to the database.' },
        { text: '50%', why: 'Only misses reach the database. At 90% hits, that is 10% of reads.' },
        { text: '90%', why: 'That is the share the cache answers. The rest, 10%, reach the database.' },
      ],
    },
  ],
  learnMore: [
    { course: 'primer', href: 'https://github.com/donnemartin/system-design-primer#cache', label: 'Cache' },
    { course: 'karan', href: 'https://github.com/karanpratapsingh/system-design#caching', label: 'Caching' },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/top-5-caching-strategies/',
      label: 'Top 5 caching strategies',
    },
  ],
};

export default cache;
