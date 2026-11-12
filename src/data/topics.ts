export interface InterviewTopic {
  /** What an interviewer asks about, for example 'Design a rate limiter'. */
  name: string;
  /** One sentence on what the interviewer probes. */
  focus: string;
  /** Curriculum lesson ids, most relevant first. */
  lessons: string[];
}

export interface TopicGroup {
  title: string;
  topics: InterviewTopic[];
}

export const topicGroups: TopicGroup[] = [
  {
    title: 'Design prompts',
    topics: [
      {
        name: 'Design a URL shortener',
        focus:
          'How you size the traffic, mint short codes that never collide, and serve hot redirects from a cache.',
        lessons: [
          'case-studies/shortener-at-scale',
          'case-studies/shortener-bad-day',
          'thinking/requirements-and-estimates',
          'foundations/unique-ids',
          'scaling/caching',
          'scaling/sharding',
          'practice/capstone',
        ],
      },
      {
        name: 'Design a news feed',
        focus:
          'Whether you fan out posts on write or on read, and how a hybrid keeps one celebrity post from burying the fanout queue.',
        lessons: [
          'case-studies/news-feed',
          'thinking/access-patterns',
          'scaling/caching',
          'scaling/sharding',
          'reliability/queues-and-backpressure',
        ],
      },
      {
        name: 'Design a flash sale ticketing system',
        focus:
          'How conditional writes stop two buyers from getting one seat, and how holds that expire and a waiting room absorb a million people.',
        lessons: [
          'case-studies/ticketing',
          'foundations/transactions',
          'reliability/idempotency',
          'reliability/queues-and-backpressure',
          'practice/design-review',
        ],
      },
      {
        name: 'Design a payment system',
        focus:
          'How idempotency keys stop a timeout and a blind retry from charging twice, and how a double-entry ledger reconciles with the bank.',
        lessons: [
          'case-studies/payments',
          'reliability/idempotency',
          'distributed-data/sagas',
          'foundations/transactions',
          'async/delivery-semantics',
        ],
      },
      {
        name: 'Design a chat system',
        focus:
          'How sequence numbers keep messages in order per conversation, and how a phone that drops offline catches up from its cursor.',
        lessons: [
          'case-studies/chat',
          'foundations/real-time',
          'async/logs-and-pubsub',
          'distributed-data/time-leases-fencing',
          'reliability/idempotency',
        ],
      },
      {
        name: 'Design a notification system',
        focus:
          'How priority lanes keep login codes ahead of a marketing campaign, and how deadlines and a circuit breaker survive a provider outage.',
        lessons: [
          'case-studies/notifications',
          'reliability/circuit-breakers',
          'reliability/retries',
          'reliability/rate-limiting',
          'async/delivery-semantics',
        ],
      },
      {
        name: 'Design a video streaming service',
        focus:
          'How you upload large videos in resumable parts, transcode them into a bitrate ladder, and stream them without overpaying for bandwidth.',
        lessons: [
          'case-studies/video-streaming',
          'scaling/object-storage',
          'scaling/cdn',
          'reliability/queues-and-backpressure',
          'reliability/idempotency',
        ],
      },
      {
        name: 'Design a ride-sharing or nearby places service',
        focus:
          'How you index locations with geohash cells or a quadtree, search a cell and its 8 neighbors, and reserve one driver per ride.',
        lessons: [
          'case-studies/ride-sharing',
          'foundations/indexes',
          'scaling/sharding',
          'foundations/real-time',
          'practice/timed-round',
        ],
      },
      {
        name: 'Design a search engine with typeahead',
        focus:
          'How you keep a search index fresh while each ranking signal updates on its own schedule, and how you serve prefix suggestions fast.',
        lessons: [
          'case-studies/search',
          'foundations/indexes',
          'scaling/sharding',
          'scaling/caching',
          'practice/timed-round',
        ],
      },
      {
        name: 'Design a metrics and alerting system',
        focus:
          'How you ingest a million samples a second, keep label cardinality bounded, downsample old data, and page people only for real incidents.',
        lessons: [
          'case-studies/metrics',
          'reliability/observability',
          'async/stream-processing',
          'async/logs-and-pubsub',
          'thinking/slos',
        ],
      },
      {
        name: 'Design a collaborative document editor',
        focus:
          'How concurrent edits converge on every copy of a document, using character ids, tombstones, and causal buffering.',
        lessons: [
          'case-studies/collaborative-editor',
          'distributed-data/consistency-models',
          'foundations/real-time',
          'distributed-data/cap-and-pacelc',
        ],
      },
      {
        name: 'Design a distributed key-value store',
        focus:
          'How you place keys on a hash ring, tune N, R, and W so reads and writes overlap, and repair replicas after a failure.',
        lessons: [
          'case-studies/kv-store',
          'distributed-data/quorums',
          'scaling/consistent-hashing',
          'foundations/storage-engines',
          'distributed-data/cap-and-pacelc',
          'practice/timed-round',
        ],
      },
      {
        name: 'Design a distributed rate limiter',
        focus:
          'Which algorithm you pick, where the shared counters live, and what the limiter does when its store fails or one key gets hot.',
        lessons: [
          'reliability/rate-limiting',
          'ai-systems/gateway',
          'thinking/access-patterns',
          'scaling/sharding',
          'practice/timed-round',
        ],
      },
      {
        name: 'Design a web crawler',
        focus:
          'How per-host queues keep the crawler polite, how a Bloom filter skips seen URLs, and how claim timeouts recover from a crashed fetcher.',
        lessons: [
          'practice/timed-round',
          'reliability/queues-and-backpressure',
          'foundations/storage-engines',
          'scaling/object-storage',
          'distributed-data/time-leases-fencing',
        ],
      },
      {
        name: 'Design a top K trending chart',
        focus:
          'How you count plays per minute across partitions, close each window with a watermark, and trade exact counts for memory.',
        lessons: [
          'practice/timed-round',
          'async/stream-processing',
          'async/logs-and-pubsub',
          'scaling/caching',
        ],
      },
      {
        name: 'Design a file sync service',
        focus:
          'How you upload only the changed chunks, catch conflicting edits with a base version, and let an offline device catch up from its cursor.',
        lessons: [
          'case-studies/file-sync',
          'scaling/object-storage',
          'foundations/transactions',
          'foundations/real-time',
          'scaling/sharding',
        ],
      },
      {
        name: 'Design a distributed job scheduler',
        focus:
          'How a unique key stops double dispatch, how heartbeats requeue a dead worker’s runs, and why at least once delivery needs idempotent handlers.',
        lessons: [
          'practice/timed-round',
          'reliability/idempotency',
          'reliability/retries',
          'distributed-data/time-leases-fencing',
          'async/event-driven-design',
        ],
      },
      {
        name: 'Design an ad click aggregator',
        focus:
          'How you count each click once per window even after a consumer crash, drop duplicate clicks, and spread hot ads across partitions.',
        lessons: [
          'practice/timed-round',
          'async/stream-processing',
          'async/delivery-semantics',
          'async/logs-and-pubsub',
          'scaling/sharding',
        ],
      },
    ],
  },
  {
    title: 'Estimation and requirements',
    topics: [
      {
        name: 'Clarify requirements and scope',
        focus:
          'Whether you split the idea into functional and non-functional requirements and say what stays out of scope before you draw a box.',
        lessons: ['thinking/requirements-and-estimates', 'thinking/design-checklist', 'practice/timed-round'],
      },
      {
        name: 'Back-of-the-envelope estimates',
        focus:
          'Whether you turn daily traffic into requests a second, storage, and server count, and let those numbers shape the design.',
        lessons: ['thinking/requirements-and-estimates', 'practice/capstone'],
      },
      {
        name: 'Latency percentiles and SLOs',
        focus:
          'Whether you define fast enough with percentiles, an SLO, and an error budget, then trace requests to find the fix that keeps the promise.',
        lessons: ['thinking/slos', 'reliability/observability', 'foundations/what-happens-when-you-click'],
      },
      {
        name: 'Read and write access patterns',
        focus:
          'Whether you find who reads what and how often, and spot the hot key that can overload one cache node while the rest sit idle.',
        lessons: ['thinking/access-patterns', 'foundations/data-modeling', 'scaling/caching'],
      },
      {
        name: 'Design the API',
        focus:
          'Whether your endpoints use clear resource names, correct status codes, request IDs, cursor pagination, and changes that keep old clients working.',
        lessons: ['foundations/apis', 'reliability/idempotency', 'foundations/security'],
      },
    ],
  },
  {
    title: 'Scaling reads',
    topics: [
      {
        name: 'Load balancing and horizontal scaling',
        focus:
          'When you buy a bigger machine and when you add servers behind a load balancer, and how the balancer stops sending traffic to a sick server.',
        lessons: ['scaling/load-balancing', 'foundations/what-happens-when-you-click'],
      },
      {
        name: 'Caching strategies',
        focus:
          'How hit ratio, eviction, expiry, and the write strategy shape a cache, and how you avoid a stampede on a cold cache.',
        lessons: ['scaling/caching', 'thinking/access-patterns', 'scaling/cdn'],
      },
      {
        name: 'Content delivery networks',
        focus:
          'How edge caches cut the latency that distance adds, and how TTLs, purges, and an origin shield protect the origin.',
        lessons: ['scaling/cdn', 'foundations/what-happens-when-you-click', 'scaling/caching'],
      },
      {
        name: 'Read replicas and replication lag',
        focus:
          'How replicas multiply read capacity, what each replication mode loses in a failover, and how log positions let users read their own writes.',
        lessons: ['scaling/read-replicas', 'distributed-data/consistency-models'],
      },
    ],
  },
  {
    title: 'Scaling writes and data',
    topics: [
      {
        name: 'Data modeling and indexes',
        focus:
          'Whether you list the queries first, pick tables, documents, or key-value records to fit them, and weigh what every extra index costs on write.',
        lessons: ['foundations/data-modeling', 'foundations/indexes', 'thinking/access-patterns'],
      },
      {
        name: 'B-trees and LSM trees',
        focus:
          'Which storage engine suits a read-heavy or write-heavy workload, and what each pays in read, write, and space amplification.',
        lessons: ['foundations/storage-engines', 'foundations/indexes'],
      },
      {
        name: 'Unique ID generation',
        focus:
          'How you mint IDs that never collide across servers, and when to use counter ranges, Snowflake IDs, UUIDv7, or random base62 codes.',
        lessons: ['foundations/unique-ids'],
      },
      {
        name: 'Transactions and concurrent writes',
        focus:
          'How atomic statements, conditional updates, row locks, and unique keys stop two writers from silently losing an update.',
        lessons: ['foundations/transactions', 'case-studies/ticketing'],
      },
      {
        name: 'Sharding and shard keys',
        focus:
          'How you pick a shard key, choose range or hash placement, route other queries through secondary indexes, and keep one hot key from overloading a shard.',
        lessons: ['scaling/sharding', 'scaling/consistent-hashing', 'thinking/access-patterns'],
      },
      {
        name: 'Consistent hashing',
        focus:
          'How a hash ring lets a new shard take only its fair share of keys, and how virtual nodes even out the load.',
        lessons: ['scaling/consistent-hashing', 'distributed-data/quorums'],
      },
      {
        name: 'Consistency models and CAP',
        focus:
          'What a reader may see under eventual, read your writes, causal, and linearizable consistency, and what a cut network link forces you to choose.',
        lessons: [
          'distributed-data/consistency-models',
          'distributed-data/cap-and-pacelc',
          'distributed-data/quorums',
        ],
      },
      {
        name: 'Leader election and consensus',
        focus:
          'How Raft elects one leader with terms and commits each entry once a majority stores it, and how fencing tokens keep a stale owner out.',
        lessons: ['distributed-data/raft', 'distributed-data/time-leases-fencing', 'scaling/read-replicas'],
      },
      {
        name: 'Distributed transactions and sagas',
        focus:
          'How you run a checkout across several services without a global lock, undo finished steps with compensations, and choose orchestration or choreography.',
        lessons: [
          'distributed-data/sagas',
          'case-studies/payments',
          'async/event-driven-design',
          'async/delivery-semantics',
        ],
      },
    ],
  },
  {
    title: 'Reliability and failure',
    topics: [
      {
        name: 'Prevent cascading failures',
        focus:
          'How timeouts, one shared deadline, and circuit breakers stop one slow dependency from freezing every caller.',
        lessons: [
          'reliability/timeouts',
          'reliability/circuit-breakers',
          'reliability/queues-and-backpressure',
          'reliability/retries',
        ],
      },
      {
        name: 'Retries with backoff and jitter',
        focus:
          'When a retry is safe, and how exponential backoff, full jitter, and a retry budget keep retries from turning a slowdown into an outage.',
        lessons: ['reliability/retries', 'reliability/idempotency', 'reliability/timeouts'],
      },
      {
        name: 'Idempotency keys',
        focus:
          'How a key claimed before the side effect turns a duplicate request into a replay of the first result.',
        lessons: ['reliability/idempotency', 'case-studies/payments', 'async/delivery-semantics'],
      },
      {
        name: 'Observability',
        focus:
          'How metrics, traces, and logs joined by correlation IDs find the cause of an incident, and what RED and USE dashboards show.',
        lessons: ['reliability/observability', 'thinking/slos', 'case-studies/metrics'],
      },
      {
        name: 'Backups and disaster recovery',
        focus:
          'How you undo a bad write that every replica already copied, within an RPO for data lost and an RTO for time down.',
        lessons: ['reliability/backups-and-recovery', 'scaling/read-replicas'],
      },
      {
        name: 'Multi-region failover',
        focus:
          'How you route users to nearby regions, decide where writes live, and fail over without split brain or silent data loss.',
        lessons: [
          'distributed-data/multi-region',
          'practice/capstone',
          'reliability/backups-and-recovery',
          'distributed-data/cap-and-pacelc',
        ],
      },
    ],
  },
  {
    title: 'Async work and messaging',
    topics: [
      {
        name: 'Queues, backpressure, and load shedding',
        focus:
          'How a bounded queue absorbs bursts, and how a fast 503 and load shedding by expected wait keep the server from tipping over.',
        lessons: ['reliability/queues-and-backpressure', 'reliability/rate-limiting'],
      },
      {
        name: 'Logs, pub/sub, and ordering',
        focus:
          'How a partitioned log and a consumer group split the reading, and why order holds only within one partition.',
        lessons: ['async/logs-and-pubsub', 'case-studies/chat'],
      },
      {
        name: 'Delivery guarantees and the outbox',
        focus:
          'Whether each event arrives at most once, at least once, or effectively once, and how the outbox keeps the data and its events in step.',
        lessons: ['async/delivery-semantics', 'reliability/idempotency', 'async/logs-and-pubsub'],
      },
      {
        name: 'Event-driven design and dead-letter queues',
        focus:
          'How you shape thin or fat events, change schemas without breaking a running consumer, and park poison messages in a dead-letter queue.',
        lessons: ['async/event-driven-design', 'distributed-data/sagas'],
      },
      {
        name: 'Stream processing and windows',
        focus:
          'How you count events in tumbling and sliding windows, handle late data with watermarks, and decide when a nightly batch job wins.',
        lessons: ['async/stream-processing', 'case-studies/metrics'],
      },
      {
        name: 'CQRS and event sourcing',
        focus:
          'When to split the write model from the read models, how projections lag behind the event log, and how replaying events rebuilds a broken view.',
        lessons: ['distributed-data/cqrs', 'async/event-driven-design'],
      },
    ],
  },
  {
    title: 'AI systems',
    topics: [
      {
        name: 'Design a recommendation system',
        focus:
          'How cheap candidate sources narrow millions of items to a few hundred, and how an accurate ranker orders them within a latency budget.',
        lessons: [
          'ai-systems/recommendations',
          'ai-systems/evaluation-and-budgets',
          'ai-systems/retrieval',
          'scaling/caching',
        ],
      },
      {
        name: 'Design an AI support assistant',
        focus:
          'How you ground answers in permission-aware documents with citations, abstain when evidence is weak, and allow one approved refund action.',
        lessons: [
          'ai-systems/support-assistant',
          'ai-systems/retrieval',
          'ai-systems/agents',
          'ai-systems/evaluation-and-budgets',
          'ai-systems/gateway',
        ],
      },
      {
        name: 'Retrieval-augmented generation',
        focus:
          'How chunking, hybrid keyword and vector search, tenant scoping, and citations ground a model’s answer in your own documents.',
        lessons: ['ai-systems/retrieval', 'ai-systems/support-assistant'],
      },
      {
        name: 'Serve an LLM efficiently',
        focus:
          'Why prefill and decode behave differently, how batching and KV cache memory set throughput, and how continuous batching keeps one GPU busy.',
        lessons: ['ai-systems/llm-serving', 'ai-systems/gateway'],
      },
      {
        name: 'Design an AI gateway',
        focus:
          'How one gateway routes or cascades calls across model tiers, caches answers safely, enforces tenant quotas, and falls back when a model fails.',
        lessons: ['ai-systems/gateway', 'reliability/rate-limiting', 'scaling/caching'],
      },
      {
        name: 'Let an agent call tools safely',
        focus:
          'How a policy authorizes each tool call the model proposes, how you treat retrieved text as data, and how a budget caps calls and cost.',
        lessons: ['ai-systems/agents', 'foundations/security'],
      },
      {
        name: 'Evaluate quality and set budgets',
        focus:
          'Whether you build an evaluation set and write quality, latency, and cost budgets before you pick a model.',
        lessons: ['ai-systems/evaluation-and-budgets', 'thinking/slos'],
      },
    ],
  },
];
