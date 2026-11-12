import { describe, expect, it } from 'vitest';
import {
  CELEBRITY_BATCH,
  demandPerSecond,
  duelScenarioIds,
  FeedDuel,
  type FeedScenarioId,
  FRESH_SECONDS,
  feedEstimates,
  feedScenarios,
  latestLoad,
  loadCost,
  MAX_FOLLOWERS,
  MAX_FOLLOWS,
  MIN_FOLLOWERS,
  MIN_FOLLOWS,
  makeFeedWorkload,
  oldestLoadWaitSeconds,
  POSTS,
  pullsAuthor,
  queueView,
  summarize,
  TICK_SECONDS,
  tileView,
  USERS,
} from '../../src/lib/models/newsFeed';

function run(duel: FeedDuel): FeedDuel {
  while (!duel.done) duel.step();
  return duel;
}

function finished(id: FeedScenarioId, seed = 42) {
  const duel = run(new FeedDuel(feedScenarios[id], seed));
  return { duel, a: summarize(duel.lanes[0], duel), b: summarize(duel.lanes[1], duel) };
}

function eventLines(duel: FeedDuel): string[] {
  return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
}

const allIds = Object.keys(feedScenarios) as FeedScenarioId[];
const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
const freshTicks = Math.round(FRESH_SECONDS / TICK_SECONDS);

describe('news feed workload', () => {
  it('numbers every post in posting order with a 2 s freshness target', () => {
    const { posts, draws } = makeFeedWorkload(42);
    expect(posts).toHaveLength(POSTS);
    expect(posts.map((post) => post.id)).toEqual(Array.from({ length: POSTS }, (_, id) => id));
    for (let id = 1; id < POSTS; id += 1) {
      expect(posts[id]?.arrival).toBeGreaterThanOrEqual(posts[id - 1]?.arrival ?? 0);
    }
    for (const post of posts) {
      expect(post.deadline - post.arrival).toBe(freshTicks);
      expect(post.followers).toBeGreaterThanOrEqual(MIN_FOLLOWERS);
      expect(post.followers).toBeLessThanOrEqual(MAX_FOLLOWERS);
    }
    for (const draw of draws) {
      expect(draw.reader).toBeGreaterThanOrEqual(0);
      expect(draw.reader).toBeLessThan(USERS);
      expect(draw.follows).toBeGreaterThanOrEqual(MIN_FOLLOWS);
      expect(draw.follows).toBeLessThanOrEqual(MAX_FOLLOWS);
    }
  });

  it('shares the posts and readers across every scenario', () => {
    const first = new FeedDuel(feedScenarios.celebrity, 9);
    for (const id of allIds) {
      const duel = new FeedDuel(feedScenarios[id], 9);
      expect(duel.posts).toEqual(first.posts);
      const shared = Math.min(duel.loads.length, first.loads.length);
      expect(duel.loads.slice(0, shared).map(({ reader, follows }) => ({ reader, follows }))).toEqual(
        first.loads.slice(0, shared).map(({ reader, follows }) => ({ reader, follows })),
      );
    }
  });

  it('lists each duel scenario once', () => {
    expect([...duelScenarioIds.celebrity, ...duelScenarioIds.reads].sort()).toEqual([...allIds].sort());
    for (const id of allIds) expect(duelScenarioIds[feedScenarios[id].duel]).toContain(id);
  });

  it('pulls only celebrities in the hybrid and charges lookups by fan-out rule', () => {
    expect(pullsAuthor('push', 5_000)).toBe(false);
    expect(pullsAuthor('pull', 20)).toBe(true);
    expect(pullsAuthor('hybrid', 80)).toBe(false);
    expect(pullsAuthor('hybrid', 5_000)).toBe(true);
    const fan = { reader: 10, follows: 45 };
    const stranger = { reader: 9_000, follows: 45 };
    expect(loadCost('pull', fan, 5_000)).toBe(45);
    expect(loadCost('push', fan, 5_000)).toBe(1);
    expect(loadCost('hybrid', fan, 5_000)).toBe(2);
    expect(loadCost('hybrid', stranger, 5_000)).toBe(1);
    expect(loadCost('hybrid', fan, 0)).toBe(1);
  });

  it('adds the evening peak as extra feed loads per tick', () => {
    const peak = new FeedDuel(feedScenarios['evening-peak'], 42);
    expect(peak.loadsAt(79)).toBe(4);
    expect(peak.loadsAt(80)).toBe(12);
    expect(peak.loadsAt(159)).toBe(12);
    expect(peak.loadsAt(160)).toBe(4);
    expect(peak.loads).toHaveLength(1_840);
    expect(peak.loadStart).toHaveLength(peak.length + 1);
    expect(new FeedDuel(feedScenarios['no-peak'], 42).loads).toHaveLength(1_200);
  });
});

describe('news feed duel', () => {
  it('replays the same seed exactly', () => {
    for (const id of allIds) {
      const first = finished(id, 7);
      const second = finished(id, 7);
      expect(second.duel.checkpoint()).toEqual(first.duel.checkpoint());
      expect(second.a).toEqual(first.a);
      expect(second.b).toEqual(first.b);
    }
  });

  it('accounts for every post, feed write, and feed load on every tick', () => {
    for (const id of allIds) {
      const duel = new FeedDuel(feedScenarios[id], 42);
      while (!duel.done) {
        duel.step();
        const posted = duel.posts.filter((post) => post.arrival < duel.ticks);
        const celebrityUp = duel.celebrityTick >= 0 && duel.ticks > duel.celebrityTick;
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel);
          const { mode } = lane.config;
          expect(sum.published).toBe(posted.length);
          expect(sum.onTime + sum.late + sum.queued).toBe(sum.published);
          expect(sum.loads).toBe(duel.loadStart[duel.ticks]);
          expect(sum.served + sum.waiting).toBe(sum.loads);
          const owed =
            posted
              .filter((post) => !pullsAuthor(mode, post.followers))
              .reduce((n, post) => n + post.followers, 0) +
            (celebrityUp && !pullsAuthor(mode, duel.celebrityFollowers) ? duel.celebrityFollowers : 0);
          expect(sum.feedWrites + sum.writesWaiting).toBe(owed);
          expect(sum.celebrityWritten).toBeLessThanOrEqual(duel.celebrityFollowers);
          const series = lane.state.series.at(-1);
          expect(series).toBe(feedScenarios[id].duel === 'celebrity' ? sum.writesWaiting : sum.waiting);
        }
      }
    }
  });

  it('delivers every post and serves every feed load by the end of the run', () => {
    for (const id of allIds) {
      const { a, b } = finished(id);
      for (const sum of [a, b]) {
        expect(sum.published).toBe(POSTS);
        expect(sum.queued).toBe(0);
        expect(sum.writesWaiting).toBe(0);
        if (id !== 'small-read-tier') expect(sum.waiting).toBe(0);
      }
    }
  });

  it('never spends more lookups in a tick than the read tier serves', () => {
    for (const id of allIds) {
      const duel = new FeedDuel(feedScenarios[id], 42);
      const work = (lane: (typeof duel.lanes)[number]) => lane.state.lookups + lane.state.headLookups;
      let before = duel.lanes.map(work);
      while (!duel.done) {
        duel.step();
        const after = duel.lanes.map(work);
        for (const index of [0, 1]) {
          expect((after[index] ?? 0) - (before[index] ?? 0)).toBeLessThanOrEqual(
            feedScenarios[id].readsPerTick,
          );
        }
        before = after;
      }
    }
  });

  it('slows hybrid feed loads when the read tier only fits fan out on write', () => {
    for (const seed of seeds) {
      const { a, b } = finished('small-read-tier', seed);
      expect(b.missed).toBe(0);
      expect(b.celebrityReachSeconds).toBe(0);
      expect(a.slowLoads).toBe(0);
      expect(b.slowLoads).toBeGreaterThan(0);
      expect(b.waiting).toBeGreaterThan(0);
      expect(b.returnedCelebrity).toBeLessThan(a.returnedCelebrity);
    }
  });

  it('counts each celebrity follower load after the post at most once as shown or missed', () => {
    for (const seed of seeds) {
      for (const id of duelScenarioIds.celebrity) {
        const { a, b } = finished(id, seed);
        for (const sum of [a, b]) {
          expect(sum.returnedCelebrity + sum.missedCelebrity).toBeLessThanOrEqual(sum.served);
        }
      }
    }
  });

  it('keeps every post fresh with hybrid fan-out while fan out on write falls behind the celebrity', () => {
    for (const seed of seeds) {
      for (const id of ['celebrity', 'more-followers', 'double-fleet'] as const) {
        const { a, b } = finished(id, seed);
        expect(b.missed).toBe(0);
        expect(b.missedCelebrity).toBe(0);
        expect(b.celebrityReachSeconds).toBe(0);
        expect(a.missed).toBeGreaterThan(0);
        expect(a.missedCelebrity).toBeGreaterThan(0);
        expect(a.celebrityReachSeconds).toBeGreaterThan(FRESH_SECONDS);
        expect(a.feedWrites - b.feedWrites).toBe(feedScenarios[id].celebrity?.followers);
        expect(b.lookups).toBeGreaterThan(a.lookups);
        expect([a.slowLoads, b.slowLoads]).toEqual([0, 0]);
      }
    }
  });

  it('serves every feed load on time with fan out on write while fan out on read falls behind at the peak', () => {
    for (const seed of seeds) {
      const { a, b } = finished('evening-peak', seed);
      expect(a.slowLoads).toBeGreaterThan(0);
      expect(b.slowLoads).toBe(0);
      expect(a.lookups).toBeGreaterThan(20 * b.lookups);
      expect(a.feedWrites).toBe(0);
      expect(b.feedWrites).toBeGreaterThan(0);
      for (const id of ['double-reads', 'no-peak'] as const) {
        const calm = finished(id, seed);
        expect([calm.a.slowLoads, calm.b.slowLoads]).toEqual([0, 0]);
      }
    }
  });

  it('runs the two lanes identically without a celebrity', () => {
    for (const seed of seeds) {
      const { duel, a, b } = finished('no-celebrity', seed);
      expect(b).toEqual(a);
      expect(duel.lanes[1].state.series).toEqual(duel.lanes[0].state.series);
      expect(duel.events.every((event) => !event.marker)).toBe(true);
    }
  });

  it('pins the numbers the lesson quotes', () => {
    const celebrity = finished('celebrity');
    expect([celebrity.a.missed, celebrity.b.missed]).toEqual([29, 0]);
    expect([celebrity.a.celebrityReachSeconds, celebrity.b.celebrityReachSeconds]).toEqual([10, 0]);
    expect([celebrity.a.missedCelebrity, celebrity.b.missedCelebrity]).toEqual([45, 0]);
    expect([celebrity.a.feedWrites, celebrity.b.feedWrites]).toEqual([7_974, 2_974]);
    expect([celebrity.a.lookups, celebrity.b.lookups]).toEqual([1_200, 1_520]);
    expect([celebrity.a.returnedCelebrity, celebrity.b.returnedCelebrity]).toEqual([247, 292]);

    const small = finished('small-read-tier');
    expect([small.a.slowLoads, small.b.slowLoads]).toEqual([0, 996]);
    expect([small.b.averageLoadWaitSeconds, small.b.waiting]).toEqual([3, 248]);
    expect([small.a.returnedCelebrity, small.b.returnedCelebrity]).toEqual([247, 17]);

    const more = finished('more-followers');
    expect([more.a.missed, more.a.celebrityReachSeconds, more.a.missedCelebrity]).toEqual([53, 20, 193]);
    expect(more.b.lookups).toBe(1_814);

    const fleet = finished('double-fleet');
    expect([fleet.a.missed, fleet.a.celebrityReachSeconds, fleet.b.missed]).toEqual([11, 5, 0]);

    const peak = finished('evening-peak');
    expect([peak.a.slowLoads, peak.b.slowLoads]).toEqual([959, 0]);
    expect([peak.a.loads, peak.a.averageLoadWaitSeconds]).toEqual([1_840, 1.4]);
    expect([peak.a.lookups, peak.b.lookups]).toEqual([92_630, 1_840]);
    expect([peak.a.feedWrites, peak.b.feedWrites]).toEqual([0, 2_974]);
    expect(Math.max(...peak.duel.lanes[0].state.series)).toBe(320);

    expect(finished('double-reads').a.slowLoads).toBe(0);

    const quiet = finished('no-celebrity');
    expect([quiet.a.missed, quiet.b.missed, quiet.a.feedWrites - quiet.b.feedWrites]).toEqual([0, 0, 0]);
    const noPeak = finished('no-peak');
    expect([noPeak.a.slowLoads, noPeak.b.slowLoads]).toEqual([0, 0]);
  });

  it('pins the illustrative estimates', () => {
    expect(feedEstimates()).toEqual({
      feedLoadsPerSecond: 23_148,
      peakFeedLoadsPerSecond: 69_444,
      pullLookupsPerSecond: 20_833_333,
      postsPerSecond: 1_157,
      pushWritesPerSecond: 347_222,
      peakPushWritesPerSecond: 1_041_667,
      celebrityFanoutSeconds: 50,
      feedCacheTerabytes: 2.6,
    });
  });

  it('writes the transcript the lesson describes', () => {
    expect(eventLines(finished('celebrity').duel)).toEqual([
      '3.0 A celebrity with 5,000 followers posts.',
      '3.1 Fan out on write: the celebrity post becomes 5,000 feed writes in 10 jobs, ahead of every later post.',
      "3.1 Hybrid fan-out: the celebrity has more than 1,000 followers, so the lane stores the post once and writes no feeds. Each follower's feed load merges it in at read time.",
      '5.9 Fan out on write: post 8 has waited 2 s in the fanout queue, and its 59 followers still cannot see it.',
      '13.0 Fan out on write: the last of 5,000 followers gets the celebrity post in their feed, 10.0 s after it went up.',
      '30.0 Run ends. Posts that missed the 2 s target: fan out on write 29, hybrid fan-out 0. Feed loads that missed the celebrity post: fan out on write 45, hybrid fan-out 0. Lookups to serve feed loads: fan out on write 1,200, hybrid fan-out 1,520.',
    ]);
    expect(eventLines(finished('evening-peak').duel)).toEqual([
      '8.0 The evening peak starts: feed loads jump from 40 to 120 per second.',
      '11.0 Fan out on read: feed load 558 has waited more than 1 s for the read tier. It needs 59 lookups.',
      '16.0 The evening peak ends: feed loads fall back to 40 per second.',
      '24.2 Fan out on read: the read tier catches up and the backlog of feed loads clears.',
      '30.0 Run ends. Feed loads that waited more than 1 s: fan out on read 959, fan out on write 0. Lookups to serve feed loads: fan out on read 92,630, fan out on write 1,840.',
    ]);
  });

  it('shows the fanout queue in the order the fleet drains it', () => {
    const duel = new FeedDuel(feedScenarios.celebrity, 42);
    while (duel.ticks < 50) duel.step();
    const [push, hybrid] = duel.lanes;
    const pushView = queueView(push, 8);
    expect(pushView.celebrityJobs).toBeGreaterThan(0);
    expect(pushView.celebrityJobs * CELEBRITY_BATCH).toBeGreaterThanOrEqual(
      5_000 - push.state.celebrityWritten,
    );
    expect(pushView.head[0]).toBe('celebrity');
    expect(pushView.posts === 0 || pushView.nextPostPlace > pushView.celebrityJobs).toBe(true);
    expect(pushView.head).toHaveLength(Math.min(8, pushView.celebrityJobs + pushView.posts));
    const hybridView = queueView(hybrid, 8);
    expect(hybridView.celebrityJobs).toBe(0);
    expect(hybridView.writes).toBeLessThan(pushView.writes);
  });

  it('reports the read tier the way the meters show it', () => {
    const duel = new FeedDuel(feedScenarios['evening-peak'], 42);
    expect(latestLoad(duel)).toBeNull();
    while (duel.ticks < 140) duel.step();
    const [pull, push] = duel.lanes;
    expect(demandPerSecond(pull, duel)).toBeGreaterThan(4_000);
    expect(demandPerSecond(push, duel)).toBe(120);
    expect(oldestLoadWaitSeconds(pull, duel)).toBeGreaterThan(1);
    expect(oldestLoadWaitSeconds(push, duel)).toBe(0);
    expect(latestLoad(duel)?.id).toBe((duel.loadStart[140] ?? 0) - 1);
  });

  it('maps every post to the tile its phase implies', () => {
    for (const id of ['celebrity', 'evening-peak'] as const) {
      const duel = new FeedDuel(feedScenarios[id], 42);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          for (const post of duel.posts) {
            const view = tileView(lane, post.id);
            const phase = lane.state.phase[post.id];
            if (view === 'overdue' || view === 'waiting') {
              expect(phase).toBe('queued');
              expect(lane.state.overdue[post.id]).toBe(view === 'overdue');
            } else expect(view).toBe(phase);
          }
        }
      }
    }
  });

  it('stops at the run length', () => {
    const { duel } = finished('celebrity');
    const before = duel.checkpoint();
    duel.step();
    expect(duel.checkpoint()).toEqual(before);
    for (const lane of duel.lanes) expect(lane.state.series).toHaveLength(duel.length);
  });

  it('resets and resumes to the same run', () => {
    for (const id of allIds) {
      const reference = finished(id).duel.checkpoint();
      const duel = new FeedDuel(feedScenarios[id], 42);
      const start = duel.checkpoint();
      while (duel.ticks < 120) duel.step();
      const middle = duel.checkpoint();
      duel.restore(start);
      expect(duel.ticks).toBe(0);
      expect(duel.lanes[0].state.phase.every((phase) => phase === 'future')).toBe(true);
      expect(run(duel).checkpoint()).toEqual(reference);

      const resumed = new FeedDuel(feedScenarios[id], 42);
      resumed.restore(middle);
      expect(run(resumed).checkpoint()).toEqual(reference);
    }
  });

  it('keeps checkpoints independent of later steps', () => {
    const duel = new FeedDuel(feedScenarios['evening-peak'], 42);
    while (duel.ticks < 120) duel.step();
    const saved = duel.checkpoint();
    const copy = structuredClone(saved);
    run(duel);
    expect(saved).toEqual(copy);
  });
});
