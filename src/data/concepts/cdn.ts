import type { Concept } from './types';

const cdn: Concept = {
  slug: 'cdn',
  group: 'traffic',
  title: 'CDN',
  definition:
    'A content delivery network (CDN) keeps copies of files on servers around the world, so users download from a nearby one.',
  analogy:
    'a bestseller stocked in every town library, so readers borrow it nearby instead of from the publisher.',
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
  steps: [
    'A user’s request goes to the nearest edge server.',
    'On a miss, the edge fetches the file from the origin.',
    'The edge keeps the copy until its TTL expires.',
    'Later nearby users get the file from the edge.',
  ],
  example: {
    title: 'A page with 4 round trips',
    lines: [
      'From the origin in Virginia: 4 × 250 ms = 1,000 ms.',
      'From an edge in Nairobi: 4 × 10 ms = 40 ms.',
      'The origin sends one copy per edge.',
    ],
  },
  variants: [
    {
      name: 'Pull',
      caption: 'An edge fetches a file on first request, then keeps it.',
      description: 'A user asks the edge for a file. The edge fetches it from the origin once and keeps it.',
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
  tradeoffs: {
    useWhen: 'you serve images, video or scripts to users far from your servers.',
    costs: 'money, and stale files until a purge or the TTL runs out.',
    realExample: 'images on a news site, or video streaming.',
    watchOut: 'never cache personal pages, like a cart, or users may see each other’s data.',
  },
  quiz: [
    {
      id: 'concepts/cdn/q1',
      prompt: 'You fixed app.js, but users still get the old file from the CDN. What is the usual fix?',
      options: [
        {
          text: 'Restart the origin server',
          why: 'The edges keep their copies until the TTL expires. A restart never reaches them.',
        },
        {
          text: 'Publish it under a new name, like app.v2.js',
          correct: true,
          why: 'A new URL is a new cache entry, so every edge fetches the fixed file. Purging the old URL also works.',
        },
        {
          text: 'Move the origin closer to users',
          why: 'Distance does not change which copy the edges hold.',
        },
      ],
    },
    {
      id: 'concepts/cdn/q2',
      prompt:
        'An edge caches logo.png for 1 hour. You replace it at the origin. How long can users see the old logo?',
      options: [
        {
          text: 'Up to 1 hour',
          correct: true,
          why: 'The edge serves its copy until the TTL runs out, unless you purge it first.',
        },
        {
          text: 'Not at all',
          why: 'The edge does not check the origin on every request. That is what saves the trip.',
        },
        {
          text: 'Until the edge server restarts',
          why: 'The TTL decides when the copy expires.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#content-delivery-network',
      label: 'Content delivery network',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#content-delivery-network-cdn',
      label: 'Content Delivery Network (CDN)',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/what-is-cdn-content-delivery-network/',
      label: 'What is a CDN?',
    },
  ],
};

export default cdn;
