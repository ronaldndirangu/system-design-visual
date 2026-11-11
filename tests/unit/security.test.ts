import { describe, expect, it } from 'vitest';
import {
  KEY_REDEPLOY_TICK,
  KEY_ROTATE_TICK,
  laneTotals,
  SEC_TICKS,
  SecDuel,
  type SecScenarioId,
  secScenarios,
} from '../../src/lib/models/security';

const ids = Object.keys(secScenarios) as SecScenarioId[];

function runToEnd(duel: SecDuel): SecDuel {
  while (!duel.done) duel.step();
  return duel;
}

function snapshot(duel: SecDuel) {
  return {
    ticks: duel.ticks,
    lanes: duel.lanes.map((lane) => ({
      results: lane.results,
      finished: lane.finished,
      exposed: lane.exposed,
      seen: lane.seen,
      series: lane.series,
    })),
    events: duel.events,
  };
}

function wrong(duel: SecDuel, lane: 0 | 1) {
  const t = laneTotals(duel.lanes[lane]);
  return [t.wronglyAllowed, t.wronglyRejected];
}

describe('security model', () => {
  it('replays identically for the same seed', () => {
    for (const id of ids) {
      const a = runToEnd(new SecDuel(secScenarios[id], 7));
      const b = runToEnd(new SecDuel(secScenarios[id], 7));
      expect(a.requests).toEqual(b.requests);
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });

  it('restores a checkpoint into the same state as a fresh run', () => {
    for (const id of ids) {
      const fresh = new SecDuel(secScenarios[id]);
      const start = fresh.checkpoint();
      for (let i = 0; i < 80; i += 1) fresh.step();
      const midway = fresh.checkpoint();
      runToEnd(fresh);
      const finished = snapshot(fresh);

      fresh.restore(start);
      runToEnd(fresh);
      expect(snapshot(fresh)).toEqual(finished);

      const other = new SecDuel(secScenarios[id]);
      other.restore(midway);
      runToEnd(other);
      expect(snapshot(other)).toEqual(finished);
    }
  });

  it('accounts for every request on every tick', () => {
    for (const id of ids) {
      const duel = new SecDuel(secScenarios[id], 3);
      while (!duel.done) {
        duel.step();
        const arrived = duel.requests.filter((request) => request.arriveAt < duel.ticks).length;
        for (const lane of duel.lanes) {
          const t = laneTotals(lane);
          expect(t.arrived).toBe(arrived);
          expect(t.allowed + t.rejected + t.inFlight).toBe(t.arrived);
          expect(t.allowedCorrect + t.wronglyAllowed).toBe(t.allowed);
          expect(t.rejectedCorrect + t.wronglyRejected).toBe(t.rejected);
          expect(duel.inFlight(lane)).toHaveLength(t.inFlight);
        }
      }
      for (const lane of duel.lanes) expect(laneTotals(lane).inFlight).toBe(0);
    }
  });

  it('stops after 20 simulated seconds and writes one wrap up note', () => {
    const duel = runToEnd(new SecDuel(secScenarios.ownership));
    expect(duel.ticks).toBe(SEC_TICKS);
    expect(duel.lanes[0].series).toHaveLength(SEC_TICKS);
    duel.step();
    expect(duel.ticks).toBe(SEC_TICKS);
    const notes = duel.events.filter((event) => !event.marker);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toMatch(/^Run ends\./);
  });

  it('never decides wrongly in the fully defended lane', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ids) {
        expect(wrong(runToEnd(new SecDuel(secScenarios[id], seed)), 1)).toEqual([0, 0]);
      }
    }
  });

  it('lets the focus caller through whenever its defense is missing', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const id of ids) {
        const scenario = secScenarios[id];
        const duel = runToEnd(new SecDuel(scenario, seed));
        const harmed = duel.requests.filter(
          (request) => duel.lanes[0].results[request.id - 1]?.verdict === 'wronglyAllowed',
        );
        expect(harmed.length).toBeGreaterThan(0);
        expect(harmed.every((request) => request.caller === scenario.focus)).toBe(true);
      }
    }
  });

  it('breaks the cleanup job only between rotation and redeploy', () => {
    const duel = runToEnd(new SecDuel(secScenarios.repoKey));
    const broken = duel.lanes[0].results.filter((result) => result?.verdict === 'wronglyRejected');
    expect(broken.length).toBeGreaterThan(0);
    for (const result of broken) {
      expect(result?.tick).toBeGreaterThanOrEqual(KEY_ROTATE_TICK);
      expect(result?.tick).toBeLessThan(KEY_REDEPLOY_TICK);
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const ownership = runToEnd(new SecDuel(secScenarios.ownership));
    expect(ownership.requests).toHaveLength(33);
    expect(wrong(ownership, 0)).toEqual([10, 0]);
    expect(wrong(ownership, 1)).toEqual([0, 0]);
    expect(ownership.lanes[1].results.filter((result) => result?.status === '403')).toHaveLength(10);
    expect(ownership.events[0]?.tick).toBe(12);

    const expired = runToEnd(new SecDuel(secScenarios.expired));
    expect(wrong(expired, 0)).toEqual([10, 0]);

    const plain = runToEnd(new SecDuel(secScenarios.plainHttp));
    expect(wrong(plain, 0)).toEqual([6, 0]);
    expect(plain.lanes[0].exposed).toEqual(['Ben']);
    expect(plain.lanes[1].exposed).toEqual([]);
    expect(plain.events[0]?.tick).toBe(26);

    const repoKey = runToEnd(new SecDuel(secScenarios.repoKey));
    expect(repoKey.requests).toHaveLength(39);
    expect(wrong(repoKey, 0)).toEqual([3, 2]);
    expect(wrong(repoKey, 1)).toEqual([0, 0]);
  });
});
