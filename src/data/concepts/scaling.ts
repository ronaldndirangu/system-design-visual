import type { Concept } from './types';

const scaling: Concept = {
  slug: 'scaling',
  group: 'basics',
  title: 'Scaling',
  definition:
    'Scaling adds capacity as traffic grows, with a bigger machine (scale up) or more machines sharing the work (scale out).',
  analogy: 'a bakery at rush hour: buy one bigger oven, or add more ovens and bakers.',
  lesson: 'scaling/load-balancing',
  illustrative: true,
  labels: {
    users: 'Users',
    server: 'Server',
    ceiling: 'Largest size',
    balancer: 'Balancer',
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
  },
  states: {
    without: {
      label: 'Scale up',
      title: 'Scale up',
      description:
        'One server grows from small to medium to large as traffic rises, until it reaches the largest size available. Then the single server fails and every user loses the site.',
      captions: [
        'Buy a bigger server as traffic grows',
        'It stops at the largest size',
        'If it fails, everything stops',
      ],
    },
    with: {
      label: 'Scale out',
      title: 'Scale out',
      description:
        'A balancer spreads users across servers, and servers A, B, C and D join one after another as traffic rises. Server B fails, and the balancer keeps sending traffic to the other three.',
      captions: [
        'Add servers behind a balancer',
        'Each new server adds capacity',
        'One fails; the others keep serving',
      ],
    },
  },
  steps: [
    'Traffic grows past what one server can handle.',
    'Scale up: move to a bigger server, until none is bigger.',
    'Scale out: add servers behind a balancer that spreads requests.',
    'When one of many servers fails, the rest keep serving.',
  ],
  example: {
    title: 'One big server or four small ones',
    lines: [
      'One big server handles 4,000 requests a second; four small ones handle 1,000 each.',
      'The big one fails: 0 a second get served.',
      'One small one fails: 3 × 1,000 = 3,000 a second still do.',
      'Traffic hits 10,000 a second: add 6 small servers.',
    ],
  },
  variants: [
    {
      name: 'Stateless servers',
      caption: 'Keep sessions in a shared store so any server can answer.',
      description:
        'Two servers keep no user data of their own. Both read sessions from one shared store, so any server can answer any user.',
      labels: { store: 'Sessions' },
    },
    {
      name: 'Autoscaling',
      caption: 'Add servers when busy; remove them when quiet.',
      description:
        'A line of traffic over a day rises and falls, and the number of servers steps up and down to follow it.',
      labels: { traffic: 'Traffic', servers: 'Servers' },
    },
  ],
  tradeoffs: {
    useWhen: 'one server runs short of CPU or memory, or must not be the only copy.',
    costs: 'scaling out needs a balancer, and servers that keep no user data locally.',
    realExample: 'online shops add servers before a big sale and remove them after.',
    watchOut: 'the shared database often becomes the next limit.',
  },
  quiz: [
    {
      id: 'concepts/scaling/q1',
      prompt: 'Your server is the largest size you can buy, and still overloaded. What next?',
      options: [
        {
          text: 'Add servers behind a balancer',
          correct: true,
          why: 'Scaling out has no fixed size limit, and one failure no longer stops the site.',
        },
        { text: 'Upgrade to a bigger server', why: 'There is no bigger size left to buy.' },
        {
          text: 'Restart it more often',
          why: 'A restart adds no capacity, and it drops requests while it runs.',
        },
      ],
    },
    {
      id: 'concepts/scaling/q2',
      prompt: 'Why do many teams scale up first?',
      options: [
        { text: 'One server never fails', why: 'One server can fail, and then everything stops.' },
        { text: 'Big servers have no limit', why: 'Every machine has a largest size.' },
        {
          text: 'It needs no code changes',
          correct: true,
          why: 'The same app runs on a bigger machine, with no balancer or shared state to add.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#scalability',
      label: 'Scalability',
    },
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#horizontal-scaling',
      label: 'Horizontal scaling',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/8-must-know-scalability-strategies/',
      label: '8 Must-Know Scalability Strategies',
    },
  ],
};

export default scaling;
