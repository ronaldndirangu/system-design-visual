import { createRng, createZipf, poisson, type Rng } from '../rng';

/* Illustrative estimates for a news search service. */

export interface SearchEstimateInput {
  corpusDocs: number;
  indexBytesPerDoc: number;
  newDocsPerSecond: number;
  queriesPerDay: number;
  peakFactor: number;
  buildDocsPerSecond: number;
  shardIndexBytes: number;
  replicaQps: number;
  keystrokesPerQuery: number;
}

export const searchEstimateInput: SearchEstimateInput = {
  corpusDocs: 540_000_000,
  indexBytesPerDoc: 1_000,
  newDocsPerSecond: 60,
  queriesPerDay: 576_000_000,
  peakFactor: 3,
  buildDocsPerSecond: 50_000,
  shardIndexBytes: 30e9,
  replicaQps: 2_000,
  keystrokesPerQuery: 6,
};

export interface SearchEstimates {
  indexBytes: number;
  shards: number;
  averageQps: number;
  peakQps: number;
  docsPerDay: number;
  dailyNewShare: number;
  rebuildSeconds: number;
  rebuildHours: number;
  docsDuringRebuild: number;
  maxBuildsPerDay: number;
  rewritesPerNewDocAtOneMinute: number;
  replicasPerShard: number;
  searchServers: number;
  typeaheadPeakQps: number;
}

export function searchEstimates(input: SearchEstimateInput = searchEstimateInput): SearchEstimates {
  const indexBytes = input.corpusDocs * input.indexBytesPerDoc;
  const shards = Math.ceil(indexBytes / input.shardIndexBytes);
  const averageQps = input.queriesPerDay / 86_400;
  const peakQps = averageQps * input.peakFactor;
  const docsPerDay = input.newDocsPerSecond * 86_400;
  const rebuildSeconds = input.corpusDocs / input.buildDocsPerSecond;
  // Sharding by document sends every query to every shard, so each shard sees the full peak rate.
  const replicasPerShard = Math.ceil(peakQps / input.replicaQps);
  return {
    indexBytes,
    shards,
    averageQps,
    peakQps,
    docsPerDay,
    dailyNewShare: docsPerDay / input.corpusDocs,
    rebuildSeconds,
    rebuildHours: rebuildSeconds / 3_600,
    docsDuringRebuild: input.newDocsPerSecond * rebuildSeconds,
    maxBuildsPerDay: Math.floor(86_400 / rebuildSeconds),
    rewritesPerNewDocAtOneMinute: input.corpusDocs / (input.newDocsPerSecond * 60),
    replicasPerShard,
    searchServers: shards * replicasPerShard,
    typeaheadPeakQps: peakQps * input.keystrokesPerQuery,
  };
}

/* Challenge: a product catalog where price and stock change far more often than titles. */

export const catalogFieldUpdatesPerSecond = 2_000;
export const fastFieldBytesPerDoc = 16;

export interface CatalogUpdateLoad {
  updatesPerDay: number;
  corpusShare: number;
  updatesPerNewDoc: number;
  fastFieldBytes: number;
  fastFieldBytesPerShard: number;
}

export function catalogUpdateLoad(
  input: SearchEstimateInput = searchEstimateInput,
  updatesPerSecond = catalogFieldUpdatesPerSecond,
): CatalogUpdateLoad {
  const updatesPerDay = updatesPerSecond * 86_400;
  const fastFieldBytes = input.corpusDocs * fastFieldBytesPerDoc;
  return {
    updatesPerDay,
    corpusShare: updatesPerDay / input.corpusDocs,
    updatesPerNewDoc: updatesPerSecond / input.newDocsPerSecond,
    fastFieldBytes,
    fastFieldBytesPerShard: fastFieldBytes / searchEstimates(input).shards,
  };
}

/* Toy freshness duel: one simulated day, two ways to keep an index current. */

export const DAY_TICKS = 96;
export const TICK_MINUTES = 15;
export const TICK_SECONDS = TICK_MINUTES * 60;
export const BUILD_TICKS = 12;
export const BUILD_START_TICK = 8;
export const QUERIES_PER_TICK = 48;
export const TOP_K = 10;
export const MERGE_FACTOR = 4;
/**
 * Assumed refresh interval, the Lucene-style default. The duel flushes once per 15-minute tick and reports a live
 * document's wait as this value; it models no queue lag, replica copy or result cache TTL.
 */
export const REFRESH_SECONDS = 1;
export const EVERGREEN_TOPICS = 30;
export const DOCS_PER_TOPIC = 60;
export const LIVE_QUALITY_PRIOR = 0.5;
export const MARKED_MERGE_LEVEL = 3;

const SEED = 42;
const TRICKLE_PER_TICK = 0.5;
const STORY_PER_TICK = 3;
const STORY_HALF_LIFE_TICKS = 12;
const STORY_INTEREST_TICKS = 24;
const STORY_SPAM_SHARE = 0.25;
const EVERGREEN_SPAM_SHARE = 0.1;
const QUALITY_NOISE = 0.15;

export interface Story {
  topic: number;
  title: string;
  breakTick: number;
}

export const stories: Story[] = [
  { topic: EVERGREEN_TOPICS, title: 'Storm makes landfall', breakTick: 2 },
  { topic: EVERGREEN_TOPICS + 1, title: 'Central bank cuts rates', breakTick: 42 },
  { topic: EVERGREEN_TOPICS + 2, title: 'Transit strike', breakTick: 74 },
];

export type SearchScenarioId = 'breaking' | 'evergreen' | 'rebuild4h';

export interface SearchScenario {
  id: SearchScenarioId;
  label: string;
  /** What this scenario changes from the baseline, shown on its chip. */
  diff: string;
  /** Share of queries that chase a story that has already broken. */
  freshShare: number;
  /** How often the lane without a real-time tier starts a full build. The other lane always rebuilds nightly. */
  rebuildEveryHours: number;
}

export const searchScenarios: Record<SearchScenarioId, SearchScenario> = {
  breaking: {
    id: 'breaking',
    label: 'Breaking news',
    diff: 'Baseline: 70% of queries chase the day’s 3 breaking stories, and both lanes build a full index nightly.',
    freshShare: 0.7,
    rebuildEveryHours: 24,
  },
  evergreen: {
    id: 'evergreen',
    label: 'Evergreen catalog',
    diff: 'Only 5% of queries chase breaking stories instead of 70%; the rest look for older documents.',
    freshShare: 0.05,
    rebuildEveryHours: 24,
  },
  rebuild4h: {
    id: 'rebuild4h',
    label: 'Rebuild every 4 hours',
    diff: 'The lane without a real-time tier starts a full build every 4 hours instead of nightly; each build still takes 3 hours.',
    freshShare: 0.7,
    rebuildEveryHours: 4,
  },
};

export function searchLaneLabels(scenario: SearchScenario): [string, string] {
  const batch =
    scenario.rebuildEveryHours === 24
      ? 'Nightly rebuild'
      : `Rebuild every ${scenario.rebuildEveryHours} hours`;
  return [batch, 'Batch index + real-time tier'];
}

export interface SearchDoc {
  id: number;
  topic: number;
  /** Tick the document arrived; -1 means it was in the corpus before the run. */
  arrival: number;
  spam: boolean;
  text: number;
  quality: number;
  /** Score with every offline signal: what a full build computes. */
  full: number;
  /** Score in a live segment: text relevance plus a neutral quality prior. */
  live: number;
}

export interface SearchEvent {
  tick: number;
  clock: string;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface LiveSegment {
  id: number;
  level: number;
  docs: number[];
}

export interface IndexBuild {
  snapshot: number;
  publishAt: number;
}

export interface SearchLane {
  label: string;
  liveTier: boolean;
  rebuildEveryTicks: number;
  /** The main index holds every document that arrived before this tick. */
  snapshot: number;
  mainDocs: number;
  build: IndexBuild | null;
  segments: LiveSegment[];
  recall: number[];
  queries: number;
  recallSum: number;
  missedBest: number;
  segmentsSearched: number;
  builds: number;
  buildWrites: number;
  flushWrites: number;
  mergeWrites: number;
}

export interface SearchSummary {
  recall: number;
  missedBestShare: number;
  /** Mean time each new document has spent unsearchable so far; a pending document counts up to the current tick. */
  unsearchableSeconds: number;
  segmentsPerQuery: number;
  builds: number;
  writes: number;
  searchableAdded: number;
  pendingAdded: number;
  liveDocs: number;
}

export function clock(tick: number): string {
  const minutes = tick * TICK_MINUTES;
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function makeDoc(rng: Rng, id: number, topic: number, arrival: number, spamShare: number): SearchDoc {
  const spam = rng() < spamShare;
  let text: number;
  let quality: number;
  if (spam) {
    text = 0.75 + 0.25 * rng();
    quality = 0.05 + 0.2 * rng();
  } else {
    const base = rng();
    text = clamp01(base + (rng() * 2 - 1) * QUALITY_NOISE);
    quality = clamp01(base + (rng() * 2 - 1) * QUALITY_NOISE);
  }
  return {
    id,
    topic,
    arrival,
    spam,
    text,
    quality,
    full: 0.5 * text + 0.5 * quality,
    live: 0.5 * text + 0.5 * LIVE_QUALITY_PRIOR,
  };
}

function byScore(docs: SearchDoc[], score: (doc: SearchDoc) => number) {
  return (a: number, b: number) => {
    const docA = docs[a] as SearchDoc;
    const docB = docs[b] as SearchDoc;
    return score(docB) - score(docA) || a - b;
  };
}

function newLane(label: string, liveTier: boolean, rebuildEveryTicks: number, mainDocs: number): SearchLane {
  return {
    label,
    liveTier,
    rebuildEveryTicks,
    snapshot: 0,
    mainDocs,
    build: null,
    segments: [],
    recall: [],
    queries: 0,
    recallSum: 0,
    missedBest: 0,
    segmentsSearched: 0,
    builds: 0,
    buildWrites: 0,
    flushWrites: 0,
    mergeWrites: 0,
  };
}

/**
 * Two lanes answer the same seeded stream of new documents and queries.
 * The batch-only lane searches its last full build. The real-time tier searches
 * the same kind of nightly build plus small live segments that hold every newer document.
 */
export class SearchDuel {
  readonly scenario: SearchScenario;
  readonly length = DAY_TICKS;
  readonly docs: SearchDoc[] = [];
  readonly corpusDocs: number;
  readonly lanes: [SearchLane, SearchLane];
  readonly events: SearchEvent[] = [];
  ticks = 0;
  private readonly docsByTopic: number[][];
  private readonly arrivalsByTick: number[][];
  private readonly queriesByTick: number[][];
  private readonly searchableAt: [Int32Array, Int32Array];
  private nextSegmentId = 1;

  constructor(scenario: SearchScenario = searchScenarios.breaking) {
    this.scenario = scenario;
    const docRng = createRng(SEED);
    const topics = EVERGREEN_TOPICS + stories.length;
    this.docsByTopic = Array.from({ length: topics }, () => []);
    this.arrivalsByTick = Array.from({ length: DAY_TICKS }, () => []);
    const add = (topic: number, arrival: number, spamShare: number) => {
      const doc = makeDoc(docRng, this.docs.length, topic, arrival, spamShare);
      this.docs.push(doc);
      this.docsByTopic[topic]?.push(doc.id);
      if (arrival >= 0) this.arrivalsByTick[arrival]?.push(doc.id);
    };
    for (let topic = 0; topic < EVERGREEN_TOPICS; topic += 1) {
      for (let n = 0; n < DOCS_PER_TOPIC; n += 1) add(topic, -1, EVERGREEN_SPAM_SHARE);
    }
    this.corpusDocs = this.docs.length;
    for (let tick = 0; tick < DAY_TICKS; tick += 1) {
      const trickle = poisson(docRng, TRICKLE_PER_TICK);
      for (let n = 0; n < trickle; n += 1) {
        add(Math.floor(docRng() * EVERGREEN_TOPICS), tick, EVERGREEN_SPAM_SHARE);
      }
      for (const story of stories) {
        if (tick < story.breakTick) continue;
        const rate = STORY_PER_TICK * 0.5 ** ((tick - story.breakTick) / STORY_HALF_LIFE_TICKS);
        const count = Math.max(tick === story.breakTick ? 1 : 0, poisson(docRng, rate));
        for (let n = 0; n < count; n += 1) add(story.topic, tick, STORY_SPAM_SHARE);
      }
    }

    const queryRng = createRng(SEED + 1);
    const zipf = createZipf(EVERGREEN_TOPICS, 1);
    this.queriesByTick = Array.from({ length: DAY_TICKS }, (_, tick) => {
      const broken = stories.filter((story) => story.breakTick <= tick);
      const weights = broken.map((story) => Math.exp(-(tick - story.breakTick) / STORY_INTEREST_TICKS));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return Array.from({ length: QUERIES_PER_TICK }, () => {
        const fresh = queryRng() < scenario.freshShare;
        const pick = queryRng();
        const evergreen = zipf(queryRng);
        if (!fresh || broken.length === 0) return evergreen;
        let target = pick * total;
        for (let index = 0; index < broken.length; index += 1) {
          target -= weights[index] ?? 0;
          if (target <= 0) return broken[index]?.topic ?? evergreen;
        }
        return broken[broken.length - 1]?.topic ?? evergreen;
      });
    });

    const everyA = (scenario.rebuildEveryHours * 60) / TICK_MINUTES;
    const [labelA, labelB] = searchLaneLabels(scenario);
    this.lanes = [
      newLane(labelA, false, everyA, this.corpusDocs),
      newLane(labelB, true, DAY_TICKS, this.corpusDocs),
    ];
    const initial = (): Int32Array => {
      const at = new Int32Array(this.docs.length).fill(-2);
      for (let id = 0; id < this.corpusDocs; id += 1) at[id] = -1;
      return at;
    };
    this.searchableAt = [initial(), initial()];
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  /** Documents that arrived during the run so far. */
  get addedSoFar(): number {
    return this.docs.length - this.corpusDocs - this.pendingArrivals();
  }

  private pendingArrivals(): number {
    let pending = 0;
    for (let tick = this.ticks; tick < DAY_TICKS; tick += 1)
      pending += this.arrivalsByTick[tick]?.length ?? 0;
    return pending;
  }

  arrivalsAt(tick: number): number {
    return this.arrivalsByTick[tick]?.length ?? 0;
  }

  queriesAt(tick: number): readonly number[] {
    return this.queriesByTick[tick] ?? [];
  }

  liveDocs(lane: SearchLane): number {
    return lane.segments.reduce((sum, segment) => sum + segment.docs.length, 0);
  }

  step(): void {
    if (this.done) return;
    const tick = this.ticks;
    const at = clock(tick);
    for (const story of stories) {
      if (story.breakTick === tick) {
        this.events.push({
          tick,
          clock: at,
          text: `Story breaks: “${story.title}”. Searches for it start at once.`,
          marker: true,
        });
      }
    }

    const published = this.lanes.map((lane, index) => this.publish(lane, index, tick));
    const shownA = published[0] ?? null;
    const shownB = published[1] ?? null;
    const [laneA, laneB] = this.lanes;
    if (shownA !== null && shownB !== null && shownA === shownB) {
      this.events.push({
        tick,
        clock: at,
        text: `Both lanes publish the ${clock(shownA)} build: older documents now rank with full signals, and the real-time tier drops them from its live segments.`,
        marker: true,
      });
    } else {
      if (shownA !== null) {
        this.events.push({
          tick,
          clock: at,
          text: `${laneA.label}: the ${clock(shownA)} build goes live, so documents from before ${clock(shownA)} become searchable.`,
          marker: true,
        });
      }
      if (shownB !== null) {
        this.events.push({
          tick,
          clock: at,
          text: `${laneB.label}: the ${clock(shownB)} build goes live, and the real-time tier drops its documents from the live segments.`,
          marker: true,
        });
      }
    }

    for (const lane of this.lanes) this.startBuild(lane, tick);

    const arrivals = this.arrivalsByTick[tick] ?? [];
    if (arrivals.length > 0) {
      for (const id of arrivals) this.searchableAt[1][id] = tick;
      laneB.segments.push({ id: this.nextSegmentId++, level: 0, docs: [...arrivals] });
      laneB.flushWrites += arrivals.length;
      this.mergeSegments(laneB, tick);
    }

    this.answerQueries(tick);
    this.ticks += 1;

    if (this.done) {
      const [a, b] = [this.summary(0), this.summary(1)];
      const [nameA, nameB] = this.lanes.map((lane) => lane.label.toLowerCase());
      const writes = (value: number) => value.toLocaleString('en-US');
      this.events.push({
        tick: this.ticks,
        clock: clock(this.ticks),
        text: `Day over. Recall@10: ${nameA} ${Math.round(a.recall)}%, ${nameB} ${Math.round(b.recall)}%. The real-time tier searched ${b.segmentsPerQuery.toFixed(1)} segments per query and wrote ${writes(b.writes)} documents, against ${writes(a.writes)} for ${nameA}.`,
        marker: false,
      });
    }
  }

  private publish(lane: SearchLane, index: number, tick: number): number | null {
    if (lane.build === null || lane.build.publishAt !== tick) return null;
    const { snapshot } = lane.build;
    const at = this.searchableAt[index as 0 | 1];
    for (const doc of this.docs) {
      if (doc.arrival >= 0 && doc.arrival < snapshot && (at[doc.id] ?? -2) < -1) at[doc.id] = tick;
    }
    lane.snapshot = snapshot;
    lane.mainDocs = this.docs.filter((doc) => doc.arrival < snapshot).length;
    lane.build = null;
    if (lane.liveTier) {
      for (const segment of lane.segments) {
        segment.docs = segment.docs.filter((id) => (this.docs[id]?.arrival ?? 0) >= snapshot);
      }
      lane.segments = lane.segments.filter((segment) => segment.docs.length > 0);
    }
    return snapshot;
  }

  private startBuild(lane: SearchLane, tick: number): void {
    if (lane.build !== null || tick < BUILD_START_TICK) return;
    if ((tick - BUILD_START_TICK) % lane.rebuildEveryTicks !== 0) return;
    lane.build = { snapshot: tick, publishAt: tick + BUILD_TICKS };
    lane.builds += 1;
    lane.buildWrites += this.docs.filter((doc) => doc.arrival < tick).length;
  }

  private mergeSegments(lane: SearchLane, tick: number): void {
    for (let level = 0; ; level += 1) {
      const atLevel = lane.segments.filter((segment) => segment.level === level);
      if (atLevel.length < MERGE_FACTOR) return;
      const merging = atLevel.slice(0, MERGE_FACTOR);
      const ids = new Set(merging.map((segment) => segment.id));
      const docs = merging.flatMap((segment) => segment.docs);
      const insertAt = lane.segments.findIndex((segment) => ids.has(segment.id));
      lane.segments = lane.segments.filter((segment) => !ids.has(segment.id));
      lane.segments.splice(insertAt, 0, { id: this.nextSegmentId++, level: level + 1, docs });
      lane.mergeWrites += docs.length;
      if (level + 1 >= MARKED_MERGE_LEVEL) {
        this.events.push({
          tick,
          clock: clock(tick),
          text: `The real-time tier merges ${MERGE_FACTOR} level ${level} segments into one level ${level + 1} segment, rewriting ${docs.length} documents.`,
          marker: true,
        });
      }
    }
  }

  /** The oracle: every document that exists by this tick, ranked with every signal. */
  ideal(topic: number, tick: number): number[] {
    const ids = (this.docsByTopic[topic] ?? []).filter((id) => (this.docs[id]?.arrival ?? 0) <= tick);
    return ids.sort(byScore(this.docs, (doc) => doc.full)).slice(0, TOP_K);
  }

  ranking(laneIndex: 0 | 1, topic: number, tick: number): number[] {
    const lane = this.lanes[laneIndex];
    const ids = this.docsByTopic[topic] ?? [];
    const main = ids.filter((id) => (this.docs[id]?.arrival ?? 0) < lane.snapshot);
    if (!lane.liveTier) return main.sort(byScore(this.docs, (doc) => doc.full)).slice(0, TOP_K);
    const scored = (doc: SearchDoc) => (doc.arrival < lane.snapshot ? doc.full : doc.live);
    const live = ids.filter((id) => {
      const arrival = this.docs[id]?.arrival ?? 0;
      return arrival >= lane.snapshot && arrival <= tick;
    });
    return [...main, ...live].sort(byScore(this.docs, scored)).slice(0, TOP_K);
  }

  private answerQueries(tick: number): void {
    const queries = this.queriesByTick[tick] ?? [];
    const cache = new Map<number, [number[], number[], number[]]>();
    const sums = [0, 0];
    for (const topic of queries) {
      let entry = cache.get(topic);
      if (entry === undefined) {
        entry = [this.ideal(topic, tick), this.ranking(0, topic, tick), this.ranking(1, topic, tick)];
        cache.set(topic, entry);
      }
      const [ideal, ...rankings] = entry;
      this.lanes.forEach((lane, index) => {
        const ranked = new Set(rankings[index]);
        const hits = ideal.filter((id) => ranked.has(id)).length;
        const recall = ideal.length === 0 ? 1 : hits / ideal.length;
        sums[index] = (sums[index] ?? 0) + recall;
        lane.queries += 1;
        lane.recallSum += recall;
        if (ideal.length > 0 && !ranked.has(ideal[0] as number)) lane.missedBest += 1;
        lane.segmentsSearched += 1 + lane.segments.length;
      });
    }
    this.lanes.forEach((lane, index) => {
      lane.recall.push(queries.length === 0 ? 100 : (100 * (sums[index] ?? 0)) / queries.length);
    });
  }

  summary(laneIndex: 0 | 1): SearchSummary {
    const lane = this.lanes[laneIndex];
    const at = this.searchableAt[laneIndex];
    let delayTotal = 0;
    let added = 0;
    let searchable = 0;
    for (const doc of this.docs) {
      if (doc.arrival < 0 || doc.arrival >= this.ticks) continue;
      added += 1;
      const ready = at[doc.id] ?? -2;
      if (ready >= 0) searchable += 1;
      const waitTicks = (ready >= 0 ? ready : this.ticks) - doc.arrival;
      delayTotal += Math.max(REFRESH_SECONDS, waitTicks * TICK_SECONDS);
    }
    const queries = Math.max(1, lane.queries);
    return {
      recall: lane.queries === 0 ? 100 : (100 * lane.recallSum) / lane.queries,
      missedBestShare: (100 * lane.missedBest) / queries,
      unsearchableSeconds: added === 0 ? 0 : delayTotal / added,
      segmentsPerQuery: lane.queries === 0 ? 1 : lane.segmentsSearched / lane.queries,
      builds: lane.builds,
      writes: lane.buildWrites + lane.flushWrites + lane.mergeWrites,
      searchableAdded: searchable,
      pendingAdded: added - searchable,
      liveDocs: this.liveDocs(lane),
    };
  }
}

export function formatDelay(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3_600).toFixed(1)} h`;
}

/* Inverted index walkthrough: six headlines, posting lists, and a two part score. */

export interface MiniDoc {
  id: string;
  title: string;
  /** Offline popularity signal from clicks, 0 to 1. */
  popularity: number;
}

export const miniDocs: MiniDoc[] = [
  { id: 'd1', title: 'Storm makes landfall on the coast', popularity: 0.9 },
  { id: 'd2', title: 'Coast towns brace for the storm', popularity: 0.6 },
  { id: 'd3', title: 'Storm storm storm coast deals', popularity: 0.05 },
  { id: 'd4', title: 'Central bank cuts rates', popularity: 0.8 },
  { id: 'd5', title: 'Coast guard drill planned', popularity: 0.3 },
  { id: 'd6', title: 'Storm insurance rates rise', popularity: 0.4 },
];

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'for', 'to', 'and', 'is']);
const BM25_K1 = 1.2;
export const POPULARITY_WEIGHT = 1;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && !STOPWORDS.has(term));
}

export interface Posting {
  doc: string;
  tf: number;
}

export function buildPostings(docs: readonly MiniDoc[]): Map<string, Posting[]> {
  const postings = new Map<string, Posting[]>();
  for (const doc of docs) {
    const counts = new Map<string, number>();
    for (const term of tokenize(doc.title)) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const [term, tf] of counts) {
      const list = postings.get(term) ?? [];
      list.push({ doc: doc.id, tf });
      postings.set(term, list);
    }
  }
  return new Map([...postings.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export interface MiniResult {
  doc: MiniDoc;
  text: number;
  final: number;
}

export interface MiniSearch {
  terms: string[];
  lists: { term: string; postings: Posting[] }[];
  matches: string[];
  results: MiniResult[];
}

/** BM25 with term frequency saturation and no length normalization, plus a popularity bonus. */
export function searchMini(
  docs: readonly MiniDoc[],
  query: string,
  usePopularity: boolean,
  postings: Map<string, Posting[]> = buildPostings(docs),
): MiniSearch {
  const terms = [...new Set(tokenize(query))];
  const lists = terms.map((term) => ({ term, postings: postings.get(term) ?? [] }));
  let matches = lists.length === 0 ? [] : (lists[0]?.postings.map((posting) => posting.doc) ?? []);
  for (const list of lists.slice(1)) {
    const docsInList = new Set(list.postings.map((posting) => posting.doc));
    matches = matches.filter((doc) => docsInList.has(doc));
  }
  const n = docs.length;
  const results = matches.map((id) => {
    const doc = docs.find((candidate) => candidate.id === id) as MiniDoc;
    let text = 0;
    for (const list of lists) {
      const df = list.postings.length;
      const tf = list.postings.find((posting) => posting.doc === id)?.tf ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      text += (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1);
    }
    return { doc, text, final: text + (usePopularity ? POPULARITY_WEIGHT * doc.popularity : 0) };
  });
  results.sort((a, b) => b.final - a.final || a.doc.id.localeCompare(b.doc.id));
  return { terms, lists, matches, results };
}

/* Typeahead: a trie whose nodes store their top completions, precomputed from the query log. */

export interface LoggedQuery {
  query: string;
  count: number;
}

export const typeaheadLog: LoggedQuery[] = [
  { query: 'storm', count: 9_400 },
  { query: 'storm tracker', count: 7_100 },
  { query: 'storm surge map', count: 2_300 },
  { query: 'stormy weather lyrics', count: 600 },
  { query: 'stock market today', count: 8_200 },
  { query: 'stocks to watch', count: 3_100 },
  { query: 'strike dates', count: 4_800 },
  { query: 'street food near me', count: 1_900 },
  { query: 'rate cut', count: 5_600 },
  { query: 'rates mortgage', count: 2_700 },
  { query: 'transit strike', count: 6_300 },
  { query: 'train times', count: 4_100 },
  { query: 'traffic map', count: 3_800 },
  { query: 'weather', count: 9_900 },
  { query: 'weather radar', count: 5_200 },
  { query: 'world cup scores', count: 4_400 },
];

export const TYPEAHEAD_K = 3;

export interface TrieNode {
  prefix: string;
  children: Map<string, TrieNode>;
  top: LoggedQuery[];
}

function rankLogged(a: LoggedQuery, b: LoggedQuery): number {
  return b.count - a.count || a.query.localeCompare(b.query);
}

export function buildTrie(log: readonly LoggedQuery[], k = TYPEAHEAD_K): TrieNode {
  const root: TrieNode = { prefix: '', children: new Map(), top: [] };
  const offer = (node: TrieNode, entry: LoggedQuery) => {
    node.top = [...node.top, entry].sort(rankLogged).slice(0, k);
  };
  for (const entry of log) {
    let node = root;
    offer(node, entry);
    for (const char of entry.query) {
      let child = node.children.get(char);
      if (child === undefined) {
        child = { prefix: node.prefix + char, children: new Map(), top: [] };
        node.children.set(char, child);
      }
      node = child;
      offer(node, entry);
    }
  }
  return root;
}

export function countTrieNodes(node: TrieNode): number {
  let count = 1;
  for (const child of node.children.values()) count += countTrieNodes(child);
  return count;
}

export interface TrieWalk {
  path: TrieNode[];
  found: boolean;
  top: LoggedQuery[];
  nodesVisited: number;
}

export function walkTrie(root: TrieNode, prefix: string): TrieWalk {
  const path: TrieNode[] = [root];
  let node: TrieNode | undefined = root;
  for (const char of prefix.toLowerCase()) {
    node = node.children.get(char);
    if (node === undefined) return { path, found: false, top: [], nodesVisited: path.length };
    path.push(node);
  }
  return { path, found: true, top: node.top, nodesVisited: path.length };
}

export interface LogScan {
  scanned: number;
  top: LoggedQuery[];
}

export function scanLog(log: readonly LoggedQuery[], prefix: string, k = TYPEAHEAD_K): LogScan {
  const wanted = prefix.toLowerCase();
  return {
    scanned: log.length,
    top: log
      .filter((entry) => entry.query.startsWith(wanted))
      .sort(rankLogged)
      .slice(0, k),
  };
}
