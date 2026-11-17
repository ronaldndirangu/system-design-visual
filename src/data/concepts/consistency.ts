import type { Concept } from './types';

const consistency: Concept = {
  slug: 'consistency',
  group: 'speed',
  title: 'Strong and eventual consistency',
  definition:
    'After a write, strong consistency means every read sees it; eventual consistency means some reads see old data for a while.',
  analogy:
    'a price change: strong updates every till before the next sale; eventual lets some labels show the old price briefly.',
  lesson: 'distributed-data/consistency-models',
  illustrative: true,
  labels: {
    writer: 'Writer',
    reader: 'Reader',
    leader: 'Leader',
    replica: 'Replica',
    old: 'old',
    new: 'new',
    copy: '200 ms',
    slow: '205 ms',
    fast: '5 ms',
  },
  states: {
    without: {
      label: 'Strong',
      title: 'Strong consistency',
      description:
        'A writer sends a new value to the leader. The leader copies it to the replica, which takes 200 milliseconds, and only then confirms, about 205 milliseconds after the write started. A reader that asks the replica afterwards gets the new value.',
      captions: [
        'The leader copies the write before it confirms',
        'The writer waits longer for the confirmation',
        'Every later read returns the new value',
      ],
    },
    with: {
      label: 'Eventual',
      title: 'Eventual consistency',
      description:
        'A writer sends a new value to the leader, which confirms in about 5 milliseconds and copies to the replica in the background. A reader asks the replica before the copy lands and gets the old value. About 200 milliseconds later the replica has the new value.',
      captions: [
        'The leader confirms the write right away',
        'A replica read still returns the old value',
        'Once the copy lands, reads see the new value',
      ],
    },
  },
  steps: [
    'A write lands on the leader, which copies it to each replica.',
    'Strong: the leader confirms only once every replica has the write.',
    'Eventual: the leader confirms at once and copies in the background.',
    'Until the copy lands, that replica returns the old value.',
  ],
  example: {
    title: 'A new comment',
    lines: [
      'Copying to the replica takes 200 ms.',
      'Eventual: confirmed in 5 ms, but a friend reading the replica 50 ms later misses it.',
      'Strong: confirmed in 5 + 200 = 205 ms, and every read after that sees it.',
    ],
  },
  variants: [
    {
      name: 'Read your own writes',
      caption: 'You always see your own edits, even before others do.',
      description:
        'The writer’s reads go to the leader, which has the new value. Another user reading from the replica still sees the old value for a moment.',
      labels: {},
    },
    {
      name: 'Quorum reads',
      caption: 'Write to 2 of 3, read from 2, and one always overlaps.',
      description:
        'Three replicas. A write reaches the first two, and a read asks the last two, so at least one replica in the read holds the new value.',
      labels: { write: 'Write', read: 'Read' },
    },
  ],
  tradeoffs: {
    useWhen: 'you replicate data: strong for balances and stock, eventual for likes and feeds.',
    costs: 'strong slows writes and stalls when a replica is down; eventual serves stale reads.',
    realExample: 'reads in Amazon DynamoDB are eventually consistent unless the request asks for strong.',
    watchOut: 'eventual sets no deadline; under heavy load, lag can grow from milliseconds to minutes.',
  },
  quiz: [
    {
      id: 'concepts/consistency/q1',
      prompt: 'Your new comment is missing after a refresh, then appears. Why?',
      options: [
        {
          text: 'Strong consistency',
          why: 'With strong consistency, every read after the confirmation sees your comment.',
        },
        {
          text: 'Eventual consistency',
          correct: true,
          why: 'Your refresh read a replica the copy had not reached yet. Once it landed, the comment appeared.',
        },
        {
          text: 'A failed write',
          why: 'A failed write would never appear. This one showed up a moment later.',
        },
      ],
    },
    {
      id: 'concepts/consistency/q2',
      prompt: 'Which data most needs strong consistency?',
      options: [
        {
          text: 'A news feed',
          why: 'A post showing up a second late in a feed harms nobody.',
        },
        {
          text: 'A video’s view count',
          why: 'A count that lags by a few views is fine.',
        },
        {
          text: 'A bank balance',
          correct: true,
          why: 'An outdated balance could let someone spend the same money twice.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#consistency-patterns',
      label: 'Consistency patterns',
    },
    {
      course: 'kleppmann',
      href: 'https://www.youtube.com/watch?v=noUNH3jDLC0',
      label: '7.2 Linearizability',
    },
  ],
};

export default consistency;
