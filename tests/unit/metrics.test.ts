import { describe, expect, it } from 'vitest';
import {
  ALERT_ERROR_RATES,
  bytesPerDay,
  CardinalityDuel,
  type CardinalityScenarioId,
  cardinalityScenarios,
  DASHBOARD_RANGES,
  evaluateAlert,
  FLEET,
  headMemoryBytes,
  LABEL_EXAMPLE,
  pointsScanned,
  RETENTION_TIERS,
  rawOnlyBytesPerSeries,
  SERIES_LIMIT,
  samplesPerSecond,
  seriesCount,
  summarize,
  tieredBytesPerSeries,
  tierFor,
} from '../../src/lib/models/metrics';

const ids = Object.keys(cardinalityScenarios) as CardinalityScenarioId[];

function run(duel: CardinalityDuel): CardinalityDuel {
  while (!duel.done) duel.step();
  return duel;
}

function play(id: CardinalityScenarioId, seed = 42) {
  const duel = run(new CardinalityDuel(cardinalityScenarios[id], seed));
  const raw = summarize(duel.lanes[0], duel.requests);
  const allow = summarize(duel.lanes[1], duel.requests);
  const limitTick = duel.lanes[0].series.indexOf(SERIES_LIMIT);
  return {
    duel,
    raw,
    allow,
    limitSeconds: limitTick === -1 ? null : (limitTick + 1) * duel.tickSeconds,
    rawAtIncident: duel.lanes[0].series[29],
  };
}

describe('estimates', () => {
  it('multiplies label cardinalities into series', () => {
    const { endpoints, statuses, hosts, users } = LABEL_EXAMPLE;
    expect(seriesCount([endpoints, statuses, hosts])).toBe(5_000);
    expect(seriesCount([endpoints, statuses, hosts, users])).toBe(500_000_000);
    expect(headMemoryBytes(seriesCount([endpoints, statuses, hosts]))).toBe(15_000_000);
    expect(headMemoryBytes(seriesCount([endpoints, statuses, hosts, users]))).toBe(1_500_000_000_000);
  });

  it('pins the fleet write volume, disk, and memory', () => {
    const series = FLEET.hosts * FLEET.seriesPerHost;
    expect(series).toBe(10_000_000);
    const perSecond = samplesPerSecond(series, FLEET.scrapeSeconds);
    expect(perSecond).toBe(1_000_000);
    expect(bytesPerDay(perSecond, FLEET.bytesPerSample)).toBeCloseTo(118_368_000_000, 0);
    expect(bytesPerDay(perSecond, FLEET.rawBytesPerSample)).toBe(1_382_400_000_000);
    expect(FLEET.rawBytesPerSample / FLEET.bytesPerSample).toBeCloseTo(11.68, 2);
    expect(headMemoryBytes(series)).toBe(30_000_000_000);
  });
});

describe('downsampling and retention', () => {
  it('answers each dashboard range from the finest tier that holds it', () => {
    const pick = (id: keyof typeof DASHBOARD_RANGES) => {
      const seconds = DASHBOARD_RANGES[id].seconds;
      const tier = tierFor(seconds);
      return [tier.id, pointsScanned(seconds), pointsScanned(seconds, RETENTION_TIERS[0])];
    };
    expect(pick('hour')).toEqual(['raw', 360, 360]);
    expect(pick('day')).toEqual(['raw', 8_640, 8_640]);
    expect(pick('month')).toEqual(['minute', 43_200, 259_200]);
    expect(pick('year')).toEqual(['hourly', 8_760, 3_153_600]);
  });

  it('pins storage per series with and without rollups', () => {
    expect(rawOnlyBytesPerSeries()).toBeCloseTo(4_320_432, 3);
    expect(tieredBytesPerSeries()).toBeCloseTo(367_598.4, 3);
    expect(rawOnlyBytesPerSeries() / tieredBytesPerSeries()).toBeCloseTo(11.75, 2);
    expect(rawOnlyBytesPerSeries() * 10_000_000).toBeCloseTo(43_204_320_000_000, -3);
    expect(tieredBytesPerSeries() * 10_000_000).toBeCloseTo(3_675_984_000_000, -3);
  });
});

describe('alert for duration', () => {
  const table = (forSeconds: number) => {
    const result = evaluateAlert(forSeconds);
    return [result.pages, result.falsePages, result.detectSeconds];
  };

  it('pins pages, false pages, and delay for each for duration', () => {
    expect(table(0)).toEqual([[3, 8, 13], 2, 0]);
    expect(table(60)).toEqual([[10, 15], 1, 60]);
    expect(table(120)).toEqual([[17], 0, 120]);
    expect(table(300)).toEqual([[23], 0, 300]);
  });

  it('goes pending before it fires and resets when the condition clears', () => {
    const { states } = evaluateAlert(60);
    expect(states.slice(7, 12)).toEqual(['ok', 'pending', 'pending', 'firing', 'ok']);
    expect(states).toHaveLength(ALERT_ERROR_RATES.length);
  });
});

describe('cardinality duel', () => {
  it('pins Launch day: raw labels fill the ingester before checkout breaks', () => {
    const { duel, raw, allow, limitSeconds } = play('launch');
    expect(duel.requests).toBe(2_904);
    expect(limitSeconds).toBe(11.5);
    expect(raw).toMatchObject({ exported: 2_570, stored: 1_000, memoryBytes: 3_000_000 });
    expect(raw).toMatchObject({ samplesReceived: 79_041, samplesStored: 49_716, samplesRejected: 29_325 });
    expect([raw.checkoutErrorsCounted, raw.checkoutErrors]).toEqual([3, 45]);
    expect(raw.checkoutSeries).toBe(82);
    expect(allow.checkoutSeries).toBe(12);
    expect([allow.exported, allow.samplesRejected, allow.checkoutErrorsCounted]).toEqual([75, 0, 45]);
  });

  it('pins Steady traffic: raw labels fit, and keep growing', () => {
    const { duel, raw, allow, limitSeconds, rawAtIncident } = play('steady');
    expect(duel.requests).toBe(1_208);
    expect(limitSeconds).toBeNull();
    expect(rawAtIncident).toBe(445);
    expect([raw.exported, raw.samplesRejected]).toEqual([756, 0]);
    expect([raw.checkoutErrorsCounted, raw.checkoutErrors]).toEqual([13, 13]);
    expect(allow.exported).toBe(60);
  });

  it('pins Bot scan: random paths fill the ingester', () => {
    const { duel, raw, allow, limitSeconds } = play('bots');
    expect(duel.requests).toBe(2_618);
    expect(limitSeconds).toBe(13.5);
    expect(raw.exported).toBe(2_193);
    expect([raw.checkoutErrorsCounted, raw.checkoutErrors]).toEqual([0, 17]);
    expect([allow.exported, allow.checkoutErrorsCounted]).toEqual([61, 17]);
  });

  it('pins the event order for Launch day', () => {
    const { duel } = play('launch');
    expect(duel.events.map((event) => [event.tick * duel.tickSeconds, event.marker])).toEqual([
      [9, true],
      [11.5, true],
      [12, true],
      [15, true],
      [30, false],
    ]);
  });

  it('replays a seeded run exactly', () => {
    for (const id of ids) {
      const a = play(id, 9);
      const b = play(id, 9);
      expect(b.raw).toEqual(a.raw);
      expect(b.duel.events).toEqual(a.duel.events);
      expect(b.duel.lanes[1].series).toEqual(a.duel.lanes[1].series);
    }
  });

  it('restarts to the same run after a partial one', () => {
    const fresh = play('bots');
    const partial = new CardinalityDuel(cardinalityScenarios.bots);
    for (let i = 0; i < 17; i += 1) partial.step();
    const restarted = play('bots');
    expect(restarted.raw).toEqual(fresh.raw);
    expect(restarted.duel.lanes[0].series).toEqual(fresh.duel.lanes[0].series);
  });

  it('stops after the run length', () => {
    const duel = run(new CardinalityDuel(cardinalityScenarios.launch));
    expect(duel.ticks).toBe(60);
    duel.step();
    expect(duel.ticks).toBe(60);
    for (const lane of duel.lanes) expect(lane.series).toHaveLength(60);
  });

  it('keeps invariants across many seeds', () => {
    for (const id of ids) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const { duel, raw, allow, rawAtIncident } = play(id, seed);
        for (const lane of [raw, allow]) {
          expect(lane.samplesReceived).toBe(lane.samplesStored + lane.samplesRejected);
          expect(lane.stored).toBeLessThanOrEqual(SERIES_LIMIT);
        }
        expect(allow.exported).toBeLessThanOrEqual(9 * 3 * 4);
        expect(allow.samplesRejected).toBe(0);
        expect(allow.checkoutErrorsCounted).toBe(allow.checkoutErrors);
        expect(raw.checkoutErrors).toBe(allow.checkoutErrors);
        expect(raw.exported).toBeGreaterThan(allow.exported);
        if (id === 'steady') expect(rawAtIncident).toBeLessThan(SERIES_LIMIT * 0.8);
        else expect(duel.lanes[0].series[29]).toBe(SERIES_LIMIT);
      }
    }
  });
});
