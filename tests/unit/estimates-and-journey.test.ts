import { describe, expect, it } from 'vitest';
import { estimate, formatBytes, formatCount, presets, shortCodeLength } from '../../src/lib/models/estimates';
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
    expect(result.storageBytes).toBe(912_500_000_000);
    expect(result.serversNeeded).toBe(3);
    expect(result.shortCodeLength).toBe(6);
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
