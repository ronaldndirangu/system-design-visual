import { createRng, randomInt } from '../rng';

/**
 * A toy social network: 60 ordinary posts go up over 24 s, and each author has
 * 20 to 80 followers. Fan out on write copies a post into every follower's feed
 * through a fanout fleet that runs a fixed number of feed writes per tick, oldest
 * job first. Feed loads arrive at a fixed rate from random readers in a network
 * of 20,000 toy users, and a read tier serves them in arrival order. Every post
 * and feed load comes from one pre-generated workload, so both lanes see the
 * same traffic at the same moments and only the fan-out rule differs. Times and
 * sizes are compressed: real celebrities have millions of followers and real
 * fanout fleets run millions of writes per second.
 */
export const TICK_SECONDS = 0.1;
export const POSTS = 60;
export const GRID_COLS = 12;
const ARRIVAL_SECONDS = 24;
export const MIN_FOLLOWERS = 20;
export const MAX_FOLLOWERS = 80;
/** A post should reach every follower's feed within this long. */
export const FRESH_SECONDS = 2;
const FRESH_TICKS = Math.round(FRESH_SECONDS / TICK_SECONDS);
/** The hybrid lane skips fanout for any author with more followers than this. */
export const CELEBRITY_THRESHOLD = 1_000;
/** The fanout fleet splits a celebrity's followers into jobs of this many feed writes. */
export const CELEBRITY_BATCH = 500;
/** Readers come from this many toy users. Users 0 to F - 1 follow the celebrity. */
export const USERS = 20_000;
/** Each reader follows this many accounts, so a pulled feed reads this many author lists. */
export const MIN_FOLLOWS = 30;
export const MAX_FOLLOWS = 70;
/** A feed load should finish within this long of the tap. */
export const READ_TARGET_SECONDS = 1;
const READ_TARGET_TICKS = Math.round(READ_TARGET_SECONDS / TICK_SECONDS);
/** Enough pre-generated readers for the busiest scenario. */
const LOAD_POOL = 4_000;

export type FeedDuelId = 'celebrity' | 'reads';
export type FeedScenarioId =
  | 'celebrity'
  | 'more-followers'
  | 'double-fleet'
  | 'small-read-tier'
  | 'no-celebrity'
  | 'evening-peak'
  | 'double-reads'
  | 'no-peak';

/**
 * push: copy every post into each follower's feed at post time. pull: store the
 * post once and build each feed at read time from the author lists the reader
 * follows. hybrid: push for ordinary authors, pull for celebrities.
 */
export type FanoutMode = 'push' | 'pull' | 'hybrid';

export interface LaneConfig {
  label: string;
  mode: FanoutMode;
}

export interface FeedScenario {
  id: FeedScenarioId;
  duel: FeedDuelId;
  label: string;
  /** What this scenario changes from its duel's baseline, shown on its chip. */
  diff: string;
  /** Feed writes the fanout fleet runs per tick. */
  writesPerTick: number;
  celebrity: { followers: number; atSeconds: number } | null;
  /** Feed loads that arrive per tick outside the peak. */
  loadsPerTick: number;
  peak: { loadsPerTick: number; fromSeconds: number; toSeconds: number } | null;
  /** Lookups the read tier serves per tick. */
  readsPerTick: number;
  seconds: number;
  lanes: [LaneConfig, LaneConfig];
}

const celebrityLanes: [LaneConfig, LaneConfig] = [
  { label: 'Fan out on write', mode: 'push' },
  { label: 'Hybrid fan-out', mode: 'hybrid' },
];
const readLanes: [LaneConfig, LaneConfig] = [
  { label: 'Fan out on read', mode: 'pull' },
  { label: 'Fan out on write', mode: 'push' },
];

export const feedScenarios: Record<FeedScenarioId, FeedScenario> = {
  celebrity: {
    id: 'celebrity',
    duel: 'celebrity',
    label: 'Celebrity posts',
    diff: 'Baseline: 60 ordinary posts over 24 s, each author with 20 to 80 followers. The fanout fleet runs 500 feed writes per second. At 3 s a celebrity with 5,000 followers posts. Feed loads arrive at 40 per second, and the read tier serves 80 lookups per second.',
    writesPerTick: 50,
    celebrity: { followers: 5_000, atSeconds: 3 },
    loadsPerTick: 4,
    peak: null,
    readsPerTick: 8,
    seconds: 30,
    lanes: celebrityLanes,
  },
  'more-followers': {
    id: 'more-followers',
    duel: 'celebrity',
    label: 'Twice the followers',
    diff: 'Celebrity followers: 5,000 to 10,000.',
    writesPerTick: 50,
    celebrity: { followers: 10_000, atSeconds: 3 },
    loadsPerTick: 4,
    peak: null,
    readsPerTick: 8,
    seconds: 30,
    lanes: celebrityLanes,
  },
  'double-fleet': {
    id: 'double-fleet',
    duel: 'celebrity',
    label: 'Double the fleet',
    diff: 'Fanout fleet: 500 to 1,000 feed writes per second.',
    writesPerTick: 100,
    celebrity: { followers: 5_000, atSeconds: 3 },
    loadsPerTick: 4,
    peak: null,
    readsPerTick: 8,
    seconds: 30,
    lanes: celebrityLanes,
  },
  'small-read-tier': {
    id: 'small-read-tier',
    duel: 'celebrity',
    label: 'Read tier sized for push',
    diff: 'Read tier: 80 to 40 lookups per second, exactly what fan out on write needs.',
    writesPerTick: 50,
    celebrity: { followers: 5_000, atSeconds: 3 },
    loadsPerTick: 4,
    peak: null,
    readsPerTick: 4,
    seconds: 30,
    lanes: celebrityLanes,
  },
  'no-celebrity': {
    id: 'no-celebrity',
    duel: 'celebrity',
    label: 'No celebrity',
    diff: 'Celebrity post: removed.',
    writesPerTick: 50,
    celebrity: null,
    loadsPerTick: 4,
    peak: null,
    readsPerTick: 8,
    seconds: 30,
    lanes: celebrityLanes,
  },
  'evening-peak': {
    id: 'evening-peak',
    duel: 'reads',
    label: 'Evening peak',
    diff: 'Baseline: the same 60 posts and no celebrity. Feed loads arrive at 40 per second, then 120 per second from 8 s to 16 s. Each reader follows 30 to 70 accounts. The read tier serves 4,000 lookups per second.',
    writesPerTick: 50,
    celebrity: null,
    loadsPerTick: 4,
    peak: { loadsPerTick: 12, fromSeconds: 8, toSeconds: 16 },
    readsPerTick: 400,
    seconds: 30,
    lanes: readLanes,
  },
  'double-reads': {
    id: 'double-reads',
    duel: 'reads',
    label: 'Double the read tier',
    diff: 'Read tier: 4,000 to 8,000 lookups per second.',
    writesPerTick: 50,
    celebrity: null,
    loadsPerTick: 4,
    peak: { loadsPerTick: 12, fromSeconds: 8, toSeconds: 16 },
    readsPerTick: 800,
    seconds: 30,
    lanes: readLanes,
  },
  'no-peak': {
    id: 'no-peak',
    duel: 'reads',
    label: 'No peak',
    diff: 'Evening peak: removed.',
    writesPerTick: 50,
    celebrity: null,
    loadsPerTick: 4,
    peak: null,
    readsPerTick: 400,
    seconds: 30,
    lanes: readLanes,
  },
};

export const duelScenarioIds: Record<FeedDuelId, FeedScenarioId[]> = {
  celebrity: ['celebrity', 'more-followers', 'double-fleet', 'small-read-tier', 'no-celebrity'],
  reads: ['evening-peak', 'double-reads', 'no-peak'],
};

export interface Post {
  /** Posts are numbered in posting order, counted from 0. */
  id: number;
  /** The tick the author posts. */
  arrival: number;
  followers: number;
  /** The first tick at which the post has missed its freshness target. */
  deadline: number;
}

/** A pre-generated reader: who taps refresh, and how many accounts they follow. */
export interface LoadDraw {
  reader: number;
  follows: number;
}

export interface FeedLoad extends LoadDraw {
  /** Feed loads are numbered in arrival order, counted from 0. */
  id: number;
  arrival: number;
}

export interface FeedWorkload {
  posts: Post[];
  draws: LoadDraw[];
}

/** The shared posts and readers. Every scenario uses the same workload; scenarios only change rates. */
export function makeFeedWorkload(seed: number): FeedWorkload {
  const rng = createRng(seed);
  const drafts = Array.from({ length: POSTS }, (_, order) => ({
    order,
    arrival: randomInt(rng, 0, Math.round(ARRIVAL_SECONDS / TICK_SECONDS) - 1),
    followers: randomInt(rng, MIN_FOLLOWERS, MAX_FOLLOWERS),
  }));
  drafts.sort((x, y) => x.arrival - y.arrival || x.order - y.order);
  const posts = drafts.map(({ arrival, followers }, id) => ({
    id,
    arrival,
    followers,
    deadline: arrival + FRESH_TICKS,
  }));
  const draws = Array.from({ length: LOAD_POOL }, () => ({
    reader: randomInt(rng, 0, USERS - 1),
    follows: randomInt(rng, MIN_FOLLOWS, MAX_FOLLOWS),
  }));
  return { posts, draws };
}

/** Whether a lane stores this author's posts once and merges them at read time. */
export function pullsAuthor(mode: FanoutMode, followers: number): boolean {
  return mode === 'pull' || (mode === 'hybrid' && followers > CELEBRITY_THRESHOLD);
}

/**
 * Lookups one feed load costs. A pushed feed is one precomputed list. A pulled
 * feed reads every followed author's list. The hybrid reads the precomputed list
 * plus the list of each followed celebrity.
 */
export function loadCost(mode: FanoutMode, load: LoadDraw, celebrityFollowers: number): number {
  if (mode === 'pull') return load.follows;
  if (mode === 'hybrid' && pullsAuthor(mode, celebrityFollowers) && load.reader < celebrityFollowers)
    return 2;
  return 1;
}

/**
 * future: not posted yet. queued: waiting for its feed writes. onTime: in every
 * follower's feed within the freshness target. late: in every feed, but after
 * the target.
 */
export type PostPhase = 'future' | 'queued' | 'onTime' | 'late';

/** One job for the fanout fleet: an ordinary post, or post -1 for a batch of celebrity followers. */
export interface FanoutJob {
  post: number;
  writes: number;
}

interface LaneState {
  phase: PostPhase[];
  /** The tick boundary from which every follower can see the post, or -1. */
  doneAt: number[];
  /** Still queued and already past the freshness target. */
  overdue: boolean[];
  queue: FanoutJob[];
  feedWrites: number;
  /** Celebrity followers whose feeds hold the post, in follower order. */
  celebrityWritten: number;
  /**
   * The tick boundary from which the post is available to every celebrity follower, or -1. A
   * follower still sees it only when the read tier returns their next feed load.
   */
  celebrityDoneTick: number;
  /** Feed loads waiting for the read tier, oldest first. */
  readQueue: number[];
  /** Lookups already spent on the feed load at the head of the read queue. */
  headLookups: number;
  servedAt: number[];
  lookups: number;
  /** Feed loads by celebrity followers, after the post, that did not show it. */
  missedCelebrity: number;
  /** Feed loads by celebrity followers, after the post, returned within the read target with the post in them. */
  returnedCelebrity: number;
  series: number[];
  firstMiss: boolean;
  firstSlow: boolean;
  backlogCleared: boolean;
}

export interface FeedLane {
  config: LaneConfig;
  state: LaneState;
}

export interface FeedEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface FeedCheckpoint {
  tick: number;
  lanes: [LaneState, LaneState];
  events: FeedEvent[];
}

function emptyLane(loads: number): LaneState {
  return {
    phase: Array.from({ length: POSTS }, (): PostPhase => 'future'),
    doneAt: Array.from({ length: POSTS }, () => -1),
    overdue: Array.from({ length: POSTS }, () => false),
    queue: [],
    feedWrites: 0,
    celebrityWritten: 0,
    celebrityDoneTick: -1,
    readQueue: [],
    headLookups: 0,
    servedAt: Array.from({ length: loads }, () => -1),
    lookups: 0,
    missedCelebrity: 0,
    returnedCelebrity: 0,
    series: [],
    firstMiss: false,
    firstSlow: false,
    backlogCleared: false,
  };
}

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, one: string, many: string) => `${count(value)} ${value === 1 ? one : many}`;

function writesWaiting(lane: FeedLane): number {
  return lane.state.queue.reduce((sum, job) => sum + job.writes, 0);
}

export class FeedDuel {
  readonly scenario: FeedScenario;
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly posts: Post[];
  readonly loads: FeedLoad[];
  /** loadStart[t] is the id of the first feed load at tick t; loadStart[length] is the total. */
  readonly loadStart: number[];
  readonly lanes: [FeedLane, FeedLane];
  /** The ticks the celebrity posts and the peak starts and ends; -1 when they never happen. */
  readonly celebrityTick: number;
  readonly peakTick: number;
  readonly peakEndTick: number;
  events: FeedEvent[] = [];
  private tickCount = 0;

  constructor(scenario: FeedScenario, seed = 42) {
    this.scenario = scenario;
    this.length = Math.round(scenario.seconds / TICK_SECONDS);
    const workload = makeFeedWorkload(seed);
    this.posts = workload.posts;
    const { celebrity, peak } = scenario;
    this.celebrityTick = celebrity ? Math.round(celebrity.atSeconds / TICK_SECONDS) : -1;
    this.peakTick = peak ? Math.round(peak.fromSeconds / TICK_SECONDS) : -1;
    this.peakEndTick = peak ? Math.round(peak.toSeconds / TICK_SECONDS) : -1;
    this.loads = [];
    this.loadStart = [];
    for (let tick = 0; tick < this.length; tick += 1) {
      this.loadStart.push(this.loads.length);
      for (let n = 0; n < this.loadsAt(tick); n += 1) {
        const draw = workload.draws[this.loads.length];
        if (!draw) throw new Error('The feed load pool is too small for this scenario.');
        this.loads.push({ id: this.loads.length, arrival: tick, ...draw });
      }
    }
    this.loadStart.push(this.loads.length);
    this.lanes = [
      { config: scenario.lanes[0], state: emptyLane(this.loads.length) },
      { config: scenario.lanes[1], state: emptyLane(this.loads.length) },
    ];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  get celebrityFollowers(): number {
    return this.scenario.celebrity?.followers ?? 0;
  }

  /** Feed loads that arrive during a tick. */
  loadsAt(tick: number): number {
    const { peak, loadsPerTick } = this.scenario;
    if (peak && tick >= this.peakTick && tick < this.peakEndTick) return peak.loadsPerTick;
    return loadsPerTick;
  }

  checkpoint(): FeedCheckpoint {
    return structuredClone({
      tick: this.tickCount,
      lanes: [this.lanes[0].state, this.lanes[1].state] as [LaneState, LaneState],
      events: this.events,
    });
  }

  restore(saved: FeedCheckpoint): void {
    const copy = structuredClone(saved);
    this.tickCount = copy.tick;
    this.lanes[0].state = copy.lanes[0];
    this.lanes[1].state = copy.lanes[1];
    this.events = copy.events;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    if (tick === this.celebrityTick) {
      this.events.push({
        tick,
        text: `A celebrity with ${count(this.celebrityFollowers)} followers posts.`,
        marker: true,
      });
    }
    if (tick === this.peakTick) {
      this.events.push({
        tick,
        text: `The evening peak starts: feed loads jump from ${this.scenario.loadsPerTick * 10} to ${this.loadsAt(tick) * 10} per second.`,
        marker: true,
      });
    }
    if (tick === this.peakEndTick) {
      this.events.push({
        tick,
        text: `The evening peak ends: feed loads fall back to ${this.scenario.loadsPerTick * 10} per second.`,
        marker: true,
      });
    }
    for (const lane of this.lanes) this.stepLane(lane, tick);
    this.tickCount += 1;
    if (this.done) this.wrapUp();
  }

  private stepLane(lane: FeedLane, tick: number): void {
    const s = lane.state;
    const { label, mode } = lane.config;
    const followers = this.celebrityFollowers;

    for (const post of this.posts) {
      if (post.arrival !== tick) continue;
      if (pullsAuthor(mode, post.followers)) {
        s.phase[post.id] = 'onTime';
        s.doneAt[post.id] = tick;
      } else {
        s.phase[post.id] = 'queued';
        s.queue.push({ post: post.id, writes: post.followers });
      }
    }
    if (tick === this.celebrityTick) {
      if (pullsAuthor(mode, followers)) {
        s.celebrityDoneTick = tick;
        this.events.push({
          tick: tick + 1,
          text: `${label}: the celebrity has more than ${count(CELEBRITY_THRESHOLD)} followers, so the lane stores the post once and writes no feeds. Each follower's feed load merges it in at read time.`,
          marker: true,
        });
      } else {
        const batches = Math.ceil(followers / CELEBRITY_BATCH);
        for (let n = 0; n < batches; n += 1) {
          s.queue.push({ post: -1, writes: Math.min(CELEBRITY_BATCH, followers - n * CELEBRITY_BATCH) });
        }
        this.events.push({
          tick: tick + 1,
          text: `${label}: the celebrity post becomes ${count(followers)} feed writes in ${batches} jobs, ahead of every later post.`,
          marker: true,
        });
      }
    }

    let budget = this.scenario.writesPerTick;
    while (budget > 0 && s.queue.length > 0) {
      const job = s.queue[0];
      if (!job) break;
      const writes = Math.min(budget, job.writes);
      job.writes -= writes;
      budget -= writes;
      s.feedWrites += writes;
      if (job.post < 0) s.celebrityWritten += writes;
      if (job.writes > 0) break;
      s.queue.shift();
      if (job.post >= 0) {
        const post = this.posts[job.post];
        s.doneAt[job.post] = tick + 1;
        s.phase[job.post] = post && tick >= post.deadline ? 'late' : 'onTime';
      } else if (s.celebrityWritten >= followers && s.celebrityDoneTick < 0) {
        s.celebrityDoneTick = tick + 1;
        const seconds = ((tick + 1 - this.celebrityTick) * TICK_SECONDS).toFixed(1);
        this.events.push({
          tick: tick + 1,
          text: `${label}: the last of ${count(followers)} followers gets the celebrity post in their feed, ${seconds} s after it went up.`,
          marker: true,
        });
      }
    }
    this.sweep(lane, tick);

    const start = this.loadStart[tick] ?? 0;
    const end = this.loadStart[tick + 1] ?? start;
    for (let id = start; id < end; id += 1) s.readQueue.push(id);
    let lookups = this.scenario.readsPerTick;
    while (s.readQueue.length > 0) {
      const load = this.loads[s.readQueue[0] ?? -1];
      if (!load) break;
      const cost = loadCost(mode, load, followers);
      const need = cost - s.headLookups;
      if (need > lookups) {
        s.headLookups += lookups;
        break;
      }
      lookups -= need;
      s.headLookups = 0;
      s.readQueue.shift();
      s.servedAt[load.id] = tick;
      s.lookups += cost;
      const posted = this.celebrityTick >= 0 && tick >= this.celebrityTick;
      if (posted && load.reader < followers) {
        const shown = pullsAuthor(mode, followers) || load.reader < s.celebrityWritten;
        if (!shown) s.missedCelebrity += 1;
        else if (tick - load.arrival <= READ_TARGET_TICKS) s.returnedCelebrity += 1;
      }
    }
    const head = this.loads[s.readQueue[0] ?? -1];
    if (head && !s.firstSlow && tick + 1 - head.arrival > READ_TARGET_TICKS) {
      s.firstSlow = true;
      this.events.push({
        tick: tick + 1,
        text: `${label}: feed load ${head.id + 1} has waited more than ${READ_TARGET_SECONDS} s for the read tier. It needs ${plural(loadCost(mode, head, followers), 'lookup', 'lookups')}.`,
        marker: true,
      });
    }
    if (s.firstSlow && !s.backlogCleared && s.readQueue.length === 0) {
      s.backlogCleared = true;
      this.events.push({
        tick: tick + 1,
        text: `${label}: the read tier catches up and the backlog of feed loads clears.`,
        marker: true,
      });
    }

    s.series.push(this.scenario.duel === 'celebrity' ? writesWaiting(lane) : s.readQueue.length);
  }

  /** Posts still queued at the end of a tick in which they reach the target can no longer make it. */
  private sweep(lane: FeedLane, tick: number): void {
    const s = lane.state;
    for (const post of this.posts) {
      if (s.phase[post.id] !== 'queued' || s.overdue[post.id] || tick + 1 < post.deadline) continue;
      s.overdue[post.id] = true;
      if (s.firstMiss) continue;
      s.firstMiss = true;
      this.events.push({
        tick: tick + 1,
        text: `${lane.config.label}: post ${post.id + 1} has waited ${FRESH_SECONDS} s in the fanout queue, and its ${post.followers} followers still cannot see it.`,
        marker: true,
      });
    }
  }

  private wrapUp(): void {
    const [a, b] = this.lanes;
    const name = (lane: FeedLane) => lane.config.label.toLowerCase();
    const sa = summarize(a, this);
    const sb = summarize(b, this);
    let text: string;
    if (this.scenario.duel === 'celebrity') {
      text = `Run ends. Posts that missed the ${FRESH_SECONDS} s target: ${name(a)} ${sa.missed}, ${name(b)} ${sb.missed}.`;
      if (this.celebrityTick >= 0) {
        text += ` Feed loads that missed the celebrity post: ${name(a)} ${sa.missedCelebrity}, ${name(b)} ${sb.missedCelebrity}.`;
      }
      if (sa.slowLoads + sb.slowLoads > 0) {
        text += ` Feed loads that waited more than ${READ_TARGET_SECONDS} s: ${name(a)} ${sa.slowLoads}, ${name(b)} ${sb.slowLoads}.`;
      }
    } else {
      text = `Run ends. Feed loads that waited more than ${READ_TARGET_SECONDS} s: ${name(a)} ${sa.slowLoads}, ${name(b)} ${sb.slowLoads}.`;
    }
    text += ` Lookups to serve feed loads: ${name(a)} ${count(sa.lookups)}, ${name(b)} ${count(sb.lookups)}.`;
    this.events.push({ tick: this.tickCount, text, marker: false });
  }
}

export type TileView = 'future' | 'waiting' | 'overdue' | 'onTime' | 'late';

export function tileView(lane: FeedLane, id: number): TileView {
  const s = lane.state;
  const phase = s.phase[id] ?? 'future';
  if (phase === 'queued') return s.overdue[id] ? 'overdue' : 'waiting';
  return phase;
}

export interface FeedSummary {
  published: number;
  onTime: number;
  late: number;
  queued: number;
  /** Late, or still queued past the target. */
  missed: number;
  /** From the post to its last feed write, over posts in every feed. */
  averageReachSeconds: number;
  feedWrites: number;
  writesWaiting: number;
  celebrityWritten: number;
  /**
   * From the celebrity post to the moment it is available to every follower, or -1 before then. A
   * follower sees it only when the read tier returns their next feed load.
   */
  celebrityReachSeconds: number;
  loads: number;
  served: number;
  waiting: number;
  /** Served after more than the read target, or still waiting past it. */
  slowLoads: number;
  averageLoadWaitSeconds: number;
  lookups: number;
  missedCelebrity: number;
  /** Feed loads by celebrity followers, after the post, that showed it within the read target. */
  returnedCelebrity: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function summarize(lane: FeedLane, duel: FeedDuel): FeedSummary {
  const s = lane.state;
  const ticks = duel.ticks;
  let published = 0;
  let onTime = 0;
  let late = 0;
  let overdue = 0;
  let reachTicks = 0;
  for (const post of duel.posts) {
    const phase = s.phase[post.id];
    if (phase === 'future') continue;
    published += 1;
    if (phase === 'queued') {
      if (s.overdue[post.id]) overdue += 1;
      continue;
    }
    if (phase === 'onTime') onTime += 1;
    else late += 1;
    reachTicks += (s.doneAt[post.id] ?? post.arrival) - post.arrival;
  }
  const loads = duel.loadStart[ticks] ?? duel.loads.length;
  let served = 0;
  let slow = 0;
  let waitTicks = 0;
  for (let id = 0; id < loads; id += 1) {
    const load = duel.loads[id];
    if (!load) continue;
    const at = s.servedAt[id] ?? -1;
    if (at < 0) {
      if (ticks - load.arrival > READ_TARGET_TICKS) slow += 1;
      continue;
    }
    served += 1;
    waitTicks += at - load.arrival;
    if (at - load.arrival > READ_TARGET_TICKS) slow += 1;
  }
  const reached = onTime + late;
  return {
    published,
    onTime,
    late,
    queued: published - reached,
    missed: late + overdue,
    averageReachSeconds: reached === 0 ? 0 : round1((reachTicks / reached) * TICK_SECONDS),
    feedWrites: s.feedWrites,
    writesWaiting: writesWaiting(lane),
    celebrityWritten: s.celebrityWritten,
    celebrityReachSeconds:
      s.celebrityDoneTick < 0 ? -1 : round1((s.celebrityDoneTick - duel.celebrityTick) * TICK_SECONDS),
    loads,
    served,
    waiting: loads - served,
    slowLoads: slow,
    averageLoadWaitSeconds: served === 0 ? 0 : round1((waitTicks / served) * TICK_SECONDS),
    lookups: s.lookups,
    missedCelebrity: s.missedCelebrity,
    returnedCelebrity: s.returnedCelebrity,
  };
}

export interface FanoutQueueView {
  writes: number;
  celebrityJobs: number;
  posts: number;
  /** The place in line of the next ordinary post, counted from 1, or 0 with none queued. */
  nextPostPlace: number;
  /** The first jobs the fleet will run. */
  head: ('celebrity' | 'post')[];
}

export function queueView(lane: FeedLane, headSize: number): FanoutQueueView {
  const queue = lane.state.queue;
  const celebrityJobs = queue.filter((job) => job.post < 0).length;
  return {
    writes: writesWaiting(lane),
    celebrityJobs,
    posts: queue.length - celebrityJobs,
    nextPostPlace: queue.findIndex((job) => job.post >= 0) + 1,
    head: queue.slice(0, headSize).map((job) => (job.post < 0 ? 'celebrity' : 'post')),
  };
}

/** How long the oldest waiting feed load has waited, at the end of the last tick that ran. */
export function oldestLoadWaitSeconds(lane: FeedLane, duel: FeedDuel): number {
  const head = duel.loads[lane.state.readQueue[0] ?? -1];
  return head ? round1((duel.ticks - head.arrival) * TICK_SECONDS) : 0;
}

/** Lookups per second the lane's feed loads asked for over the last second that ran. */
export function demandPerSecond(lane: FeedLane, duel: FeedDuel): number {
  const to = duel.ticks;
  const from = Math.max(0, to - Math.round(1 / TICK_SECONDS));
  if (to === from) return 0;
  let lookups = 0;
  for (let id = duel.loadStart[from] ?? 0; id < (duel.loadStart[to] ?? 0); id += 1) {
    const load = duel.loads[id];
    if (load) lookups += loadCost(lane.config.mode, load, duel.celebrityFollowers);
  }
  return Math.round(lookups / ((to - from) * TICK_SECONDS));
}

/** The most recent feed load to arrive, or null before the first. */
export function latestLoad(duel: FeedDuel): FeedLoad | null {
  return duel.loads[(duel.loadStart[duel.ticks] ?? 0) - 1] ?? null;
}

export interface FeedEstimate {
  feedLoadsPerSecond: number;
  peakFeedLoadsPerSecond: number;
  /** Fan out on read: one lookup per followed account on every feed load at peak. */
  pullLookupsPerSecond: number;
  postsPerSecond: number;
  /** Fan out on write: one feed write per follower for every post. */
  pushWritesPerSecond: number;
  peakPushWritesPerSecond: number;
  /** The whole fanout fleet, busy with one celebrity post and nothing else. */
  celebrityFanoutSeconds: number;
  feedCacheTerabytes: number;
}

/** Back-of-envelope sizing for the lesson's illustrative social network. */
export function feedEstimates({
  dailyUsers = 200_000_000,
  feedLoadsPerUserPerDay = 10,
  postsPerUserPerDay = 0.5,
  averageFollows = 300,
  peakFactor = 3,
  celebrityFollowers = 100_000_000,
  fanoutWritesPerSecond = 2_000_000,
  feedEntries = 800,
  bytesPerEntry = 16,
} = {}): FeedEstimate {
  const loads = (dailyUsers * feedLoadsPerUserPerDay) / 86_400;
  const posts = (dailyUsers * postsPerUserPerDay) / 86_400;
  return {
    feedLoadsPerSecond: Math.round(loads),
    peakFeedLoadsPerSecond: Math.round(loads * peakFactor),
    pullLookupsPerSecond: Math.round(loads * peakFactor * averageFollows),
    postsPerSecond: Math.round(posts),
    pushWritesPerSecond: Math.round(posts * averageFollows),
    peakPushWritesPerSecond: Math.round(posts * averageFollows * peakFactor),
    celebrityFanoutSeconds: Math.round(celebrityFollowers / fanoutWritesPerSecond),
    feedCacheTerabytes: round1((dailyUsers * feedEntries * bytesPerEntry) / 1e12),
  };
}
