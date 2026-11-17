import type { Concept } from './types';

const retries: Concept = {
  slug: 'retries',
  group: 'reliability',
  title: 'Retries',
  definition:
    'A retry resends a request that failed or timed out, pausing longer and a bit randomly each time so the service can recover.',
  analogy: 'calling a busy friend: hang up after a few rings, then wait longer before each new try.',
  lesson: 'reliability/retries',
  illustrative: true,
  labels: {
    apps: 'Apps',
    service: 'Service',
    a: 'App A',
    b: 'App B',
    w1: '1 s',
    w2: '2 s',
    w4: '4 s',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without backoff',
      description:
        'Two apps call a struggling service. Each try times out after 2 seconds, and both apps retry at once, at the same moments, with no pause. Waves of retries keep the service overloaded for the whole 15 seconds.',
      captions: [
        'Failed tries are retried at once',
        'Both apps retry in lockstep',
        'Retry waves keep the service down',
      ],
    },
    with: {
      label: 'With',
      title: 'With timeouts, backoff and jitter',
      description:
        'Each try times out after 2 seconds. App A pauses 1, then 2, then 4 seconds before its retries, which start at 3, 7 and 13 seconds. App B pauses random, shorter amounts, so its tries land at other times. The quieter service recovers, and each app’s fourth try succeeds.',
      captions: [
        'Each try gives up after 2 s',
        'Pauses double: 1 s, 2 s, 4 s',
        'Jitter spreads retries; the service recovers',
      ],
    },
  },
  steps: [
    'Each try gives up after 2\u00a0s without a reply.',
    'The pause before each retry doubles: 1\u00a0s, 2\u00a0s, 4\u00a0s.',
    'Jitter makes each pause random, so apps stop retrying together.',
    'The service recovers. If not, the app stops after 3 retries.',
  ],
  example: {
    title: 'Worst case: every try times out',
    lines: [
      '4\u00a0tries (1 + 3\u00a0retries) × 2\u00a0s timeout = 8\u00a0s.',
      'Pauses: 1 + 2 + 4 = 7\u00a0s, so retries start at 3, 7 and 13\u00a0s.',
      'The app gives up at 8 + 7 = 15\u00a0s.',
    ],
  },
  variants: [
    {
      name: 'Fixed vs doubling',
      caption: 'Fixed pauses keep the pressure on; doubling backs off.',
      description:
        'Left: tries separated by equal short pauses, so the service gets hit at a steady rate. Right: the pause doubles after each try, so tries thin out over time.',
      labels: { fixed: 'Fixed', doubling: 'Doubling' },
    },
    {
      name: 'Without vs with jitter',
      caption: 'Equal pauses keep apps in step; random pauses spread them.',
      description:
        'Left: three apps retry at exactly the same moments, in lined-up columns. Right: the same three apps pause random amounts, so their retries land at different times.',
      labels: { lockstep: 'Lockstep', jitter: 'Jitter' },
    },
  ],
  tradeoffs: {
    useWhen: 'failures are brief, like a dropped connection.',
    costs: 'extra load, and slower errors when the service is truly down.',
    realExample: 'AWS SDKs retry with exponential backoff and jitter by default.',
    watchOut: 'a retried payment can charge twice unless it is idempotent.',
  },
  quiz: [
    {
      id: 'concepts/retries/q1',
      prompt:
        '10,000 phones fail at once, then all retry after exactly 1\u00a0s, 2\u00a0s and 4\u00a0s. What happens?',
      options: [
        {
          text: 'Retries spread out evenly',
          why: 'Every phone waits the same time, so they stay bunched together.',
        },
        {
          text: 'Retry waves hit the server together',
          correct: true,
          why: 'Identical pauses keep the phones in step. Jitter spreads them out.',
        },
        {
          text: 'The server gets less traffic',
          why: 'Each wave still holds every phone that failed.',
        },
      ],
    },
    {
      id: 'concepts/retries/q2',
      prompt:
        'An app and its service each make up to 3 tries per call. How many database calls can one tap cause?',
      ordered: true,
      options: [
        { text: '3', why: 'Each of the app’s 3 tries can make the service try 3 times.' },
        { text: '6', why: 'Retries multiply across layers: 3 × 3.' },
        {
          text: '9',
          correct: true,
          why: '3 app tries × 3 service tries = 9. Retry in one layer to keep this small.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/how-do-we-retry-on-failures/',
      label: 'Retry strategies',
    },
    {
      course: 'mit',
      href: 'https://pdos.csail.mit.edu/6.824/notes/l-rpc.txt',
      label: 'RPC and failures',
    },
  ],
};

export default retries;
