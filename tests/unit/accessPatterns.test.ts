import { describe, expect, it } from 'vitest';
import {
  HOT_THRESHOLD,
  HotKeyRun,
  homeNode,
  hotKeyScenarios,
  LINK_COUNT,
  linkCode,
  NODE_CAPACITY,
  nodeRate,
  QUEUE_LIMIT,
  summarizeLane,
  TICK_SECONDS,
  TOP_LINK,
} from '../../src/lib/models/accessPatterns';

function finish(run: HotKeyRun): HotKeyRun {
  while (!run.done) run.step();
  return run;
}

function snapshot(run: HotKeyRun) {
  return {
    series: run.lanes.map((lane) => lane.series),
    summaries: run.lanes.map(summarizeLane),
    events: run.events,
    pattern: run.pattern(),
  };
}

describe('link routing', () => {
  it('gives every link a stable six character code and a fixed home node', () => {
    expect(linkCode(0)).toBe(TOP_LINK);
    const codes = Array.from({ length: LINK_COUNT }, (_, index) => linkCode(index));
    expect(new Set(codes).size).toBe(LINK_COUNT);
    for (const code of codes) expect(code).toMatch(/^[0-9a-zA-Z]{6}$/);
    expect(homeNode(0, 4)).toBe(homeNode(0, 4));
    expect(codes.map((_, index) => homeNode(index, 4))).toEqual(codes.map((_, index) => homeNode(index, 4)));
  });
});

describe('HotKeyRun', () => {
  it('replays the same seed exactly', () => {
    for (const scenario of Object.values(hotKeyScenarios)) {
      expect(snapshot(finish(new HotKeyRun(scenario, 42)))).toEqual(
        snapshot(finish(new HotKeyRun(scenario, 42))),
      );
    }
  });

  it('starts a fresh run identical to one that never ran, after another run played', () => {
    const scenario = hotKeyScenarios.viral;
    const fresh = snapshot(finish(new HotKeyRun(scenario)));
    const interrupted = new HotKeyRun(scenario);
    for (let i = 0; i < 57; i += 1) interrupted.step();
    expect(snapshot(finish(new HotKeyRun(scenario)))).toEqual(fresh);
  });

  it('feeds both lanes the same clicks', () => {
    for (const scenario of Object.values(hotKeyScenarios)) {
      const run = finish(new HotKeyRun(scenario));
      const [hash, copies] = run.lanes.map(summarizeLane);
      expect(hash?.arrived).toBe(copies?.arrived);
      expect(hash?.arrived).toBe(run.clicks.reduce((sum, tick) => sum + tick.length, 0));
    }
  });

  it('accounts for every click on every node at every tick', () => {
    for (const scenario of Object.values(hotKeyScenarios)) {
      const run = new HotKeyRun(scenario);
      while (!run.done) {
        run.step();
        for (const lane of run.lanes) {
          for (const node of lane.nodes) {
            expect(node.arrived).toBe(node.served + node.rejected + node.queue.length);
          }
        }
      }
    }
  });

  it('stops at the end of the run', () => {
    const run = finish(new HotKeyRun(hotKeyScenarios.busy));
    const before = snapshot(run);
    run.step();
    expect(snapshot(run)).toEqual(before);
    expect(run.ticks).toBe(run.length);
  });
});

describe('pinned illustrative numbers (seed 42, quoted in the lesson)', () => {
  it('keeps the toy constants and scenario setup the story quotes', () => {
    expect(NODE_CAPACITY).toBe(150);
    expect(QUEUE_LIMIT).toBe(30);
    expect(HOT_THRESHOLD).toBe(50);
    for (const scenario of Object.values(hotKeyScenarios)) {
      expect(scenario.changeAt * TICK_SECONDS).toBeCloseTo(3);
      expect(scenario.before).toEqual({ rate: 40, topShare: 0.05 });
      expect(scenario.after.rate).toBe(400);
    }
    expect(hotKeyScenarios.busy.after.topShare).toBe(0.05);
    expect(hotKeyScenarios.viral.after.topShare).toBe(0.6);
    expect(hotKeyScenarios.viral.nodes).toBe(4);
    expect(hotKeyScenarios['viral-8'].nodes).toBe(8);
    const { rate, topShare } = hotKeyScenarios.viral.after;
    const hotRate = rate * topShare;
    const coldPerNode = (rate - hotRate) / 4;
    expect(NODE_CAPACITY * 4).toBe(600);
    expect(hotRate).toBe(240);
    expect(hotRate).toBeGreaterThan(NODE_CAPACITY);
    expect(coldPerNode).toBe(40);
    expect(hotRate + coldPerNode).toBe(280);
    expect(hotRate / 4).toBe(60);
  });

  it('busy evening: even traffic fits, so both lanes tie', () => {
    const run = finish(new HotKeyRun(hotKeyScenarios.busy));
    const [hash, copies] = run.lanes.map(summarizeLane);
    expect(hash).toEqual(copies);
    expect(hash).toMatchObject({ arrived: 6831, rejected: 0, peakLoad: 86, extraCopies: 0 });
    for (const node of run.lanes[0].nodes) {
      expect(Math.round(nodeRate(node))).toBeGreaterThanOrEqual(90);
      expect(Math.round(nodeRate(node))).toBeLessThanOrEqual(115);
    }
  });

  it('viral link: the story numbers for share, idle nodes, tier use and detection', () => {
    const run = new HotKeyRun(hotKeyScenarios.viral);
    for (let tick = 0; tick < 30; tick += 1) run.step();
    const before = run.pattern().topShare;
    expect(before).toBeGreaterThan(0.04);
    expect(before).toBeLessThan(0.07);
    finish(run);
    const [hashLane, copiesLane] = run.lanes;
    expect(run.topHome + 1).toBe(2);
    let tierRate = 0;
    for (const node of hashLane.nodes) {
      tierRate += nodeRate(node);
      if (node.id === run.topHome) continue;
      expect(Math.round(nodeRate(node))).toBeGreaterThanOrEqual(40);
      expect(Math.round(nodeRate(node))).toBeLessThanOrEqual(44);
    }
    expect(tierRate / (NODE_CAPACITY * 4)).toBeLessThan(0.7);
    for (const node of copiesLane.nodes) {
      expect(Math.round(nodeRate(node))).toBeGreaterThanOrEqual(100);
      expect(Math.round(nodeRate(node))).toBeLessThanOrEqual(110);
    }
    expect(hashLane.firstRejectTick).toBe(33);
    expect(copiesLane.firstRejectTick).toBe(33);
  });

  it('viral link: the hash only node overflows while copies spread the load', () => {
    const run = finish(new HotKeyRun(hotKeyScenarios.viral));
    const [hashLane, copiesLane] = run.lanes;
    if (!hashLane || !copiesLane) throw new Error('missing lanes');
    const hot = hashLane.nodes[run.topHome];
    if (!hot) throw new Error('missing hot node');
    expect(Math.round(nodeRate(hot))).toBe(294);
    expect(nodeRate(hot)).toBeGreaterThan(NODE_CAPACITY * 1.9);
    for (const node of hashLane.nodes) {
      if (node.id !== run.topHome) expect(nodeRate(node)).toBeLessThan(50);
    }
    for (const node of copiesLane.nodes) expect(nodeRate(node)).toBeLessThan(NODE_CAPACITY * 0.75);
    expect(summarizeLane(hashLane)).toMatchObject({
      arrived: 6952,
      served: 4888,
      rejected: 2049,
      inFlight: 15,
    });
    expect(summarizeLane(hashLane).peakLoad).toBe(203);
    expect(summarizeLane(copiesLane)).toMatchObject({ rejected: 6, peakLoad: 89, extraCopies: 3 });
    const pattern = run.pattern();
    expect(pattern.topShare).toBeGreaterThan(0.55);
    expect(pattern.top[0]?.code).toBe(TOP_LINK);
  });

  it('viral link on 8 nodes: more nodes leave the hot node just as full', () => {
    const run = finish(new HotKeyRun(hotKeyScenarios['viral-8']));
    const [hashLane, copiesLane] = run.lanes;
    if (!hashLane || !copiesLane) throw new Error('missing lanes');
    const hot = hashLane.nodes[run.topHome];
    if (!hot) throw new Error('missing hot node');
    expect(nodeRate(hot)).toBeGreaterThan(NODE_CAPACITY * 1.7);
    expect(Math.round(nodeRate(hot))).toBe(270);
    for (const node of hashLane.nodes) {
      if (node.id === run.topHome) continue;
      expect(Math.round(nodeRate(node))).toBeGreaterThanOrEqual(16);
      expect(Math.round(nodeRate(node))).toBeLessThanOrEqual(28);
    }
    expect(summarizeLane(hashLane)).toMatchObject({ rejected: 1724, peakLoad: 190 });
    expect(summarizeLane(copiesLane)).toMatchObject({ rejected: 2, peakLoad: 62, extraCopies: 7 });
  });

  it('keeps writes near 1% of traffic', () => {
    const run = finish(new HotKeyRun(hotKeyScenarios.busy));
    const pattern = run.pattern();
    const share = pattern.writesPerSecond / (pattern.readsPerSecond + pattern.writesPerSecond);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.03);
  });
});
