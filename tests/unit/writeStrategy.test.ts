import { describe, expect, it } from 'vitest';
import {
  CACHE_MS,
  clickKey,
  DB_MS,
  summarize,
  WriteDuel,
  type WriteScenarioId,
  writeScenarios,
} from '../../src/lib/models/writeStrategy';

const scenarioIds = Object.keys(writeScenarios) as WriteScenarioId[];

function run(duel: WriteDuel): WriteDuel {
  while (!duel.done) duel.step();
  return duel;
}

function play(id: WriteScenarioId, seed = 42) {
  const duel = run(new WriteDuel(writeScenarios[id], seed));
  const [through, behind, around] = duel.lanes.map(summarize);
  if (!through || !behind || !around) throw new Error('expected three lanes');
  return { duel, through, behind, around };
}

const transcript = (duel: WriteDuel) =>
  duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);

describe('WriteDuel', () => {
  it('replays a seed exactly and resets with a new duel', () => {
    for (const id of scenarioIds) {
      const a = play(id, 9).duel;
      const b = play(id, 9).duel;
      expect(b.lanes.map((lane) => lane.series)).toEqual(a.lanes.map((lane) => lane.series));
      expect(b.events).toEqual(a.events);
    }
  });

  it('feeds every lane the same reads and writes', () => {
    for (const id of scenarioIds) {
      const { through, behind, around } = play(id, 3);
      expect(behind.writes).toBe(through.writes);
      expect(around.writes).toBe(through.writes);
      expect(behind.reads).toBe(through.reads);
      expect(around.reads).toBe(through.reads);
    }
  });

  it('accounts for every write at every tick', () => {
    for (const id of scenarioIds) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const duel = new WriteDuel(writeScenarios[id], seed);
        while (!duel.done) {
          duel.step();
          for (const lane of duel.lanes) {
            const { writes, dbWrites, coalesced, lost } = lane.totals;
            expect(dbWrites + coalesced + lost + lane.pending).toBe(writes);
            expect(lane.cached).toBeLessThanOrEqual(lane.capacity);
          }
        }
      }
    }
  });

  it('stops after 20 s with one value per tick', () => {
    const duel = run(new WriteDuel(writeScenarios.steady));
    expect(duel.ticks).toBe(200);
    for (const lane of duel.lanes) expect(lane.series).toHaveLength(200);
    const events = duel.events.length;
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.events).toHaveLength(events);
  });

  it('charges the database round trip only where the caller waits for it', () => {
    const { through, behind, around } = play('steady');
    expect(through.writeMs).toBe(DB_MS + CACHE_MS);
    expect(behind.writeMs).toBe(CACHE_MS);
    expect(around.writeMs).toBe(DB_MS + CACHE_MS);
  });

  it('uses cited latencies: a memory cache at 0.5 to 1 ms, an indexed database read at 1 to 5 ms', () => {
    expect(CACHE_MS).toBeGreaterThanOrEqual(0.5);
    expect(CACHE_MS).toBeLessThanOrEqual(1);
    expect(DB_MS).toBeGreaterThanOrEqual(1);
    expect(DB_MS).toBeLessThanOrEqual(5);
    expect(DB_MS).toBeGreaterThan(CACHE_MS);
  });

  it('serves fresh edits from cache except with write-around', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { through, behind, around } = play('steady', seed);
      expect(around.firstReadHitRatio).toBe(0);
      expect(through.firstReadHitRatio).toBeGreaterThan(0.8);
      expect(behind.dbWrites).toBeLessThan(through.dbWrites);
    }
  });

  it('merges click counts with write-behind and keeps the redirect hit ratio with write-around', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { through, behind, around } = play('clicks', seed);
      expect(behind.dbWrites).toBeLessThan(through.dbWrites * 0.5);
      expect(around.dbWrites).toBe(around.writes);
      expect(around.hitRatio).toBeGreaterThan(through.hitRatio);
    }
  });

  it('stores click counts under their own keys, so counting leaves the write-around hit ratio unchanged', () => {
    expect(clickKey(7)).not.toBe(7);
    for (let seed = 1; seed <= 12; seed += 1) {
      const counted = play('clicks', seed).around;
      const plain = run(new WriteDuel({ ...writeScenarios.clicks, countClicks: false }, seed)).lanes.map(
        summarize,
      )[2];
      expect(counted.reads).toBe(plain?.reads);
      expect(counted.hitRatio).toBe(plain?.hitRatio);
    }
  });

  it('keeps popular links cached during a bulk import only with write-around', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { duel, through, behind, around } = play('import', seed);
      expect(around.hitRatio - through.hitRatio).toBeGreaterThan(0.15);
      expect(behind.hitRatio).toBe(through.hitRatio);
      const markers = duel.events.filter((event) => event.marker);
      expect(markers).toHaveLength(1);
      expect(markers[0]?.text).not.toContain('write-around');
    }
  });

  it('loses confirmed writes in a crash only with write-behind', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { through, behind, around } = play('crash', seed);
      expect(behind.lost).toBeGreaterThan(0);
      expect(through.lost).toBe(0);
      expect(around.lost).toBe(0);
    }
  });

  it('pins the seed 42 numbers and transcripts', () => {
    const steady = play('steady');
    expect([steady.through.dbWrites, steady.behind.dbWrites, steady.around.dbWrites]).toEqual([
      416, 279, 416,
    ]);
    expect(transcript(steady.duel)).toEqual([
      '2.0 Write-behind saves its buffer: 47 writes reach the database as 33.',
      '20.0 Run ends. Database writes for the same 416 writes: write-through 416, write-behind 279, write-around 416.',
    ]);

    const clicks = play('clicks');
    expect([clicks.through.dbWrites, clicks.behind.dbWrites, clicks.around.dbWrites]).toEqual([
      4015, 1501, 4015,
    ]);
    expect(
      [clicks.through, clicks.behind, clicks.around].map((sum) => Math.round(sum.hitRatio * 1000)),
    ).toEqual([692, 692, 844]);

    expect(transcript(play('import').duel)).toEqual([
      '1.4 Imported links push popular links out of the write-through and write-behind caches. Hits over the last second: 68%.',
      '20.0 Run ends. Read hit ratio for the whole run: write-through 62%, write-behind 62%, write-around 84%.',
    ]);

    const crash = play('crash');
    expect(crash.behind.lost).toBe(38);
    expect(crash.behind.peakPending).toBe(55);
    expect(transcript(crash.duel)).toEqual([
      '2.0 Write-behind saves its buffer: 47 writes reach the database as 33.',
      '13.5 The cache crashes and restarts empty. Write-behind loses 38 writes it had already confirmed. Write-through and write-around lose none.',
      '20.0 Run ends. Writes lost: write-through 0, write-behind 38, write-around 0.',
    ]);
  });
});
