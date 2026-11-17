import type { Concept } from './types';

const consistentHashing: Concept = {
  slug: 'consistent-hashing',
  group: 'speed',
  title: 'Consistent hashing',
  definition:
    'Consistent hashing places servers and keys on a ring, so adding or removing a server moves only a small share of keys.',
  analogy:
    'a round table where the next waiter clockwise serves each guest; a new waiter takes only nearby guests.',
  lesson: 'scaling/consistent-hashing',
  illustrative: false,
  labels: {
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
    mod3: 'mod 3',
    mod4: 'mod 4',
    movedMod: '9 of 12 moved',
    movedRing: '3 of 12 moved',
  },
  states: {
    without: {
      label: 'mod N',
      title: 'Key mod N',
      description:
        'Twelve keys, 0 to 11, sit under servers A, B and C by key mod 3. Server D joins and the rule becomes key mod 4. Only keys 0, 1 and 2 stay put; the other 9 move.',
      captions: ['Each key goes to server key mod 3', 'Add D: now key mod 4', '9 of 12 keys move'],
    },
    with: {
      label: 'Ring',
      title: 'A consistent hash ring',
      description:
        'Twelve keys and servers A, B and C sit on a ring. Each key belongs to the next server clockwise. Server D joins between A and B and takes the 3 keys just before it, which used to go to B. The other 9 stay.',
      captions: ['Each key goes clockwise to a server', 'Add server D', 'Only the 3 keys before D move'],
    },
  },
  steps: [
    'Simple sharding picks server key mod N.',
    'Change N, and most keys move.',
    'Servers and keys hash onto one ring; each key goes clockwise to the next server.',
    'A new server takes only the keys just before it.',
  ],
  example: {
    title: '1,200,000 keys, 3 servers to 4',
    lines: [
      'mod N: a key stays only if key mod 3 equals key mod 4.',
      'That is 3 in 12, so 900,000 keys (75%) move.',
      'Ring: the new server takes about a quarter, 300,000 keys.',
    ],
  },
  variants: [
    {
      name: 'Virtual nodes',
      caption: 'Each server sits at many ring points, so load spreads evenly.',
      description:
        'Three servers each appear at three points around the ring, so every server owns several small arcs instead of one large one.',
      labels: { a: 'A', b: 'B', c: 'C' },
    },
    {
      name: 'Fixed slots',
      caption: 'Redis Cluster hashes keys into 16,384 slots and moves whole slots.',
      description:
        'Keys hash into a fixed row of slots, and each server owns a block of slots. A new server takes over some slots, and only their keys move.',
      labels: { a: 'A', b: 'B', c: 'C', d: 'D' },
    },
  ],
  tradeoffs: {
    useWhen: 'servers join and leave often, as in cache clusters.',
    costs: 'a ring lookup per request, and uneven load without virtual nodes.',
    realExample: "Amazon's Dynamo and Apache Cassandra place data on a hash ring.",
    watchOut: 'with few servers, one may own a huge arc.',
  },
  quiz: [
    {
      id: 'concepts/consistent-hashing/q1',
      prompt: 'A cache uses key mod N and grows from 3 servers to 4. About what share of keys move?',
      ordered: true,
      options: [
        { text: 'About 25%', why: 'That is what a ring moves. With mod N, only 3 of every 12 keys stay.' },
        {
          text: 'About 75%',
          correct: true,
          why: 'A key stays only when key mod 3 equals key mod 4, which is 3 in 12.',
        },
        {
          text: 'All of them',
          why: 'Keys such as 0, 1 and 2 give the same answer for mod 3 and mod 4, so they stay.',
        },
      ],
    },
    {
      id: 'concepts/consistent-hashing/q2',
      prompt: 'On a ring, D joins between A and B, clockwise. Whose keys does D take?',
      options: [
        { text: 'Some from every server', why: 'Only the arc just before D changes owner.' },
        { text: "All of A's keys", why: "A's keys sit before A on the ring, so A keeps them." },
        {
          text: "Some of B's keys",
          correct: true,
          why: 'Keys between A and D used to go clockwise to B. Now D comes first.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#consistent-hashing',
      label: 'Consistent hashing',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/consistent-hashing/',
      label: 'Consistent hashing explained',
    },
  ],
};

export default consistentHashing;
