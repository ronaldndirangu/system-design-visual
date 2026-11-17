import type { Concept } from './types';

const availability: Concept = {
  slug: 'availability',
  group: 'basics',
  title: 'Availability',
  definition:
    'Availability is the share of time a system works when people need it, usually written as a percentage of uptime.',
  analogy: 'a shop with two cashiers: when one is out sick, customers can still pay.',
  lesson: 'thinking/slos',
  illustrative: false,
  labels: {
    users: 'Users',
    server: 'Server',
    balancer: 'Balancer',
    a: 'A',
    b: 'B',
    up: 'Site up',
    down: 'Site down',
    one: '99% up',
    two: '99.99% up',
  },
  states: {
    without: {
      label: 'One server',
      title: 'One server',
      description:
        'Users send every request to one server that is up 99% of the time. When that server fails, requests are dropped and the whole site goes down.',
      captions: ['Every request needs this one server', 'The server fails', 'The whole site goes down'],
    },
    with: {
      label: 'Two servers',
      title: 'Two servers',
      description:
        'A balancer spreads requests across servers A and B, each up 99% of the time, so the pair is up 99.99%. Server A fails, the balancer sends everything to server B, and the site stays up.',
      captions: ['Requests reach either server', 'Server A fails', 'Server B keeps the site up'],
    },
  },
  steps: [
    'Every request needs a working server.',
    'With one server, its failure stops every request.',
    'With two, the balancer stops sending to the failed one.',
    'The site goes down only if both fail at the same time.',
  ],
  example: {
    title: 'Counting the nines',
    lines: [
      'A year has 365 × 24 = 8,760 hours.',
      '99.9% up: 0.1% × 8,760 ≈ 8.8 hours down a year.',
      '99.99% up: 0.01% × 8,760 ≈ 53 minutes down a year.',
      'Two independent 99% servers both fail only 1% × 1% = 0.01% of the time, so the pair is up 99.99%.',
    ],
  },
  variants: [
    {
      name: 'In series',
      caption: 'Parts in a chain multiply: 99.9% × 99.9% ≈ 99.8%.',
      description:
        'A request passes through a web server and then a database, each up 99.9% of the time. The chain works only when both do, so it is up about 99.8%.',
      labels: { each: '99.9%', total: '≈ 99.8%' },
    },
    {
      name: 'Across zones',
      caption: 'Copies in separate buildings survive a power cut.',
      description:
        'Two servers sit in two zones, separate buildings with their own power and network. Zone 1 loses power, and the server in zone 2 keeps serving.',
      labels: { zone1: 'Zone 1', zone2: 'Zone 2' },
    },
  ],
  tradeoffs: {
    useWhen: 'downtime loses money or trust, as with payments and sign in.',
    costs: 'each extra nine allows 10 times less downtime and needs more spares and testing.',
    realExample: 'cloud providers promise uptime in their SLAs, often 99.9% to 99.99%.',
    watchOut: 'copies that share power, network or code fail together.',
  },
  quiz: [
    {
      id: 'concepts/availability/q1',
      prompt: 'A service promises 99.99% uptime. About how much downtime a year is that?',
      ordered: true,
      options: [
        { text: '53 minutes', correct: true, why: '0.01% of 8,760 hours is 0.876 hours, about 53 minutes.' },
        { text: '8.8 hours', why: 'That is 99.9%, one nine fewer.' },
        { text: '3.7 days', why: 'That is 99%, two nines fewer.' },
      ],
    },
    {
      id: 'concepts/availability/q2',
      prompt: 'Two servers back each other up but share one power strip. What is the risk?',
      options: [
        {
          text: 'Requests get slower',
          why: 'Sharing power does not slow requests while the power stays on.',
        },
        {
          text: 'One power cut stops both',
          correct: true,
          why: 'The copies fail together, so the second server no longer protects the site.',
        },
        {
          text: 'They need more memory',
          why: 'Memory has nothing to do with it. The shared power strip is the weak point.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#availability-in-numbers',
      label: 'Availability in numbers',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#availability-in-sequence-vs-parallel',
      label: 'Availability in Sequence vs Parallel',
    },
    {
      course: 'kleppmann',
      href: 'https://www.youtube.com/watch?v=43TDfUNsM3E',
      label: 'Lecture 2.4: Fault tolerance',
    },
  ],
};

export default availability;
