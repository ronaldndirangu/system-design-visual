/**
 * Core concept pages: one idea, one Without / With picture, a few words.
 * Kept free of imports so scripts/lint-lessons.ts can load it under plain Node.
 * Every string in `states`, `variants` and `labels` shows on screen and counts toward the word budget;
 * `description` fields are for screen readers only.
 */

export type ConceptSlug = 'load-balancer' | 'cache' | 'cdn';
export type ConceptStateId = 'without' | 'with';

export interface ConceptState {
  /** Toggle label. */
  label: string;
  /** Accessible name of the drawing. */
  title: string;
  /** Screen reader description of what the drawing shows. */
  description: string;
  /** Numbered captions drawn on the diagram, at most three. */
  captions: string[];
}

export interface ConceptVariant {
  name: string;
  caption: string;
  /** Screen reader description of the mini diagram. */
  description: string;
  /** Text drawn inside the mini diagram. */
  labels: Record<string, string>;
}

export interface Concept {
  slug: ConceptSlug;
  title: string;
  /** One sentence, at most 25 words. Also the page's meta description. */
  definition: string;
  /** Lesson id for the "Go deeper" link. */
  lesson: string;
  /** Diagram numbers are examples, so the figure says so. */
  illustrative: boolean;
  /** Text drawn inside the main diagram. */
  labels: Record<string, string>;
  states: Record<ConceptStateId, ConceptState>;
  variants: ConceptVariant[];
}

export const CONCEPT_WORD_BUDGET = 200;
export const DEFINITION_WORD_LIMIT = 25;
export const VARIANT_CAPTION_WORD_LIMIT = 12;
export const ILLUSTRATIVE_NOTE = 'Numbers are illustrative.';

export const concepts: Concept[] = [
  {
    slug: 'load-balancer',
    title: 'Load balancer',
    definition:
      'A load balancer spreads incoming requests across several servers and stops sending them to a server that fails.',
    lesson: 'scaling/load-balancing',
    illustrative: false,
    labels: { users: 'Users', server: 'Server', balancer: 'Balancer', a: 'A', b: 'B', c: 'C' },
    states: {
      without: {
        label: 'Without',
        title: 'Without a load balancer',
        description:
          'Users send every request to one server. Its load gauge fills to red, the server shows a warning, and extra requests are dropped.',
        captions: ['Every request goes to one server', 'It fills up', 'Extra requests get dropped'],
      },
      with: {
        label: 'With',
        title: 'With a load balancer',
        description:
          'Users send requests to a load balancer, which passes them in turn to servers A, B and C, and responses flow back. Server B fails. Health checks notice, and the balancer sends new requests only to A and C.',
        captions: [
          'The balancer spreads requests',
          'Server B fails',
          'Health checks catch it; traffic skips B',
        ],
      },
    },
    variants: [
      {
        name: 'Take turns vs least busy',
        caption: 'Turns ignore speed; least busy sends a slow server fewer requests.',
        description:
          'Left: the balancer gives three servers equal turns and the slow server builds a queue. Right: the balancer sends the slow server fewer requests, so no queue builds.',
        labels: { turns: 'Turns', busy: 'Least busy' },
      },
      {
        name: 'Layer 4 vs Layer 7',
        caption: 'Layer 4 routes by address and port; Layer 7 reads the URL.',
        description:
          'Left: a Layer 4 balancer forwards connections to any server by address and port. Right: a Layer 7 balancer sends paths starting with /images to image servers and /api to API servers.',
        labels: { l4: 'L4', l7: 'L7', images: '/images', api: '/api' },
      },
      {
        name: 'Active-passive vs active-active',
        caption: 'A standby balancer takes over, or both balancers share the load.',
        description:
          'Left: one balancer handles traffic while a second waits on standby. Right: two balancers both handle traffic and cover for each other.',
        labels: { standby: 'Standby' },
      },
    ],
  },
  {
    slug: 'cache',
    title: 'Cache',
    definition:
      'A cache keeps a copy of often-read data in fast memory, so repeat reads skip the slower database.',
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
  },
  {
    slug: 'cdn',
    title: 'CDN',
    definition:
      'A content delivery network (CDN) keeps copies of files on servers around the world, so users download from a nearby one.',
    lesson: 'scaling/cdn',
    illustrative: true,
    labels: {
      origin: 'Origin',
      edge: 'Edge',
      users: 'Users',
      virginia: 'Virginia',
      nairobi: 'Nairobi',
      far: '250 ms',
      near: '10 ms',
    },
    states: {
      without: {
        label: 'Without',
        title: 'Without a CDN',
        description:
          'Users in Nairobi fetch a file from the origin server in Virginia, United States. Each round trip takes about 250 milliseconds, and the origin sends every copy.',
        captions: [
          'Every user fetches from Virginia',
          'Each round trip takes about 250 ms',
          'The origin sends every copy',
        ],
      },
      with: {
        label: 'With',
        title: 'With a CDN',
        description:
          'The first request from Nairobi reaches a nearby edge server, which fetches the file from the origin in Virginia and keeps a copy. Later users get the file from the edge in about 10 milliseconds.',
        captions: [
          'First request: the edge fetches from the origin',
          'The edge keeps a copy',
          'Later users get it nearby in about 10 ms',
        ],
      },
    },
    variants: [
      {
        name: 'Pull',
        caption: 'An edge fetches a file on first request, then keeps it.',
        description:
          'A user asks the edge for a file. The edge fetches it from the origin once and keeps it.',
        labels: {},
      },
      {
        name: 'Push',
        caption: 'You upload files to the CDN before anyone asks for them.',
        description:
          'You upload files from the origin to the CDN ahead of time. Users then fetch them from the edge.',
        labels: { upload: 'Upload' },
      },
    ],
  },
];

export type LabelReader = (key: string) => string;

/** Reads a drawn label by key, so a renamed key fails the build instead of drawing nothing. */
export function labelReader(labels: Record<string, string> = {}): LabelReader {
  return (key) => {
    const text = labels[key];
    if (text === undefined) throw new Error(`missing label "${key}"`);
    return text;
  };
}

export function concept(slug: ConceptSlug): Concept {
  const found = concepts.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`unknown concept "${slug}"`);
  return found;
}

/** Every string a concept draws or labels on screen, for the word budget. */
export function conceptScreenText(entry: Concept): string[] {
  return [
    entry.definition,
    ...Object.values(entry.labels),
    ...Object.values(entry.states).flatMap((state) => [state.label, ...state.captions]),
    ...entry.variants.flatMap((variant) => [variant.name, variant.caption, ...Object.values(variant.labels)]),
    ...(entry.illustrative ? [ILLUSTRATIVE_NOTE] : []),
  ];
}
