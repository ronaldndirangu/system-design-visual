import { describe, expect, it } from 'vitest';
import {
  type CcChangeId,
  type CcMode,
  ccChanges,
  ccSummary,
  evaluateChange,
  offsetRowsScanned,
  PG_SEED,
  PG_TICKS,
  PgDuel,
  type PgScenarioId,
  pgScenarios,
} from '../../src/lib/models/apis';

const ids = Object.keys(pgScenarios) as PgScenarioId[];
const changes = Object.keys(ccChanges) as CcChangeId[];
const modes: CcMode[] = ['inPlace', 'expand'];

function runToEnd(duel: PgDuel): PgDuel {
  while (!duel.done) duel.step();
  return duel;
}

function snapshot(duel: PgDuel) {
  return {
    ticks: duel.ticks,
    links: duel.links,
    lanes: duel.lanes,
    events: duel.events,
  };
}

function finalNumbers(id: PgScenarioId, seed = PG_SEED) {
  const duel = runToEnd(new PgDuel(pgScenarios[id], seed));
  return duel.lanes.map((lane) => {
    const totals = duel.totals(lane);
    return {
      pages: lane.pages,
      rowsShown: lane.rowsShown,
      duplicates: totals.duplicates,
      skipped: totals.skipped,
      missedNew: totals.missedNew,
      rowsScanned: lane.rowsScanned,
    };
  });
}

describe('apis pagination model', () => {
  it('replays identically for the same seed', () => {
    for (const id of ids) {
      const a = runToEnd(new PgDuel(pgScenarios[id], 7));
      const b = runToEnd(new PgDuel(pgScenarios[id], 7));
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });

  it('restores a checkpoint into the same state as a fresh run', () => {
    for (const id of ids) {
      const fresh = new PgDuel(pgScenarios[id]);
      const start = fresh.checkpoint();
      for (let i = 0; i < 10; i += 1) fresh.step();
      const midway = fresh.checkpoint();
      runToEnd(fresh);
      const finished = snapshot(fresh);

      fresh.restore(start);
      runToEnd(fresh);
      expect(snapshot(fresh)).toEqual(finished);

      const other = new PgDuel(pgScenarios[id]);
      other.restore(midway);
      runToEnd(other);
      expect(snapshot(other)).toEqual(finished);
    }
  });

  it('accounts for every stable link on every tick', () => {
    for (const id of ids) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const duel = new PgDuel(pgScenarios[id], seed);
        while (!duel.done) {
          duel.step();
          for (const lane of duel.lanes) {
            const totals = duel.totals(lane);
            expect(totals.once + totals.multi + totals.skipped + totals.ahead).toBe(totals.stable);
            const shown = Object.values(lane.shown).reduce((sum, count) => sum + count, 0);
            expect(shown).toBe(lane.rowsShown);
          }
        }
        expect(duel.ticks).toBe(PG_TICKS);
        for (const lane of duel.lanes) {
          expect(lane.finishedAt).not.toBeNull();
          expect(duel.totals(lane).ahead).toBe(0);
          expect(lane.series).toHaveLength(PG_TICKS);
        }
      }
    }
  });

  it('ties on a quiet list, where offset still walks three times the rows', () => {
    for (const lane of finalNumbers('quiet')) {
      expect(lane).toMatchObject({ pages: 5, rowsShown: 50, duplicates: 0, skipped: 0 });
    }
    const [offset, cursor] = finalNumbers('quiet');
    expect(offset?.rowsScanned).toBe(150);
    expect(cursor?.rowsScanned).toBe(50);
  });

  it('never repeats or skips a stable link with a cursor', () => {
    for (const id of ids) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const [, cursor] = finalNumbers(id, seed);
        expect(cursor).toMatchObject({ duplicates: 0, skipped: 0 });
      }
    }
  });

  it('repeats rows under creates and skips links under deletes with offsets', () => {
    let repeats = 0;
    let skips = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const [busy] = finalNumbers('busy', seed);
      const [cleanup] = finalNumbers('cleanup', seed);
      if ((busy?.duplicates ?? 0) > 0) repeats += 1;
      if ((cleanup?.skipped ?? 0) > 0) skips += 1;
      expect(busy?.skipped).toBe(0);
      expect(cleanup?.duplicates).toBe(0);
    }
    expect(repeats).toBeGreaterThanOrEqual(10);
    expect(skips).toBeGreaterThanOrEqual(10);
  });

  it('writes exactly one wrap up note', () => {
    for (const id of ids) {
      const duel = runToEnd(new PgDuel(pgScenarios[id]));
      expect(duel.events.filter((event) => !event.marker)).toHaveLength(1);
    }
  });

  it('pins the numbers the lesson quotes', () => {
    expect(finalNumbers('busy')).toEqual([
      { pages: 6, rowsShown: 60, duplicates: 10, skipped: 0, missedNew: 13, rowsScanned: 210 },
      { pages: 5, rowsShown: 50, duplicates: 0, skipped: 0, missedNew: 13, rowsScanned: 50 },
    ]);
    expect(finalNumbers('cleanup')).toEqual([
      { pages: 5, rowsShown: 42, duplicates: 0, skipped: 6, missedNew: 0, rowsScanned: 142 },
      { pages: 5, rowsShown: 49, duplicates: 0, skipped: 0, missedNew: 0, rowsScanned: 49 },
    ]);
    expect(finalNumbers('both')).toEqual([
      { pages: 6, rowsShown: 51, duplicates: 9, skipped: 5, missedNew: 15, rowsScanned: 201 },
      { pages: 5, rowsShown: 48, duplicates: 0, skipped: 0, missedNew: 15, rowsScanned: 48 },
    ]);
    const both = runToEnd(new PgDuel(pgScenarios.both));
    const [offset, cursor] = both.lanes;
    expect(offset && both.totals(offset)).toMatchObject({ stable: 41, once: 28, multi: 8, skipped: 5 });
    expect(cursor && both.totals(cursor)).toMatchObject({ stable: 46, once: 46, multi: 0, skipped: 0 });
  });

  it('walks 10,000 rows to serve page 500 at 20 per page', () => {
    expect(offsetRowsScanned(500, 20)).toBe(10_000);
  });
});

describe('apis contract change model', () => {
  it('never does more damage by expanding first', () => {
    for (const change of changes) {
      for (const strict of [false, true]) {
        const inPlace = ccSummary(change, 'inPlace', strict);
        const expand = ccSummary(change, 'expand', strict);
        expect(expand.broken + expand.silent).toBeLessThanOrEqual(inPlace.broken + inPlace.silent);
      }
    }
  });

  it('breaks nobody with an optional field unless a reader is strict', () => {
    for (const mode of modes) {
      expect(ccSummary('addOptional', mode, false)).toMatchObject({ broken: 0, silent: 0, versions: 1 });
      const strict = evaluateChange('addOptional', mode, true);
      expect(
        strict.filter((verdict) => verdict.outcome === 'breaks').map((verdict) => verdict.client.id),
      ).toEqual(['partner']);
    }
  });

  it('breaks nobody when tolerant readers meet expand then contract', () => {
    for (const change of changes) {
      expect(ccSummary(change, 'expand', false)).toMatchObject({ broken: 0, silent: 0 });
    }
  });

  it('breaks the old mobile app for every in place change except the additive one', () => {
    for (const change of changes) {
      const mobile = evaluateChange(change, 'inPlace', false).find(
        (verdict) => verdict.client.id === 'mobile',
      );
      expect(mobile?.outcome === 'ok').toBe(change === 'addOptional');
    }
  });
});
