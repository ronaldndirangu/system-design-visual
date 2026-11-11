import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  type CdnCommand,
  CdnDuel,
  CdnModel,
  type CdnTick,
  CITIES,
  cdnScenarioIds,
  cdnScenarios,
  clickLatencyMs,
  rttMs,
  summarizeCdnLane,
} from '../../src/lib/models/cdn';

const sydney = 15700;
const newYork = 350;

function play(model: CdnModel, ticks: number, schedule: ScheduledCommand<CdnCommand>[] = []): CdnTick[] {
  const out: CdnTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(model, schedule));
  return out;
}

function finish(duel: CdnDuel): CdnDuel {
  while (!duel.done) duel.step();
  return duel;
}

describe('CDN latency model', () => {
  it('turns distance into round trip time at 200 km per ms', () => {
    expect(rttMs(200)).toBe(2);
    expect(rttMs(sydney)).toBe(157);
  });

  it('pins the click latencies the lesson quotes', () => {
    expect(clickLatencyMs('direct', sydney)).toBe(473);
    expect(clickLatencyMs('direct', newYork)).toBe(12.5);
    expect(clickLatencyMs('edge-hit', sydney)).toBe(3.5);
    expect(clickLatencyMs('edge-miss', sydney)).toBe(160.5);
    expect(clickLatencyMs('shield-hit', sydney, true)).toBe(160.5);
    expect(clickLatencyMs('edge-miss', sydney, true)).toBe(161);
    expect(clickLatencyMs('edge-miss', newYork)).toBe(7);
  });

  it('makes every path through an edge faster than going direct', () => {
    for (const city of CITIES) {
      const direct = clickLatencyMs('direct', city.km);
      expect(clickLatencyMs('edge-hit', city.km)).toBeLessThan(direct);
      expect(clickLatencyMs('edge-miss', city.km, true)).toBeLessThan(direct);
    }
  });
});

describe('CdnModel playback', () => {
  it('sends both lanes the same clicks from the same cities', () => {
    const origin = new CdnModel({ cdn: false, seed: 9 });
    const cdn = new CdnModel({ cdn: true, seed: 9 });
    const a = play(origin, 120);
    const b = play(cdn, 120);
    expect(b.map((tick) => tick.samples.map((s) => s.city))).toEqual(
      a.map((tick) => tick.samples.map((s) => s.city)),
    );
    expect(cdn.cityStats.map((c) => c.clicks)).toEqual(origin.cityStats.map((c) => c.clicks));
  });

  it('sends every click straight to the origin without a CDN', () => {
    const origin = new CdnModel({ cdn: false });
    play(origin, 50);
    expect(origin.totals.originServed).toBe(origin.totals.arrived);
    expect(origin.totals.edgeHits).toBe(0);
  });

  it('applies a scheduled purge before its tick', () => {
    const cdn = new CdnModel({ links: 1, clicksPerTick: 5 });
    play(cdn, 10);
    const before = cdn.totals.originServed;
    stepScheduled(cdn, [{ at: 10, command: { type: 'purge' } }]);
    expect(cdn.totals.originServed).toBeGreaterThan(before);
  });

  it('refetches a link once its TTL runs out', () => {
    const cdn = new CdnModel({ links: 1, clicksPerTick: 50, ttlSeconds: 1, tickSeconds: 0.1 });
    const ticks = play(cdn, 30);
    const misses = ticks.map((tick) => tick.originServed);
    expect(misses[0]).toBeGreaterThan(0);
    expect(misses.slice(1, 10).every((count) => count === 0)).toBe(true);
    expect(misses[10]).toBeGreaterThan(0);
  });

  it('never reuses a copy when the TTL is zero', () => {
    const cdn = new CdnModel({ links: 1, clicksPerTick: 50, ttlSeconds: 0, shield: true });
    play(cdn, 5);
    expect(cdn.totals.edgeHits + cdn.totals.shieldHits).toBe(0);
    expect(cdn.totals.originServed).toBe(cdn.totals.arrived);
  });

  it('replays a scripted run exactly', () => {
    const schedule: ScheduledCommand<CdnCommand>[] = [{ at: 40, command: { type: 'purge' } }];
    const a = play(new CdnModel({ shield: true, edgeLogs: true, seed: 3 }), 120, schedule);
    const b = play(new CdnModel({ shield: true, edgeLogs: true, seed: 3 }), 120, schedule);
    expect(b).toEqual(a);
  });

  it('restores a checkpoint midway and into a fresh model', () => {
    const config = { shield: true, edgeLogs: true, ttlSeconds: 2, seed: 5 };
    const original = new CdnModel(config);
    play(original, 60);
    const saved = original.checkpoint();
    const expected = play(original, 60);

    const rewound = new CdnModel(config);
    play(rewound, 25);
    rewound.restore(saved);
    expect(play(rewound, 60)).toEqual(expected);

    const fresh = new CdnModel();
    fresh.restore(saved);
    expect(fresh.ticks).toBe(60);
    expect(play(fresh, 60)).toEqual(expected);
  });

  it('keeps checkpoints independent of later steps', () => {
    const model = new CdnModel({ seed: 8 });
    play(model, 30);
    const saved = model.checkpoint();
    const snapshot = structuredClone(saved);
    play(model, 30);
    expect(saved).toEqual(snapshot);
  });

  it('accounts for every click at every tick', () => {
    for (const config of [
      { cdn: false },
      { cdn: true },
      { cdn: true, shield: true },
      { cdn: true, edgeLogs: true },
      { cdn: true, shield: true, edgeLogs: true, ttlSeconds: 1 },
    ]) {
      const model = new CdnModel({ ...config, seed: 11 });
      for (let i = 0; i < 200; i += 1) {
        stepScheduled(model, [{ at: 90, command: { type: 'purge' } }]);
        const t = model.totals;
        expect(t.edgeHits + t.shieldHits + t.originServed).toBe(t.arrived);
        expect(t.counted + t.pending + t.uncounted).toBe(t.arrived);
      }
    }
  });
});

describe('CdnDuel', () => {
  it('cuts average latency in every scenario across seeds', () => {
    for (const id of cdnScenarioIds) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const [a, b] = finish(new CdnDuel(cdnScenarios[id], seed)).lanes.map((lane) =>
          summarizeCdnLane(lane.model),
        );
        expect(b?.meanMs).toBeLessThan(a?.meanMs ?? 0);
      }
    }
  });

  it('ties origin load when every link is brand new', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [a, b] = finish(new CdnDuel(cdnScenarios['new-links'], seed)).lanes.map((lane) =>
        summarizeCdnLane(lane.model),
      );
      expect(b?.originRequests).toBe(a?.originRequests);
      expect(b?.edgeHitRatio).toBe(0);
    }
  });

  it('loses edge clicks from the counter unless edges ship logs', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [, quiet] = finish(new CdnDuel(cdnScenarios.worldwide, seed)).lanes.map((lane) =>
        summarizeCdnLane(lane.model),
      );
      expect(quiet?.countedPercent).toBeLessThan(100);
      const [a, b] = finish(new CdnDuel(cdnScenarios['edge-logs'], seed)).lanes.map((lane) =>
        summarizeCdnLane(lane.model),
      );
      expect(a?.countedPercent).toBe(100);
      expect(b?.countedPercent).toBe(100);
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const summary = (id: keyof typeof cdnScenarios) =>
      finish(new CdnDuel(cdnScenarios[id])).lanes.map((lane) => summarizeCdnLane(lane.model));
    const [origin, cdn] = summary('worldwide');
    expect(origin?.clicks).toBe(4000);
    expect(origin?.meanMs.toFixed(0)).toBe('202');
    expect(cdn?.meanMs.toFixed(0)).toBe('28');
    expect(cdn?.p95Ms).toBe(160.5);
    expect(origin?.p95Ms).toBe(473);
    expect(cdn?.edgeHitRatio.toFixed(2)).toBe('0.65');
    expect(cdn?.originRequests).toBe(1402);
    expect(cdn?.countedPercent.toFixed(0)).toBe('35');
    expect(summary('short-ttl')[1]?.edgeHitRatio.toFixed(2)).toBe('0.31');
    expect(summary('short-ttl')[1]?.originRequests).toBe(2761);
    expect(summary('purge')[1]?.originRequests).toBe(1774);
    expect(summary('shield')[1]?.originRequests).toBe(683);
    expect(summary('shield')[1]?.edgeHitRatio.toFixed(2)).toBe('0.65');
    expect(summary('new-links')[1]?.originRequests).toBe(4000);
  });

  it('logs the run in order with readable text', () => {
    const duel = finish(new CdnDuel(cdnScenarios.purge));
    expect(duel.events.map((event) => [event.tick, event.text])).toEqual([
      [32, "With CDN: edges answer over half of the last second's clicks"],
      [100, 'Purge deletes every cached copy'],
      [129, "With CDN: edges answer over half of the last second's clicks"],
      [200, 'Run ends. 4,000 requests reached the origin alone and 1,774 reached it through the CDN.'],
    ]);
    expect(duel.events.at(-1)?.marker).toBe(false);

    const logs = finish(new CdnDuel(cdnScenarios['edge-logs']));
    const ships = logs.events.filter((event) => event.text.includes('ship'));
    expect(ships.map((event) => event.tick)).toEqual([50, 100, 150, 200]);
  });

  it('stops after 20 seconds and ignores further steps', () => {
    const duel = finish(new CdnDuel(cdnScenarios.shield));
    expect(duel.ticks).toBe(200);
    const before = structuredClone(duel.lanes.map((lane) => lane.model.checkpoint()));
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes.map((lane) => lane.model.checkpoint())).toEqual(before);
    for (const lane of duel.lanes) expect(lane.series).toHaveLength(200);
  });

  it('charts the counted share returning to 100% at each log shipment', () => {
    const duel = finish(new CdnDuel(cdnScenarios['edge-logs']));
    const series = duel.lanes[1].series;
    expect(series[48]).toBeLessThan(100);
    expect(series[49]).toBe(100);
    expect(series[199]).toBe(100);
    expect(duel.lanes[0].series.every((value) => value === 100)).toBe(true);
  });
});
