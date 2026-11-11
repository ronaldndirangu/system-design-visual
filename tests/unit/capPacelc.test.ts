import { describe, expect, it } from 'vitest';
import {
  CapDuel,
  type CapScenario,
  type CapScenarioId,
  capScenarioOrder,
  capScenarios,
  cartAt,
  generateWorkload,
  LOCAL_MS,
  summarize,
  TIMEOUT_MS,
} from '../../src/lib/models/capPacelc';

const finish = (scenario: CapScenario) => {
  const duel = new CapDuel(scenario);
  while (!duel.done) duel.step();
  return duel;
};

const withSeed = (id: CapScenarioId, seed: number): CapScenario => ({ ...capScenarios[id], seed });

const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

describe('CAP and PACELC cart model', () => {
  it('replays the same taps and results for the same seed', () => {
    for (const id of capScenarioOrder) {
      const a = finish(capScenarios[id]);
      const b = finish(capScenarios[id]);
      expect(b.workload).toEqual(a.workload);
      expect(b.lanes).toEqual(a.lanes);
      expect(b.events).toEqual(a.events);
    }
    expect(generateWorkload(41, null)).not.toEqual(generateWorkload(40, null));
  });

  it('matches a fresh run after a reset', () => {
    const first = new CapDuel(capScenarios.partition);
    for (let i = 0; i < 25; i += 1) first.step();
    const fresh = new CapDuel(capScenarios.partition);
    expect(fresh.ticks).toBe(0);
    expect(fresh.events).toEqual([]);
    for (let i = 0; i < 25; i += 1) fresh.step();
    expect(fresh.lanes).toEqual(first.lanes);
    expect(fresh.events).toEqual(first.events);
  });

  it('accounts for every tap at every tick: arrived = answered + refused + in flight', () => {
    for (const id of capScenarioOrder) {
      const duel = new CapDuel(capScenarios[id]);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel.now);
          expect(sum.arrived).toBe(sum.answered + sum.refused + sum.inFlight);
        }
      }
      for (const lane of duel.lanes) {
        const sum = summarize(lane, duel.now);
        expect(sum.inFlight, `${id} ${lane.strategy}`).toBe(0);
        expect(sum.arrived).toBe(duel.workload.length);
      }
    }
  });

  it('keeps each strategy to its promise over many seeds', () => {
    for (const seed of seeds) {
      for (const id of capScenarioOrder) {
        const duel = finish(withSeed(id, seed));
        const [refuse, accept] = duel.lanes.map((lane) => summarize(lane, duel.now));
        expect(refuse?.outOfDate, `refuse ${id} seed ${seed}`).toBe(0);
        expect(refuse?.comebacks).toBe(0);
        expect(accept?.refused, `accept ${id} seed ${seed}`).toBe(0);
        expect(accept?.longestWaitMs).toBe(LOCAL_MS);
        if (id !== 'partition') expect(refuse?.refused, `refuse ${id} seed ${seed}`).toBe(0);
        expect(refuse?.longestWaitMs).toBeLessThanOrEqual(TIMEOUT_MS);
      }
    }
  });

  it('brings East and West back to the same cart once messages land', () => {
    for (const seed of seeds) {
      for (const id of capScenarioOrder) {
        const duel = finish(withSeed(id, seed));
        const accept = duel.lanes[1];
        const east = cartAt(accept, 'east', duel.now);
        const west = cartAt(accept, 'west', duel.now);
        expect(west?.cart, `${id} seed ${seed}`).toEqual(east?.cart);
        expect(west?.versions).toBe(east?.versions);
        expect(cartAt(duel.lanes[0], 'west', duel.now)).toBeNull();
      }
    }
    const partition = finish(capScenarios.partition);
    expect(cartAt(partition.lanes[1], 'east', partition.now)).toMatchObject({
      cart: ['mug', 'book', 'lamp', 'tea', 'pen', 'jam', 'soap'],
      versions: 1,
    });
  });

  it('pins the partition numbers the lesson quotes', () => {
    const duel = finish(capScenarios.partition);
    const [refuse, accept] = duel.lanes.map((lane) => summarize(lane, duel.now));
    expect(duel.workload).toHaveLength(28);
    expect(refuse).toMatchObject({
      answered: 20,
      refused: 8,
      outOfDate: 0,
      comebacks: 0,
      longestWaitMs: 300,
    });
    expect(Math.round(refuse?.averageWaitMs ?? 0)).toBe(104);
    expect(accept).toMatchObject({ answered: 28, refused: 0, outOfDate: 7, comebacks: 1, averageWaitMs: 5 });

    const bookAdd = duel.workload.find((r) => r.device === 'phone' && r.action === 'add' && r.at >= 1500);
    expect(bookAdd).toMatchObject({ item: 'book', at: 1542 });
    expect(duel.lanes[0].answers[bookAdd?.id ?? -1]).toMatchObject({ ok: false, replyAt: 1842 });
    expect(duel.lanes[1].answers[bookAdd?.id ?? -1]).toMatchObject({ ok: true, replyAt: 1547 });

    const comeback = duel.lanes[1].comebacks[0];
    expect(comeback).toMatchObject({ at: 4540, side: 'west', item: 'scarf' });
    expect(comeback?.remove).toMatchObject({ device: 'phone', at: 3990 });
    expect(duel.lanes[0].series.at(-1)).toBe(8);
    expect(duel.lanes[1].series.at(-1)).toBe(7);
    expect(duel.lanes[1].series.indexOf(1)).toBe(17);
  });

  it('pins the no-cut numbers the lesson quotes', () => {
    const calm = finish(capScenarios.calm);
    const [calmRefuse, calmAccept] = calm.lanes.map((lane) => summarize(lane, calm.now));
    expect(Math.round(calmRefuse?.averageWaitMs ?? 0)).toBe(42);
    expect(calmRefuse).toMatchObject({ longestWaitMs: 85, outOfDate: 0, refused: 0 });
    expect(calmAccept).toMatchObject({ averageWaitMs: 5, outOfDate: 1, comebacks: 0 });

    const far = finish(capScenarios.far);
    const [farRefuse, farAccept] = far.lanes.map((lane) => summarize(lane, far.now));
    expect(Math.round(farRefuse?.averageWaitMs ?? 0)).toBe(116);
    expect(farRefuse).toMatchObject({ longestWaitMs: 245, outOfDate: 0, refused: 0 });
    expect(farAccept).toMatchObject({ averageWaitMs: 5, outOfDate: 1, comebacks: 1 });
    expect(far.lanes[1].comebacks[0]).toMatchObject({ at: 303, side: 'east', item: 'mug' });
  });
});
