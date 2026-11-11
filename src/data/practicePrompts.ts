/**
 * Content for the timed design round: the seven checklist steps with guiding
 * questions and rubric criteria, and a small pool of prompts drawn from
 * systems the course covers. Each prompt carries a reference outline that the
 * learner sees only after the round.
 */
export interface ChecklistStep {
  title: string;
  question: string;
  guide: readonly string[];
  /** What a solid answer to this step contains. */
  criterion: string;
}

export const checklistSteps: readonly ChecklistStep[] = [
  {
    title: 'Requirements',
    question: 'What must it do, and how well?',
    guide: [
      'Which two or three features must work on day one?',
      'How fast must it answer, and how much downtime is acceptable?',
      'What will you leave out? Say it out loud.',
    ],
    criterion: 'Named the core features, at least one latency or uptime target, and something out of scope.',
  },
  {
    title: 'Estimates',
    question: 'How big is it?',
    guide: [
      'How many writes and reads per second, on average and at peak?',
      'How much storage does the system need over its life?',
      'Which way does the read to write ratio lean?',
    ],
    criterion: 'Worked out peak requests per second and total storage, with units.',
  },
  {
    title: 'API',
    question: 'How do callers talk to it?',
    guide: [
      'Which calls does a client make, and what goes in and out of each?',
      'Which errors can each call return?',
      'Which call might a client retry, and what happens if it does?',
    ],
    criterion: 'Listed each call with its inputs, its outputs, and at least one error.',
  },
  {
    title: 'Data model',
    question: 'What do you store, and how do you read it?',
    guide: [
      'Which entities do you store, and what is the key of each?',
      'Which query runs most often?',
      'Does that query read one key, or does it scan?',
    ],
    criterion: 'Named the entities, their keys, and the most frequent query.',
  },
  {
    title: 'High-level design',
    question: 'Which boxes, and how does a request flow?',
    guide: [
      'Which boxes does a read pass through?',
      'Which boxes does a write pass through?',
      'What job does each box do? Remove any box without one.',
    ],
    criterion: 'Drew the read path and the write path separately, and every box has a job.',
  },
  {
    title: 'Deep dive',
    question: 'Where does it break first?',
    guide: [
      'Which number from your estimates worries you most?',
      'What fails first when traffic triples or one machine dies?',
      'What is your fix, and what does it cost?',
    ],
    criterion: 'Picked the riskiest part, tied it to a number, and designed a fix.',
  },
  {
    title: 'Trade-offs',
    question: 'What did you give up, and why?',
    guide: [
      'Which alternatives did you reject?',
      'What does each choice you made cost?',
      'What would make you change your mind?',
    ],
    criterion: 'Named at least two choices, the alternative to each, and what each choice costs.',
  },
];

export const rubricLevels = [
  { score: 0, label: 'Missing' },
  { score: 1, label: 'Partial' },
  { score: 2, label: 'Solid' },
] as const;

export type PromptId = 'url-shortener' | 'paste-bin' | 'news-feed' | 'flash-sale';

export interface PracticePrompt {
  id: PromptId;
  title: string;
  /** The scale numbers, shown on the prompt chip. */
  scale: string;
  brief: string;
  /** One list of points per checklist step. */
  outline: readonly (readonly string[])[];
}

export const practicePrompts: readonly PracticePrompt[] = [
  {
    id: 'url-shortener',
    title: 'URL shortener',
    scale: '1M links a day, 100 clicks each',
    brief:
      'People paste a long URL and get a short link back. Anyone who opens the short link lands on the long URL. Expect 1 million new links a day, each clicked about 100 times.',
    outline: [
      [
        'Create a short link, and redirect anyone who opens it.',
        'Redirects under 100 ms, 99.9% uptime, and a link never changes once created.',
        'Out of scope: click analytics and custom aliases.',
      ],
      [
        'Writes: 1,000,000 ÷ 86,400 ≈ 12 per second.',
        'Reads: 12 × 100 ≈ 1,200 per second on average, a few thousand at peak.',
        'Storage: about 1.8 billion links in 5 years at 500 bytes each ≈ 1 TB.',
      ],
      [
        'POST /links takes a long URL and returns a short code. An invalid URL gets 400.',
        'GET /{code} answers with a redirect. An unknown code gets 404.',
      ],
      [
        'One table: code (the primary key), long URL, and creation time.',
        'Every read looks up one code, so a key to value lookup fits.',
      ],
      [
        'Write path: browser, load balancer, app server, database.',
        'Read path: browser, load balancer, app server, cache, and the database on a cache miss.',
      ],
      [
        'A viral link floods one key. The cache absorbs the repeat reads.',
        'About 1 TB outgrows one machine over the years. Shard the table by code.',
        'Short codes: a counter encoded in base62 never collides, and random codes need a uniqueness check.',
      ],
      [
        'A 301 redirect lets browsers cache it, so repeat clicks never reach you and click counts go missing. A 302 keeps every click visible at the cost of more traffic.',
        'Random codes resist guessing. Counter codes stay shorter and make the next link easy to guess.',
      ],
    ],
  },
  {
    id: 'paste-bin',
    title: 'Paste sharing site',
    scale: '100k pastes a day, 10 KB each, kept 2 years',
    brief:
      'People save a text snippet and share a link to it. Expect 100,000 new pastes a day at about 10 KB each. Each paste is read about 10 times, and pastes stay for 2 years.',
    outline: [
      [
        'Save a paste and get a link. Open the link to read the paste.',
        'Pastes expire after 2 years, or sooner if the author asks.',
        'Reads under 200 ms, and a saved paste is never lost.',
        'Out of scope: editing and search.',
      ],
      [
        'Writes: 100,000 ÷ 86,400 ≈ 1.2 per second.',
        'Reads: about 12 per second. One small server handles the traffic.',
        'Storage: 100,000 × 365 × 2 × 10 KB ≈ 730 GB. Storage drives this design far more than traffic.',
      ],
      [
        'POST /pastes takes the text and an optional expiry and returns an id. Text over the size limit gets 413.',
        'GET /pastes/{id} returns the text. An unknown or expired id gets 404.',
      ],
      [
        'Metadata table: id (the primary key), creation time, expiry time, size, and the storage key of the body.',
        'Paste bodies live in object storage, keyed by id.',
        'Reads look up one id. An index on expiry time lets a cleanup job find old pastes.',
      ],
      [
        'Write path: browser, load balancer, app server, then the body to object storage and the metadata to the database.',
        'Read path: browser, cache, app server, a metadata lookup, then the body from object storage.',
      ],
      [
        'Storage growth: 730 GB costs little in object storage and much more on database disks.',
        'Expiry: a scheduled job deletes expired pastes in batches, and every read checks the expiry time so a late delete never shows an expired paste.',
        'Abuse: cap the paste size and rate limit writes for each user.',
      ],
      [
        'Object storage costs less per GB and adds a second call to every read.',
        'Checking expiry on read is simple, and deleting eagerly frees space sooner. Use both.',
      ],
    ],
  },
  {
    id: 'news-feed',
    title: 'News feed',
    scale: '10M daily users, 200 follows each',
    brief:
      'People follow accounts and read a home feed of recent posts, newest first. Expect 10 million daily users. Each one follows about 200 accounts, posts once a day, and opens the feed 10 times a day.',
    outline: [
      [
        'Post, follow an account, and read a home feed, newest first.',
        'The feed loads in under 200 ms. A new post may take a few seconds to appear.',
        'Out of scope: ranking, comments, and ads.',
      ],
      [
        'Posts: 10,000,000 ÷ 86,400 ≈ 120 per second.',
        'Feed reads: 100 million a day ≈ 1,200 per second on average, a few thousand at peak.',
        'Fan-out on write: 120 posts × 200 followers ≈ 24,000 feed inserts per second.',
      ],
      [
        'POST /posts creates a post.',
        'POST /follows/{account} follows an account.',
        'GET /feed?cursor=… returns one page of the feed. The cursor keeps pages stable while new posts arrive.',
      ],
      [
        'Posts: id, author, creation time, and text.',
        'Follows: follower and followee, read in both directions.',
        'Feeds: for each user, a list of recent post ids, newest first, kept in a cache.',
      ],
      [
        'Write path: the app server stores the post, and a queue hands it to fan-out workers that push the post id into each follower feed.',
        'Read path: load balancer, feed service, the user feed list, then post details from a cache.',
      ],
      [
        'Celebrities: one post from an account with 50 million followers means 50 million inserts.',
        'Fix: skip fan-out for huge accounts and merge their recent posts in at read time.',
        'Keep only the newest few hundred ids in each feed to bound memory.',
      ],
      [
        'Fan-out on write makes reads fast and writes heavy. Fan-out on read reverses that.',
        'The hybrid adds code and keeps both paths bounded.',
        'A post appears a few seconds late, which a feed tolerates.',
      ],
    ],
  },
  {
    id: 'flash-sale',
    title: 'Flash-sale ticketing',
    scale: '50k seats, 2M buyers in the first minute',
    brief:
      'A concert puts 50,000 seats on sale at 10:00. About 2 million people arrive in the first minute. No seat may be sold twice, and a buyer gets 10 minutes to pay for a held seat.',
    outline: [
      [
        'Join the sale, hold a seat, and pay within 10 minutes.',
        'Never sell a seat twice, and never take a payment without a seat.',
        'Stay up through the first minute, even if buyers wait in line.',
      ],
      [
        'Arrivals: 2,000,000 ÷ 60 ≈ 33,000 requests per second at the start.',
        'Only 50,000 seats, so about 1 in 40 people get one.',
        'Seat writes stay small: about 50,000 holds, plus seats that return when holds expire.',
      ],
      [
        'POST /sale/join returns a place in line.',
        'POST /holds takes a seat and returns a hold that expires in 10 minutes. A taken seat gets 409.',
        'POST /orders takes a hold and an idempotency key and charges the buyer once.',
      ],
      [
        'Seats: event, seat id, state (free, held, or sold), and hold expiry.',
        'Orders: id, seat, buyer, payment status, and a unique idempotency key.',
        'The busiest write changes one seat from free to held, only if it is still free.',
      ],
      [
        'Arrival path: load balancer, then a waiting room that admits buyers at a rate the database can take.',
        'Hold path: an app server runs a conditional update on the seat row.',
        'Pay path: the order service calls the payment provider, then marks the seat sold.',
      ],
      [
        'The stampede: 33,000 requests per second at one seat table. A waiting room and rate limits cap the load.',
        'Overselling: a conditional update or a unique constraint lets exactly one hold win.',
        'Payment retries: the idempotency key stops a retried request from charging twice.',
        'Expired holds return their seats to the pool.',
      ],
      [
        'A waiting room makes buyers wait and protects the database.',
        'Expiring holds free seats for others, and a slow buyer can lose a seat while paying.',
        'Strict checks on every seat cost throughput. A ticket sale chooses correctness.',
      ],
    ],
  },
];
