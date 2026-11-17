import type { Concept } from './types';

const rateLimiting: Concept = {
  slug: 'rate-limiting',
  group: 'traffic',
  title: 'Rate limiting',
  definition:
    'Rate limiting caps how many requests each client may send per second or minute, and rejects the rest.',
  analogy: 'a ticket booth that hands out 5 tickets a second: no ticket, no entry.',
  lesson: 'reliability/rate-limiting',
  illustrative: false,
  labels: {
    client: 'Client',
    server: 'Server',
    bucket: 'Tokens',
    rejected: '429',
    refill: '+5/s',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without rate limiting',
      description:
        'A client sends a burst of 8 requests at once. The server tries to handle them all, overloads, and starts failing for everyone.',
      captions: [
        'A burst of requests arrives at once',
        'The server tries to handle them all',
        'It overloads and fails for everyone',
      ],
    },
    with: {
      label: 'With',
      title: 'With a token bucket',
      description:
        'A bucket holds 5 tokens. Each request takes one token and passes to the server. The last 3 requests of the burst find the bucket empty and get a 429 Too Many Requests reply. Then the bucket refills at 5 tokens a second.',
      captions: [
        'Each request takes a token from the bucket',
        'No token left: the extras get 429',
        'Tokens refill at 5 a second',
      ],
    },
  },
  steps: [
    'Each client gets a bucket of tokens, here up to 5.',
    'Each request takes one token and goes through.',
    'An empty bucket means the reply is 429 Too Many Requests.',
    'Tokens refill at a steady rate: 5 a second.',
  ],
  example: {
    title: 'A bucket of 5 that refills at 5 a second',
    lines: [
      'A burst of 8 arrives at once: 5 pass and the other 3 get 429.',
      'In any 60 s, at most 5 + 5 × 60 = 305 pass.',
      'A steady 5 a second never sees a 429.',
    ],
  },
  variants: [
    {
      name: 'Token bucket',
      caption: 'Allows short bursts up to the bucket size.',
      description: 'A bucket of tokens refills at a steady rate. Bursts pass until the bucket runs dry.',
      labels: { refill: '+5/s' },
    },
    {
      name: 'Fixed window',
      caption: 'Bursts on both sides of a window edge can double the limit.',
      description:
        'A timeline split into one minute windows, each allowing 100 requests. 100 arrive just before the minute ends and 100 just after, so 200 pass within seconds.',
      labels: { edge: '1:00', count: '100' },
    },
    {
      name: 'Sliding window',
      caption: 'Counts the last 60 s, so edge bursts get caught.',
      description:
        'A one minute window slides along the timeline and counts every request inside it, so a burst across the edge of a minute is still limited to 100.',
      labels: { window: 'Last 60 s' },
    },
  ],
  tradeoffs: {
    useWhen: 'you run a public API or a login form.',
    costs: 'servers must share counters, and real users can be blocked at peaks.',
    realExample: 'GitHub’s REST API allows 5,000 requests an hour per signed-in user.',
    watchOut: 'many people share one IP, so limit by user or API key.',
  },
  quiz: [
    {
      id: 'concepts/rate-limiting/q1',
      prompt: 'A full bucket holds 5 tokens, and 8 requests arrive at once. What happens?',
      options: [
        {
          text: 'All 8 wait for tokens',
          why: 'The limiter answers at once. The extras get 429 and may retry later.',
        },
        { text: 'All 8 pass', why: 'The bucket holds only 5 tokens, so only 5 can pass right away.' },
        {
          text: '5 pass and 3 get 429',
          correct: true,
          why: 'Each of the first 5 takes a token. The bucket is empty for the other 3.',
        },
      ],
    },
    {
      id: 'concepts/rate-limiting/q2',
      prompt: 'A fixed window allows 100 a minute. 100 arrive at 0:59 and 100 at 1:00. How many pass?',
      ordered: true,
      options: [
        { text: '100', why: 'The second 100 fall in a new window with a fresh count.' },
        { text: '150', why: 'Each window counts on its own, so neither batch is cut.' },
        {
          text: '200',
          correct: true,
          why: 'Each batch fits its own window, so all 200 pass in about one second.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#rate-limiting',
      label: 'Rate Limiting',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/what-does-api-gateway-do/',
      label: 'What Does an API Gateway Do?',
    },
  ],
};

export default rateLimiting;
