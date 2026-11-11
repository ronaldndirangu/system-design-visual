import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_CRDT_CHAR,
  ConvergenceDuel,
  type ConvergenceScenarioId,
  CrdtReplica,
  compareIds,
  convergenceScenarios,
  crdtBytes,
  IndexReplica,
  randomSession,
  relayLoad,
  seedOps,
  TYPING_OPS_PER_SECOND,
} from '../../src/lib/models/collabEditor';
import { formatBytes, formatCount } from '../../src/lib/models/estimates';

const scenarioIds = Object.keys(convergenceScenarios) as ConvergenceScenarioId[];

function playToEnd(id: ConvergenceScenarioId): ConvergenceDuel {
  const duel = new ConvergenceDuel(convergenceScenarios[id]);
  while (!duel.done) duel.step();
  return duel;
}

function finalTexts(duel: ConvergenceDuel) {
  const [index, crdt] = duel.lanes;
  return {
    index: [index.text('ada'), index.text('ben')],
    crdt: [crdt.text('ada'), crdt.text('ben')],
  };
}

describe('CrdtReplica', () => {
  it('orders ids by counter, then by site', () => {
    expect(compareIds({ site: 'a', counter: 3 }, { site: 'b', counter: 2 })).toBeGreaterThan(0);
    expect(compareIds({ site: 'b', counter: 3 }, { site: 'a', counter: 3 })).toBeGreaterThan(0);
    expect(compareIds({ site: 'a', counter: 3 }, { site: 'a', counter: 3 })).toBe(0);
  });

  it('gives a local insert one more than the largest counter it has seen', () => {
    const ben = new CrdtReplica('b', seedOps('Hi'));
    const op = ben.insertAt(2, 'y');
    expect(op).toEqual({
      kind: 'insert',
      id: { site: 'b', counter: 3 },
      origin: { site: 'a', counter: 2 },
      char: 'y',
    });
  });

  it('holds an op until the character it depends on arrives, then applies both', () => {
    const ada = new CrdtReplica('a', seedOps('cat'));
    const ben = new CrdtReplica('b', seedOps('cat'));
    const s = ada.insertAt(3, 's');
    const gone = ada.deleteAt(3);
    expect(ben.receive(gone)).toBe(0);
    expect(ben.waiting()).toHaveLength(1);
    expect(ben.receive(s)).toBe(2);
    expect(ben.waiting()).toHaveLength(0);
    expect(ben.text()).toBe('cat');
    expect(ben.tombstones()).toBe(1);
    expect(ben.structure()).toEqual(ada.structure());
  });

  it('keeps forward typed runs together when two people type at the same spot', () => {
    const ada = new CrdtReplica('a');
    const ben = new CrdtReplica('b');
    const fromAda = [...'abc'].map((char, index) => ada.insertAt(index, char));
    const fromBen = [...'xyz'].map((char, index) => ben.insertAt(index, char));
    for (const op of fromBen) ada.receive(op);
    for (const op of fromAda) ben.receive(op);
    expect(ada.text()).toBe('xyzabc');
    expect(ben.text()).toBe('xyzabc');
  });

  it('interleaves runs typed backward at the same spot, the caveat the lesson states', () => {
    const ada = new CrdtReplica('a');
    const ben = new CrdtReplica('b');
    const fromAda = [...'cba'].map((char) => ada.insertAt(0, char));
    const fromBen = [...'zyx'].map((char) => ben.insertAt(0, char));
    expect(ada.text()).toBe('abc');
    expect(ben.text()).toBe('xyz');
    for (const op of fromBen) ada.receive(op);
    for (const op of fromAda) ben.receive(op);
    expect(ada.text()).toBe('xaybzc');
    expect(ben.text()).toBe('xaybzc');
  });
});

describe('IndexReplica', () => {
  it('applies remote positions as they are, without adjusting them', () => {
    const ben = new IndexReplica('b', 'cast');
    ben.insertAt(1, 'o');
    ben.receive({ kind: 'delete', index: 2 });
    expect(ben.text()).toBe('cost');
  });
});

describe('convergence scenarios', () => {
  it('ends each scripted story with the texts the lesson quotes', () => {
    expect(finalTexts(playToEnd('same-spot'))).toEqual({
      index: ['Hiya!', 'Hi!ya'],
      crdt: ['Hiya!', 'Hiya!'],
    });
    expect(finalTexts(playToEnd('insert-delete'))).toEqual({
      index: ['coat', 'cost'],
      crdt: ['coat', 'coat'],
    });
    expect(finalTexts(playToEnd('reordered'))).toEqual({
      index: ['chats!', 'chast!'],
      crdt: ['chats!', 'chats!'],
    });
  });

  it('makes the index lane diverge and the CRDT lane converge in every scenario', () => {
    for (const id of scenarioIds) {
      const [index, crdt] = playToEnd(id).lanes;
      expect(index.matches, id).toBe(false);
      expect(crdt.matches, id).toBe(true);
      expect(index.differing, id).toBeGreaterThan(0);
      expect(crdt.differing, id).toBe(0);
    }
  });

  it('answers the Predict question: Ada sees coat and Ben sees cost', () => {
    const [index, crdt] = playToEnd('insert-delete').lanes;
    expect(index.text('ada')).toBe('coat');
    expect(index.text('ben')).toBe('cost');
    expect(crdt.tombstones).toBe(2);
  });

  it('buffers the reordered edit for one delivery, then drains it', () => {
    const duel = new ConvergenceDuel(convergenceScenarios.reordered);
    const waiting: number[] = [];
    while (!duel.done) {
      duel.step();
      waiting.push(duel.lanes[1].waiting);
    }
    expect(waiting).toEqual([0, 0, 0, 1, 1, 0]);
    expect(duel.lanes[0].waiting).toBe(0);
    expect(duel.lanes[1].copies.ben.text()).toBe('chats!');
  });

  it('conserves every op: sent equals applied plus waiting plus in flight', () => {
    for (const id of scenarioIds) {
      const duel = new ConvergenceDuel(convergenceScenarios[id]);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          expect(lane.sent, id).toBe(lane.applied + lane.waiting + lane.inFlightCount);
        }
      }
      for (const lane of duel.lanes) {
        expect(lane.inFlightCount, id).toBe(0);
        expect(lane.applied, id).toBe(lane.sent);
      }
    }
  });

  it('replays the same transcript, and a fresh duel matches a reset one', () => {
    for (const id of scenarioIds) {
      const first = playToEnd(id);
      const second = playToEnd(id);
      expect(second.events).toEqual(first.events);
      const fresh = new ConvergenceDuel(convergenceScenarios[id]);
      expect(fresh.ticks).toBe(0);
      expect(fresh.events).toEqual([]);
      expect(fresh.lanes[1].text('ada')).toBe(convergenceScenarios[id].start);
    }
  });

  it('numbers one transcript entry per tick plus a closing verdict', () => {
    for (const id of scenarioIds) {
      const duel = playToEnd(id);
      expect(duel.ticks).toBe(convergenceScenarios[id].script.length);
      expect(duel.events.filter((event) => event.marker)).toHaveLength(duel.length);
      expect(duel.events.at(-1)?.text).toContain('so the copies differ');
    }
    expect(playToEnd('same-spot').length).toBe(6);
    expect(playToEnd('insert-delete').length).toBe(4);
    expect(playToEnd('reordered').length).toBe(6);
  });

  it('stops advancing once the script ends', () => {
    const duel = playToEnd('insert-delete');
    const events = duel.events.length;
    duel.step();
    expect(duel.ticks).toBe(4);
    expect(duel.events).toHaveLength(events);
    expect(duel.lanes[0].series).toHaveLength(4);
  });

  it('charts differing characters per tick, ending at zero only for CRDT ids', () => {
    for (const id of scenarioIds) {
      const [index, crdt] = playToEnd(id).lanes;
      expect(index.series, id).toHaveLength(convergenceScenarios[id].script.length);
      expect(crdt.series.at(-1), id).toBe(0);
      expect(index.series.at(-1), id).toBe(index.differing);
      expect(index.series.at(-1), id).toBeGreaterThan(0);
      expect(playToEnd(id).lanes[0].series, id).toEqual(index.series);
    }
  });
});

describe('random concurrent sessions', () => {
  const seeds = Array.from({ length: 150 }, (_, index) => index + 1);

  it('converges on every copy for every delivery order, across two and three copies', () => {
    let buffered = 0;
    for (const sites of [2, 3] as const) {
      for (const seed of seeds) {
        const run = randomSession('crdt', seed, sites);
        expect(new Set(run.texts).size, `seed ${seed}, ${sites} copies`).toBe(1);
        if (run.peakWaiting > 0) buffered += 1;
      }
    }
    expect(buffered).toBeGreaterThan(50);
  });

  it('lets index positions diverge in most of the same kind of sessions', () => {
    for (const sites of [2, 3] as const) {
      const diverged = seeds.filter(
        (seed) => new Set(randomSession('index', seed, sites).texts).size > 1,
      ).length;
      expect(diverged).toBeGreaterThan(seeds.length * 0.8);
    }
  });

  it('replays a seed exactly', () => {
    expect(randomSession('crdt', 42, 3)).toEqual(randomSession('crdt', 42, 3));
    expect(randomSession('index', 42, 3)).toEqual(randomSession('index', 42, 3));
  });
});

describe('illustrative estimates', () => {
  it('pins the relay load for ten people typing at once', () => {
    expect(TYPING_OPS_PER_SECOND).toBe(5);
    expect(relayLoad(10)).toEqual({ incoming: 50, outgoing: 450 });
    expect(relayLoad(2)).toEqual({ incoming: 10, outgoing: 10 });
    expect(relayLoad(100)).toEqual({ incoming: 500, outgoing: 49_500 });
    expect(formatCount(relayLoad(100).outgoing)).toBe('49.5K');
  });

  it('pins the metadata cost per character and the growth from tombstones', () => {
    expect(BYTES_PER_CRDT_CHAR).toBe(18);
    expect(crdtBytes(50_000, 0)).toBe(900_000);
    expect(crdtBytes(50_000, 50_000)).toBe(1_800_000);
    expect(formatBytes(50_000)).toBe('50 KB');
    expect(formatBytes(crdtBytes(50_000, 0))).toBe('900 KB');
    expect(formatBytes(crdtBytes(50_000, 50_000))).toBe('1.8 MB');
  });

  it('pins the challenge: twenty editors and a heavily edited outline', () => {
    expect(relayLoad(20)).toEqual({ incoming: 100, outgoing: 1_900 });
    expect(crdtBytes(20_000, 60_000)).toBe(1_440_000);
    expect(formatBytes(crdtBytes(20_000, 60_000))).toBe('1.44 MB');
    expect(formatBytes(20_000)).toBe('20 KB');
    expect(crdtBytes(20_000, 60_000) / 20_000).toBe(72);
  });
});
