/**
 * Back-of-envelope sizing for a URL shortener. Every formula here appears in
 * the lesson text so learners can redo it by hand.
 */
export const SECONDS_PER_DAY = 86_400;
export const BASE62_ALPHABET = 62;
/** Run servers at most this busy so a spike or a lost server does not tip you over. */
export const TARGET_UTILIZATION = 0.7;
/** Copies of every row, so one lost disk or zone loses no links. */
export const REPLICATION_FACTOR = 3;
/** Indexes, row headers and free space add roughly this share on top of the raw data. */
export const INDEX_OVERHEAD = 0.3;
/**
 * Most clicks on a short link land in its first week, so the links read on any
 * one day are roughly the last week's new links.
 */
export const CLICK_WINDOW_DAYS = 7;

export interface EstimateInputs {
  newLinksPerDay: number;
  readsPerWrite: number;
  bytesPerLink: number;
  retentionYears: number;
  peakToAverage: number;
  requestsPerServer: number;
  /** Share of the links read each day worth keeping in memory, from 0 to 1. */
  hotFraction: number;
}

export interface EstimateResult {
  writesPerSecond: number;
  readsPerSecond: number;
  peakRequestsPerSecond: number;
  totalLinks: number;
  /** One copy of the link rows, before replication and indexes. */
  rawStorageBytes: number;
  /** Disk to provision: raw rows × replication × index overhead. */
  storageBytes: number;
  /** Distinct links read in a day; a link clicked 100 times still counts once. */
  distinctLinksReadPerDay: number;
  cacheBytes: number;
  /** Redirect responses leaving the servers in the busiest hour. */
  peakBandwidthBytesPerSecond: number;
  serversNeeded: number;
  shortCodeLength: number;
}

export const presets = {
  sideProject: {
    label: 'Side project',
    inputs: {
      newLinksPerDay: 1_000,
      readsPerWrite: 10,
      bytesPerLink: 500,
      retentionYears: 5,
      peakToAverage: 3,
      requestsPerServer: 2_000,
      hotFraction: 0.2,
    },
  },
  startup: {
    label: 'Growing startup',
    inputs: {
      newLinksPerDay: 1_000_000,
      readsPerWrite: 100,
      bytesPerLink: 500,
      retentionYears: 5,
      peakToAverage: 3,
      requestsPerServer: 2_000,
      hotFraction: 0.2,
    },
  },
  planet: {
    label: 'Planet scale',
    inputs: {
      newLinksPerDay: 100_000_000,
      readsPerWrite: 100,
      bytesPerLink: 500,
      retentionYears: 10,
      peakToAverage: 3,
      requestsPerServer: 2_000,
      hotFraction: 0.2,
    },
  },
} as const satisfies Record<string, { label: string; inputs: EstimateInputs }>;

export type PresetId = keyof typeof presets;

export function estimate(inputs: EstimateInputs): EstimateResult {
  const writesPerSecond = inputs.newLinksPerDay / SECONDS_PER_DAY;
  const readsPerSecond = writesPerSecond * inputs.readsPerWrite;
  const peakRequestsPerSecond = (writesPerSecond + readsPerSecond) * inputs.peakToAverage;
  const totalLinks = inputs.newLinksPerDay * 365 * inputs.retentionYears;
  const rawStorageBytes = totalLinks * inputs.bytesPerLink;
  const storageBytes = rawStorageBytes * REPLICATION_FACTOR * (1 + INDEX_OVERHEAD);
  const distinctLinksReadPerDay = Math.min(totalLinks, inputs.newLinksPerDay * CLICK_WINDOW_DAYS);
  const cacheBytes = distinctLinksReadPerDay * inputs.hotFraction * inputs.bytesPerLink;
  const peakBandwidthBytesPerSecond = peakRequestsPerSecond * inputs.bytesPerLink;
  const serversNeeded = Math.max(
    1,
    Math.ceil(peakRequestsPerSecond / (inputs.requestsPerServer * TARGET_UTILIZATION)),
  );
  return {
    writesPerSecond,
    readsPerSecond,
    peakRequestsPerSecond,
    totalLinks,
    rawStorageBytes,
    storageBytes,
    distinctLinksReadPerDay,
    cacheBytes,
    peakBandwidthBytesPerSecond,
    serversNeeded,
    shortCodeLength: shortCodeLength(totalLinks),
  };
}

/** Shortest base62 code that can name `count` links (always at least 1 character). */
export function shortCodeLength(count: number): number {
  let length = 1;
  while (BASE62_ALPHABET ** length < count) length += 1;
  return length;
}

const SI_UNITS = ['', 'K', 'M', 'B', 'T', 'Q'];
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];

/** 1234 -> "1.2K", 3_400_000 -> "3.4M". Uses decimal steps of 1,000. */
export function formatCount(value: number): string {
  return formatScaled(value, SI_UNITS, '');
}

/** Decimal bytes (1 KB = 1,000 B), the convention used for capacity planning. */
export function formatBytes(value: number): string {
  return formatScaled(value, BYTE_UNITS, ' ');
}

function formatScaled(value: number, units: string[], separator: string): string {
  if (!Number.isFinite(value) || value <= 0) return `0${separator}${units[0]}`;
  let scaled = value;
  let unit = 0;
  while (scaled >= 999.5 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  const digits = scaled >= 100 || Number.isInteger(scaled) ? 0 : scaled >= 10 ? 1 : 2;
  const text = Number(scaled.toFixed(digits)).toString();
  return `${text}${separator}${units[unit]}`.trimEnd();
}
