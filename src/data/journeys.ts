import { isComplete, lessonProgress, type ProgressData } from '../lib/progress';
import { pathContinueTarget } from './coursePath';
import { findLesson } from './curriculum';

export type ConceptMetadata = Record<string, { title: string; set: string }>;

export interface JourneyStage {
  title: string;
  problem: string;
  decision: string;
  consequence: string;
  concepts: string[];
  deeper?: string;
  scenario?: string;
}

export interface SystemJourney {
  id: string;
  title: string;
  outcome: string;
  stages: JourneyStage[];
}

export const foundations: JourneyStage = {
  title: '1. Read the requirements',
  problem: 'A service feels slow as demand grows. What does fast and available actually mean?',
  decision: 'Separate response time from work per second. Set an availability goal before adding servers.',
  consequence:
    'More capacity costs money and cannot remove every bottleneck. Measure the limiting resource first.',
  concepts: ['latency-throughput', 'availability', 'scaling'],
  deeper: 'thinking/requirements-and-estimates',
};

export const journeys: SystemJourney[] = [
  {
    id: 'search',
    title: 'Search engines',
    outcome: 'Design news search that balances fast queries, fresh documents and ranking quality.',
    stages: [
      foundations,
      {
        title: '2. Answer repeated queries',
        problem:
          'Readers search the same breaking story. Scanning every document on every request is too expensive.',
        decision: 'Use an index to find candidates and a result cache to reuse hot queries.',
        consequence: 'Indexes add write work. Cached results can hide a new story until they expire.',
        concepts: ['indexes', 'cache'],
        deeper: 'foundations/indexes',
      },
      {
        title: '3. Distribute the index',
        problem: 'The index outgrows one machine while new articles arrive continuously.',
        decision:
          'Split documents into shards and queue indexing work. Decide how much visibility lag readers can tolerate.',
        consequence:
          'Each search fans out across shards. A slow shard delays the response, and queued writes are not immediately searchable.',
        concepts: ['sharding', 'message-queue', 'consistency'],
        deeper: 'async/logs-and-pubsub',
      },
      {
        title: '4. Design news search',
        problem: 'A breaking article must be searchable before the nightly ranking rebuild finishes.',
        decision: 'Compare nightly-only indexing with a live segment tier in the existing search simulation.',
        consequence:
          'Fresh stories appear sooner, but every query searches more segments and background merges add writes.',
        concepts: [],
        scenario: 'case-studies/search',
      },
    ],
  },
  {
    id: 'distributed-storage',
    title: 'Distributed systems: key-value storage',
    outcome: 'Keep a replicated store useful through node failures and explain its consistency limits.',
    stages: [
      foundations,
      {
        title: '2. Place and copy the data',
        problem: 'One machine cannot hold the whole dataset or survive a disk failure alone.',
        decision: 'Partition keys, keep replicas and use a hash ring to limit movement as nodes join.',
        consequence:
          'Replicas consume storage. Rebalancing competes with live traffic and hot keys can still overload one partition.',
        concepts: ['sharding', 'replication', 'consistent-hashing'],
        deeper: 'scaling/consistent-hashing',
      },
      {
        title: '3. Choose behavior during failure',
        problem: 'Some replicas cannot communicate. Should a write wait, fail or use another node?',
        decision: 'Choose a consistency contract and compare quorum choices before introducing failover.',
        consequence:
          'Waiting for more replicas costs latency and availability. Accepting writes elsewhere can return stale or conflicting values.',
        concepts: ['consistency', 'cap-theorem', 'failover'],
        deeper: 'distributed-data/quorums',
      },
      {
        title: '4. Survive a two-node outage',
        problem: "Two of a key's three home nodes stop answering.",
        decision: 'Run the key-value store duel. Compare strict quorums with stand-ins and hinted handoff.',
        consequence:
          'Stand-ins accept more writes, but read/write overlap no longer guarantees freshness. Recovery needs repair.',
        concepts: [],
        scenario: 'case-studies/kv-store',
      },
    ],
  },
  {
    id: 'chat',
    title: 'Messaging and chat',
    outcome: 'Deliver ordered conversations and recover messages when a phone reconnects.',
    stages: [
      foundations,
      {
        title: '2. Keep a conversation open',
        problem: 'Polling wastes requests while participants expect messages to arrive promptly.',
        decision: 'Define the send API and compare polling, server events and bidirectional sockets.',
        consequence: 'Open connections need capacity, heartbeats and reconnect handling.',
        concepts: ['apis', 'real-time'],
        deeper: 'foundations/real-time',
      },
      {
        title: '3. Deliver safely across workers',
        problem:
          'Parallel workers push messages out of order, and reconnecting clients resend uncertain writes.',
        decision:
          'Publish conversation events, retry transient failures and deduplicate by a stable message ID.',
        consequence:
          'Pub/sub alone does not provide durable catch-up or a global order. Retrying adds load and needs bounds.',
        concepts: ['pub-sub', 'retries', 'idempotency'],
        deeper: 'async/delivery-semantics',
      },
      {
        title: '4. Recover a disconnected phone',
        problem: 'A tunnel swallows messages while parallel push workers scramble their arrival order.',
        decision: 'Use the chat simulation to compare plain push with sequence numbers and cursor catch-up.',
        consequence:
          'Correct order and recovery need a durable per-conversation log, buffering and extra reads.',
        concepts: [],
        scenario: 'case-studies/chat',
      },
    ],
  },
  {
    id: 'feeds',
    title: 'Social feeds',
    outcome: 'Choose a fan-out strategy that keeps feeds fast without letting a celebrity stall everyone.',
    stages: [
      foundations,
      {
        title: '2. Serve repeated feed reads',
        problem: 'Many readers refresh their feed at once and overload a single server.',
        decision: 'Spread requests across servers and cache precomputed feed entries.',
        consequence:
          'Caches consume memory and can serve old data. Load balancing does not fix a shared database bottleneck.',
        concepts: ['load-balancer', 'cache'],
        deeper: 'scaling/caching',
      },
      {
        title: '3. Absorb a burst of posts',
        problem: 'A single post can trigger millions of follower updates.',
        decision: 'Queue fan-out work, publish events and make repeated jobs safe.',
        consequence:
          'Queues smooth bursts but increase visibility lag. Duplicate delivery still requires idempotent writes.',
        concepts: ['message-queue', 'pub-sub', 'idempotency'],
        deeper: 'reliability/queues-and-backpressure',
      },
      {
        title: '4. Handle a celebrity post',
        problem: 'A celebrity with millions of followers can bury the fan-out queue.',
        decision: 'Compare write-time, read-time and hybrid fan-out in the news feed simulation.',
        consequence: 'Hybrid fan-out bounds write amplification while moving some merge work onto reads.',
        concepts: [],
        scenario: 'case-studies/news-feed',
      },
    ],
  },
];

export function journeyById(id: string | undefined): SystemJourney | undefined {
  return journeys.find((journey) => journey.id === id);
}

export function stagePages(stage: JourneyStage): string[] {
  return [...stage.concepts.map((slug) => `concepts/${slug}`), ...(stage.scenario ? [stage.scenario] : [])];
}

export function journeyIncludes(journey: SystemJourney, id: string): boolean {
  return journey.stages.some((stage) => stagePages(stage).includes(id) || stage.deeper === id);
}

export function learningPage(
  id: string,
  metadata: ConceptMetadata,
): { id: string; title: string; format: string } {
  if (id.startsWith('concepts/')) {
    const entry = metadata[id];
    if (!entry) throw new Error(`Unknown concept: ${id}`);
    return { id, title: entry.title, format: 'Visual concept' };
  }
  const lesson = findLesson(id);
  if (!lesson) throw new Error(`Unknown learning page: ${id}`);
  return {
    id,
    title: lesson.title,
    format: id.startsWith('case-studies/') ? 'Case study' : 'Deeper lesson',
  };
}

export function learningStatus(
  progress: ProgressData,
  id: string,
  metadata: ConceptMetadata,
): 'Mastered' | 'Completed' | 'Attempted' | 'Not started' {
  const saved = lessonProgress(progress, id);
  if (!id.startsWith('concepts/'))
    return isComplete(progress, id) ? 'Completed' : saved.quizBest ? 'Attempted' : 'Not started';
  const entry = metadata[id];
  if (!entry) throw new Error(`Unknown concept: ${id}`);
  const last = saved.quizLast;
  return last?.set === entry.set && last.score === last.total
    ? 'Mastered'
    : saved.quizBest
      ? 'Attempted'
      : 'Not started';
}

export function learningDone(progress: ProgressData, id: string, metadata: ConceptMetadata): boolean {
  const status = learningStatus(progress, id, metadata);
  return status === 'Mastered' || status === 'Completed';
}

export function journeyProgress(journey: SystemJourney, progress: ProgressData, metadata: ConceptMetadata) {
  const pages = journey.stages.flatMap(stagePages);
  const next = pages.find((id) => !learningDone(progress, id, metadata));
  return {
    completed: pages.filter((id) => learningDone(progress, id, metadata)).length,
    total: pages.length,
    next: next ? learningPage(next, metadata) : undefined,
    stage: next
      ? journey.stages.findIndex((stage) => stagePages(stage).includes(next))
      : journey.stages.length,
  };
}

export function guidedContinueTarget(
  progress: ProgressData,
  metadata: ConceptMetadata,
): { id: string; title: string } | null {
  const journey = journeyById(progress.journey);
  const last = progress.resume ?? progress.last;
  if (journey && last && (last === `journeys/${journey.id}` || journeyIncludes(journey, last))) {
    const next = journeyProgress(journey, progress, metadata).next;
    return next ?? { id: 'journeys', title: 'Choose another system' };
  }
  const id = progress.resume;
  const entry = id && Object.hasOwn(metadata, id) ? metadata[id] : undefined;
  if (entry && id) {
    return learningDone(progress, id, metadata)
      ? { id: 'journeys', title: 'Apply your concepts to a system' }
      : { id, title: entry.title };
  }
  return pathContinueTarget(progress);
}
