import type { Concept } from './types';

const sqlVsNosql: Concept = {
  slug: 'sql-vs-nosql',
  group: 'data',
  title: 'SQL vs NoSQL',
  definition:
    'SQL databases store rows in related tables with a fixed schema; NoSQL databases store flexible records that spread easily across machines.',
  analogy: 'linked spreadsheets with fixed columns, versus index cards that each hold one whole record.',
  lesson: 'foundations/data-modeling',
  illustrative: false,
  labels: {
    app: 'App',
    users: 'Users',
    orders: 'Orders',
    node1: 'Node 1',
    node2: 'Node 2',
    node3: 'Node 3',
  },
  states: {
    without: {
      label: 'SQL',
      title: 'A SQL database',
      description:
        'The app queries one database that holds two tables with fixed columns, Users and Orders. A join links each order to its user. Then one transaction adds a row to both tables together.',
      captions: [
        'Each table has fixed columns',
        'A join links orders to users',
        'A transaction updates both or neither',
      ],
    },
    with: {
      label: 'NoSQL',
      title: 'A NoSQL document database',
      description:
        'The app reads one document by key from node 1. Each document holds a user and their orders, so no join is needed. Another document gains a new field. A third node joins to store more documents.',
      captions: [
        'One key read returns a whole document',
        'Documents can hold different fields',
        'Add nodes to store more',
      ],
    },
  },
  steps: [
    'SQL stores rows in tables with columns fixed up front.',
    'A join combines related rows when you query.',
    'NoSQL stores each record whole under a key.',
    'The key picks a node, so more nodes add room.',
  ],
  example: {
    title: "Ada's order page",
    lines: [
      'Show Ada and her 3 orders.',
      'SQL joins 1 user row to 3 order rows.',
      'A document store reads all 4 in one lookup by key.',
      'Later, find all orders over $50: SQL filters one table; documents need a scan or extra index.',
    ],
  },
  variants: [
    {
      name: 'Key-value vs document',
      caption: 'Key-value returns a value by key; documents have queryable fields.',
      description:
        'Left: keys point to values the store cannot look inside. Right: a document with named fields, including a nested list, that queries can search.',
      labels: { kv: 'Key-value', doc: 'Document' },
    },
    {
      name: 'Wide-column vs graph',
      caption: 'Wide-column rows fill different columns; graphs store links between things.',
      description:
        'Left: rows in a wide-column store, each filling a different set of columns. Right: a graph of people joined by lines.',
      labels: { columns: 'Columns', graph: 'Graph' },
    },
  ],
  tradeoffs: {
    useWhen: 'SQL for related data and transactions; NoSQL for huge volumes of reads by key.',
    costs: 'SQL is harder to spread out; NoSQL drops joins and often transactions.',
    realExample: 'Amazon built Dynamo, a key-value store, for always-writable shopping carts.',
    watchOut: 'list your queries first; documents make unplanned ones slow.',
  },
  quiz: [
    {
      id: 'concepts/sql-vs-nosql/q1',
      prompt: 'Moving money between accounts must update both balances or neither. What fits?',
      options: [
        {
          text: 'A key-value store without transactions',
          why: 'A crash between the two writes could leave money missing.',
        },
        {
          text: 'A SQL database with a transaction',
          correct: true,
          why: 'The transaction commits both updates together or rolls both back.',
        },
        { text: 'A cache in front', why: 'A cache speeds up reads. It cannot make two writes atomic.' },
      ],
    },
    {
      id: 'concepts/sql-vs-nosql/q2',
      prompt: 'A game reads player profiles by id, billions of times a day. What fits?',
      options: [
        {
          text: 'A key-value store across many nodes',
          correct: true,
          why: 'Every read names its key, so the store can split players across many nodes.',
        },
        {
          text: 'One SQL server joining five tables',
          why: 'Joins on every read add work, and one server caps the volume.',
        },
        {
          text: 'A graph database',
          why: 'Graphs shine at following links, such as friends of friends. Plain reads by id need no links.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#sql-or-nosql',
      label: 'SQL or NoSQL',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#sql-vs-nosql-databases',
      label: 'SQL vs NoSQL databases',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/understanding-database-types/',
      label: 'Understanding database types',
    },
  ],
};

export default sqlVsNosql;
