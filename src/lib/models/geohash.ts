/**
 * Geohash: a real implementation of the public algorithm. Each bit halves a
 * box, alternating longitude then latitude, and every 5 bits become one
 * base32 character. Longer hashes name smaller cells, and two hashes that
 * share a prefix sit inside the same larger cell.
 */

export const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Mean kilometers per degree of latitude; also per degree of longitude at the equator. */
export const KM_PER_DEGREE = 111.32;

export interface GeohashBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface DecodedGeohash extends GeohashBox {
  /** Center of the cell. */
  lat: number;
  lng: number;
}

export type GeohashAxis = 'lng' | 'lat';

/** One halving of the box while encoding: which axis, which half, and the box that remains. */
export interface GeohashStep {
  /** 0 based bit position in the whole hash. */
  bit: number;
  axis: GeohashAxis;
  /** 1 keeps the upper half (east or north), 0 keeps the lower half. */
  value: 0 | 1;
  box: GeohashBox;
  /** Set on every fifth bit, when the 5 bits so far become one base32 character. */
  char?: string;
}

const WORLD: GeohashBox = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };

function assertPrecision(precision: number) {
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
    throw new RangeError(`Geohash precision must be a whole number from 1 to 12, got ${precision}`);
  }
}

function halve(box: GeohashBox, axis: GeohashAxis, value: 0 | 1): GeohashBox {
  if (axis === 'lng') {
    const mid = (box.minLng + box.maxLng) / 2;
    return value === 1 ? { ...box, minLng: mid } : { ...box, maxLng: mid };
  }
  const mid = (box.minLat + box.maxLat) / 2;
  return value === 1 ? { ...box, minLat: mid } : { ...box, maxLat: mid };
}

/** Every halving that encoding a point performs, in order. The explorer widget replays these. */
export function geohashSteps(lat: number, lng: number, precision: number): GeohashStep[] {
  assertPrecision(precision);
  const steps: GeohashStep[] = [];
  let box = WORLD;
  let charBits = 0;
  for (let bit = 0; bit < precision * 5; bit += 1) {
    const axis: GeohashAxis = bit % 2 === 0 ? 'lng' : 'lat';
    const mid = axis === 'lng' ? (box.minLng + box.maxLng) / 2 : (box.minLat + box.maxLat) / 2;
    const value: 0 | 1 = (axis === 'lng' ? lng : lat) >= mid ? 1 : 0;
    box = halve(box, axis, value);
    charBits = charBits * 2 + value;
    const step: GeohashStep = { bit, axis, value, box };
    if (bit % 5 === 4) {
      step.char = GEOHASH_ALPHABET[charBits] ?? '';
      charBits = 0;
    }
    steps.push(step);
  }
  return steps;
}

export function encodeGeohash(lat: number, lng: number, precision: number): string {
  return geohashSteps(lat, lng, precision)
    .map((step) => step.char ?? '')
    .join('');
}

export function decodeGeohash(hash: string): DecodedGeohash {
  if (hash.length === 0) throw new RangeError('A geohash needs at least one character');
  let box = WORLD;
  let bit = 0;
  for (const char of hash.toLowerCase()) {
    const index = GEOHASH_ALPHABET.indexOf(char);
    if (index < 0) throw new RangeError(`"${char}" is not a geohash character`);
    for (let shift = 4; shift >= 0; shift -= 1) {
      const value = ((index >> shift) & 1) as 0 | 1;
      box = halve(box, bit % 2 === 0 ? 'lng' : 'lat', value);
      bit += 1;
    }
  }
  return { ...box, lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 };
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The cells exactly `radius` steps away from `hash`, where a step crosses one
 * cell edge or corner. Radius 0 is the cell itself and radius 1 is its 8
 * neighbors. Longitude wraps around the globe; latitude clamps, so rings that
 * reach past a pole repeat the polar row.
 */
export function geohashRing(hash: string, radius: number): string[] {
  const cell = decodeGeohash(hash);
  if (radius === 0) return [hash];
  const width = cell.maxLng - cell.minLng;
  const height = cell.maxLat - cell.minLat;
  const cells: string[] = [];
  for (let dy = radius; dy >= -radius; dy -= 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const lat = Math.min(90 - height / 2, Math.max(-90 + height / 2, cell.lat + dy * height));
      cells.push(encodeGeohash(lat, wrapLng(cell.lng + dx * width), hash.length));
    }
  }
  return cells;
}

/** The 8 cells that share an edge or a corner with `hash`, row by row from the north west. */
export function geohashNeighbors(hash: string): string[] {
  return geohashRing(hash, 1);
}

export interface CellSize {
  widthKm: number;
  heightKm: number;
}

/**
 * Approximate cell size at a latitude. Height is the same everywhere; width
 * shrinks with the cosine of latitude because meridians converge.
 */
export function geohashCellSize(precision: number, lat = 0): CellSize {
  assertPrecision(precision);
  const bits = precision * 5;
  const lngBits = Math.ceil(bits / 2);
  const latBits = Math.floor(bits / 2);
  const widthDeg = 360 / 2 ** lngBits;
  const heightDeg = 180 / 2 ** latBits;
  return {
    widthKm: widthDeg * KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180),
    heightKm: heightDeg * KM_PER_DEGREE,
  };
}

/** Length of the shared prefix: the precision of the smallest cell holding both hashes. */
export function sharedPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}
