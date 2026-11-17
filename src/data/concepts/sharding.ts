import type { Concept } from './types';

const sharding: Concept = {
  slug: 'sharding',
  group: 'data',
  title: 'Sharding',
  definition:
    'Sharding splits data across several databases by a key, such as user id, so each holds and serves only its part.',
  analogy: 'a phone book split into A to H, I to P and Q to Z volumes.',
  lesson: 'scaling/sharding',
  illustrative: true,
  labels: {
    app: 'App',
    all: 'Users A-Z',
    shard1: 'Shard A-H',
    shard2: 'Shard I-P',
    shard3: 'Shard Q-Z',
    ada: 'Ada',
    mo: 'Mo',
    zoe: 'Zoe',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without sharding',
      description:
        'One database holds every user from A to Z. Every request lands on it, so its storage and load gauge climb until it runs out of room.',
      captions: ['One database holds every user', 'Every request lands on it', 'It outgrows one machine'],
    },
    with: {
      label: 'With',
      title: 'With sharding',
      description:
        'Users are split by the first letter of their name across three shards: A to H, I to P and Q to Z. A request for Ada goes to the first shard, Mo to the second and Zoe to the third, so each shard carries about a third of the load.',
      captions: [
        "Ada's name sends her to A-H",
        'Mo and Zoe go to other shards',
        'Each shard carries a third',
      ],
    },
  },
  steps: [
    'Pick a shard key, like user id, that most queries carry.',
    'A rule maps each key to a shard, by range or hash.',
    'Each query goes only to the shard owning its key.',
    'More shards add room for data and traffic.',
  ],
  example: {
    title: 'Outgrowing one server',
    lines: [
      'You have 3 TB and 30,000 queries a second.',
      'One server holds 1 TB and 12,000 queries a second.',
      '3 shards: 1 TB and 10,000 queries each, full on day one.',
      '4 shards: 0.75 TB and 7,500 each, with room to grow.',
    ],
  },
  variants: [
    {
      name: 'Range vs hash',
      caption: 'Ranges keep neighbors together; hashing spreads keys but scatters ranges.',
      description:
        'Left: keys in order fill one shard, then the next. Right: a hash sends neighboring keys to different shards, which evens out the load.',
      labels: { range: 'Range', hash: 'Hash' },
    },
    {
      name: 'Hot shard',
      caption: 'One busy key overloads its shard while others idle.',
      description:
        'Most requests carry the same popular key, so one shard turns red with load while the other two stay nearly empty.',
      labels: {},
    },
  ],
  tradeoffs: {
    useWhen: 'data or writes outgrow the biggest server, even with replicas.',
    costs: 'cross-shard queries, joins and transactions get slow or hard.',
    realExample: 'Notion split its PostgreSQL data by workspace id into 480 shards on 32 databases.',
    watchOut: 'pick a key that spreads load evenly, or one shard runs hot.',
  },
  quiz: [
    {
      id: 'concepts/sharding/q1',
      prompt: 'Users are sharded by user id. Which query gets slow?',
      options: [
        { text: "Load user 42's profile", why: 'The id picks one shard, so one database answers.' },
        { text: "Change user 42's email", why: 'The id still picks one shard.' },
        {
          text: 'List users who signed up today',
          correct: true,
          why: "Today's users sit on every shard, so the query must ask them all.",
        },
      ],
    },
    {
      id: 'concepts/sharding/q2',
      prompt: 'Users are sharded by country, and 70% live in one country. What happens?',
      options: [
        {
          text: 'One shard gets most of the load',
          correct: true,
          why: 'That shard runs hot while the rest sit idle. Pick a key that spreads evenly.',
        },
        {
          text: 'Load stays even',
          why: 'Each country lands on one shard, so the big country stays together.',
        },
        { text: 'Every query gets faster', why: 'Queries for the big country all hit one overloaded shard.' },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#sharding',
      label: 'Sharding',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#sharding',
      label: 'Sharding',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/a-crash-course-in-database-sharding/',
      label: 'A crash course on database sharding',
    },
  ],
};

export default sharding;
