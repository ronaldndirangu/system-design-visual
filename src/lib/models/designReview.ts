/**
 * Design review practice: a flawed online shop, the learner's flags and
 * proposed fixes, and a scripted replay of the first hour of a sale.
 *
 * Toy model. The replay is a fixed script with illustrative numbers, written
 * so each seeded flaw fails in the way it really would. Nothing is random, so
 * the same flags and picks always produce the same replay, verdicts, and score.
 */

export type FixId =
  | 'standby'
  | 'ttl'
  | 'precompute'
  | 'backoff'
  | 'bound'
  | 'outbox'
  | 'more-servers'
  | 'bigger-machine';

export interface Fix {
  id: FixId;
  label: string;
  /** Why a distractor fails as a fix for any of the seeded flaws. */
  whyNot?: string;
}

export const FIXES: readonly Fix[] = [
  { id: 'standby', label: 'Run a standby pair with health checks and failover' },
  { id: 'ttl', label: 'Set a TTL and invalidate the entry on write' },
  { id: 'precompute', label: 'Precompute the result off the request path' },
  { id: 'backoff', label: 'Retry with exponential backoff, jitter, and a retry budget' },
  { id: 'bound', label: 'Use a durable, bounded queue and push back on producers' },
  { id: 'outbox', label: 'Write the event to an outbox table in the same transaction' },
  {
    id: 'more-servers',
    label: 'Add more servers of the same kind',
    whyNot:
      'More copies add capacity. A single point of failure and a correctness bug both survive extra copies.',
  },
  {
    id: 'bigger-machine',
    label: 'Move it to a bigger machine',
    whyNot: 'A bigger machine buys time. The same failure returns at a higher load.',
  },
];

export interface LessonRef {
  id: string;
  title: string;
}

export interface ReviewItem {
  id: string;
  label: string;
  /** What the design document says, in neutral words that give nothing away. */
  note: string;
  /** Design checklist step that surfaces the problem, or confirms the part is sound. */
  lens: string;
  question: string;
  isFlaw: boolean;
  /** Short name of the anti-pattern, or of the sound choice. */
  verdictName: string;
  explanation: string;
  fixId: FixId | null;
  fixDetail: string | null;
  lesson: LessonRef | null;
}

const lessons = {
  loadBalancing: { id: 'scaling/load-balancing', title: 'The server melts' },
  caching: { id: 'scaling/caching', title: 'Caching' },
  sharding: { id: 'scaling/sharding', title: 'Sharding and partitioning' },
  readReplicas: { id: 'scaling/read-replicas', title: 'Replication' },
  retries: { id: 'reliability/retries', title: 'Retries with backoff and jitter' },
  queues: { id: 'reliability/queues-and-backpressure', title: 'Queues and backpressure' },
  outbox: { id: 'async/delivery-semantics', title: 'Delivery semantics and the outbox' },
} satisfies Record<string, LessonRef>;

/** Items in display order; item n has number n + 1, and key 0 stands for item 10. */
export const REVIEW_ITEMS: readonly ReviewItem[] = [
  {
    id: 'load-balancer',
    label: 'Load balancer',
    note: 'One load balancer instance receives all shopper traffic and spreads it across the web tier.',
    lens: 'High-level design',
    question: 'What happens to every request if this box stops?',
    isFlaw: true,
    verdictName: 'Single point of failure',
    explanation:
      'Every request passes through one instance. When it fails or restarts, the whole shop goes dark, however many healthy web servers sit behind it.',
    fixId: 'standby',
    fixDetail:
      'Run two load balancers as an active and standby pair behind one address, or use a managed balancer that spans zones, with health checks that fail over in seconds.',
    lesson: lessons.loadBalancing,
  },
  {
    id: 'web-tier',
    label: 'Web tier',
    note: 'Three stateless web servers, sized so any two carry the peak sale traffic. The load balancer health checks each one every 5 seconds.',
    lens: 'Deep dive',
    question: 'If one web server dies during the sale, who notices, and what changes for shoppers?',
    isFlaw: false,
    verdictName: 'Sound: stateless and health checked',
    explanation:
      'Any server can handle any request, so a failed one drops out of rotation. The tier keeps one spare server of capacity, so the other two carry the peak on their own.',
    fixId: null,
    fixDetail: null,
    lesson: lessons.loadBalancing,
  },
  {
    id: 'product-cache',
    label: 'Product cache',
    note: 'Product pages, prices included, are cached on first read and kept until the cache node restarts.',
    lens: 'Data model',
    question: 'When a price changes in the database, how does the cached copy find out?',
    isFlaw: true,
    verdictName: 'Cache with no expiry',
    explanation:
      'Entries never expire and nothing removes them on a write, so a price change never reaches shoppers. The cache also fills with products nobody views.',
    fixId: 'ttl',
    fixDetail:
      'Give each entry a TTL that bounds how stale it can get, and delete or update the entry whenever its price is written.',
    lesson: lessons.caching,
  },
  {
    id: 'best-sellers',
    label: 'Best sellers query',
    note: 'The home page lists best sellers by joining order rows across all 8 order shards on every view.',
    lens: 'Estimates',
    question: 'How many shard queries does one home page view cost at peak traffic?',
    isFlaw: true,
    verdictName: 'Cross-shard join on the hot path',
    explanation:
      'Each home page view queries all 8 shards and waits for the slowest one. Page time follows the worst shard, and every view adds load to every shard at once.',
    fixId: 'precompute',
    fixDetail:
      'Compute best sellers every few minutes from the order events, store the small result, and serve it from the cache.',
    lesson: lessons.sharding,
  },
  {
    id: 'payment-client',
    label: 'Payment calls',
    note: 'When a call to the payment provider fails, checkout retries it immediately, up to 5 times.',
    lens: 'Deep dive',
    question: 'When the payment provider slows down, how many calls does checkout send it?',
    isFlaw: true,
    verdictName: 'Retries without backoff or jitter',
    explanation:
      'Immediate retries pile onto a provider that is already struggling. Each failing call becomes up to 6 back to back attempts with no pause. Thousands of checkouts fail together and retry together, so the retries arrive in synchronized waves that keep the provider overloaded.',
    fixId: 'backoff',
    fixDetail:
      'Wait longer before each retry with random jitter, cap retries with a budget, and send an idempotency key so a repeated charge is safe.',
    lesson: lessons.retries,
  },
  {
    id: 'event-queue',
    label: 'Event queue',
    note: 'Order events wait in an in-memory queue with no length limit, so producers never block and the queue turns no event away.',
    lens: 'Trade-offs',
    question: 'What happens to this queue when its consumers fall behind for an hour?',
    isFlaw: true,
    verdictName: 'Unbounded queue',
    explanation:
      'With no limit the queue grows until the process runs out of memory, and then every pending event is lost at once. Each new event also waits behind the whole backlog.',
    fixId: 'bound',
    fixDetail:
      'Move the events from process memory into a durable broker with a size limit, alert when consumer lag grows, and slow checkout down as the backlog nears the limit. Shed only low value work such as analytics, and keep every order event.',
    lesson: lessons.queues,
  },
  {
    id: 'checkout',
    label: 'Checkout',
    note: 'Checkout writes the order row to its shard, then publishes OrderPlaced to the event queue.',
    lens: 'API',
    question: 'If checkout crashes between those two writes, which systems disagree about the order?',
    isFlaw: true,
    verdictName: 'Dual write without an outbox',
    explanation:
      'The database write and the publish are separate steps. A crash between them keeps the order and loses the event, so no confirmation email goes out and the warehouse never ships.',
    fixId: 'outbox',
    fixDetail:
      'Insert the event into an outbox table in the same transaction as the order row. A relay publishes each outbox row until the broker confirms it, and a relay crash can publish a row twice, so delivery is at least once. Consumers record each event id they handle and skip a repeat, which makes them idempotent.',
    lesson: lessons.outbox,
  },
  {
    id: 'cdn',
    label: 'CDN',
    note: 'Images and scripts have content-hashed file names and a one-year cache lifetime at the CDN.',
    lens: 'Requirements',
    question: 'When an image changes, how does a shopper get the new version?',
    isFlaw: false,
    verdictName: 'Sound: versioned static files',
    explanation:
      'A changed file gets a new hashed name, so a long lifetime is safe: old names never change, and a new name misses once. The CDN absorbs the image traffic spike.',
    fixId: null,
    fixDetail: null,
    lesson: lessons.caching,
  },
  {
    id: 'read-replica',
    label: 'Read replica',
    note: 'Sales reports run on read replicas of the order shards and can lag them by a few seconds.',
    lens: 'Trade-offs',
    question: 'Who reads this copy, and can they live with a few seconds of lag?',
    isFlaw: false,
    verdictName: 'Sound: heavy reads moved off the primaries',
    explanation:
      'Reports are heavy reads that tolerate a little lag. Running them on replicas keeps the primaries free for checkout writes.',
    fixId: null,
    fixDetail: null,
    lesson: lessons.readReplicas,
  },
  {
    id: 'order-history',
    label: 'Order history query',
    note: 'The order history page reads one shard, chosen by customer id, which is the shard key.',
    lens: 'Data model',
    question: 'How many shards does one order history view touch?',
    isFlaw: false,
    verdictName: 'Sound: routed by the shard key',
    explanation:
      'The query carries the shard key, so it goes to exactly one shard. Its cost stays flat as the shop adds shards.',
    fixId: null,
    fixDetail: null,
    lesson: lessons.sharding,
  },
];

export const ITEM_COUNT = REVIEW_ITEMS.length;
export const FLAW_COUNT = REVIEW_ITEMS.filter((item) => item.isFlaw).length;
export const REPLAY_MINUTES = 60;

export type EventKind = 'incident' | 'held';

export interface ReplayEvent {
  minute: number;
  item: number;
  kind: EventKind;
  text: string;
}

/** One scripted event per item, in minute order. Numbers are illustrative. */
export const EVENTS: readonly ReplayEvent[] = [
  {
    minute: 4,
    item: 2,
    kind: 'incident',
    text: 'The sale price goes live in the database. Cached product pages keep the old price, so shoppers see one price on the page and another in the cart.',
  },
  {
    minute: 8,
    item: 7,
    kind: 'held',
    text: 'Image requests jump 30 times. The CDN answers them from its edge caches and the web tier never sees them.',
  },
  {
    minute: 12,
    item: 3,
    kind: 'incident',
    text: 'Home page views peak. Each view queries all 8 shards, and page time follows the slowest shard to about 2 seconds.',
  },
  {
    minute: 18,
    item: 1,
    kind: 'held',
    text: 'One web server fails two health checks. The load balancer stops sending it requests within 10 seconds, and the other two, sized for the peak, absorb its share.',
  },
  {
    minute: 24,
    item: 4,
    kind: 'incident',
    text: 'The payment provider slows down. Each failed call turns into up to 6 attempts with no pause, thousands of checkouts retry in the same waves, and the retry storm keeps the provider overloaded.',
  },
  {
    minute: 30,
    item: 5,
    kind: 'incident',
    text: 'The email consumer falls behind. The queue grows until the process runs out of memory, restarts, and loses every pending event.',
  },
  {
    minute: 36,
    item: 6,
    kind: 'incident',
    text: 'A checkout server crashes after saving an order and before publishing OrderPlaced. The shopper gets no confirmation, and the warehouse never ships.',
  },
  {
    minute: 42,
    item: 9,
    kind: 'held',
    text: 'Shoppers check their orders. Each view reads one shard, so latency stays flat while the shop is busy.',
  },
  {
    minute: 48,
    item: 8,
    kind: 'held',
    text: 'Finance runs the hourly sales report on the replicas. Checkout writes on the primaries keep their usual speed.',
  },
  {
    minute: 54,
    item: 0,
    kind: 'incident',
    text: 'The load balancer host reboots for a patch. Every request fails for 4 minutes, while all three web servers sit healthy behind it.',
  },
];

export type Phase = 'flagging' | 'replaying' | 'paused' | 'revealed';

export interface ReviewState {
  phase: Phase;
  flags: readonly boolean[];
  picks: readonly (FixId | null)[];
  minute: number;
}

export function initialReview(): ReviewState {
  return {
    phase: 'flagging',
    flags: Array.from({ length: ITEM_COUNT }, () => false),
    picks: Array.from({ length: ITEM_COUNT }, () => null),
    minute: 0,
  };
}

export function itemAt(index: number): ReviewItem {
  const item = REVIEW_ITEMS[index];
  if (!item) throw new RangeError(`No review item at index ${index}`);
  return item;
}

export function isFlagged(state: ReviewState, index: number): boolean {
  return state.flags[index] ?? false;
}

export function pickAt(state: ReviewState, index: number): FixId | null {
  return state.picks[index] ?? null;
}

export function flagCount(state: ReviewState): number {
  return state.flags.filter(Boolean).length;
}

export function canReview(state: ReviewState): boolean {
  return state.phase === 'flagging' && flagCount(state) > 0;
}

/** Unflagging an item also clears its proposed fix. */
export function toggleFlag(state: ReviewState, index: number): ReviewState {
  if (state.phase !== 'flagging' || index < 0 || index >= ITEM_COUNT) return state;
  const flagged = !state.flags[index];
  return {
    ...state,
    flags: state.flags.map((flag, i) => (i === index ? flagged : flag)),
    picks: flagged ? state.picks : state.picks.map((pick, i) => (i === index ? null : pick)),
  };
}

export function pickFix(state: ReviewState, index: number, fix: FixId | null): ReviewState {
  if (state.phase !== 'flagging' || !state.flags[index]) return state;
  return { ...state, picks: state.picks.map((pick, i) => (i === index ? fix : pick)) };
}

export function play(state: ReviewState): ReviewState {
  if (canReview(state) || state.phase === 'paused') return { ...state, phase: 'replaying' };
  return state;
}

export function pause(state: ReviewState): ReviewState {
  return state.phase === 'replaying' ? { ...state, phase: 'paused' } : state;
}

export function reveal(state: ReviewState): ReviewState {
  if (canReview(state) || state.phase === 'replaying' || state.phase === 'paused')
    return { ...state, phase: 'revealed', minute: REPLAY_MINUTES };
  return state;
}

/** Advances the replay one minute; the hour ending reveals the answers. */
export function tick(state: ReviewState): ReviewState {
  if (state.phase !== 'replaying') return state;
  const minute = state.minute + 1;
  return minute >= REPLAY_MINUTES ? reveal(state) : { ...state, minute };
}

export function nextEvent(state: ReviewState): ReplayEvent | null {
  return EVENTS.find((event) => event.minute > state.minute) ?? null;
}

/** Jumps to the next event and pauses there, so the learner can read it. */
export function stepToNextEvent(state: ReviewState): ReviewState {
  if (!(canReview(state) || state.phase === 'replaying' || state.phase === 'paused')) return state;
  const next = nextEvent(state);
  if (!next) return reveal(state);
  return { ...state, phase: 'paused', minute: next.minute };
}

export function eventsSoFar(state: ReviewState): ReplayEvent[] {
  return EVENTS.filter((event) => event.minute <= state.minute);
}

export function eventForItem(index: number): ReplayEvent | null {
  return EVENTS.find((event) => event.item === index) ?? null;
}

export type Verdict = 'found' | 'missed' | 'false-alarm' | 'cleared';

export function verdict(state: ReviewState, index: number): Verdict {
  const flagged = isFlagged(state, index);
  if (REVIEW_ITEMS[index]?.isFlaw) return flagged ? 'found' : 'missed';
  return flagged ? 'false-alarm' : 'cleared';
}

export type FixResult =
  | { kind: 'match' }
  | { kind: 'none' }
  | { kind: 'not-needed' }
  | { kind: 'mismatch'; reason: string };

export function fixResult(index: number, pick: FixId | null): FixResult {
  const item = REVIEW_ITEMS[index];
  if (!item?.isFlaw) return { kind: 'not-needed' };
  if (pick === null) return { kind: 'none' };
  if (pick === item.fixId) return { kind: 'match' };
  const distractor = FIXES.find((fix) => fix.id === pick)?.whyNot;
  if (distractor) return { kind: 'mismatch', reason: distractor };
  const owner = REVIEW_ITEMS.findIndex((other) => other.fixId === pick);
  const ownerItem = REVIEW_ITEMS[owner];
  return {
    kind: 'mismatch',
    reason: ownerItem
      ? `That fix belongs to item ${owner + 1}, ${ownerItem.label}: ${ownerItem.verdictName.toLowerCase()}.`
      : 'That fix does not address this flaw.',
  };
}

export interface ReviewScore {
  found: number;
  missed: number;
  falseAlarms: number;
  cleared: number;
  fixesMatched: number;
}

export function reviewScore(state: ReviewState): ReviewScore {
  const score: ReviewScore = { found: 0, missed: 0, falseAlarms: 0, cleared: 0, fixesMatched: 0 };
  REVIEW_ITEMS.forEach((_, index) => {
    const result = verdict(state, index);
    if (result === 'found') score.found += 1;
    else if (result === 'missed') score.missed += 1;
    else if (result === 'false-alarm') score.falseAlarms += 1;
    else score.cleared += 1;
    if (result === 'found' && fixResult(index, pickAt(state, index)).kind === 'match')
      score.fixesMatched += 1;
  });
  return score;
}
