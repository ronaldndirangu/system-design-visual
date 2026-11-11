import { describe, expect, it } from 'vitest';
import {
  laneTotals,
  TX_TICKS,
  TxDuel,
  type TxScenarioId,
  timelineRows,
  txScenarios,
} from '../../src/lib/models/transactions';

const ids = Object.keys(txScenarios) as TxScenarioId[];

function runToEnd(duel: TxDuel): TxDuel {
  while (!duel.done) duel.step();
  return duel;
}

function snapshot(duel: TxDuel) {
  return {
    ticks: duel.ticks,
    lanes: duel.lanes.map((lane) => ({
      stored: lane.stored,
      version: lane.version,
      rows: lane.rows,
      results: lane.results,
      series: lane.series,
    })),
    events: duel.events,
  };
}

describe('transactions model', () => {
  it('replays identically for the same seed', () => {
    for (const id of ids) {
      const a = runToEnd(new TxDuel(txScenarios[id], 7));
      const b = runToEnd(new TxDuel(txScenarios[id], 7));
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });

  it('restores a checkpoint into the same state as a fresh run', () => {
    for (const id of ids) {
      const fresh = new TxDuel(txScenarios[id]);
      const start = fresh.checkpoint();
      for (let i = 0; i < 80; i += 1) fresh.step();
      const midway = fresh.checkpoint();
      runToEnd(fresh);
      const finished = snapshot(fresh);

      fresh.restore(start);
      runToEnd(fresh);
      expect(snapshot(fresh)).toEqual(finished);

      const other = new TxDuel(txScenarios[id]);
      other.restore(midway);
      runToEnd(other);
      expect(snapshot(other)).toEqual(finished);
    }
  });

  it('accounts for every request on every tick', () => {
    for (const id of ids) {
      const scenario = txScenarios[id];
      const duel = new TxDuel(scenario, 3);
      while (!duel.done) {
        duel.step();
        const started = duel.requests.filter((request) => request.readAt < duel.ticks).length;
        for (const lane of duel.lanes) {
          const t = laneTotals(lane, scenario.kind);
          expect(t.arrived).toBe(started);
          expect(t.ok + t.stale + t.rejected + t.taken + t.duplicate + t.inFlight).toBe(t.arrived);
          expect(duel.inFlight(lane)).toHaveLength(t.inFlight);
        }
      }
      for (const lane of duel.lanes) expect(laneTotals(lane, scenario.kind).inFlight).toBe(0);
    }
  });

  it('stops after 20 simulated seconds and writes one wrap up note', () => {
    const duel = runToEnd(new TxDuel(txScenarios.counter));
    expect(duel.ticks).toBe(TX_TICKS);
    expect(duel.lanes[0].series).toHaveLength(TX_TICKS);
    duel.step();
    expect(duel.ticks).toBe(TX_TICKS);
    const notes = duel.events.filter((event) => !event.marker);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toMatch(/^Run ends\./);
  });

  it('never loses or duplicates anything in the guarded lane', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ids) {
        const scenario = txScenarios[id];
        const guarded = runToEnd(new TxDuel(scenario, seed)).lanes[1];
        expect(laneTotals(guarded, scenario.kind).harm).toBe(0);
        expect(
          guarded.results.some((result) => result?.outcome === 'stale' || result?.outcome === 'duplicate'),
        ).toBe(false);
      }
    }
  });

  it('shows the race in the unguarded lane whenever requests overlap', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ['counter', 'editors', 'alias'] as const) {
        const scenario = txScenarios[id];
        const duel = runToEnd(new TxDuel(scenario, seed));
        expect(duel.overlapped.some(Boolean)).toBe(true);
        expect(laneTotals(duel.lanes[0], scenario.kind).harm).toBeGreaterThan(0);
      }
    }
  });

  it('ties when no two requests overlap', () => {
    const duel = runToEnd(new TxDuel(txScenarios.quiet));
    expect(duel.overlapped.some(Boolean)).toBe(false);
    for (const lane of duel.lanes) {
      expect(lane.stored).toBe(10);
      expect(laneTotals(lane, 'counter').harm).toBe(0);
    }
  });

  it('keeps one row per alias under the unique key', () => {
    const duel = runToEnd(new TxDuel(txScenarios.alias));
    const aliases = duel.lanes[1].rows.map((row) => row.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('never overlaps two requests on one timeline row', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ids) {
        const scenario = txScenarios[id];
        const requests = new TxDuel(scenario, seed).requests;
        const rows = timelineRows(scenario.kind, requests);
        expect(rows).toHaveLength(requests.length);
        for (const a of requests) {
          for (const b of requests) {
            if (a.id >= b.id || rows[a.id - 1] !== rows[b.id - 1]) continue;
            const apart = a.writeAt < b.readAt || b.writeAt < a.readAt;
            expect(apart).toBe(true);
          }
        }
      }
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const counter = runToEnd(new TxDuel(txScenarios.counter));
    expect(counter.requests).toHaveLength(30);
    expect(counter.overlapped.filter(Boolean)).toHaveLength(25);
    expect(counter.lanes[0].stored).toBe(17);
    expect(laneTotals(counter.lanes[0], 'counter').harm).toBe(13);
    expect(counter.lanes[1].stored).toBe(30);
    expect(counter.events[0]?.text).toBe('Click 3 starts while click 2 is still in flight. Both read 1.');

    const editors = runToEnd(new TxDuel(txScenarios.editors));
    const lww = laneTotals(editors.lanes[0], 'edit');
    const conditional = laneTotals(editors.lanes[1], 'edit');
    expect([lww.ok, lww.stale]).toEqual([2, 7]);
    expect([conditional.ok, conditional.rejected, conditional.stale]).toEqual([4, 5, 0]);

    const alias = runToEnd(new TxDuel(txScenarios.alias));
    const check = laneTotals(alias.lanes[0], 'alias');
    const unique = laneTotals(alias.lanes[1], 'alias');
    expect([check.ok, check.taken, check.duplicate]).toEqual([5, 5, 10]);
    expect([unique.ok, unique.taken, unique.rejected, unique.duplicate]).toEqual([5, 5, 10, 0]);
    expect(alias.lanes[0].rows).toHaveLength(15);
    expect(alias.lanes[1].rows).toHaveLength(5);
  });
});
