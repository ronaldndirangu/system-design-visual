import type { Concept } from './types';

const latencyThroughput: Concept = {
  slug: 'latency-throughput',
  group: 'basics',
  title: 'Latency and throughput',
  definition:
    'Latency is how long one request takes, and throughput is how many requests a system finishes each second.',
  analogy: 'a highway: latency is one car’s trip time; throughput is how many cars pass each minute.',
  lesson: 'thinking/anatomy-of-a-web-app',
  illustrative: true,
  labels: {
    client: 'Client',
    server: 'Server',
    latency: 'Latency',
    time: '100 ms',
    throughput: 'Throughput',
    slow: '10/s',
    fast: '30/s',
  },
  states: {
    without: {
      label: 'One request',
      title: 'One request at a time',
      description:
        'A client sends one request at a time to a server, and each reply comes back before the next request leaves. A stopwatch shows each round trip takes 100 milliseconds, and a counter of finished requests fills slowly: 10 a second.',
      captions: [
        'A request goes to the server and back',
        'The stopwatch shows its latency: 100 ms',
        'One at a time, 10 finish each second',
      ],
    },
    with: {
      label: 'Many requests',
      title: 'Many requests at once',
      description:
        'The client sends three requests side by side. Each round trip still takes 100 milliseconds, but the counter of finished requests fills three times as fast: 30 a second.',
      captions: [
        'Three requests travel side by side',
        'Each one still takes 100 ms',
        'Throughput triples to 30 a second',
      ],
    },
  },
  steps: [
    'A request travels to the server, and its reply travels back.',
    'Latency is how long that round trip takes: 100 ms.',
    'Throughput counts how many round trips finish each second.',
    'More requests side by side raise throughput; each one still takes 100 ms.',
  ],
  example: {
    title: 'Common delays',
    lines: [
      'Memory read: about 100 ns (0.0001 ms).',
      'SSD read: about 0.1 ms.',
      'Round trip inside one data center: about 0.5 ms.',
      'Round trip from California to Europe: about 150 ms.',
      'That is 1.5 million memory reads (150 ms ÷ 100 ns).',
    ],
  },
  variants: [
    {
      name: 'Tail latency',
      caption: 'Most requests are quick; watch the slowest 1 in 100 (p99).',
      description:
        'A bar chart of request times. Most bars sit at the fast end around the median, p50, and a thin tail stretches right to the slow p99 mark.',
      labels: { p50: 'p50', p99: 'p99' },
    },
    {
      name: 'Busy means slow',
      caption: 'Near full capacity, requests queue and latency climbs fast.',
      description:
        'A line chart of wait time against load. The wait stays low and flat, then shoots up as load nears the server’s full capacity.',
      labels: { load: 'Load', wait: 'Wait', full: 'Full' },
    },
  ],
  tradeoffs: {
    useWhen: 'you set goals, such as replies under 300 ms at peak.',
    costs: 'batching raises throughput but makes each item wait longer.',
    realExample: 'video calls need low latency; nightly backups need high throughput.',
    watchOut: 'distance sets a floor. Light in fiber needs about 5 ms per 1,000 km.',
  },
  quiz: [
    {
      id: 'concepts/latency-throughput/q1',
      prompt: 'A server handles 10 requests at once, 100 ms each. How many finish per second?',
      ordered: true,
      options: [
        { text: '10', why: 'That is one at a time: 1 s ÷ 0.1 s. Ten at once finish ten times as many.' },
        { text: '100', correct: true, why: '10 at once × (1 s ÷ 0.1 s) = 100 per second.' },
        { text: '1,000', why: 'That would need 100 at once, or 10 ms per request.' },
      ],
    },
    {
      id: 'concepts/latency-throughput/q2',
      prompt: 'Users in Kenya wait 250 ms per reply from an idle US server. What helps most?',
      options: [
        {
          text: 'A faster CPU',
          why: 'The server is idle, so it already answers quickly. The time goes into the long trip.',
        },
        {
          text: 'More US servers',
          why: 'More servers raise throughput, but each reply still crosses the ocean.',
        },
        {
          text: 'Serving from near Kenya',
          correct: true,
          why: 'A shorter distance shortens every round trip, and distance is what costs time here.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#latency-vs-throughput',
      label: 'Latency vs throughput',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/which-latency-numbers-should-you-know/',
      label: 'Which Latency Numbers Should You Know?',
    },
  ],
};

export default latencyThroughput;
