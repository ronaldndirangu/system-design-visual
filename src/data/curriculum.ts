/**
 * Single source of truth for the course map. The sidebar, the curriculum
 * page, lesson headers, and progress tracking all read from here. A unit
 * test checks that every lesson has a matching MDX file.
 */

/** A card is a short reference page; a lesson follows the full seven-beat flow. */
export type LessonFormat = 'lesson' | 'card';

/** 1 foundational, 2 intermediate, 3 advanced. */
export type Difficulty = 1 | 2 | 3;

export const difficultyLabels: Record<Difficulty, string> = {
  1: 'Foundational',
  2: 'Intermediate',
  3: 'Advanced',
};

export interface Lesson {
  /** Docs entry id, which is also the URL path, e.g. "scaling/caching". */
  id: string;
  title: string;
  summary: string;
  /** Declared time. A unit test keeps it within 25% of the time computed from the MDX. */
  minutes: number;
  difficulty: Difficulty;
  /** True for difficulty 3, derived so the map badge and the lesson header always agree. */
  advanced: boolean;
  /** Earlier lessons this one assumes. The header links them and the Recall box quizzes them. */
  buildsOn?: string[];
  /** Running example when it differs from the module's, e.g. "Chat" inside a mixed module. */
  example?: string;
  /** Minutes of fixed-clock practice the lesson asks for, such as a timed drill. */
  drillMinutes?: number;
  format?: LessonFormat;
  /** Id of the module a learner should finish first. Lets case studies interleave with the core path. */
  bestAfter?: string;
}

export interface CourseModule {
  id: string;
  number: number;
  title: string;
  summary: string;
  /** The system this module uses as its running example. */
  example: string;
  /** False when each lesson brings its own system, so lesson headers show no example chip. */
  sharedExample?: boolean;
  lessons: Lesson[];
}

type LessonInput = Omit<Lesson, 'advanced'>;
type ModuleInput = Omit<CourseModule, 'lessons'> & { lessons: LessonInput[] };

const modules: ModuleInput[] = [
  {
    id: 'thinking',
    number: 0,
    title: 'Thinking in systems',
    summary: 'Turn a vague idea into numbers and questions you can design against.',
    example: 'URL shortener',
    lessons: [
      {
        id: 'thinking/anatomy-of-a-web-app',
        title: 'Anatomy of a web app',
        summary: 'Follow one request through the boxes every design reuses, and learn four words for slow.',
        minutes: 7,
        difficulty: 1,
        format: 'card',
      },
      {
        id: 'thinking/requirements-and-estimates',
        title: 'Requirements and estimates',
        summary: 'Size a URL shortener on the back of an envelope before you draw a single box.',
        minutes: 24,
        difficulty: 1,
        buildsOn: ['thinking/anatomy-of-a-web-app'],
      },
      {
        id: 'thinking/design-checklist',
        title: 'The design checklist',
        summary: 'Seven questions to ask about any system. Every case study in this course reuses them.',
        minutes: 7,
        difficulty: 1,
        buildsOn: ['thinking/requirements-and-estimates'],
        format: 'card',
      },
      {
        id: 'thinking/access-patterns',
        title: 'Access patterns and hot keys',
        summary: 'Learn who reads what, how often, and why a few keys get most of the traffic.',
        minutes: 24,
        difficulty: 1,
        buildsOn: ['thinking/requirements-and-estimates'],
      },
      {
        id: 'thinking/slos',
        title: 'SLOs and measurement',
        summary:
          'Define "fast enough" with percentiles, an SLO and an error budget, then check which fix keeps the promise.',
        minutes: 24,
        difficulty: 1,
        buildsOn: ['thinking/access-patterns'],
      },
    ],
  },
  {
    id: 'foundations',
    number: 1,
    title: 'Foundations',
    summary:
      'The building blocks every system shares: networks, APIs, data models, transactions, and indexes.',
    example: 'URL shortener',
    lessons: [
      {
        id: 'foundations/what-happens-when-you-click',
        title: 'What happens when you click a link',
        summary: 'Follow one click through DNS, TCP, TLS, and HTTP, and see where the time goes.',
        minutes: 23,
        difficulty: 1,
        buildsOn: ['thinking/slos'],
      },
      {
        id: 'foundations/apis',
        title: 'API styles',
        summary: 'Choose between REST, RPC, and GraphQL, and write a contract that is hard to call wrong.',
        minutes: 19,
        difficulty: 1,
        buildsOn: ['foundations/what-happens-when-you-click'],
      },
      {
        id: 'foundations/api-design',
        title: 'API design details',
        summary:
          'Page through big lists, version without breaking callers, and return errors clients can act on.',
        minutes: 24,
        difficulty: 1,
        buildsOn: ['foundations/apis'],
      },
      {
        id: 'foundations/data-modeling',
        title: 'Data modeling and storage choice',
        summary: 'Let the access pattern choose between tables, documents, and key-value stores.',
        minutes: 23,
        difficulty: 1,
        buildsOn: ['thinking/access-patterns'],
      },
      {
        id: 'foundations/transactions',
        title: 'Transactions and constraints',
        summary:
          'Keep one database correct under concurrent writes with isolation, unique keys, and conditional updates.',
        minutes: 24,
        difficulty: 1,
        buildsOn: ['foundations/data-modeling'],
      },
      {
        id: 'foundations/indexes',
        title: 'Indexes',
        summary:
          'Find one row among billions without reading them all, and see what every index costs on write.',
        minutes: 26,
        difficulty: 1,
        buildsOn: ['foundations/data-modeling', 'foundations/transactions'],
      },
      {
        id: 'foundations/unique-ids',
        title: 'Unique IDs',
        summary:
          'Mint IDs that never collide, from one counter to Snowflake, UUIDv7, and short base62 codes.',
        format: 'card',
        minutes: 10,
        difficulty: 1,
        buildsOn: ['foundations/data-modeling', 'foundations/indexes'],
      },
      {
        id: 'foundations/storage-engines',
        title: 'Storage engines',
        summary:
          'Follow a write through the log, B-trees, and LSM trees, and see what each engine pays for speed.',
        minutes: 22,
        difficulty: 2,
        buildsOn: ['foundations/indexes', 'foundations/transactions'],
      },
      {
        id: 'foundations/real-time',
        title: 'Real-time transport',
        summary: 'Compare polling, long polling, server-sent events, and WebSockets.',
        format: 'card',
        minutes: 11,
        difficulty: 1,
        buildsOn: ['foundations/what-happens-when-you-click'],
      },
      {
        id: 'foundations/security',
        title: 'Security basics',
        summary: 'Authenticate callers, authorize actions, encrypt traffic, and keep secrets out of code.',
        minutes: 23,
        difficulty: 1,
        buildsOn: ['foundations/apis', 'foundations/what-happens-when-you-click'],
      },
      {
        id: 'foundations/auth',
        title: 'Sessions, tokens, and OAuth',
        summary:
          'Pick sessions or tokens, avoid the classic JWT mistakes, and see how OAuth hands out access.',
        format: 'card',
        minutes: 7,
        difficulty: 1,
        buildsOn: ['foundations/security'],
      },
    ],
  },
  {
    id: 'scaling',
    number: 2,
    title: 'Scaling the URL shortener',
    summary: 'Grow from one user to 100 million by adding one component at a time.',
    example: 'URL shortener',
    lessons: [
      {
        id: 'scaling/load-balancing',
        title: 'The server melts',
        summary: 'Scale up, scale out, and spread traffic with a load balancer.',
        minutes: 27,
        difficulty: 1,
        buildsOn: ['thinking/requirements-and-estimates', 'foundations/what-happens-when-you-click'],
      },
      {
        id: 'scaling/caching',
        title: 'Caching',
        summary: 'Answer popular requests from memory and watch the database relax.',
        minutes: 25,
        difficulty: 1,
        buildsOn: ['scaling/load-balancing', 'thinking/access-patterns'],
      },
      {
        id: 'scaling/cdn',
        title: 'CDNs',
        summary: 'Move bytes closer to people so distance stops dominating latency.',
        minutes: 20,
        difficulty: 1,
        buildsOn: ['scaling/caching', 'foundations/what-happens-when-you-click'],
      },
      {
        id: 'scaling/object-storage',
        title: 'Object storage',
        summary:
          'Store large files in buckets with presigned URLs, multipart uploads, tiers, and erasure coding.',
        format: 'card',
        minutes: 10,
        difficulty: 1,
        buildsOn: ['scaling/cdn'],
      },
      {
        id: 'scaling/read-replicas',
        title: 'Replication',
        summary:
          'Copy the database to serve more reads and survive a failover, and handle the lag that copying creates.',
        minutes: 23,
        difficulty: 2,
        buildsOn: ['scaling/caching', 'scaling/cdn'],
      },
      {
        id: 'scaling/sharding',
        title: 'Sharding and partitioning',
        summary:
          'Split data across machines with a shard key, and keep one hot key from overloading a shard.',
        minutes: 24,
        difficulty: 2,
        buildsOn: ['scaling/read-replicas', 'thinking/access-patterns'],
      },
      {
        id: 'scaling/consistent-hashing',
        title: 'Consistent hashing and rebalancing',
        summary: 'Add a shard without reshuffling everything, and move data while the cluster keeps serving.',
        minutes: 23,
        difficulty: 2,
        buildsOn: ['scaling/sharding'],
      },
    ],
  },
  {
    id: 'reliability',
    number: 3,
    title: 'Reliability',
    summary: 'Keep working when parts fail, slow down, or get flooded.',
    example: 'URL shortener and its click analytics pipeline',
    lessons: [
      {
        id: 'reliability/timeouts',
        title: 'Timeouts and cancellation',
        summary: 'Stop waiting forever on a dependency, and stop doing work nobody is waiting for.',
        minutes: 30,
        difficulty: 1,
        buildsOn: ['thinking/slos', 'scaling/load-balancing'],
      },
      {
        id: 'reliability/queues-and-backpressure',
        title: 'Queues and backpressure',
        summary: 'Absorb bursts, push back when the queue fills, and shed load before the system tips over.',
        minutes: 24,
        difficulty: 2,
        buildsOn: ['reliability/timeouts'],
      },
      {
        id: 'reliability/idempotency',
        title: 'Idempotency',
        summary: 'Make "do it again" safe so a repeated request never double charges anyone.',
        minutes: 21,
        difficulty: 2,
        buildsOn: ['reliability/queues-and-backpressure', 'foundations/apis'],
      },
      {
        id: 'reliability/retries',
        title: 'Retries with backoff and jitter',
        summary: 'Retry without stampeding a service that is already struggling.',
        minutes: 30,
        difficulty: 2,
        buildsOn: ['reliability/timeouts', 'reliability/idempotency'],
      },
      {
        id: 'reliability/rate-limiting',
        title: 'Rate limiting',
        summary: 'Share capacity fairly with token buckets and sliding windows.',
        minutes: 30,
        difficulty: 2,
        buildsOn: ['reliability/retries', 'reliability/queues-and-backpressure'],
      },
      {
        id: 'reliability/circuit-breakers',
        title: 'Circuit breakers',
        summary: 'Fail fast when a dependency is down, then test it gently.',
        minutes: 30,
        difficulty: 2,
        buildsOn: ['reliability/timeouts', 'reliability/retries'],
      },
      {
        id: 'reliability/observability',
        title: 'Observability',
        summary: 'Use logs, metrics, and traces to answer questions you did not plan for.',
        minutes: 30,
        difficulty: 2,
        buildsOn: ['thinking/slos', 'reliability/circuit-breakers'],
      },
      {
        id: 'reliability/backups-and-recovery',
        title: 'Backups and recovery',
        summary:
          'Undo a bad write that every replica already copied, within budgets for data lost and time down.',
        minutes: 23,
        difficulty: 2,
        buildsOn: ['reliability/observability', 'scaling/read-replicas'],
      },
    ],
  },
  {
    id: 'async',
    number: 4,
    title: 'Async and streaming',
    summary: 'Move work off the request path with logs, events, and stream processors.',
    example: 'Click analytics pipeline',
    lessons: [
      {
        id: 'async/logs-and-pubsub',
        title: 'Logs and pub/sub',
        summary: 'Partition a log, run consumer groups, and see why order holds only within a partition.',
        minutes: 26,
        difficulty: 2,
        buildsOn: ['scaling/sharding', 'reliability/queues-and-backpressure'],
      },
      {
        id: 'async/delivery-semantics',
        title: 'Delivery semantics and the outbox',
        summary:
          'At most once, at least once, and effectively once through idempotent consumers, plus the outbox that keeps events and data in step.',
        minutes: 26,
        difficulty: 2,
        buildsOn: ['async/logs-and-pubsub', 'reliability/idempotency'],
      },
      {
        id: 'async/event-driven-design',
        title: 'Event-driven design',
        summary:
          'Choose between thin and fat events, choreography and orchestration, evolve event schemas safely, and park poison messages in a dead-letter queue.',
        minutes: 27,
        difficulty: 2,
        buildsOn: ['async/delivery-semantics'],
      },
      {
        id: 'async/stream-processing',
        title: 'Stream processing',
        summary:
          'Count events in windows, handle late data with watermarks, and choose between batch and stream.',
        minutes: 28,
        difficulty: 2,
        buildsOn: ['async/logs-and-pubsub', 'async/delivery-semantics'],
      },
    ],
  },
  {
    id: 'distributed-data',
    number: 5,
    title: 'Distributed data',
    summary: 'Reason about copies of data that disagree, and choose what to give up.',
    example: 'Shopping cart and chat',
    lessons: [
      {
        id: 'distributed-data/consistency-models',
        title: 'Consistency models',
        summary: 'From strong to eventual: what each promise lets a reader see.',
        minutes: 23,
        difficulty: 2,
        buildsOn: ['scaling/read-replicas'],
        example: 'Chat',
      },
      {
        id: 'distributed-data/cap-and-pacelc',
        title: 'CAP and PACELC',
        summary:
          'See what a network partition forces you to choose, and what latency costs you the rest of the time.',
        minutes: 23,
        difficulty: 2,
        buildsOn: ['distributed-data/consistency-models'],
        example: 'Shopping cart',
      },
      {
        id: 'distributed-data/quorums',
        title: 'Quorums on a replicated ring',
        summary: 'Tune N, R, and W, and watch reads and writes survive node loss.',
        minutes: 25,
        difficulty: 2,
        buildsOn: ['distributed-data/cap-and-pacelc', 'scaling/sharding', 'scaling/consistent-hashing'],
        example: 'Shopping cart',
      },
      {
        id: 'distributed-data/time-leases-fencing',
        title: 'Time, leases, and fencing',
        summary:
          'See why clocks lie, why a lock can expire under you, and how a fencing token stops a stale writer.',
        minutes: 24,
        difficulty: 3,
        buildsOn: ['distributed-data/quorums', 'reliability/idempotency'],
        example: 'Chat',
      },
      {
        id: 'distributed-data/raft',
        title: 'Consensus with Raft',
        summary: 'Watch nodes elect a leader and agree on a log.',
        minutes: 25,
        difficulty: 3,
        buildsOn: ['distributed-data/quorums'],
        example: 'Chat',
      },
      {
        id: 'distributed-data/multi-region',
        title: 'Multi-region systems',
        summary:
          'Survive a region going dark: route users nearby, pick where writes live, and fail over without split brain.',
        minutes: 20,
        difficulty: 3,
        buildsOn: ['distributed-data/raft', 'distributed-data/cap-and-pacelc'],
        example: 'Chat',
      },
      {
        id: 'distributed-data/sagas',
        title: 'Sagas',
        summary: 'Coordinate a multi-step business process with compensating steps instead of a global lock.',
        minutes: 25,
        difficulty: 3,
        buildsOn: ['foundations/transactions', 'async/event-driven-design'],
        example: 'Shopping cart checkout',
      },
      {
        id: 'distributed-data/cqrs',
        title: 'CQRS and event sourcing',
        summary: 'Split the write model from the read model when they want different shapes.',
        minutes: 25,
        difficulty: 3,
        buildsOn: ['async/event-driven-design', 'scaling/read-replicas'],
        example: 'Shopping cart',
      },
    ],
  },
  {
    id: 'case-studies',
    number: 6,
    title: 'Case studies',
    summary:
      'Ten products, each chosen for one constraint that dominates its design. Start each one as soon as you finish the module it builds on. Beginner route: News feed and Notifications, then Ticketing, Payments and Chat, then Video streaming, Search, Ride sharing, Metrics and Collaborative editor.',
    example: 'A different system per lesson',
    sharedExample: false,
    lessons: [
      {
        id: 'case-studies/search',
        title: 'Search',
        summary:
          'Keep a news index fresh, give each ranking signal its own clock, then add typeahead as an extension.',
        minutes: 50,
        difficulty: 3,
        buildsOn: ['foundations/indexes', 'scaling/sharding', 'scaling/caching'],
        bestAfter: 'scaling',
      },
      {
        id: 'case-studies/news-feed',
        title: 'News feed',
        summary: 'Fan out on write or on read, and handle the celebrity whose post reaches millions.',
        minutes: 30,
        difficulty: 2,
        buildsOn: ['scaling/caching', 'scaling/sharding', 'reliability/queues-and-backpressure'],
        bestAfter: 'reliability',
      },
      {
        id: 'case-studies/video-streaming',
        title: 'Video streaming',
        summary:
          'Store large files in object storage, upload them in parts, transcode a bitrate ladder, and pay for bandwidth wisely.',
        minutes: 30,
        difficulty: 3,
        buildsOn: ['scaling/cdn', 'reliability/idempotency', 'reliability/queues-and-backpressure'],
        bestAfter: 'reliability',
      },
      {
        id: 'case-studies/ticketing',
        title: 'Flash-sale ticketing',
        summary: 'Sell 10,000 seats to a million people without selling one seat twice.',
        minutes: 33,
        difficulty: 2,
        buildsOn: ['foundations/transactions', 'reliability/idempotency', 'reliability/rate-limiting'],
        bestAfter: 'reliability',
      },
      {
        id: 'case-studies/payments',
        title: 'Payments',
        summary:
          'Move money exactly once, reconcile with banks, and compare the failure modes with ticketing.',
        minutes: 36,
        difficulty: 2,
        buildsOn: ['reliability/idempotency', 'async/delivery-semantics', 'foundations/transactions'],
        bestAfter: 'async',
      },
      {
        id: 'case-studies/chat',
        title: 'Chat',
        summary: 'Keep connections alive, deliver messages in order, and sync devices that were offline.',
        minutes: 35,
        difficulty: 2,
        buildsOn: ['foundations/real-time', 'async/logs-and-pubsub'],
        bestAfter: 'async',
      },
      {
        id: 'case-studies/notifications',
        title: 'Notifications',
        summary:
          'Deliver through external providers with deadlines and preferences, and contrast it with chat.',
        minutes: 36,
        difficulty: 2,
        buildsOn: ['reliability/queues-and-backpressure', 'reliability/retries', 'async/delivery-semantics'],
        bestAfter: 'async',
      },
      {
        id: 'case-studies/ride-sharing',
        title: 'Ride sharing',
        summary: 'Index fast-changing locations with one geospatial scheme and match riders to drivers.',
        minutes: 47,
        difficulty: 3,
        buildsOn: ['scaling/sharding', 'foundations/indexes', 'foundations/real-time'],
        bestAfter: 'async',
      },
      {
        id: 'case-studies/metrics',
        title: 'Metrics and alerting',
        summary:
          'Ingest millions of writes per second, control label cardinality, downsample, and expire old data.',
        minutes: 46,
        difficulty: 3,
        buildsOn: ['async/logs-and-pubsub', 'async/stream-processing', 'reliability/observability'],
        bestAfter: 'async',
      },
      {
        id: 'case-studies/collaborative-editor',
        title: 'Collaborative editor',
        summary: 'Merge concurrent edits so every copy of the document converges.',
        minutes: 35,
        difficulty: 3,
        buildsOn: ['foundations/real-time', 'distributed-data/consistency-models'],
        bestAfter: 'distributed-data',
      },
    ],
  },
  {
    id: 'ai-systems',
    number: 7,
    title: 'AI systems',
    summary: 'Design products around models: evaluate first, then route, retrieve, serve, and act safely.',
    example: 'Customer support assistant',
    lessons: [
      {
        id: 'ai-systems/evaluation-and-budgets',
        title: 'Evaluation and budgets',
        summary:
          'Define the task, build an evaluation set, and set quality, latency, and cost budgets before choosing a model.',
        minutes: 27,
        difficulty: 2,
        buildsOn: ['thinking/requirements-and-estimates', 'thinking/slos'],
      },
      {
        id: 'ai-systems/gateway',
        title: 'The AI gateway',
        summary:
          'Route and cascade model calls, cache safely, enforce quotas, validate output, and fall back.',
        minutes: 29,
        difficulty: 2,
        buildsOn: ['ai-systems/evaluation-and-budgets', 'scaling/load-balancing', 'scaling/caching'],
      },
      {
        id: 'ai-systems/retrieval',
        title: 'Retrieval',
        summary:
          'Ground answers in your documents with chunking, hybrid search, tenant scoping, and citations.',
        minutes: 28,
        difficulty: 2,
        buildsOn: ['ai-systems/evaluation-and-budgets', 'ai-systems/gateway'],
      },
      {
        id: 'ai-systems/llm-serving',
        title: 'Serving models',
        summary:
          'See why prefill and decode behave differently, and how batching and KV cache memory set throughput.',
        minutes: 28,
        difficulty: 3,
        buildsOn: ['ai-systems/gateway', 'scaling/load-balancing'],
      },
      {
        id: 'ai-systems/agents',
        title: 'Agents and tools',
        summary:
          'Let a model call tools with authorization, injection boundaries, budgets, and cancellation.',
        minutes: 25,
        difficulty: 3,
        buildsOn: ['ai-systems/gateway', 'ai-systems/retrieval'],
      },
      {
        id: 'ai-systems/recommendations',
        title: 'Recommendation systems',
        summary: 'Narrow millions of items to a handful with candidate generation, then ranking.',
        minutes: 28,
        difficulty: 2,
        buildsOn: ['ai-systems/retrieval', 'ai-systems/evaluation-and-budgets'],
      },
      {
        id: 'ai-systems/support-assistant',
        title: 'Capstone: support assistant',
        summary:
          'Design a multi-tenant assistant with citations, an abstention path, one approved action, and a fixed budget.',
        minutes: 24,
        difficulty: 3,
        buildsOn: ['ai-systems/retrieval', 'ai-systems/gateway', 'ai-systems/agents'],
      },
    ],
  },
  {
    id: 'practice',
    number: 8,
    title: 'Practice',
    summary: "Use the design checklist on your own, against a clock, and on someone else's design.",
    example: 'Any system',
    sharedExample: false,
    lessons: [
      {
        id: 'practice/timed-round',
        title: 'Timed design round',
        summary: 'Design a system end to end with the checklist and a timer.',
        minutes: 30,
        difficulty: 2,
        drillMinutes: 20,
        buildsOn: ['thinking/design-checklist'],
      },
      {
        id: 'practice/design-review',
        title: 'Review a design',
        summary: 'Find the anti-patterns in a flawed design and explain how you would fix each one.',
        minutes: 20,
        difficulty: 2,
        buildsOn: ['thinking/design-checklist'],
      },
      {
        id: 'practice/capstone',
        title: 'Take sho.rt global',
        summary:
          'Design sho.rt for three regions and a 99.99% SLO, score each step, then compare with a reference answer.',
        minutes: 65,
        difficulty: 3,
        drillMinutes: 45,
        buildsOn: ['thinking/design-checklist', 'distributed-data/multi-region'],
        bestAfter: 'distributed-data',
      },
    ],
  },
];

export const curriculum: CourseModule[] = modules.map((module) => ({
  ...module,
  lessons: module.lessons.map((lesson) => ({ ...lesson, advanced: lesson.difficulty === 3 })),
}));

export const allLessons: Lesson[] = curriculum.flatMap((module) => module.lessons);

export function findLesson(id: string): Lesson | undefined {
  return allLessons.find((lesson) => lesson.id === normalizeId(id));
}

export function findModule(id: string): CourseModule | undefined {
  return curriculum.find((module) => module.id === id);
}

export function findModuleForLesson(id: string): CourseModule | undefined {
  const normalized = normalizeId(id);
  return curriculum.find((module) => module.lessons.some((lesson) => lesson.id === normalized));
}

/** 1-based position of a lesson in course order. */
export function lessonPosition(id: string): number | undefined {
  const index = allLessons.findIndex((lesson) => lesson.id === normalizeId(id));
  return index === -1 ? undefined : index + 1;
}

/** Anchor id used on the curriculum page for a module or lesson. */
export function anchorFor(id: string): string {
  return id.replaceAll('/', '--');
}

/** The system a lesson's examples follow, or undefined when its module has no shared one. */
export function runningExampleFor(id: string): string | undefined {
  const lesson = findLesson(id);
  const module = findModuleForLesson(id);
  if (!lesson || !module) return undefined;
  if (lesson.example) return lesson.example;
  return module.sharedExample === false ? undefined : module.example;
}

function normalizeId(id: string): string {
  return id.replace(/^\/+|\/+$/g, '');
}
