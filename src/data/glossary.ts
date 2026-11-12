export interface GlossaryEntry {
  /** The term as a learner would search for it, for example 'Cache-aside'. */
  term: string;
  /** One or two plain sentences. */
  definition: string;
  /** Curriculum id of the lesson that teaches the term, for example 'scaling/caching'. */
  lesson: string;
}

export const glossary: GlossaryEntry[] = [
  {
    term: 'Access pattern',
    definition:
      'How a system gets used: which operations run, the ratio of reads to writes, how skewed the traffic is, and how it changes over time. Pin these down before you pick a design.',
    lesson: 'thinking/access-patterns',
  },
  {
    term: 'Active-active',
    definition:
      'A multi-region setup where every region accepts writes. Two regions can write the same item at once, so a rule such as last writer wins throws one write away.',
    lesson: 'distributed-data/multi-region',
  },
  {
    term: 'Agent',
    definition:
      'A loop where a model plans a step, calls a tool, reads the result, and repeats until it can answer. The model only proposes actions, and a policy layer decides what runs as the signed-in user.',
    lesson: 'ai-systems/agents',
  },
  {
    term: 'AI gateway',
    definition:
      'A service that every model call passes through. It is the one place to enforce quotas, reuse answers, choose a model, check replies, and handle provider failures.',
    lesson: 'ai-systems/gateway',
  },
  {
    term: 'At-least-once delivery',
    definition:
      'The consumer processes an event, then commits its offset. A crash between the two replays the event, so nothing is lost and some events run twice.',
    lesson: 'async/delivery-semantics',
  },
  {
    term: 'At-most-once delivery',
    definition:
      'The consumer commits an event’s offset, then processes it. A crash between the two skips the event, so nothing runs twice and some events are lost.',
    lesson: 'async/delivery-semantics',
  },
  {
    term: 'Authorization',
    definition:
      'The check that answers “may this caller do this to this object?” Deny by default, grant the least privilege needed, and return 403 when the answer is no.',
    lesson: 'foundations/security',
  },
  {
    term: 'Availability',
    definition:
      'In the CAP sense, every request that reaches a working server gets a real answer, with no error and no timeout.',
    lesson: 'distributed-data/cap-and-pacelc',
  },
  {
    term: 'B-tree',
    definition:
      'A shallow tree of fixed-size pages that keeps keys in sorted order. A lookup reads one page per level, so its cost grows with the log of the row count.',
    lesson: 'foundations/indexes',
  },
  {
    term: 'Back-of-envelope estimate',
    definition:
      'Quick math in round numbers for peak requests a second, storage, and bandwidth. A day has 86,400 seconds, which you can round to 100,000.',
    lesson: 'thinking/requirements-and-estimates',
  },
  {
    term: 'Backpressure',
    definition:
      'A component that cannot keep up tells whoever sends it work to slow down. TCP flow control is one example: it stops a sender when the receiver’s buffer fills.',
    lesson: 'reliability/queues-and-backpressure',
  },
  {
    term: 'Bloom filter',
    definition:
      'A small bit array that answers “definitely not here” or “maybe here” for a key. With 10 bits per key it is wrong about 1% of the time, so reads skip most files that lack the key.',
    lesson: 'foundations/storage-engines',
  },
  {
    term: 'Cache stampede',
    definition:
      'Many requests miss the same entry at once, often when a hot key expires, and all of them hit the database together. Single-flight, TTL jitter, and stale-while-revalidate keep it in check.',
    lesson: 'scaling/caching',
  },
  {
    term: 'Cache-aside',
    definition:
      'The app checks the cache first. On a miss, it reads the database and stores the result in the cache for the next reader.',
    lesson: 'scaling/caching',
  },
  {
    term: 'CAP theorem',
    definition:
      'While a network partition lasts, each side must either refuse some requests to stay consistent or answer all of them and risk stale data. The popular “pick any two” summary misstates it.',
    lesson: 'distributed-data/cap-and-pacelc',
  },
  {
    term: 'Causal consistency',
    definition:
      'Readers never see an effect before its cause, so a reply never shows up before the message it answers. It also gives read your writes and monotonic reads.',
    lesson: 'distributed-data/consistency-models',
  },
  {
    term: 'CDN (content delivery network)',
    definition:
      'Cache servers, called edges, placed in many cities close to users. On a miss, the edge fetches the content from your own server, called the origin.',
    lesson: 'scaling/cdn',
  },
  {
    term: 'Change data capture (CDC)',
    definition:
      'A process tails the database’s write-ahead log and publishes each committed change as an event. Debezium is one such tool.',
    lesson: 'async/delivery-semantics',
  },
  {
    term: 'Circuit breaker',
    definition:
      'A small state machine around calls to one dependency. It opens when failures cross a threshold (for example 50% of at least 20 calls), fails fast, and after a cooldown lets a few probe calls through.',
    lesson: 'reliability/circuit-breakers',
  },
  {
    term: 'Consensus',
    definition:
      'A group of servers agrees on one ordered log even while some of them crash or get cut off. Raft is a consensus algorithm.',
    lesson: 'distributed-data/raft',
  },
  {
    term: 'Consistent hashing',
    definition:
      'Shards and keys sit on a hash ring, and each key belongs to the first shard clockwise from it. Adding a shard moves only the keys on one arc of the ring.',
    lesson: 'scaling/consistent-hashing',
  },
  {
    term: 'Consumer group',
    definition:
      'A set of workers that share a topic’s partitions. Each partition has exactly one reader in the group at a time.',
    lesson: 'async/logs-and-pubsub',
  },
  {
    term: 'CQRS',
    definition:
      'Command query responsibility segregation: a write model checks commands and appends events, and separate read models shaped for one screen each follow the log. Read models lag the writes.',
    lesson: 'distributed-data/cqrs',
  },
  {
    term: 'CRDT',
    definition:
      'A conflict-free replicated data type. Copies that apply the same set of operations in any causal order end up identical.',
    lesson: 'case-studies/collaborative-editor',
  },
  {
    term: 'Dead-letter queue (DLQ)',
    definition:
      'A place to park an event that keeps failing. After the retry budget runs out or a permanent error appears, the consumer moves the event there, commits its offset, and keeps reading.',
    lesson: 'async/event-driven-design',
  },
  {
    term: 'Deadline',
    definition:
      'One point in time by which the whole request must finish. Each hop passes the remaining time to the next, so every hop stops together.',
    lesson: 'reliability/timeouts',
  },
  {
    term: 'Denormalization',
    definition:
      'Copying data into the shape a read needs, so the read skips a join or a second lookup. Every change must then reach every copy.',
    lesson: 'foundations/data-modeling',
  },
  {
    term: 'Effectively once',
    definition:
      'The consumer records each event id in the same transaction as the event’s effect and skips ids it has already seen. Delivery is still at least once, and the effect happens once.',
    lesson: 'async/delivery-semantics',
  },
  {
    term: 'Embedding',
    definition:
      'A list of numbers (a vector) that places similar items close together, so nearness stands in for similarity.',
    lesson: 'ai-systems/recommendations',
  },
  {
    term: 'Error budget',
    definition:
      'The share of bad events an SLO allows. A 99.9% SLO over 30 days lets 0.1% fail, which equals 43.2 minutes of full downtime at steady traffic.',
    lesson: 'thinking/slos',
  },
  {
    term: 'Evaluation set',
    definition:
      'A fixed list of realistic inputs, each with a rubric of what a passing answer must and must never contain. Grading every candidate on the same set tells them apart where a demo cannot.',
    lesson: 'ai-systems/evaluation-and-budgets',
  },
  {
    term: 'Event sourcing',
    definition:
      'The stored events are the source of truth, and current state is a fold over them. A snapshot saves folded state at a known position so a rebuild starts there.',
    lesson: 'distributed-data/cqrs',
  },
  {
    term: 'Eventual consistency',
    definition:
      'A read returns whatever its replica holds right now, and replicas converge once updates stop. It rules out none of the read anomalies and never makes a reader wait.',
    lesson: 'distributed-data/consistency-models',
  },
  {
    term: 'Exponential backoff',
    definition: 'Doubling the wait after each failed attempt, for example 200 ms, then 400 ms, then 800 ms.',
    lesson: 'reliability/retries',
  },
  {
    term: 'Failover',
    definition:
      'Replacing a failed primary: detect the failure (for example 3 missed heartbeats 1 s apart), promote the most caught-up replica, and send writes to it.',
    lesson: 'scaling/read-replicas',
  },
  {
    term: 'Fan-out on read',
    definition:
      'Store each post once and build the feed when a user opens it by fetching recent posts from every account they follow. Posting is cheap and reading is expensive.',
    lesson: 'case-studies/news-feed',
  },
  {
    term: 'Fan-out on write',
    definition:
      'Copy each new post id into every follower’s feed list, so opening the feed is one lookup. A celebrity with millions of followers makes each post expensive, so hybrid designs pull those posts at read time.',
    lesson: 'case-studies/news-feed',
  },
  {
    term: 'Fencing token',
    definition:
      'A number that grows with every lock or lease grant. Storage refuses any write that carries a lower token than the highest it has seen.',
    lesson: 'distributed-data/time-leases-fencing',
  },
  {
    term: 'Functional requirement',
    definition:
      'Something the system does for its users, for example “shorten a link” and “redirect to the original URL.”',
    lesson: 'thinking/requirements-and-estimates',
  },
  {
    term: 'Geohash',
    definition:
      'A short string for a latitude and longitude, built by halving the map again and again. Each extra character names a smaller box, so nearby points share a prefix.',
    lesson: 'case-studies/ride-sharing',
  },
  {
    term: 'Goodput',
    definition:
      'The answers that arrive while someone still wants them. Workers can stay 100% busy while goodput falls to almost nothing.',
    lesson: 'reliability/queues-and-backpressure',
  },
  {
    term: 'Health check',
    definition:
      'A probe the load balancer sends to each server on a fixed interval, removing the server after several failures in a row. Checking every 5 s with a threshold of 3 leaves a crashed server in the pool for up to about 15 s.',
    lesson: 'scaling/load-balancing',
  },
  {
    term: 'Horizontal scaling',
    definition:
      'Adding more machines of the same size behind a load balancer. Vertical scaling moves to one bigger machine instead.',
    lesson: 'scaling/load-balancing',
  },
  {
    term: 'Hot key',
    definition:
      'A single key that draws a large share of the traffic. Hashing cannot split one key, so the node that owns it carries all of that load.',
    lesson: 'thinking/access-patterns',
  },
  {
    term: 'Idempotency',
    definition: 'An operation is idempotent when doing it twice has the same effect as doing it once.',
    lesson: 'reliability/idempotency',
  },
  {
    term: 'Idempotency key',
    definition:
      'A unique value the client creates once per operation and sends on every attempt, often in an Idempotency-Key header. The server stores each key with its result and replays that result for a repeat.',
    lesson: 'reliability/idempotency',
  },
  {
    term: 'Indirect prompt injection',
    definition:
      'Instructions hidden inside content the model reads, such as retrieved text or tool output. No filter stops it reliably, so treat that content as data and limit what a misled model can do with least privilege.',
    lesson: 'ai-systems/agents',
  },
  {
    term: 'Inverted index',
    definition:
      'A map from each term to its posting list: the ids of the documents that contain it, in sorted order.',
    lesson: 'case-studies/search',
  },
  {
    term: 'Jitter',
    definition:
      'Randomness added to a wait. Full jitter picks a random wait between 0 and the backoff window, so clients that failed together do not retry together.',
    lesson: 'reliability/retries',
  },
  {
    term: 'KV cache',
    definition:
      'The attention keys and values for every earlier token, kept in GPU memory so each decode step reuses them. KV memory usually runs out before compute does, which caps how many requests run at once.',
    lesson: 'ai-systems/llm-serving',
  },
  {
    term: 'Leader election',
    definition:
      'How Raft picks a leader. A follower that hears no heartbeat before its random 150 to 300 ms timer runs out becomes a candidate and wins with votes from a majority, such as 3 of 5.',
    lesson: 'distributed-data/raft',
  },
  {
    term: 'Lease',
    definition:
      'A lock that expires on its own unless the holder renews it, for example a 10 s lease renewed every 3 s through etcd or ZooKeeper.',
    lesson: 'distributed-data/time-leases-fencing',
  },
  {
    term: 'Linearizability',
    definition:
      'Once a write is confirmed, every later read shows it. The system acts as if only one copy of the data existed.',
    lesson: 'distributed-data/consistency-models',
  },
  {
    term: 'Load balancer',
    definition:
      'Spreads requests across a pool of servers and uses health checks to stop sending to failed ones. A layer 4 balancer forwards by IP and port, and a layer 7 balancer reads the HTTP request.',
    lesson: 'scaling/load-balancing',
  },
  {
    term: 'Load shedding',
    definition:
      'Dropping work that cannot finish in time, for example requests that already waited past a 600 ms budget, so the rest still succeed.',
    lesson: 'reliability/queues-and-backpressure',
  },
  {
    term: 'LSM tree',
    definition:
      'A log-structured merge tree collects writes in memory, flushes them as sorted files, and merges files in the background through compaction. It never updates a file in place, as in RocksDB and Cassandra.',
    lesson: 'foundations/storage-engines',
  },
  {
    term: 'Multi-region',
    definition:
      'Running the system in several regions, each a group of zones in one metro area. Replication between regions is usually asynchronous, so lag turns into lost data on failover.',
    lesson: 'distributed-data/multi-region',
  },
  {
    term: 'Non-functional requirement',
    definition: 'How well the system must work, for example redirects under 100 ms or 99.9% availability.',
    lesson: 'thinking/requirements-and-estimates',
  },
  {
    term: 'Object storage',
    definition:
      'Stores whole objects in buckets by key, as Amazon S3 does. You write, read, or delete each object as a unit, and a database row keeps its key and metadata.',
    lesson: 'scaling/object-storage',
  },
  {
    term: 'Optimistic concurrency',
    definition:
      'Each row stores a version number, and a write succeeds only if the version still matches the one the writer read. This is a conditional update.',
    lesson: 'foundations/transactions',
  },
  {
    term: 'PACELC',
    definition:
      'An extension of CAP: if there is a Partition, choose Availability or Consistency. Else, in normal operation, choose Latency or Consistency.',
    lesson: 'distributed-data/cap-and-pacelc',
  },
  {
    term: 'Partition (log)',
    definition:
      'One of the ordered logs a topic splits into. The partition count caps how many consumers in a group can read in parallel, and a partition key keeps one key’s events in order.',
    lesson: 'async/logs-and-pubsub',
  },
  {
    term: 'Percentile (p50, p99)',
    definition:
      'Rank every request by time: p50 is the median, and p99 is the time that 99% of requests beat. Never average percentiles across servers.',
    lesson: 'thinking/slos',
  },
  {
    term: 'Prefill',
    definition:
      'The first phase of serving a model: it reads the whole prompt in one pass and produces the first token. Decode then adds one token per step.',
    lesson: 'ai-systems/llm-serving',
  },
  {
    term: 'Presigned URL',
    definition:
      'A bucket URL signed with credentials and an expiry, such as 15 minutes. The client uploads or downloads straight from the bucket, which keeps large files off your servers.',
    lesson: 'scaling/object-storage',
  },
  {
    term: 'Pub/sub',
    definition:
      'A producer publishes each event once, and any number of consumer groups subscribe. Each group sees every event and tracks its own offsets.',
    lesson: 'async/logs-and-pubsub',
  },
  {
    term: 'Quorum',
    definition:
      'With N copies, a write waits for W of them to confirm and a read asks R of them. When R + W > N, every read overlaps the latest write.',
    lesson: 'distributed-data/quorums',
  },
  {
    term: 'Raft',
    definition:
      'A consensus algorithm with numbered terms and at most one leader per term. A log entry commits once a majority of servers store it.',
    lesson: 'distributed-data/raft',
  },
  {
    term: 'RAG (retrieval-augmented generation)',
    definition:
      'Retrieval puts relevant document chunks into the prompt, so the model answers from them and cites its sources.',
    lesson: 'ai-systems/retrieval',
  },
  {
    term: 'Rate limiting',
    definition:
      'Caps how many requests each client may send in a period, so one noisy client cannot starve the rest. Requests over the limit get 429 Too Many Requests.',
    lesson: 'reliability/rate-limiting',
  },
  {
    term: 'Read replica',
    definition:
      'A copy of the database that the primary streams its writes to. It serves reads, which can be stale by up to the replication lag.',
    lesson: 'scaling/read-replicas',
  },
  {
    term: 'Read your own writes',
    definition:
      'A user always sees their own latest write. One way: only a replica that has applied the write’s log position answers that user’s read.',
    lesson: 'scaling/read-replicas',
  },
  {
    term: 'Replication lag',
    definition:
      'The delay before a replica applies a write the primary already accepted. Reads in that window are stale, and with asynchronous replication a primary crash loses the writes inside it.',
    lesson: 'scaling/read-replicas',
  },
  {
    term: 'Retry budget',
    definition:
      'A cap on retries as a share of fresh traffic. Each fresh request adds 0.1 token (up to 10) and each retry spends 1, so retries stay near 10% of the load.',
    lesson: 'reliability/retries',
  },
  {
    term: 'RPO (recovery point objective)',
    definition:
      'How much recent data you can afford to lose in a disaster, measured in time, for example 1 hour.',
    lesson: 'reliability/backups-and-recovery',
  },
  {
    term: 'RTO (recovery time objective)',
    definition: 'How long the service can stay down before it must work again, for example 4 hours.',
    lesson: 'reliability/backups-and-recovery',
  },
  {
    term: 'Saga',
    definition:
      'A chain of local transactions, each committed right away. If a step fails, compensating actions undo every finished step, newest first.',
    lesson: 'distributed-data/sagas',
  },
  {
    term: 'Shard key',
    definition:
      'The field that decides which shard holds each record. Check each candidate for high cardinality, low skew, and busy queries that name the key so they touch one shard.',
    lesson: 'scaling/sharding',
  },
  {
    term: 'Sharding',
    definition:
      'Splitting data across machines so each shard holds one slice. Records are placed by key range or by a hash of the key.',
    lesson: 'scaling/sharding',
  },
  {
    term: 'SLI (service level indicator)',
    definition:
      'A measured ratio of good events to all events, for example redirects served under 100 ms divided by all redirects.',
    lesson: 'thinking/slos',
  },
  {
    term: 'SLO (service level objective)',
    definition:
      'A target for an SLI over a time window, for example 99% of redirects under 100 ms over 30 days.',
    lesson: 'thinking/slos',
  },
  {
    term: 'Snowflake ID',
    definition:
      'A 64-bit ID made of a 41-bit millisecond timestamp, a 10-bit machine number, and a 12-bit sequence. Each machine makes up to 4,096 IDs per ms with no coordination, and IDs sort roughly by time.',
    lesson: 'foundations/unique-ids',
  },
  {
    term: 'Split brain',
    definition:
      'Two nodes both act as primary and accept writes, so their histories drift apart. Fencing stops the old primary from writing.',
    lesson: 'scaling/read-replicas',
  },
  {
    term: 'Tail latency',
    definition:
      'The slow end of response times, such as p99. A page that waits on 20 calls hits at least one call slower than its p99 on about 18% of loads.',
    lesson: 'thinking/slos',
  },
  {
    term: 'Timeout',
    definition:
      'A cap on how long a caller waits for an answer. When it fires, the caller gives up, reports an error such as 504, and cancels the work.',
    lesson: 'reliability/timeouts',
  },
  {
    term: 'Token bucket',
    definition:
      'A bucket holds up to a burst size of tokens and refills at a steady rate. Each request spends 1 token, and a request that finds the bucket empty gets 429.',
    lesson: 'reliability/rate-limiting',
  },
  {
    term: 'Trace',
    definition:
      'One request’s path through the system as a tree of timed spans. The trace ID travels in the traceparent header and doubles as a correlation ID for logs.',
    lesson: 'reliability/observability',
  },
  {
    term: 'Transactional outbox',
    definition:
      'The service writes its data change and an outbox row in one local transaction. A relay then publishes unsent outbox rows, so no committed change misses its event.',
    lesson: 'async/delivery-semantics',
  },
  {
    term: 'Trie',
    definition:
      'A prefix tree with one node per prefix. For typeahead, each node stores its top k completions, computed offline.',
    lesson: 'case-studies/search',
  },
  {
    term: 'TTL (time to live)',
    definition:
      'How long a cached entry stays valid, which bounds how stale an answer can get. Adding jitter spreads out expiries so many keys do not expire at once.',
    lesson: 'scaling/caching',
  },
  {
    term: 'Two-phase commit',
    definition:
      'A coordinator asks every participant to prepare (vote yes and hold locks), then tells them all to commit. If the coordinator crashes after a yes vote, participants keep their locks and wait.',
    lesson: 'distributed-data/sagas',
  },
  {
    term: 'Vector search',
    definition:
      'Finds chunks whose embeddings sit closest to the query’s embedding, which matches by meaning. Hybrid search runs it alongside keyword search and merges the results.',
    lesson: 'ai-systems/retrieval',
  },
  {
    term: 'Virtual nodes',
    definition:
      'Many points on the hash ring for each shard, for example 64. The arcs average out, so the busiest of 4 shards holds only about 1.07 times an even share.',
    lesson: 'scaling/consistent-hashing',
  },
  {
    term: 'Watermark',
    definition:
      'A stream processor’s marker for event time: the newest event time seen minus a fixed wait. An event that arrives for a window already published counts as late.',
    lesson: 'async/stream-processing',
  },
  {
    term: 'WebSocket',
    definition:
      'A long-lived two-way connection. The client sends an HTTP Upgrade request, the server answers 101 Switching Protocols, and then both sides send frames at any time.',
    lesson: 'foundations/real-time',
  },
  {
    term: 'Write amplification',
    definition:
      'Bytes written to disk for each byte the app writes. A B-tree rewrites a whole 8 KB page to change an 80-byte row, and an LSM tree rewrites records at each compaction.',
    lesson: 'foundations/storage-engines',
  },
  {
    term: 'Write-ahead log (WAL)',
    definition:
      'An append-only log the database flushes to disk before it changes any data page, then replays after a crash. Replicas stream it to copy the primary.',
    lesson: 'foundations/storage-engines',
  },
  {
    term: 'Write-behind',
    definition:
      'A write updates only the cache and returns at once, and the cache saves to the database later, for example every 2 s. Until then the cache holds the only copy.',
    lesson: 'scaling/caching',
  },
  {
    term: 'Write-through',
    definition:
      'Each write updates the database and the cache before it returns, so the cache stays fresh and every write waits for the database.',
    lesson: 'scaling/caching',
  },
];
