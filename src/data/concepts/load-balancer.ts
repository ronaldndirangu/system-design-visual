import type { Concept } from './types';

const loadBalancer: Concept = {
  slug: 'load-balancer',
  group: 'traffic',
  title: 'Load balancer',
  definition:
    'A load balancer spreads incoming requests across several servers and stops sending them to a server that fails.',
  analogy: 'a restaurant host who seats each group at a free table and skips closed ones.',
  lesson: 'scaling/load-balancing',
  illustrative: true,
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
  steps: [
    'Users send every request to one address: the balancer.',
    'The balancer passes each request to the next server in line.',
    'It sends each server a health check every few seconds.',
    'A server that fails its checks gets no requests until it recovers.',
  ],
  example: {
    title: 'A ticket sale',
    lines: [
      'Each server handles 1,000\u00a0requests per second.',
      'Peak traffic: 2,500\u00a0requests per second.',
      '2,500 ÷ 1,000 = 2.5, so you need 3\u00a0servers.',
      'Add 1 spare to survive a failure: run 4.',
    ],
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
  tradeoffs: {
    useWhen: "one server can't keep up, or one failure must not take the site down.",
    costs: 'an extra hop, a spare balancer, and sessions stored off the servers.',
    realExample: 'a concert ticket sale.',
    watchOut: 'a health check that only opens a port can pass while the app returns errors.',
  },
  quiz: [
    {
      id: 'concepts/load-balancer/q1',
      prompt: 'Each server keeps carts in its own memory. What breaks behind a load balancer?',
      options: [
        {
          text: 'The balancer runs out of memory',
          why: 'The balancer only forwards requests. The carts live on the servers.',
        },
        {
          text: 'The next request can land on a server without the cart',
          correct: true,
          why: 'The balancer can pick a different server each time. Keep carts in a shared store, such as a database.',
        },
        {
          text: 'Every server gets slower',
          why: 'Spreading requests makes each server less busy. The trouble is where the cart lives.',
        },
      ],
    },
    {
      id: 'concepts/load-balancer/q2',
      prompt:
        'Each server handles 500\u00a0requests per second. Peak is 1,800, and one may fail. How many servers?',
      ordered: true,
      options: [
        { text: '3', why: 'Three servers handle only 1,500 requests per second, short of the 1,800 peak.' },
        { text: '4', why: 'Four cover the peak, but if one fails the other three handle only 1,500.' },
        {
          text: '5',
          correct: true,
          why: '1,800 ÷ 500 = 3.6, so the peak needs 4. The fifth keeps it covered when one fails.',
        },
        { text: '6', why: 'Six works, but one spare already covers a single failure.' },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#load-balancer',
      label: 'Load balancer',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#load-balancing',
      label: 'Load balancing',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/what-is-a-load-balancer/',
      label: 'What is a load balancer?',
    },
  ],
};

export default loadBalancer;
