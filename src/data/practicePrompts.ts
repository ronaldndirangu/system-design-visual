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

export type PromptId =
  | 'url-shortener'
  | 'paste-bin'
  | 'news-feed'
  | 'flash-sale'
  | 'kv-store'
  | 'rate-limiter'
  | 'web-crawler'
  | 'typeahead'
  | 'top-k'
  | 'file-sync'
  | 'job-scheduler'
  | 'ad-click-aggregation'
  | 'hotel-booking'
  | 'proximity';

export interface PracticePrompt {
  id: PromptId;
  title: string;
  /** The scale numbers, shown on the prompt chip. */
  scale: string;
  /** Id of the module that covers every idea the prompt needs. */
  bestAfter: string;
  brief: string;
  /** One list of points per checklist step. */
  outline: readonly (readonly string[])[];
}

export const practicePrompts: readonly PracticePrompt[] = [
  {
    id: 'url-shortener',
    title: 'URL shortener',
    scale: '1M links a day, 100 clicks each',
    bestAfter: 'scaling',
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
        'About 1 TB over 5 years and 12 writes per second fit one database server with read replicas. Shard by code later, only if measured writes, index size, or disk headroom outgrow that server.',
        'Short codes: a counter encoded in base62 never collides, and random codes need a uniqueness check.',
      ],
      [
        'Browsers treat a 301 redirect as permanent and often cache it with no expiry, so repeat clicks never reach you and click counts go missing. A 302 with Cache-Control: no-store sends every click to the service, at the cost of more traffic.',
        'Random codes resist guessing. Counter codes stay shorter and make the next link easy to guess.',
      ],
    ],
  },
  {
    id: 'paste-bin',
    title: 'Paste sharing site',
    scale: '100k pastes a day, 10 KB each, kept 2 years',
    bestAfter: 'scaling',
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
    bestAfter: 'async',
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
    bestAfter: 'reliability',
    brief:
      'A concert puts 50,000 seats on sale at 10:00. About 2 million people arrive in the first minute. No seat may be sold twice, and a buyer gets 10 minutes to pay for a held seat.',
    outline: [
      [
        'Join the sale, hold a seat, and pay within 10 minutes.',
        'Never sell a seat twice, and never take a payment without a seat.',
        'Stay up through the first minute, even if buyers wait in line.',
      ],
      [
        'Arrivals: 2,000,000 ÷ 60 ≈ 33,000 requests per second, averaged over the minute. Most buyers click at 10:00:00, so the first seconds peak several times higher.',
        'Only 50,000 seats, so about 1 in 40 people get one.',
        'Seat writes stay small: about 50,000 holds, plus seats that return when holds expire.',
      ],
      [
        'POST /sale/join returns a place in line.',
        'POST /holds takes a seat and returns a hold that expires in 10 minutes. A taken seat gets 409.',
        'POST /orders takes a hold and an idempotency key and charges the buyer once.',
      ],
      [
        'Seats: event, seat id, state (free, held, paying, or sold), hold owner, and hold expiry.',
        'Orders: id, seat, buyer, payment status, and a unique idempotency key.',
        'The busiest write changes one seat from free to held, only if it is still free.',
      ],
      [
        'Arrival path: load balancer, then a waiting room that admits buyers at a rate the database can take.',
        'Hold path: an app server runs a conditional update on the seat row.',
        'Pay path: the order service moves the seat from held to paying, only if the buyer still owns an unexpired hold. Then it charges the buyer and marks the seat sold.',
      ],
      [
        'The stampede: the first seconds bring several times 33,000 requests per second, all aimed at one seat table. A waiting room and rate limits cap the load.',
        'Overselling: a conditional update or a unique constraint lets exactly one hold win.',
        'Payment retries: the idempotency key stops a retried request from charging twice.',
        'Expiry versus payment: expired holds return their seats to the pool, but expiry never touches a seat in paying. A buyer whose hold expired gets refused before any charge.',
        'A declined charge frees the seat. A reconciliation job asks the provider about seats stuck in paying, marks each one sold or free, and refunds any charge that ended up with no seat.',
      ],
      [
        'A waiting room makes buyers wait and protects the database.',
        'Expiring holds free seats for others, and a slow buyer can lose a seat before starting to pay.',
        'The paying state and the reconciliation job add moving parts. In return, no buyer pays for a seat someone else got.',
        'Strict checks on every seat cost throughput. A ticket sale chooses correctness.',
      ],
    ],
  },
  {
    id: 'kv-store',
    title: 'Distributed key-value store',
    scale: '10 TB, 100k reads and 10k writes a second',
    bestAfter: 'distributed-data',
    brief:
      'Build a key-value store for an internal platform. It holds 10 TB, serves 100,000 reads and 10,000 writes a second, and keeps working when a server or a whole rack fails.',
    outline: [
      [
        'get(key) and put(key, value), with values up to 1 MB.',
        'Stay readable and writable when one server or one rack fails.',
        'Reads may lag writes for a moment. A client can ask for a fresher read when it needs one.',
      ],
      [
        'Storage: 10 TB × 3 replicas = 30 TB.',
        'At about 2 TB of usable disk per server, that is 15 servers. Headroom for growth and rebuilds brings it to about 20.',
        'Each read asks 2 replicas: 200,000 replica reads ÷ 20 servers = 10,000 a second each, well within one server.',
        'Each write lands on 3 replicas: 30,000 ÷ 20 = 1,500 replica writes a second per server.',
      ],
      [
        'GET /kv/{key} returns the value and its version.',
        'PUT /kv/{key} takes a value and, optionally, the version it replaces.',
        'A read option picks one replica for speed or a quorum for fresher data.',
      ],
      [
        'Each record holds key, value, version, and a tombstone flag for deletes.',
        'On disk, an append-only log feeds an LSM tree, which turns random writes into sequential ones.',
        'A hash ring maps each key to 3 replicas. Each server owns many virtual nodes on the ring.',
      ],
      [
        'A client calls any server, which acts as coordinator. The coordinator hashes the key and finds its 3 replicas.',
        'Writes go to all 3 replicas and succeed once 2 acknowledge (W = 2).',
        'Reads ask 2 replicas (R = 2). Because R + W > N, every read overlaps the latest acknowledged write.',
        'A gossip protocol spreads membership and failure news between servers.',
      ],
      [
        'A replica is down: hinted handoff parks its writes on a neighbor and replays them when it returns.',
        'Replicas drift: read repair fixes stale copies during reads, and a background job compares Merkle trees to find the rest.',
        'Concurrent writes: version vectors detect the conflict. The app merges the values, or the last write wins.',
        'Hot keys: a cache in front, or copies of the key under suffixes, spreads the load.',
        'A new server takes many small slices of the ring through its virtual nodes, so no single neighbor carries the whole rebuild.',
      ],
      [
        'A leaderless quorum stays writable through failures and can return conflicting versions.',
        'A leader per shard with Raft gives one order of writes and pauses writes during an election.',
        'R = 1 makes reads faster and lets them return stale data.',
        'Last write wins keeps the code simple and can drop a write when clocks disagree.',
      ],
    ],
  },
  {
    id: 'rate-limiter',
    title: 'Distributed rate limiter',
    scale: '1M requests a second across 50 gateways',
    bestAfter: 'reliability',
    brief:
      'An API platform serves 1 million requests a second through 50 gateways. Each customer has a limit, such as 100 requests a second, and that limit must hold across every gateway at once.',
    outline: [
      [
        'Enforce each customer’s limit across all gateways, with a small overshoot allowed.',
        'Add at most a millisecond or two to each request.',
        'Keep serving traffic when the limiter itself fails.',
        'Tell a limited client when to retry.',
      ],
      [
        'Per gateway: 1,000,000 ÷ 50 = 20,000 checks a second.',
        'State: 1 million active keys × about 100 bytes ≈ 100 MB, which fits in memory.',
        'One in-memory store shard handles about 100,000 operations a second, so 1 million checks need about 10 shards.',
      ],
      [
        'Internal call: allow(key, cost) returns allowed or denied, plus the tokens left.',
        'A denied request gets HTTP 429 with a Retry-After header.',
        'Limits live in config: key pattern, rate, and burst size.',
      ],
      [
        'Token bucket per key: tokens left and the time of the last refill.',
        'Sliding window per key: counts for the current and previous window, weighted by how far the clock is into the current one.',
        'Keys expire after a few idle minutes, which bounds memory.',
      ],
      [
        'Client, then load balancer, then a gateway that checks the limit before it calls the backend.',
        'Each gateway talks to a sharded in-memory store. The key’s hash picks the shard.',
        'Gateways load limit rules from a config service and refresh them every minute.',
      ],
      [
        'Race: two gateways read the same count and both allow. An atomic script reads, refills, and takes tokens in one step.',
        'Latency: a store round trip on every request adds up. Gateways keep local buckets and sync with the store every 100 ms.',
        'Local buckets let a customer overshoot by up to one sync interval of traffic.',
        'The store fails: gateways fail open and fall back to local limits, so a limiter outage never blocks all traffic.',
        'Hot keys: one huge customer lands on one shard. Split its key across shards and divide the limit between them.',
      ],
      [
        'Token bucket allows short bursts. A sliding window gives smoother limits for a little more state.',
        'A central store counts accurately and adds a network hop. Local buckets cut the hop and allow overshoot.',
        'Failing open keeps the API up and lets abusers through during an outage. Failing closed does the reverse.',
      ],
    ],
  },
  {
    id: 'web-crawler',
    title: 'Web crawler',
    scale: '1B pages a month',
    bestAfter: 'async',
    brief:
      'A search team needs 1 billion web pages crawled each month. The crawler must respect each site’s rules, skip duplicates, and escape traps that generate endless URLs.',
    outline: [
      [
        'Fetch about 1 billion pages a month and store the raw HTML.',
        'Obey robots.txt and keep a polite request rate for each host.',
        'Skip URLs already seen and pages that copy another page.',
        'Survive worker crashes without losing or repeating large batches of work.',
      ],
      [
        'Rate: 1,000,000,000 ÷ 2,600,000 seconds in a month ≈ 390 pages a second.',
        'Storage: 1 billion × 100 KB = 100 TB raw a month, about 20 TB compressed.',
        'Bandwidth: 390 × 100 KB ≈ 39 MB a second, about 310 Mbit/s.',
        'URL frontier: 10 billion known URLs × 100 bytes ≈ 1 TB.',
      ],
      [
        'POST /seeds adds starting URLs.',
        'Workers call lease(n) to get n URLs and complete(url, result) to report back.',
        'Downstream systems get one event per page: URL, fetch time, and where the HTML lives.',
      ],
      [
        'Frontier: one queue per host, plus a priority score for each URL.',
        'Seen URLs: a Bloom filter in memory, backed by a URL table on disk.',
        'Pages: HTML in object storage, keyed by a hash of the URL. Metadata holds fetch time, status, and a hash of the content.',
      ],
      [
        'The frontier hands URLs to fetcher workers, with at most one request in flight per host.',
        'Fetchers check a cached copy of robots.txt, download the page, and write it to object storage.',
        'A queue carries fetched pages to parsers and absorbs bursts.',
        'Parsers pull out links, normalize them, filter seen ones, and add the rest to the frontier.',
      ],
      [
        'Politeness: per-host queues and a next-allowed time for each host stop the crawler from hammering one site.',
        'Seen URLs: the Bloom filter answers in memory. A false positive skips a few new URLs, which a crawl tolerates.',
        'Copied content: a hash of each page catches exact copies under different URLs.',
        'Traps: calendars and session ids create endless URLs. Cap depth and URLs per host, and drop repeating path patterns.',
        'Crashes: each leased URL has a claim timeout. If no result arrives in time, the frontier hands it out again.',
      ],
      [
        'Breadth first reaches many sites fast. A priority score spends the budget on important pages first.',
        'A Bloom filter saves memory and skips a small share of new URLs.',
        'Claim timeouts can fetch a page twice. Storing pages by URL hash makes the second write harmless.',
      ],
    ],
  },
  {
    id: 'typeahead',
    title: 'Search typeahead',
    scale: '10M daily users, 5 searches each',
    bestAfter: 'scaling',
    brief:
      'A shopping site wants suggestions under its search box. As a user types, show the 5 most popular past queries that start with the typed text, within 100 ms.',
    outline: [
      [
        'Return the top 5 completions for a prefix in under 100 ms.',
        'Rank by popularity over the last 4 weeks.',
        'Suggestions may be a day old.',
        'Drop offensive queries.',
      ],
      [
        '10 million users × 5 searches = 50 million searches a day.',
        'About 10 suggest calls per search: 500 million calls a day.',
        '500,000,000 ÷ 86,400 ≈ 5,800 calls a second, about 12,000 at peak.',
        'Top 10 million queries × about 30 bytes = 300 MB of text. With trie overhead, a few GB, which fits on one server.',
      ],
      [
        'GET /suggest?q=pho returns up to 5 strings.',
        'The client waits about 50 ms after a keystroke before it calls, which cuts calls.',
        'The suggest call writes nothing. Search logs feed the ranking.',
      ],
      [
        'A trie: each node is one character, and each node stores its top 5 completions.',
        'Query counts: query and count over the last 4 weeks.',
        'A blocklist of terms to drop.',
      ],
      [
        'Read path: client, CDN, load balancer, then suggest servers that hold the trie in memory.',
        'Build path: a daily batch job counts queries from search logs, then another job builds a new trie.',
        'Suggest servers load the new trie in the background and swap a pointer to it.',
      ],
      [
        'Speed: the top 5 stored at each node makes a lookup one walk down the trie, with no search below the prefix.',
        'Short prefixes like “a” get most of the traffic and change slowly. The CDN caches them for an hour.',
        'Freshness: a daily rebuild misses a sudden trend. A small hourly trie of trending queries can merge in on top.',
        'Scale: one server holds the whole trie, so add replicas for traffic. Shard by prefix only if the trie outgrows memory.',
        'Safe swap: each server keeps answering from the old trie until the new one finishes loading.',
      ],
      [
        'Precomputed top 5 lists make reads fast and the build slower and bigger.',
        'A daily rebuild is simple and up to a day stale.',
        'Waiting 50 ms on the client cuts load and delays the first suggestion slightly.',
      ],
    ],
  },
  {
    id: 'top-k',
    title: 'Top K trending songs',
    scale: '100k plays a second, top 100 every minute',
    bestAfter: 'async',
    brief:
      'A music app wants a live chart of its 100 most played songs. Plays arrive at 100,000 a second, and the chart refreshes every minute.',
    outline: [
      [
        'Publish the top 100 songs for the last minute, hour, and day.',
        'Refresh the minute chart within a minute of real time.',
        'Live charts may be slightly off. The daily chart must be exact.',
      ],
      [
        '100,000 × 86,400 ≈ 8.6 billion plays a day.',
        'About 50 bytes per play event, so about 430 GB a day.',
        'Counters: 50 million songs × 16 bytes ≈ 800 MB, which fits in memory across a few workers.',
      ],
      [
        'Clients send play events: song id, user id, timestamp.',
        'GET /charts/top?window=minute returns 100 songs with counts.',
        'Many listeners read the same chart, so a cache serves it.',
      ],
      [
        'Play events: a log partitioned by song id.',
        'Counts: for each window, a map from song id to plays on each worker.',
        'Charts: window, end time, and the ordered list of 100 songs.',
      ],
      [
        'Clients, then ingest servers, then a log like Kafka, partitioned by song id.',
        'Stream workers each own some partitions, count plays per song per minute, and keep a local top 100.',
        'A merger combines the local lists into the global top 100 and writes it to the chart cache.',
        'A batch job recounts each day from the raw log for the exact daily chart.',
      ],
      [
        'Partitioning by song puts all of a song’s plays on one worker. Its count is complete there, so merging the local top 100 lists gives the right global top 100.',
        'Late events: a watermark waits a few seconds past each minute before closing it.',
        'Hot songs: one hit can swamp its partition. Ingest servers sum plays for a second before sending one count.',
        'Memory: a count-min sketch counts in a fixed few MB per worker and can overcount slightly.',
        'Hour charts: add each minute’s full per-song counts into an hourly map. Merging only the minute top 100 lists would miss a song that sits at 101 every minute.',
      ],
      [
        'A sketch saves memory and gives approximate counts.',
        'The lambda pattern runs a fast stream path for live charts and a slow batch path for exact ones. The two paths can disagree.',
        'A longer watermark catches more late events and delays the chart.',
      ],
    ],
  },
  {
    id: 'file-sync',
    title: 'File sync',
    scale: '50M users, 10 GB each, 2 devices',
    bestAfter: 'distributed-data',
    brief:
      'Build a service that keeps a folder in sync across a user’s laptop and phone. 50 million users store about 10 GB each, and an edit on one device reaches the other within a minute.',
    outline: [
      [
        'Upload, download, and sync files across devices.',
        'Sync a small edit to a large file without resending the whole file.',
        'Never lose a version when two devices edit the same file offline.',
        'Work offline and catch up on reconnect.',
      ],
      [
        'Storage: 50 million × 10 GB = 500 PB before deduplication.',
        'Changes: if each user changes 100 files a day, 5 billion ÷ 86,400 ≈ 58,000 metadata writes a second.',
        'Chunks: 4 MB each, so a 1 GB video is 250 chunks and a small edit resends one or two.',
      ],
      [
        'POST /chunks/check takes a list of hashes and returns the ones the server lacks.',
        'PUT /chunks/{hash} uploads one chunk.',
        'POST /files/commit takes a path, the chunk list, and the base version. A stale base version gets 409.',
        'GET /changes?cursor=42 returns every change after 42, plus the new cursor.',
      ],
      [
        'Chunks: SHA-256 hash to a location in object storage. Identical chunks are stored once.',
        'Files: user, path, version, and the ordered list of chunk hashes.',
        'Journal: one numbered row per change per user. A device’s cursor is the last number it has seen.',
      ],
      [
        'The client watches the folder, splits changed files into chunks, and hashes them.',
        'Upload path: ask which chunks are missing, upload them to object storage, then commit the file metadata.',
        'Notify path: a long poll tells other devices to pull changes from their cursor.',
        'Metadata lives in a database sharded by user.',
      ],
      [
        'Order: commit metadata only after every chunk is stored, so no device sees a file it cannot download.',
        'Conflicts: each commit names its base version. If another device committed first, the server returns 409 and the client saves its file as a conflicted copy.',
        'Offline: the client queues local changes and replays them on reconnect, after it pulls from its cursor.',
        'Deduplication: a chunk hash shared across users stores once, which saves space on common files.',
        'Sharding by user keeps one user’s journal on one shard, so the cursor stays a simple counter.',
      ],
      [
        'Fixed 4 MB chunks are simple. An insert near the start shifts every later chunk. Content-defined chunking fixes that and costs more CPU.',
        'Conflicted copies never lose data and make the user merge by hand.',
        'Long polls keep devices current and hold many connections open.',
      ],
    ],
  },
  {
    id: 'job-scheduler',
    title: 'Distributed job scheduler',
    scale: '10M jobs a day, run within 1 s of due',
    bestAfter: 'reliability',
    brief:
      'Teams submit jobs that run at a set time or on a schedule, such as a report at the top of every hour. The scheduler runs 10 million jobs a day, starts each within a second of its due time, and never drops one.',
    outline: [
      [
        'Submit one-off and recurring jobs, and cancel them.',
        'Start each job within 1 second of its due time.',
        'Run each job at least once, and retry failures.',
        'Show status and history for each job.',
      ],
      [
        'Average: 10,000,000 ÷ 86,400 ≈ 116 jobs a second.',
        'Peak: if 40% of jobs run hourly at :00, 4,000,000 ÷ 24 ≈ 167,000 fall due at the top of each hour.',
        'Spread over 10 seconds, that is about 17,000 starts a second, 150 times the average.',
        'History: 10 million runs × 1 KB × 30 days ≈ 300 GB.',
      ],
      [
        'POST /jobs takes a schedule (a time or a cron expression), a payload, and a retry policy.',
        'DELETE /jobs/{id} cancels future runs.',
        'GET /jobs/{id}/runs lists past runs with their status.',
      ],
      [
        'Jobs: id, schedule, payload, retry policy, and next due time, indexed on next due time.',
        'Runs: job id, due time, state, attempt count, worker, and last heartbeat. (job id, due time) is unique.',
        'Both tables are partitioned by a hash of job id, so many schedulers scan in parallel.',
      ],
      [
        'Scheduler nodes each own some partitions. Every second they read the jobs due in the next few seconds.',
        'For each due job, a scheduler inserts a run row and pushes the run onto a queue.',
        'Workers pull runs, execute them, send a heartbeat every 10 seconds, and mark each run done.',
        'For recurring jobs, the scheduler then computes the next due time.',
      ],
      [
        'Double dispatch: two schedulers may pick the same job. The unique (job id, due time) key lets one insert win.',
        'Dead workers: a run with no heartbeat for 30 seconds, three missed beats, goes back on the queue.',
        'At least once means a job can run twice, so handlers must be idempotent, for example by keying their writes on the run id.',
        'Failures: retry with exponential backoff and jitter. After 5 attempts, move the run to a dead letter queue and alert the owner.',
        'The top of the hour: load runs a minute early and release them at the due second. Jobs that allow it get a few seconds of random jitter.',
      ],
      [
        'At least once plus idempotent handlers is far simpler than exactly once, and every handler must cope with repeats.',
        'A 30 second heartbeat timeout recovers a dead worker fast, and requeues a run whose worker stalls longer, for example in a long garbage collection pause, while it still holds the run.',
        'Polling the due index every second is simple and adds up to a second of delay. A timing wheel in memory cuts the delay and must be rebuilt after a crash.',
      ],
    ],
  },
  {
    id: 'ad-click-aggregation',
    title: 'Ad click aggregation',
    scale: '1B clicks a day, per-minute counts',
    bestAfter: 'async',
    brief:
      'An ad network records 1 billion clicks a day. Advertisers want clicks per ad per minute on a dashboard within a few minutes, and billing needs exact totals.',
    outline: [
      [
        'Count clicks per ad per minute.',
        'Show counts on dashboards within 2 minutes.',
        'Billing totals must be exact: no click counted twice, no click lost.',
        'Exclude bot traffic from billing.',
      ],
      [
        '1,000,000,000 ÷ 86,400 ≈ 11,600 clicks a second, about 50,000 at peak.',
        'About 100 bytes per click event, so 100 GB a day.',
        'Only ads with clicks in a given minute get a row, so the count table stays far smaller than the raw log.',
      ],
      [
        'The click tracker records each click and redirects the user to the advertiser.',
        'GET /ads/{id}/clicks?from=…&to=… returns per-minute counts.',
        'Billing reads daily totals from the batch output.',
      ],
      [
        'Click event: click id, ad id, user id, IP, timestamp.',
        'Minute counts: ad id, minute, count, with (ad id, minute) as the key.',
        'Raw clicks stay in cheap storage for 30 days for recounts and audits.',
      ],
      [
        'Click tracker, then a log like Kafka, partitioned by ad id.',
        'Stream aggregators read the log, count per ad per minute, and write counts to an analytics store.',
        'Dashboards query the analytics store.',
        'A nightly batch job recounts the raw log and corrects any minute that differs.',
      ],
      [
        'Exact counts: the aggregator saves its counts and its log offsets in one transaction. After a crash it resumes from the saved offset, so no click counts twice.',
        'Late clicks: a watermark closes each minute shortly after it ends. Anything later waits for the nightly recount.',
        'Duplicates: the tracker may resend a click on retry. Keep seen click ids for 10 minutes and drop repeats.',
        'Hot ads: one viral ad swamps its partition. Salt its key into several sub-keys, count each, and add them up.',
        'Bots: flag bursts from one IP or user and exclude them from billing.',
      ],
      [
        'Stream counts are fast and can miss very late clicks. The nightly batch is exact and a day behind, so billing uses it.',
        'A longer watermark catches more late clicks and delays the dashboard.',
        'Salting fixes hot partitions and adds a merge step.',
      ],
    ],
  },
  {
    id: 'hotel-booking',
    title: 'Hotel booking',
    scale: '1M hotels, 100k bookings a day',
    bestAfter: 'distributed-data',
    brief:
      'A travel site lists 1 million hotels. Guests search a city and dates, pick a room type, and book. The site takes 100,000 bookings a day and must never sell more rooms than a hotel has.',
    outline: [
      [
        'Search hotels by city and dates, with prices and availability.',
        'Book a room type for a range of nights, and cancel.',
        'Never sell more rooms than a hotel offers on any night.',
        'Charge the guest once, even when a request retries.',
      ],
      [
        'Bookings: 100,000 ÷ 86,400 ≈ 1.2 a second, a tiny write rate.',
        'Searches: 10 million a day ≈ 116 a second, more at peak.',
        'Inventory: 1 million hotels × 5 room types × 365 nights ≈ 1.8 billion rows.',
      ],
      [
        'GET /search?city=…&from=…&to=… returns hotels with prices.',
        'POST /holds takes hotel, room type, and dates, and holds rooms for 15 minutes.',
        'POST /bookings takes a hold and an idempotency key, then charges and confirms.',
      ],
      [
        'Inventory: hotel, room type, night, total rooms, reserved rooms, keyed on (hotel, room type, night).',
        'Bookings: id, guest, hotel, room type, nights, status, and a unique idempotency key.',
        'Search index: hotel details and a cached availability summary in a search engine.',
      ],
      [
        'Search path: client, then a search service backed by the search index and a price cache.',
        'Booking path: booking service, then the inventory database, sharded by hotel.',
        'Payment follows the hold. A saga releases the hold if payment fails.',
      ],
      [
        'No overselling: for each night, run UPDATE … SET reserved = reserved + 1 WHERE reserved < total. Put every night in one transaction, and roll back if any night fails.',
        'Sharding by hotel keeps every night of a booking on one shard, so the transaction stays local.',
        'Retries: the unique idempotency key turns a repeated booking request into a lookup of the first result.',
        'Holds: a hold expires after 15 minutes, and a job returns its rooms.',
        'Saga: hold rooms, charge the card, confirm. A failed charge releases the hold.',
        'Stale search: search shows cached availability, and the booking step checks the real numbers.',
      ],
      [
        'Checking at booking time keeps search fast and can show a room that is gone by checkout.',
        'Holds protect a paying guest and lock rooms away from others for 15 minutes.',
        'Hotels often allow about 5% overbooking because some guests cancel. That raises revenue and risks turning a guest away.',
      ],
    ],
  },
  {
    id: 'proximity',
    title: 'Nearby places search',
    scale: '200M places, 5,000 searches a second',
    bestAfter: 'scaling',
    brief:
      'A maps app lets users find restaurants, shops, and fuel near them. It holds 200 million places and serves 5,000 searches a second, each one returning places within a chosen radius.',
    outline: [
      [
        'Find places within a radius of 500 m to 20 km, filtered by category.',
        'Return results in under 200 ms.',
        'Owners update their place details. Search may show a change a day later.',
      ],
      [
        'Details: 200 million × 1 KB = 200 GB.',
        'Geo index: 200 million × 16 bytes (id plus geohash) = 3.2 GB, which fits in memory on every search server.',
        'Writes are rare: owners change a few thousand places a day.',
      ],
      [
        'GET /nearby?lat=…&lng=…&radius=2km&category=food returns ids, names, and distances.',
        'GET /places/{id} returns details.',
        'PUT /places/{id} lets an owner update details.',
      ],
      [
        'Places: id, name, category, latitude, longitude, and details, in a database sharded by id.',
        'Geo index: geohash to place ids, sorted so one prefix scan returns a whole cell.',
        'A precision 6 geohash cell is about 1.2 km × 0.6 km. A precision 5 cell is about 4.9 km × 4.9 km.',
      ],
      [
        'Client, then load balancer, then search servers that hold the geo index in memory.',
        'Search servers find candidate ids, then fetch details through a cache in front of the places database.',
        'A nightly job rebuilds the geo index from the places table and ships it to the search servers.',
      ],
      [
        'Cells: find the cell under the user’s point, plus the 8 cells around it, so a place just across a border still shows up.',
        'Precision: pick cells at least as big as the radius. A 2 km search uses precision 5, and a 500 m search uses precision 6.',
        'Exact filter: the 9 cells cover a rough box, so compute the real distance to each candidate and drop any beyond the radius.',
        'Dense cities: one downtown cell can hold thousands of places. A quadtree splits busy areas into smaller cells and leaves empty areas coarse.',
        'New places appear after the nightly rebuild. A small daily delta index covers urgent changes.',
      ],
      [
        'Geohash is simple and uses fixed cells. A quadtree adapts to density and is harder to update.',
        'A nightly rebuild keeps search fast and simple, and new places wait up to a day.',
        'An index in memory on every server costs RAM and removes a database hop from every search.',
      ],
    ],
  },
];
