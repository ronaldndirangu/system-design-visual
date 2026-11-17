import type { Concept } from './types';

const replication: Concept = {
  slug: 'replication',
  group: 'data',
  title: 'Replication',
  definition:
    'Replication keeps copies of a database on several servers, where a leader takes every write and followers copy it and serve reads.',
  analogy: "a teacher's main board, copied onto side boards by helpers a moment behind.",
  lesson: 'scaling/read-replicas',
  illustrative: true,
  labels: {
    app: 'App',
    database: 'Database',
    leader: 'Leader',
    follower1: 'Follower 1',
    follower2: 'Follower 2',
    v1: 'v1',
    v2: 'v2',
    lag: 'Lag',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without replication',
      description:
        'The app sends every read and every write to one database. Its load gauge fills as reads pile up. Then the database fails, and every request after that fails too.',
      captions: [
        'Every read and write hits one database',
        'Heavy reads slow everything down',
        'If it fails, nothing works',
      ],
    },
    with: {
      label: 'With',
      title: 'With leader and follower replication',
      description:
        'The app sends writes to the leader, which copies each one to two followers. Follower 1 updates to version 2 quickly; follower 2 lags and briefly returns the old version 1. Reads go to the followers.',
      captions: [
        'The leader takes every write',
        'Followers copy each write after a lag',
        'Followers serve reads, maybe slightly stale',
      ],
    },
  },
  steps: [
    'Every write goes to the leader.',
    'The leader streams each write to its followers.',
    'Followers apply it a moment later: replication lag.',
    'Reads spread across followers, so more followers serve more reads.',
  ],
  example: {
    title: 'Splitting 10,000 queries a second',
    lines: [
      'The app does 9,000 reads and 1,000 writes a second.',
      'One server handles about 5,000 queries a second.',
      '3 followers: 3,000 reads plus 1,000 copied writes each, so 4,000.',
      'The leader still takes all 1,000 writes.',
    ],
  },
  variants: [
    {
      name: 'Sync vs async',
      caption: 'Sync waits for a follower to confirm; async can lose recent writes.',
      description:
        'Left: the leader waits for the follower to confirm before telling the app the write is saved. Right: the leader replies at once and copies later, so a crash can lose the newest write.',
      labels: { sync: 'Sync', async: 'Async' },
    },
    {
      name: 'Multi-leader',
      caption: 'Leaders in two regions both take writes, then resolve conflicts.',
      description:
        'Two leaders, one per region, each take local writes and copy them to each other. Two edits to the same record can conflict and must be merged.',
      labels: { us: 'US', eu: 'EU' },
    },
  ],
  tradeoffs: {
    useWhen: 'reads far outnumber writes, or you want a spare copy if a server dies.',
    costs: 'follower reads can be stale, and every server stores every write.',
    realExample: 'PostgreSQL and MySQL ship leader and follower replication for read replicas.',
    watchOut: "read a user's own fresh edits from the leader.",
  },
  quiz: [
    {
      id: 'concepts/replication/q1',
      prompt: 'A user edits their bio, reloads, and sees the old one. Reads hit followers. Why?',
      options: [
        {
          text: 'The follower has not caught up',
          correct: true,
          why: 'Replication lag: the leader has the new bio, and the follower gets it a moment later.',
        },
        {
          text: 'The leader rejected the edit',
          why: 'Then the bio would stay old for good. It updates a moment later.',
        },
        { text: 'Followers skip edits to old rows', why: 'Followers copy every write, old rows included.' },
      ],
    },
    {
      id: 'concepts/replication/q2',
      prompt: 'Writes triple and the leader is maxed out. Will more followers help?',
      options: [
        {
          text: 'Yes, they share writes',
          why: 'Each follower must apply every write too, so writes still pile up.',
        },
        {
          text: 'Only in the same region',
          why: 'Location changes lag. It does not change who takes writes.',
        },
        {
          text: 'No, the leader still takes every write',
          correct: true,
          why: 'Followers scale reads. To scale writes, split the data with sharding.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#database-replication',
      label: 'Database replication',
    },
    {
      course: 'kleppmann',
      href: 'https://www.youtube.com/watch?v=mBUCF1WGI_I',
      label: '5.1 Replication',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/read-replica-pattern/',
      label: 'Read replica pattern',
    },
  ],
};

export default replication;
