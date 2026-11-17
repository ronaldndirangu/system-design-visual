import type { Concept } from './types';

const capTheorem: Concept = {
  slug: 'cap-theorem',
  group: 'speed',
  title: 'CAP theorem',
  definition:
    'During a network split, a replicated system either refuses some requests to stay consistent or keeps answering and lets copies disagree.',
  analogy: 'two bank tellers whose phone line drops: stop paying out, or keep paying and settle up later.',
  lesson: 'distributed-data/cap-and-pacelc',
  illustrative: false,
  labels: {
    paris: 'Paris',
    rome: 'Rome',
    lima: 'Lima',
    alice: 'Alice',
    bob: 'Bob',
    majority: '2 of 3',
    minority: '1 of 3',
  },
  states: {
    without: {
      label: 'Pick consistency',
      title: 'Picking consistency during a split',
      description:
        'Three replicas, in Paris, Rome and Lima, copy every write to each other. A network split cuts Lima off. Alice writes through Rome, and Paris and Rome form a majority, so her write succeeds. Bob writes through Lima, which cannot reach a majority, so Lima refuses his write.',
      captions: [
        'A split cuts Lima off',
        'Paris and Rome form a majority; Alice’s write works',
        'Lima has no majority, so it refuses Bob',
      ],
    },
    with: {
      label: 'Pick availability',
      title: 'Picking availability during a split',
      description:
        'Three replicas, in Paris, Rome and Lima, copy every write to each other. A network split cuts Lima off. Alice writes through Rome and Bob writes through Lima, and both writes succeed, so the copies differ. When the link heals, every replica merges both writes.',
      captions: [
        'A split cuts Lima off',
        'Both sides accept writes, so copies differ',
        'When the link heals, the sides merge',
      ],
    },
  },
  steps: [
    'Replicas in different places hold copies of the same data.',
    'A network split cuts some replicas off from the rest.',
    'Pick consistency: the side without a majority refuses requests until the split heals.',
    'Pick availability: both sides keep answering, then merge their writes when the link heals.',
  ],
  example: {
    title: 'One seat left',
    lines: [
      '1 seat is left when a split cuts Lima off.',
      'Alice buys through Rome, Bob through Lima.',
      'Pick consistency: Alice gets the seat, Bob gets an error.',
      'Pick availability: both succeed, so 2 sales for 1 seat.',
    ],
  },
  variants: [
    {
      name: 'No split, no choice',
      caption: 'On a healthy network, you get consistency and availability.',
      description:
        'Three linked replicas with no split. Two users write through different replicas, and every replica ends up with both writes.',
      labels: {},
    },
    {
      name: 'PACELC',
      caption: 'With no split, you still trade speed against consistency.',
      description:
        'Left: the leader waits for the copy before it replies, which is slower but consistent. Right: the leader replies at once and copies later, which is faster but briefly stale.',
      labels: { wait: 'Wait', fast: 'Fast' },
    },
  ],
  tradeoffs: {
    useWhen: 'you replicate data: consistency for payments, availability for carts and feeds.',
    costs: 'errors or waits during a split, or merge logic and brief wrong answers.',
    realExample:
      'etcd refuses writes without a majority; Amazon’s Dynamo kept carts writable and merged later.',
    watchOut: 'the C in CAP means every read sees the latest write, unlike the C in ACID.',
  },
  quiz: [
    {
      id: 'concepts/cap-theorem/q1',
      prompt:
        'During a split, a system that picks consistency gets a write on the minority side. What happens?',
      options: [
        {
          text: 'Accepted, merged later',
          why: 'That is the availability choice. The copies disagree until the merge.',
        },
        {
          text: 'Refused or delayed',
          correct: true,
          why: 'Without a majority, the replica cannot know whether the other side wrote first, so it stops taking writes.',
        },
        {
          text: 'Sent to a cache',
          why: 'A cache does not decide which copy is right. The replica still has to accept or refuse.',
        },
      ],
    },
    {
      id: 'concepts/cap-theorem/q2',
      prompt: 'With no split, what does CAP make you give up?',
      options: [
        {
          text: 'Consistency',
          why: 'With every replica reachable, each write can reach all of them before it is confirmed.',
        },
        {
          text: 'Availability',
          why: 'With every replica reachable, every request can get an answer.',
        },
        {
          text: 'Nothing',
          correct: true,
          why: 'CAP only forces the choice during a split. Waiting for copies still costs time, which PACELC describes.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#cap-theorem',
      label: 'CAP theorem',
    },
    {
      course: 'kleppmann',
      href: 'https://www.youtube.com/watch?v=9uCP3qHNbWw',
      label: '7.3 Eventual consistency',
    },
  ],
};

export default capTheorem;
