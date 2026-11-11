import { describe, expect, it } from 'vitest';
import {
  btreeLevels,
  formatDuration,
  IX_TICKS,
  IxDuel,
  type IxScenarioId,
  indexLookupPages,
  indexPages,
  insertCost,
  ixScenarios,
  redundantIndexes,
  scanPages,
} from '../../src/lib/models/indexes';

const ids = Object.keys(ixScenarios) as IxScenarioId[];

function runToEnd(duel: IxDuel): IxDuel {
  while (!duel.done) duel.step();
  return duel;
}

function snapshot(duel: IxDuel) {
  return {
    ticks: duel.ticks,
    issued: duel.issued,
    lanes: duel.lanes.map((lane) => ({
      waiting: lane.waiting,
      answered: lane.answered,
      pagesRead: lane.pagesRead,
      slowestUs: lane.slowestUs,
      series: lane.series,
    })),
    events: duel.events,
  };
}

describe('index math', () => {
  it('grows the scan with the table and the tree with its logarithm', () => {
    expect(ids.map((id) => scanPages(ixScenarios[id].rows))).toEqual([100, 100_000, 100_000_000]);
    expect(ids.map((id) => btreeLevels(ixScenarios[id].rows))).toEqual([2, 3, 4]);
    expect(ids.map((id) => indexLookupPages(ixScenarios[id].rows))).toEqual([3, 4, 5]);
    expect(btreeLevels(500)).toBe(1);
    expect(btreeLevels(501)).toBe(2);
    expect(btreeLevels(62_500_000_000)).toBe(4);
    expect(btreeLevels(62_500_000_001)).toBe(5);
  });

  it('prices one lookup at the assumed page costs', () => {
    expect(formatDuration(100 * 10)).toBe('1 ms');
    expect(formatDuration(3 * 100)).toBe('0.3 ms');
    expect(formatDuration(100_000 * 10)).toBe('1 s');
    expect(formatDuration(100_000_000 * 10)).toBe('17 min');
    expect(formatDuration(5 * 100)).toBe('0.5 ms');
  });

  it('charges every insert one more page per index', () => {
    expect(indexPages(10_000_000)).toBe(20_041);
    expect(insertCost(0)).toMatchObject({
      pagesWritten: 1,
      pagesVisited: 1,
      writeUs: 100,
      indexPagesTotal: 0,
    });
    expect(insertCost(1)).toMatchObject({
      pagesWritten: 2,
      pagesVisited: 4,
      writeUs: 200,
      indexPagesTotal: 20_041,
    });
    expect(insertCost(4)).toMatchObject({
      structures: 5,
      pagesWritten: 5,
      pagesVisited: 13,
      writeUs: 500,
      tablePages: 100_000,
      indexPagesTotal: 80_164,
    });
  });

  it('flags a lone user_id index once the composite index exists', () => {
    expect(redundantIndexes(['code', 'user'])).toEqual([]);
    expect(redundantIndexes(['code', 'user', 'userCreated'])).toEqual(['user']);
  });
});

describe('indexes duel', () => {
  it('replays identically for the same seed', () => {
    for (const id of ids) {
      const a = runToEnd(new IxDuel(ixScenarios[id], 7));
      const b = runToEnd(new IxDuel(ixScenarios[id], 7));
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });

  it('replays the same lookups in every scenario', () => {
    const lookups = ids.map((id) => new IxDuel(ixScenarios[id], 7).lookups);
    expect(lookups[1]).toEqual(lookups[0]);
    expect(lookups[2]).toEqual(lookups[0]);
  });

  it('resets to a fresh run from a checkpoint', () => {
    for (const id of ids) {
      const fresh = new IxDuel(ixScenarios[id]);
      const start = fresh.checkpoint();
      for (let i = 0; i < 60; i += 1) fresh.step();
      const midway = fresh.checkpoint();
      runToEnd(fresh);
      const finished = snapshot(fresh);

      fresh.restore(start);
      expect(fresh.ticks).toBe(0);
      expect(fresh.events).toEqual([]);
      runToEnd(fresh);
      expect(snapshot(fresh)).toEqual(finished);

      const other = new IxDuel(ixScenarios[id]);
      other.restore(midway);
      runToEnd(other);
      expect(snapshot(other)).toEqual(finished);
    }
  });

  it('accounts for every lookup on every tick', () => {
    for (const id of ids) {
      const duel = new IxDuel(ixScenarios[id], 3);
      while (!duel.done) {
        duel.step();
        const arrived = duel.lookups.filter((lookup) => lookup.at < duel.ticks).length;
        expect(duel.issued).toBe(arrived);
        for (const lane of duel.lanes) {
          expect(lane.answered + lane.waiting.length).toBe(duel.issued);
          expect(lane.series).toHaveLength(duel.ticks);
        }
      }
    }
  });

  it('never lets the scan stop before the last page', () => {
    for (const id of ids) {
      const [scan] = runToEnd(new IxDuel(ixScenarios[id])).lanes;
      const partial = scan.pagesRead - scan.answered * scan.pagesPerLookup;
      expect(partial).toBeGreaterThanOrEqual(0);
      expect(partial).toBeLessThan(scan.pagesPerLookup);
    }
  });

  it('stops after 10 simulated seconds and writes one wrap up note', () => {
    const duel = runToEnd(new IxDuel(ixScenarios.medium));
    expect(duel.ticks).toBe(IX_TICKS);
    const before = snapshot(duel);
    duel.step();
    expect(snapshot(duel)).toEqual(before);
    expect(duel.events.filter((event) => /^Run ends\./.test(event.text))).toHaveLength(1);
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const small = runToEnd(new IxDuel(ixScenarios.small));
    const medium = runToEnd(new IxDuel(ixScenarios.medium));
    const huge = runToEnd(new IxDuel(ixScenarios.huge));
    for (const duel of [small, medium, huge]) expect(duel.issued).toBe(43);

    const [smallScan, smallIndex] = small.lanes;
    expect([smallScan.answered, smallScan.pagesRead]).toEqual([43, 4_300]);
    expect([smallIndex.answered, smallIndex.pagesRead]).toEqual([43, 129]);
    expect(Math.max(...smallScan.series)).toBe(0);

    const [mediumScan, mediumIndex] = medium.lanes;
    expect([mediumScan.answered, mediumScan.waiting.length, mediumScan.pagesRead]).toEqual([9, 34, 980_000]);
    expect(medium.longestWaitUs(mediumScan)).toBe(7_600_000);
    expect([mediumIndex.answered, mediumIndex.pagesRead]).toEqual([43, 172]);

    const [hugeScan, hugeIndex] = huge.lanes;
    expect([hugeScan.answered, hugeScan.pagesRead]).toEqual([0, 980_000]);
    expect([hugeIndex.answered, hugeIndex.pagesRead, hugeIndex.slowestUs]).toEqual([43, 215, 1_000]);
    expect(huge.events.some((event) => event.text.includes('480,000 of 100,000,000 pages (0.5%)'))).toBe(
      true,
    );
  });
});
