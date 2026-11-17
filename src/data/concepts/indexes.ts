import type { Concept } from './types';

const indexes: Concept = {
  slug: 'indexes',
  group: 'data',
  title: 'Indexes',
  definition:
    'An index is a sorted lookup structure, usually a B-tree, that jumps straight to matching rows instead of reading every row.',
  analogy: "a book's index: look up a word, get the page, skip reading every page.",
  lesson: 'foundations/indexes',
  illustrative: false,
  labels: {
    find: 'Find ada@mail.com',
    checked: 'rows checked',
    total: '1,000,000',
    tree: 'Index',
    table: 'Table',
    steps: 'About 20 checks',
    write: 'New row',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without an index',
      description:
        'The query looks for one email in a table of 1,000,000 rows. With no index, the database checks the rows one by one, and the counter climbs until all 1,000,000 rows have been checked.',
      captions: [
        'The query wants one email',
        'No index: check row after row',
        'All 1,000,000 rows get checked',
      ],
    },
    with: {
      label: 'With',
      title: 'With an index',
      description:
        'A tree of sorted emails sits above the table. The lookup goes from the root to one branch, then one leaf, which points at the matching row. Then a new row arrives, and both the table and a leaf of the index change.',
      captions: [
        'A tree keeps emails sorted',
        'Each level narrows the search',
        'Each write updates the index too',
      ],
    },
  },
  steps: [
    'Without an index, the database reads every row.',
    'An index keeps a column sorted in a tree of pointers to rows.',
    'A lookup walks from the root down, narrowing the range at each level.',
    'Every insert or update also changes each index.',
  ],
  example: {
    title: 'One email in 1,000,000 rows',
    lines: [
      'No index: check all 1,000,000 rows.',
      'Sorted: halving the range 20 times is enough, since 2 to the 20th is 1,048,576.',
      'B-tree pages hold hundreds of keys, so only 3 or 4 page reads.',
      'The cost: with 3 indexes, each insert does 4 writes.',
    ],
  },
  variants: [
    {
      name: 'Hash vs B-tree',
      caption: 'Hash finds exact keys; a B-tree also serves ranges and sorting.',
      description:
        'Left: a hash index sends one key straight to one bucket. Right: a B-tree reads a run of neighboring keys in order, which answers a range query.',
      labels: { hash: 'Hash', tree: 'B-tree' },
    },
    {
      name: 'Composite index',
      caption: 'An index on (last, first) helps queries that filter by last name.',
      description:
        'An index sorted by last name, then first name. A query for one last name reads one block of entries. A query for only a first name finds its matches scattered.',
      labels: { last: 'Last', first: 'First' },
    },
  ],
  tradeoffs: {
    useWhen: 'queries filter, join or sort on a column, and reads outnumber writes.',
    costs: 'disk space and slower writes, since every index must change too.',
    realExample: 'a login finds one user by email through an index on email.',
    watchOut: 'a query on LOWER(email) cannot use a plain index on email.',
  },
  quiz: [
    {
      id: 'concepts/indexes/q1',
      prompt: '1,000,000 rows, no index on email. How many rows does one email lookup check?',
      ordered: true,
      options: [
        {
          text: 'About 20',
          why: 'That is what a sorted index needs. Without one, there is no order to use.',
        },
        { text: 'About 1,000', why: 'Nothing narrows the search, so it cannot stop early.' },
        {
          text: 'All 1,000,000',
          correct: true,
          why: 'With no index, any row could match, so the database reads every one.',
        },
      ],
    },
    {
      id: 'concepts/indexes/q2',
      prompt: 'A busy table gets 5 new indexes. What happens to inserts?',
      options: [
        { text: 'They get faster', why: 'Indexes speed up reads. Each insert now has more to update.' },
        {
          text: 'They slow down, since each updates every index',
          correct: true,
          why: 'One insert now writes the row plus 5 index entries.',
        },
        { text: 'Nothing changes', why: 'Every index on the table must take each new row.' },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#indexes',
      label: 'Indexes',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/8-data-structures-that-power-your-databases/',
      label: '8 data structures that power your databases',
    },
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#use-good-indices',
      label: 'Use good indices',
    },
  ],
};

export default indexes;
