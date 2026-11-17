import type { Concept } from './types';

const circuitBreaker: Concept = {
  slug: 'circuit-breaker',
  group: 'reliability',
  title: 'Circuit breaker',
  definition:
    'A circuit breaker stops calls to a failing service for a while, so callers fail fast and the service can recover.',
  analogy: 'a fuse box breaker: it trips on a fault, and later you flip it back to test the wiring.',
  lesson: 'reliability/circuit-breakers',
  illustrative: true,
  labels: {
    users: 'Users',
    app: 'App',
    service: 'Service',
    waiting: 'Waiting',
    breaker: 'Breaker',
    closed: 'Closed',
    open: 'Open',
    half: 'Half-open',
    fails: '5 failures',
    cooldown: 'Cooldown',
    trial: 'Trial OK',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without a circuit breaker',
      description:
        'Users call an app, and the app calls a service that has failed. Every call waits for a timeout. Waiting calls pile up and fill the app, so users start getting errors too.',
      captions: [
        'The service fails; calls keep coming',
        'Each call waits for a timeout',
        'Waiting calls fill the app; users get errors',
      ],
    },
    with: {
      label: 'With',
      title: 'With a circuit breaker',
      description:
        'The app calls a service through a breaker. Five calls fail, and the breaker moves from closed to open. While open, calls fail at once without reaching the service. After a cooldown the breaker goes half-open and lets one trial call through. It succeeds, so the breaker closes again.',
      captions: [
        'After 5 failures, the breaker opens',
        'While open, calls fail fast',
        'After a cooldown, one trial call tests it',
      ],
    },
  },
  steps: [
    'Closed: calls pass through, and the breaker counts failures.',
    'After 5 failures in a row, it opens: calls fail at once.',
    'After a cooldown, it goes half-open and lets one trial call through.',
    'A good trial closes it; a failed one reopens it.',
  ],
  example: {
    title: 'A dead service and a 2\u00a0s timeout',
    lines: [
      'Without a breaker: 100\u00a0calls/s × 2\u00a0s = 200\u00a0calls waiting at any moment.',
      'With one, a 30\u00a0s cooldown spares the service 100 × 30 = 3,000\u00a0calls.',
    ],
  },
  variants: [
    {
      name: 'Fallback',
      caption: 'While open, the app answers from a cache instead.',
      description:
        'The breaker is open, so the app skips the failing service and answers from a cache with an older copy of the data.',
      labels: { cached: 'Cached' },
    },
    {
      name: 'Count vs rate',
      caption: 'Trip after 5 failures in a row, or a 50% failure rate.',
      description:
        'Left: five failed calls in a row trip the breaker. Right: ten recent calls, half of them failed, also trip it.',
      labels: { count: '5 in a row', rate: '50%' },
    },
  ],
  tradeoffs: {
    useWhen: 'a slow or failing service could tie up your app.',
    costs: 'it refuses some calls that might have worked.',
    realExample:
      'Netflix’s Hystrix library popularized it. Netflix now suggests Resilience4j for new projects.',
    watchOut: 'plan what users see while it is open: cached data or a clear error.',
  },
  quiz: [
    {
      id: 'concepts/circuit-breaker/q1',
      prompt: 'The breaker is open. A new call comes in. What happens?',
      options: [
        {
          text: 'It waits for a timeout',
          why: 'Skipping that wait is the point of an open breaker.',
        },
        {
          text: 'It fails at once or gets a fallback',
          correct: true,
          why: 'An open breaker answers without touching the service.',
        },
        {
          text: 'It resets and goes through',
          why: 'Only a successful trial after the cooldown closes the breaker.',
        },
      ],
    },
    {
      id: 'concepts/circuit-breaker/q2',
      prompt: 'A half-open breaker’s trial call fails. What happens next?',
      options: [
        {
          text: 'It opens again for another cooldown',
          correct: true,
          why: 'A failed trial shows the service is still down, so the breaker keeps protecting it.',
        },
        {
          text: 'It closes',
          why: 'Closing needs a trial that works.',
        },
        {
          text: 'It sends another trial at once',
          why: 'The breaker waits out another cooldown before it tries again.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#circuit-breaker',
      label: 'Circuit breaker',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/resiliency-patterns/',
      label: 'Resiliency patterns',
    },
    {
      course: 'scalability',
      href: 'https://github.com/binhnguyennus/awesome-scalability#stability',
      label: 'Stability',
    },
  ],
};

export default circuitBreaker;
