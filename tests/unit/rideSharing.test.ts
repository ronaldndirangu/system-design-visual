import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount } from '../../src/lib/models/estimates';
import {
  CELL_HEIGHT_KM,
  CELL_WIDTH_KM,
  CITY_PREFIX,
  cellByHash,
  cellChangeShare,
  cellHashAt,
  cityCells,
  DriverPositions,
  DriverReservations,
  DUEL_SECONDS,
  historyBytesPerDay,
  indexMemoryBytes,
  lateAcceptTimeline,
  locationWritesPerSecond,
  naiveChecksPerSecond,
  OFFER_SECONDS,
  PING_SECONDS,
  pingIsNewer,
  RideMatchDuel,
  type RideScenarioId,
  rideEstimates,
  rideRequestsPerSecond,
  rideScenarios,
} from '../../src/lib/models/rideSharing';

const scenarioIds = Object.keys(rideScenarios) as RideScenarioId[];

function run(id: RideScenarioId, seed = 42) {
  const duel = new RideMatchDuel(rideScenarios[id], seed);
  while (!duel.done) duel.step();
  return duel;
}

function snapshot(duel: RideMatchDuel) {
  return {
    lanes: duel.lanes,
    pings: duel.pings,
    cellMoves: duel.cellMoves,
    trace: duel.trace,
    events: duel.events,
    results: duel.results.map((result) => [result.driverId, result.checks, result.radius]),
    drivers: duel.drivers.map((driver) => [driver.x, driver.y, driver.cell]),
  };
}

describe('ride sharing estimates (illustrative)', () => {
  const e = rideEstimates;
  const writes = locationWritesPerSecond(e.onlineDrivers, e.pingSeconds);
  const requests = rideRequestsPerSecond(e.ridesPerDay, e.peakFactor);

  it('turns 200,000 drivers pinging every 4 s into 50,000 writes per second', () => {
    expect(writes).toBe(50_000);
  });

  it('fits the whole live index in about 20 MB of memory', () => {
    const bytes = indexMemoryBytes(e.onlineDrivers, e.bytesPerIndexEntry);
    expect(bytes).toBe(20_000_000);
    expect(formatBytes(bytes)).toBe('20 MB');
  });

  it('expects about 116 ride requests per second on average and 347 at peak', () => {
    expect(requests.average).toBeCloseTo(115.74, 2);
    expect(requests.peak).toBeCloseTo(347.22, 2);
  });

  it('makes the naive scan cost 69.4M distance checks per second at peak', () => {
    const checks = naiveChecksPerSecond(e.onlineDrivers, requests.peak);
    expect(formatCount(checks)).toBe('69.4M');
    expect(naiveChecksPerSecond(2 * e.onlineDrivers, 2 * requests.peak) / checks).toBeCloseTo(4, 10);
  });

  it('sees about 144 location writes for every ride search at peak', () => {
    expect(Math.round(writes / requests.peak)).toBe(144);
  });

  it('keeps about 173 GB of location history per day', () => {
    const bytes = historyBytesPerDay(writes, e.bytesPerHistoryPoint);
    expect(bytes).toBe(172_800_000_000);
    expect(formatBytes(bytes)).toBe('173 GB');
  });

  it('moves a driver between cells on about 1 ping in 12', () => {
    const stepKm = (e.speedKmh * e.pingSeconds) / 3600;
    expect(stepKm).toBeCloseTo(0.04, 10);
    const share = cellChangeShare(stepKm, e.cellKm);
    expect(share).toBeCloseTo(0.0835, 4);
    expect(Math.round(1 / share)).toBe(12);
    expect(Math.round(writes * share)).toBe(4175);
    expect(cellChangeShare(1, 0.5)).toBe(1);
  });
});

describe('the toy city', () => {
  it('lays out 100 distinct precision 6 cells inside u4pr', () => {
    expect(cityCells).toHaveLength(100);
    expect(cellByHash.size).toBe(100);
    for (const cell of cityCells) {
      expect(cell.hash).toHaveLength(6);
      expect(cell.hash.startsWith(CITY_PREFIX)).toBe(true);
      expect(cell.label).toBe(cell.hash.slice(4));
    }
  });

  it('uses cells about 0.66 km wide and 0.61 km tall', () => {
    expect(CELL_WIDTH_KM).toBeCloseTo(0.656, 3);
    expect(CELL_HEIGHT_KM).toBeCloseTo(0.611, 3);
  });

  it('maps a point just inside each side of a cell to that cell', () => {
    for (const cell of cityCells) {
      const left = cell.col * CELL_WIDTH_KM;
      const bottom = cell.row * CELL_HEIGHT_KM;
      expect(cellHashAt(left + 0.001, bottom + 0.001)).toBe(cell.hash);
      expect(cellHashAt(left + CELL_WIDTH_KM - 0.001, bottom + CELL_HEIGHT_KM - 0.001)).toBe(cell.hash);
    }
  });
});

describe('RideMatchDuel', () => {
  it('replays the same run from the same seed', () => {
    for (const id of scenarioIds) {
      expect(snapshot(run(id))).toEqual(snapshot(run(id)));
    }
  });

  it('matches a fresh run after reset', () => {
    for (const id of scenarioIds) {
      const duel = new RideMatchDuel(rideScenarios[id], 42);
      for (let i = 0; i < 17; i += 1) duel.step();
      duel.reset();
      expect(duel.ticks).toBe(0);
      expect(duel.events).toEqual([]);
      while (!duel.done) duel.step();
      expect(snapshot(duel)).toEqual(snapshot(run(id)));
    }
  });

  it('stops after the run length', () => {
    const duel = run('dense');
    expect(duel.ticks).toBe(DUEL_SECONDS);
    duel.step();
    expect(duel.ticks).toBe(DUEL_SECONDS);
    expect(duel.trace[0]).toHaveLength(DUEL_SECONDS);
    expect(duel.trace[1]).toHaveLength(DUEL_SECONDS);
  });

  it('conserves requests, pings, and index membership', () => {
    for (const id of scenarioIds) {
      for (const seed of [1, 7, 42, 99]) {
        const duel = run(id, seed);
        const scenario = rideScenarios[id];
        expect(duel.results).toHaveLength(15);
        for (const lane of duel.lanes) expect(lane.matched + lane.unmatched).toBe(duel.results.length);
        let expectedPings = 0;
        for (let tick = 1; tick <= DUEL_SECONDS; tick += 1) {
          for (let driverId = 0; driverId < scenario.drivers; driverId += 1) {
            if ((tick + driverId) % PING_SECONDS === 0) expectedPings += 1;
          }
        }
        expect(duel.pings).toBe(expectedPings);
        const filed = [...duel.index.values()].reduce((sum, members) => sum + members.size, 0);
        expect(filed).toBe(scenario.drivers);
        for (const driver of duel.drivers) {
          expect(duel.index.get(driver.cell)?.has(driver.id)).toBe(true);
          expect(cellHashAt(driver.x, driver.y)).toBe(driver.cell);
        }
        expect(duel.trace[0].at(-1)).toBe(duel.lanes[0].checks);
        expect(duel.trace[1].at(-1)).toBe(duel.lanes[1].checks);
      }
    }
  });

  it('always lets both lanes pick the same driver while the cell search does less work', () => {
    for (const id of scenarioIds) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const duel = run(id, seed);
        for (const result of duel.results) {
          expect(result.laneDriverIds[0]).toBe(result.laneDriverIds[1]);
          expect(result.checks[1]).toBeLessThanOrEqual(result.checks[0]);
        }
      }
    }
  });

  it('never hands one driver to two riders at once', () => {
    for (const id of scenarioIds) {
      const duel = run(id, 3);
      for (const [i, result] of duel.results.entries()) {
        const overlapping = duel.results
          .slice(i + 1)
          .filter((later) => later.request.tick < result.request.tick + 12);
        if (result.driverId === null) continue;
        expect(overlapping.map((later) => later.driverId)).not.toContain(result.driverId);
      }
    }
  });

  it('pins seed 42 in dense downtown: 596 checks per request for the scan, 43 for the cells', () => {
    const duel = run('dense');
    expect(duel.lanes[0].checks).toBe(8940);
    expect(duel.lanes[1].checks).toBe(646);
    expect(duel.lanes[0].checks / 15).toBe(596);
    expect(Math.round(duel.lanes[1].checks / 15)).toBe(43);
    expect((duel.lanes[0].checks / duel.lanes[1].checks).toFixed(1)).toBe('13.8');
    expect(duel.results[0]?.checks).toEqual([600, 54]);
    expect(duel.lanes[0].matched).toBe(15);
    expect(duel.lanes[0].distanceKm / 15).toBeCloseTo(0.121, 3);
    expect(duel.pings).toBe(4500);
    expect(duel.cellMoves).toBe(314);
    expect(Math.round((100 * duel.cellMoves) / duel.pings)).toBe(7);
    expect(duel.widened).toBe(0);
    expect(duel.sameCellMisses).toBe(4);
  });

  it('pins seed 42 near cell edges: the rider cell alone misses 13 of 15 nearest drivers', () => {
    const duel = run('edge');
    expect(duel.sameCellMisses).toBe(13);
    expect(duel.widened).toBe(0);
    expect(duel.lanes[0].checks).toBe(2190);
    expect(duel.lanes[1].checks).toBe(209);
    expect(duel.lanes[0].distanceKm / 15).toBeCloseTo(0.241, 3);
    expect(duel.cellMoves).toBe(77);
  });

  it('pins seed 42 in sparse suburbs: the search widens on 10 of 15 requests', () => {
    const duel = run('sparse');
    expect(duel.widened).toBe(10);
    expect(duel.results.filter((result) => result.widenReason === 'empty')).not.toHaveLength(0);
    expect(Math.max(...duel.results.map((result) => result.radius))).toBe(3);
    expect(duel.lanes[0].checks).toBe(240);
    expect(duel.lanes[1].checks).toBe(33);
    expect(duel.lanes[0].matched).toBe(15);
    expect(duel.lanes[0].distanceKm / 15).toBeCloseTo(0.993, 3);
  });

  it('widens only when the 9 cells cannot prove they hold the nearest driver', () => {
    for (const id of scenarioIds) {
      for (const result of run(id).results) {
        expect(result.searchedCells).toHaveLength((2 * result.radius + 1) ** 2);
        expect(result.widenReason === null).toBe(result.radius === 1);
      }
    }
  });

  it('numbers its marker events and closes with a summary note', () => {
    for (const id of scenarioIds) {
      const duel = run(id);
      const markers = duel.events.filter((event) => event.marker);
      expect(markers.length).toBeGreaterThan(0);
      expect(markers.length).toBeLessThanOrEqual(8);
      expect(markers[0]?.text.startsWith('Request 1:')).toBe(true);
      const last = duel.events.at(-1);
      expect(last?.marker).toBe(false);
      expect(last?.tick).toBe(DUEL_SECONDS);
    }
    const dense = run('dense').events.at(-1)?.text;
    expect(dense).toBe(
      'Run complete: the scan made 8,940 distance checks and the cell search made 646, 13.8× fewer. 4,500 location writes moved a driver to a new cell 314 times.',
    );
  });

  it('explains the edge miss in the transcript', () => {
    const texts = run('edge').events.map((event) => event.text);
    expect(
      texts.some((text) => text.includes("A search of the rider's cell alone would have sent driver")),
    ).toBe(true);
    const sparse = run('sparse').events.map((event) => event.text);
    expect(sparse.some((text) => text.includes('widened ring by ring to 25 cells'))).toBe(true);
  });
});

describe('fenced driver reservations', () => {
  it('lets only one ride reserve a free driver until the lease expires', () => {
    const table = new DriverReservations(['d1']);
    const a = table.reserve('d1', 'A', 0);
    expect(a).toEqual({ driverId: 'd1', rideId: 'A', version: 1, expiresAt: OFFER_SECONDS });
    expect(table.reserve('d1', 'B', OFFER_SECONDS - 1)).toBeNull();
    expect(table.statusAt('d1', OFFER_SECONDS)).toBe('free');
    const b = table.reserve('d1', 'B', OFFER_SECONDS);
    expect(b?.version).toBe(2);
  });

  it('rejects an accept after expiry even with the matching version', () => {
    const table = new DriverReservations(['d1']);
    const a = table.reserve('d1', 'A', 0);
    if (!a) throw new Error('reserve failed');
    expect(table.accept(a, a.expiresAt)).toBe(false);
    expect(table.statusAt('d1', a.expiresAt)).toBe('free');
  });

  it('renews only the current reservation', () => {
    const table = new DriverReservations(['d1']);
    const a = table.reserve('d1', 'A', 0);
    if (!a) throw new Error('reserve failed');
    const renewed = table.renew(a, 10);
    expect(renewed?.expiresAt).toBe(10 + OFFER_SECONDS);
    expect(table.reserve('d1', 'B', OFFER_SECONDS + 1)).toBeNull();
    expect(table.renew({ ...a, version: a.version + 1 }, 11)).toBeNull();
    expect(table.renew({ ...a, rideId: 'B' }, 11)).toBeNull();
  });

  it('frees the driver on release and then refuses the old reservation', () => {
    const table = new DriverReservations(['d1']);
    const a = table.reserve('d1', 'A', 0);
    if (!a) throw new Error('reserve failed');
    expect(table.release(a)).toBe(true);
    expect(table.statusAt('d1', 1)).toBe('free');
    expect(table.rideOf('d1')).toBeNull();
    expect(table.release(a)).toBe(false);
    expect(table.accept(a, 2)).toBe(false);
  });

  it('rejects a stale release and a late accept after reassignment', () => {
    const timeline = lateAcceptTimeline();
    expect(timeline.freeAtExpiry).toBe(true);
    expect(
      timeline.steps.map(({ at, ride, action, named, driverVersion, ok }) => [
        at,
        ride,
        action,
        named,
        driverVersion,
        ok,
      ]),
    ).toEqual([
      [0, 'A', 'reserve', null, 1, true],
      [16, 'B', 'reserve', null, 2, true],
      [17, 'A', 'release', 1, 2, false],
      [18, 'A', 'accept', 1, 2, false],
      [20, 'B', 'accept', 2, 2, true],
    ]);
    expect(timeline.final).toEqual({ status: 'on-trip', ride: 'B', version: 2 });
  });
});

describe('ping ordering', () => {
  it('orders by session, then sequence', () => {
    expect(pingIsNewer({ session: 1, seq: 5 }, { session: 1, seq: 4 })).toBe(true);
    expect(pingIsNewer({ session: 1, seq: 4 }, { session: 1, seq: 4 })).toBe(false);
    expect(pingIsNewer({ session: 2, seq: 1 }, { session: 1, seq: 900 })).toBe(true);
  });

  it('drops a ping that arrives after a newer one, and repeats', () => {
    const index = new DriverPositions();
    expect(index.apply('d1', { session: 1, seq: 2 }, 'c2')).toBe(true);
    expect(index.apply('d1', { session: 1, seq: 1 }, 'c1')).toBe(false);
    expect(index.apply('d1', { session: 1, seq: 2 }, 'c2')).toBe(false);
    expect(index.cellOf('d1')).toBe('c2');
  });

  it('keeps a removal against a late older add', () => {
    const index = new DriverPositions();
    index.apply('d1', { session: 1, seq: 7 }, 'c1');
    expect(index.apply('d1', { session: 1, seq: 9 }, null)).toBe(true);
    expect(index.apply('d1', { session: 1, seq: 8 }, 'c3')).toBe(false);
    expect(index.cellOf('d1')).toBeNull();
  });

  it('applies the first ping of a new session after a high sequence', () => {
    const index = new DriverPositions();
    index.apply('d1', { session: 1, seq: 900 }, 'c1');
    expect(index.apply('d1', { session: 2, seq: 1 }, 'c4')).toBe(true);
    expect(index.cellOf('d1')).toBe('c4');
  });
});
