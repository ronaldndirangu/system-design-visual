import { describe, expect, it } from 'vitest';
import {
  CLICK_WINDOW_DAYS,
  estimate,
  formatBytes,
  formatCount,
  INDEX_OVERHEAD,
  presets,
  REPLICATION_FACTOR,
  shortCodeLength,
} from '../../src/lib/models/estimates';
import { planJourney, totalMs } from '../../src/lib/models/requestJourney';

describe('estimate', () => {
  it('matches the hand calculation in the lesson for a growing startup', () => {
    const result = estimate(presets.startup.inputs);
    // 1M links a day / 86,400 s is about 11.6 writes per second.
    expect(result.writesPerSecond).toBeCloseTo(11.57, 1);
    expect(result.readsPerSecond).toBeCloseTo(1157, 0);
    // (11.6 + 1157) * 3 peak factor.
    expect(result.peakRequestsPerSecond).toBeCloseTo(3507, 0);
    // 1M * 365 * 5 years * 500 bytes.
    expect(result.rawStorageBytes).toBe(912_500_000_000);
    // 913 GB * 3 copies * 1.3 for indexes.
    expect(formatBytes(result.storageBytes)).toBe('3.56 TB');
    // 3,507 peak requests * 500 byte redirects.
    expect(formatBytes(result.peakBandwidthBytesPerSecond)).toBe('1.75 MB');
    // 1M new links * 7 day click window * 20% hot * 500 bytes.
    expect(result.cacheBytes).toBe(700_000_000);
    expect(result.serversNeeded).toBe(3);
    expect(result.shortCodeLength).toBe(6);
  });

  it('provisions disk for every replica and the index overhead', () => {
    for (const preset of Object.values(presets)) {
      const result = estimate(preset.inputs);
      expect(result.storageBytes).toBeCloseTo(
        result.rawStorageBytes * REPLICATION_FACTOR * (1 + INDEX_OVERHEAD),
        0,
      );
      expect(result.storageBytes).toBeGreaterThan(3 * result.rawStorageBytes);
    }
  });

  it('sizes the cache by distinct links, so more clicks per link need no more memory', () => {
    const base = presets.startup.inputs;
    const few = estimate({ ...base, readsPerWrite: 10 });
    const many = estimate({ ...base, readsPerWrite: 1_000 });
    expect(many.readsPerSecond).toBe(few.readsPerSecond * 100);
    expect(many.cacheBytes).toBe(few.cacheBytes);
    expect(few.distinctLinksReadPerDay).toBe(base.newLinksPerDay * CLICK_WINDOW_DAYS);
  });

  it('never caches more links than exist', () => {
    const result = estimate({ ...presets.startup.inputs, retentionYears: 0.01, hotFraction: 1 });
    expect(result.distinctLinksReadPerDay).toBe(result.totalLinks);
    expect(result.cacheBytes).toBeLessThanOrEqual(result.rawStorageBytes);
  });

  it('needs a single server for a side project', () => {
    expect(estimate(presets.sideProject.inputs).serversNeeded).toBe(1);
  });
});

describe('shortCodeLength', () => {
  it('finds the shortest base62 code that fits', () => {
    expect(shortCodeLength(1)).toBe(1);
    expect(shortCodeLength(62)).toBe(1);
    expect(shortCodeLength(63)).toBe(2);
    expect(shortCodeLength(3_000_000_000_000)).toBe(7);
  });
});

describe('formatters', () => {
  it('formats counts with decimal suffixes', () => {
    expect(formatCount(950)).toBe('950');
    expect(formatCount(1_234)).toBe('1.23K');
    expect(formatCount(3_400_000)).toBe('3.4M');
    expect(formatCount(0)).toBe('0');
  });

  it('formats bytes with decimal units', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(912_500_000_000)).toBe('913 GB');
    expect(formatBytes(1_500_000_000_000)).toBe('1.5 TB');
  });
});

describe('planJourney', () => {
  const base = {
    rttMs: 40,
    dnsRttMs: 30,
    dnsCached: false,
    connectionReused: false,
    tlsVersion: '1.3' as const,
    serverMs: 2,
    databaseMs: 5,
  };

  it('costs DNS + TCP + TLS 1.3 + one request round trip on a cold start', () => {
    // 30 DNS + 40 TCP + 40 TLS + 40 request/response + 7 compute.
    expect(totalMs(planJourney(base))).toBe(157);
  });

  it('adds an extra round trip for TLS 1.2', () => {
    expect(totalMs(planJourney({ ...base, tlsVersion: '1.2' }))).toBe(197);
  });

  it('drops DNS and handshakes when everything is warm', () => {
    const steps = planJourney({ ...base, dnsCached: true, connectionReused: true });
    expect(totalMs(steps)).toBe(47);
    expect(steps.filter((step) => step.skipped).map((step) => step.id)).toEqual(['dns', 'tcp', 'tls']);
  });

  it('lays steps end to end', () => {
    const steps = planJourney(base).filter((step) => !step.skipped);
    for (let i = 1; i < steps.length; i += 1) {
      const previous = steps[i - 1];
      const current = steps[i];
      if (!previous || !current) continue;
      expect(current.startMs).toBe(previous.startMs + previous.durationMs);
    }
  });
});
