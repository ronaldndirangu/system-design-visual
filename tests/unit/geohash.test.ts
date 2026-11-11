import { describe, expect, it } from 'vitest';
import {
  decodeGeohash,
  encodeGeohash,
  GEOHASH_ALPHABET,
  geohashCellSize,
  geohashNeighbors,
  geohashRing,
  geohashSteps,
  KM_PER_DEGREE,
  sharedPrefixLength,
} from '../../src/lib/models/geohash';

describe('geohash encoding', () => {
  it('matches the published test vector', () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('uses the 32 character alphabet without a, i, l, or o', () => {
    expect(GEOHASH_ALPHABET).toHaveLength(32);
    for (const letter of 'ailo') expect(GEOHASH_ALPHABET).not.toContain(letter);
  });

  it('gives a shorter hash as a prefix of a longer one for the same point', () => {
    const long = encodeGeohash(57.64911, 10.40744, 11);
    for (let precision = 1; precision <= 11; precision += 1) {
      expect(long.startsWith(encodeGeohash(57.64911, 10.40744, precision))).toBe(true);
    }
  });

  it('halves the box alternately, longitude first, and emits a character every 5 bits', () => {
    const steps = geohashSteps(57.64911, 10.40744, 2);
    expect(steps).toHaveLength(10);
    expect(steps.map((step) => step.axis).join(',')).toBe('lng,lat,lng,lat,lng,lat,lng,lat,lng,lat');
    expect(steps[0]?.box.maxLng).toBe(180);
    expect(steps[0]?.box.minLng).toBe(0);
    expect(steps[1]?.box.minLat).toBe(0);
    expect(steps[1]?.box.maxLat).toBe(90);
    expect(steps.filter((step) => step.char).map((step) => step.char)).toEqual(['u', '4']);
    expect(steps[4]?.char).toBe('u');
  });

  it('rejects precision outside 1 to 12', () => {
    expect(() => encodeGeohash(0, 0, 0)).toThrow(RangeError);
    expect(() => encodeGeohash(0, 0, 13)).toThrow(RangeError);
  });
});

describe('geohash decoding', () => {
  it('returns a cell that contains the original point', () => {
    const cell = decodeGeohash('u4pruydqqvj');
    expect(cell.minLat).toBeLessThanOrEqual(57.64911);
    expect(cell.maxLat).toBeGreaterThan(57.64911);
    expect(cell.minLng).toBeLessThanOrEqual(10.40744);
    expect(cell.maxLng).toBeGreaterThan(10.40744);
    expect(encodeGeohash(cell.lat, cell.lng, 11)).toBe('u4pruydqqvj');
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeGeohash('u4pa')).toThrow(RangeError);
    expect(() => decodeGeohash('')).toThrow(RangeError);
  });
});

describe('geohash neighbors', () => {
  const hash = encodeGeohash(57.64911, 10.40744, 6);
  const cell = decodeGeohash(hash);
  const width = cell.maxLng - cell.minLng;
  const height = cell.maxLat - cell.minLat;

  it('returns 8 distinct cells of the same precision, none of them the cell itself', () => {
    const neighbors = geohashNeighbors(hash);
    expect(neighbors).toHaveLength(8);
    expect(new Set(neighbors).size).toBe(8);
    expect(neighbors).not.toContain(hash);
    for (const neighbor of neighbors) expect(neighbor).toHaveLength(6);
  });

  it('only returns cells that share an edge or a corner', () => {
    for (const neighbor of geohashNeighbors(hash)) {
      const box = decodeGeohash(neighbor);
      const steps = [Math.round((box.lng - cell.lng) / width), Math.round((box.lat - cell.lat) / height)];
      expect(Math.abs(box.lng - cell.lng - (steps[0] ?? 0) * width)).toBeLessThan(1e-9);
      expect(Math.abs(box.lat - cell.lat - (steps[1] ?? 0) * height)).toBeLessThan(1e-9);
      expect(Math.max(Math.abs(steps[0] ?? 0), Math.abs(steps[1] ?? 0))).toBe(1);
    }
  });

  it('builds wider rings that never repeat a cell', () => {
    const rings = [0, 1, 2, 3].map((radius) => geohashRing(hash, radius));
    expect(rings.map((ring) => ring.length)).toEqual([1, 8, 16, 24]);
    expect(new Set(rings.flat()).size).toBe(49);
  });

  it('wraps longitude across the antimeridian', () => {
    const west = encodeGeohash(10, -179.99, 4);
    const east = encodeGeohash(10, 179.99, 4);
    expect(geohashNeighbors(west)).toContain(east);
  });
});

describe('geohash prefixes and sizes', () => {
  it('can give very close points no shared prefix when they straddle a big cell edge', () => {
    const a = encodeGeohash(0.0001, 0.0001, 8);
    const b = encodeGeohash(-0.0001, -0.0001, 8);
    expect(sharedPrefixLength(a, b)).toBe(0);
    expect(a.slice(0, 5)).toBe('s0000');
    expect(b.slice(0, 5)).toBe('7zzzz');
    const apartKm = Math.hypot(0.0002 * KM_PER_DEGREE, 0.0002 * KM_PER_DEGREE);
    expect(Math.round(apartKm * 1000)).toBe(31);
  });

  it('gives nearby points in the same city a long shared prefix', () => {
    const a = encodeGeohash(57.64911, 10.40744, 8);
    const b = encodeGeohash(57.6495, 10.4078, 8);
    expect(sharedPrefixLength(a, b)).toBeGreaterThanOrEqual(5);
  });

  it('pins approximate cell sizes quoted in the lesson', () => {
    const one = geohashCellSize(1);
    expect(one.widthKm).toBeCloseTo(5009, 0);
    expect(one.heightKm).toBeCloseTo(5009, 0);
    const four = geohashCellSize(4);
    expect(four.widthKm).toBeCloseTo(39.1, 1);
    expect(four.heightKm).toBeCloseTo(19.6, 1);
    const five = geohashCellSize(5);
    expect(five.widthKm).toBeCloseTo(4.89, 2);
    expect(five.heightKm).toBeCloseTo(4.89, 2);
    const six = geohashCellSize(6);
    expect(six.widthKm).toBeCloseTo(1.22, 2);
    expect(six.heightKm).toBeCloseTo(0.61, 2);
    const sixNorth = geohashCellSize(6, 57.6);
    expect(sixNorth.widthKm).toBeCloseTo(0.66, 2);
    expect(sixNorth.heightKm).toBeCloseTo(0.61, 2);
  });

  it('splits each cell into 8 columns and 4 rows for the next character after an even precision', () => {
    const six = geohashCellSize(6);
    const seven = geohashCellSize(7);
    expect(six.widthKm / seven.widthKm).toBeCloseTo(8, 6);
    expect(six.heightKm / seven.heightKm).toBeCloseTo(4, 6);
    expect(seven.widthKm).toBeCloseTo(0.153, 3);
    expect(seven.heightKm).toBeCloseTo(0.153, 3);
  });
});

describe('searching neighbors near a cell edge', () => {
  it('finds the true nearest driver in a neighbor cell that a same cell search misses', () => {
    const home = decodeGeohash(encodeGeohash(57.64911, 10.40744, 6));
    const width = home.maxLng - home.minLng;
    const rider = { lat: home.lat, lng: home.maxLng - width * 0.02 };
    const drivers = [
      { id: 'same cell, far side', lat: home.lat, lng: home.minLng + width * 0.05 },
      { id: 'next cell, just across', lat: home.lat, lng: home.maxLng + width * 0.03 },
    ];
    const distance = (driver: { lat: number; lng: number }) =>
      Math.hypot(driver.lat - rider.lat, (driver.lng - rider.lng) * Math.cos((rider.lat * Math.PI) / 180));
    const nearest = (candidates: typeof drivers) =>
      [...candidates].sort((a, b) => distance(a) - distance(b))[0]?.id;

    const riderCell = encodeGeohash(rider.lat, rider.lng, 6);
    const searched = new Set([riderCell, ...geohashNeighbors(riderCell)]);
    const inCell = drivers.filter((driver) => encodeGeohash(driver.lat, driver.lng, 6) === riderCell);
    const inNine = drivers.filter((driver) => searched.has(encodeGeohash(driver.lat, driver.lng, 6)));

    expect(nearest(drivers)).toBe('next cell, just across');
    expect(nearest(inCell)).toBe('same cell, far side');
    expect(nearest(inNine)).toBe('next cell, just across');
  });
});
