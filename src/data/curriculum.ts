/**
 * Single source of truth for the course map. The sidebar, the curriculum
 * page, lesson headers, and progress tracking all read from here. A unit
 * test checks that every "ready" lesson has a matching MDX file.
 */
export type LessonStatus = 'ready' | 'soon';

/** A card is a short reference page; a lesson follows the full seven-beat flow. */
export type LessonFormat = 'lesson' | 'card';

export interface Lesson {
  /** Docs entry id, which is also the URL path, e.g. "scaling/caching". */
  id: string;
  title: string;
  summary: string;
  status: LessonStatus;
  minutes?: number;
  advanced?: boolean;
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
  lessons: Lesson[];
}

export const curriculum: CourseModule[] = [
  {
    id: 'thinking',
    number: 0,
    title: 'Thinking in systems',
    summary: 'Turn a vague idea into numbers and questions you can design against.',
    example: 'URL shortener',
    lessons: [
      {
        id: 'thinking/requirements-and-estimates',
        title: 'Requirements and estimates',
        summary: 'Size a URL shortener on the back of an envelope before you draw a single box.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'thinking/design-checklist',
        title: 'The design checklist',
        summary: 'Seven questions to ask about any system. Every case study in this course reuses them.',
        status: 'ready',
        minutes: 5,
        format: 'card',
      },
      {
        id: 'thinking/access-patterns',
        title: 'Access patterns and hot keys',
        summary: 'Learn who reads what, how often, and why a few keys get most of the traffic.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'thinking/slos',
        title: 'SLOs and measurement',
        summary: 'Define "fast enough" with percentiles and error budgets, then find the real bottleneck.',
        status: 'ready',
        minutes: 20,
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
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'foundations/apis',
        title: 'APIs and contracts',
        summary: 'Design endpoints that are easy to call correctly and hard to call wrong.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'foundations/data-modeling',
        title: 'Data modeling and storage choice',
        summary: 'Let the access pattern choose between tables, documents, and key-value stores.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'foundations/transactions',
        title: 'Transactions and constraints',
        summary:
          'Keep one database correct under concurrent writes with isolation, unique keys, and conditional updates.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'foundations/indexes',
        title: 'Indexes',
        summary:
          'Find one row among billions without reading them all, and see what every index costs on write.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'foundations/real-time',
        title: 'Real-time transport',
        summary: 'Compare polling, long polling, server-sent events, and WebSockets.',
        status: 'ready',
        format: 'card',
        minutes: 8,
      },
      {
        id: 'foundations/security',
        title: 'Security basics',
        summary: 'Authenticate callers, authorize actions, encrypt traffic, and keep secrets out of code.',
        status: 'ready',
        minutes: 20,
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
        status: 'ready',
        minutes: 25,
      },
      {
        id: 'scaling/caching',
        title: 'Caching',
        summary: 'Answer popular requests from memory and watch the database relax.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'scaling/cdn',
        title: 'CDNs',
        summary: 'Move bytes closer to people so distance stops dominating latency.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'scaling/read-replicas',
        title: 'Read replicas',
        summary: 'Copy the database to serve more reads, and handle the lag that copying creates.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'scaling/sharding',
        title: 'Sharding and consistent hashing',
        summary: 'Split data across machines without reshuffling everything when you add one.',
        status: 'ready',
        minutes: 25,
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
        status: 'soon',
      },
      {
        id: 'reliability/queues-and-backpressure',
        title: 'Queues and backpressure',
        summary: 'Absorb bursts, push back when the queue fills, and shed load before the system tips over.',
        status: 'soon',
      },
      {
        id: 'reliability/idempotency',
        title: 'Idempotency',
        summary: 'Make "do it again" safe so a repeated request never double charges anyone.',
        status: 'soon',
      },
      {
        id: 'reliability/retries',
        title: 'Retries with backoff and jitter',
        summary: 'Retry without stampeding a service that is already struggling.',
        status: 'soon',
      },
      {
        id: 'reliability/rate-limiting',
        title: 'Rate limiting',
        summary: 'Share capacity fairly with token buckets and sliding windows.',
        status: 'soon',
      },
      {
        id: 'reliability/circuit-breakers',
        title: 'Circuit breakers',
        summary: 'Fail fast when a dependency is down, then test it gently.',
        status: 'soon',
      },
      {
        id: 'reliability/observability',
        title: 'Observability',
        summary: 'Use logs, metrics, and traces to answer questions you did not plan for.',
        status: 'soon',
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
        status: 'soon',
      },
      {
        id: 'async/delivery-semantics',
        title: 'Delivery semantics and the outbox',
        summary:
          'At most once, at least once, and effectively once through idempotent consumers, plus the outbox that keeps events and data in step.',
        status: 'soon',
      },
      {
        id: 'async/event-driven-design',
        title: 'Event-driven design',
        summary:
          'Choose between thin and fat events, choreography and orchestration, evolve event schemas safely, and park poison messages in a dead-letter queue.',
        status: 'soon',
      },
      {
        id: 'async/stream-processing',
        title: 'Stream processing',
        summary:
          'Count events in windows, handle late data with watermarks, and choose between batch and stream.',
        status: 'soon',
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
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'distributed-data/cap-and-pacelc',
        title: 'CAP and PACELC',
        summary:
          'See what a network partition forces you to choose, and what latency costs you the rest of the time.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'distributed-data/quorums',
        title: 'Quorums on a replicated ring',
        summary: 'Tune N, R, and W, and watch reads and writes survive node loss.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'distributed-data/raft',
        title: 'Consensus with Raft',
        summary: 'Watch nodes elect a leader and agree on a log.',
        status: 'ready',
        minutes: 22,
        advanced: true,
      },
      {
        id: 'distributed-data/sagas',
        title: 'Sagas',
        summary: 'Coordinate a multi-step business process with compensating steps instead of a global lock.',
        status: 'ready',
        minutes: 22,
        advanced: true,
      },
      {
        id: 'distributed-data/cqrs',
        title: 'CQRS and event sourcing',
        summary: 'Split the write model from the read model when they want different shapes.',
        status: 'ready',
        minutes: 25,
        advanced: true,
      },
    ],
  },
  {
    id: 'case-studies',
    number: 6,
    title: 'Case studies',
    summary:
      'Ten products, each chosen for one constraint that dominates its design. Start each one as soon as you finish the module it builds on.',
    example: 'A different system per lesson',
    lessons: [
      {
        id: 'case-studies/search',
        title: 'Search',
        summary: 'Trade retrieval quality against index freshness, then add typeahead as an extension.',
        status: 'ready',
        minutes: 25,
        bestAfter: 'scaling',
      },
      {
        id: 'case-studies/news-feed',
        title: 'News feed',
        summary: 'Fan out on write or on read, and handle the celebrity whose post reaches millions.',
        status: 'ready',
        minutes: 20,
        bestAfter: 'reliability',
      },
      {
        id: 'case-studies/video-streaming',
        title: 'Video streaming',
        summary:
          'Store large files in object storage, upload them in parts, transcode a bitrate ladder, and pay for bandwidth wisely.',
        status: 'ready',
        minutes: 25,
        bestAfter: 'reliability',
      },
      {
        id: 'case-studies/ticketing',
        title: 'Flash-sale ticketing',
        summary: 'Sell 10,000 seats to a million people without selling one seat twice.',
        status: 'ready',
        minutes: 20,
        bestAfter: 'reliability',
      },
      {
        id: 'case-studies/payments',
        title: 'Payments',
        summary:
          'Move money exactly once, reconcile with banks, and compare the failure modes with ticketing.',
        status: 'ready',
        minutes: 20,
        bestAfter: 'async',
      },
      {
        id: 'case-studies/chat',
        title: 'Chat',
        summary: 'Keep connections alive, deliver messages in order, and sync devices that were offline.',
        status: 'ready',
        minutes: 20,
        bestAfter: 'async',
      },
      {
        id: 'case-studies/notifications',
        title: 'Notifications',
        summary:
          'Deliver through external providers with deadlines and preferences, and contrast it with chat.',
        status: 'ready',
        minutes: 20,
        bestAfter: 'async',
      },
      {
        id: 'case-studies/ride-sharing',
        title: 'Ride sharing',
        summary: 'Index fast-changing locations with one geospatial scheme and match riders to drivers.',
        status: 'ready',
        minutes: 25,
        bestAfter: 'async',
      },
      {
        id: 'case-studies/metrics',
        title: 'Metrics and alerting',
        summary:
          'Ingest millions of writes per second, control label cardinality, downsample, and expire old data.',
        status: 'ready',
        minutes: 25,
        bestAfter: 'async',
      },
      {
        id: 'case-studies/collaborative-editor',
        title: 'Collaborative editor',
        summary: 'Merge concurrent edits so every copy of the document converges.',
        status: 'ready',
        minutes: 20,
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
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'ai-systems/gateway',
        title: 'The AI gateway',
        summary:
          'Route and cascade model calls, cache safely, enforce quotas, validate output, and fall back.',
        status: 'ready',
        minutes: 25,
      },
      {
        id: 'ai-systems/retrieval',
        title: 'Retrieval',
        summary:
          'Ground answers in your documents with chunking, hybrid search, tenant scoping, and citations.',
        status: 'ready',
        minutes: 25,
      },
      {
        id: 'ai-systems/llm-serving',
        title: 'Serving models',
        summary:
          'See why prefill and decode behave differently, and how batching and KV cache memory set throughput.',
        status: 'ready',
        minutes: 25,
      },
      {
        id: 'ai-systems/agents',
        title: 'Agents and tools',
        summary:
          'Let a model call tools with authorization, injection boundaries, budgets, and cancellation.',
        status: 'ready',
        minutes: 25,
      },
      {
        id: 'ai-systems/recommendations',
        title: 'Recommendation systems',
        summary: 'Narrow millions of items to a handful with candidate generation, then ranking.',
        status: 'ready',
        minutes: 20,
      },
      {
        id: 'ai-systems/support-assistant',
        title: 'Capstone: support assistant',
        summary:
          'Design a multi-tenant assistant with citations, an abstention path, one approved action, and a fixed budget.',
        status: 'ready',
        minutes: 25,
      },
    ],
  },
  {
    id: 'practice',
    number: 8,
    title: 'Practice',
    summary: "Use the design checklist on your own, against a clock, and on someone else's design.",
    example: 'Any system',
    lessons: [
      {
        id: 'practice/timed-round',
        title: 'Timed design round',
        summary: 'Design a system end to end with the checklist and a timer.',
        status: 'ready',
        minutes: 25,
      },
      {
        id: 'practice/design-review',
        title: 'Review a design',
        summary: 'Find the anti-patterns in a flawed design and explain how you would fix each one.',
        status: 'ready',
        minutes: 20,
      },
    ],
  },
];
export const allLessons: Lesson[] = curriculum.flatMap((module) => module.lessons);

export const readyLessons: Lesson[] = allLessons.filter((lesson) => lesson.status === 'ready');

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

/** 1-based position among lessons that learners can open today. */
export function readyLessonPosition(id: string): number | undefined {
  const index = readyLessons.findIndex((lesson) => lesson.id === normalizeId(id));
  return index === -1 ? undefined : index + 1;
}

/** Anchor id used on the curriculum page for a module or lesson. */
export function anchorFor(id: string): string {
  return id.replaceAll('/', '--');
}

function normalizeId(id: string): string {
  return id.replace(/^\/+|\/+$/g, '');
}
