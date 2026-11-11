import { describe, expect, it } from 'vitest';
import {
  bandwidthTrace,
  egressEstimate,
  LADDER,
  MAX_BUFFER_SECONDS,
  STREAM_SECONDS,
  StreamDuel,
  type StreamScenarioId,
  streamScenarios,
  summarize,
  TICK_SECONDS,
  TUNNELS,
  uploadComparison,
  videoEstimates,
} from '../../src/lib/models/videoStreaming';

const scenarioIds = Object.keys(streamScenarios) as StreamScenarioId[];

const run = (id: StreamScenarioId, seed = 42) => {
  const duel = new StreamDuel(streamScenarios[id], seed);
  while (!duel.done) duel.step();
  return duel;
};

const results = (id: StreamScenarioId) => {
  const duel = run(id);
  return { fixed: summarize(duel.lanes[0]), adaptive: summarize(duel.lanes[1]), duel };
};

const inTunnel = (tick: number) =>
  TUNNELS.some(([start, end]) => tick * TICK_SECONDS >= start && tick * TICK_SECONDS < end);

describe('bandwidth traces', () => {
  it('repeats for a seed and changes with the seed', () => {
    for (const id of scenarioIds) {
      expect(bandwidthTrace(id, 42)).toEqual(bandwidthTrace(id, 42));
      expect(bandwidthTrace(id, 7)).not.toEqual(bandwidthTrace(id, 42));
      expect(bandwidthTrace(id)).toHaveLength(STREAM_SECONDS / TICK_SECONDS);
    }
  });

  it('stays inside the ranges the scenario chips describe', () => {
    const steady = bandwidthTrace('steady');
    expect(Math.min(...steady)).toBeGreaterThanOrEqual(10.5);
    expect(Math.max(...steady)).toBeLessThanOrEqual(13.5);
    const crowded = bandwidthTrace('crowded');
    expect(Math.min(...crowded)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...crowded)).toBeLessThanOrEqual(3.6);
    const tunnels = bandwidthTrace('tunnels');
    const inside = tunnels.filter((_, tick) => inTunnel(tick));
    const outside = tunnels.filter((_, tick) => !inTunnel(tick));
    expect(Math.min(...inside)).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...inside)).toBeLessThanOrEqual(1.2);
    expect(Math.min(...outside)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...outside)).toBeLessThanOrEqual(8.5);
  });
});

describe('stream duel', () => {
  it('is deterministic for a seed', () => {
    for (const id of scenarioIds) {
      const first = run(id);
      const second = run(id);
      expect(second.events).toEqual(first.events);
      expect(second.lanes).toEqual(first.lanes);
    }
  });

  it('starts over cleanly after a reset and stops at the end', () => {
    const partial = new StreamDuel(streamScenarios.tunnels);
    for (let tick = 0; tick < 57; tick += 1) partial.step();
    const reset = new StreamDuel(streamScenarios.tunnels);
    expect(reset.ticks).toBe(0);
    expect(reset.events).toEqual([]);
    expect(reset.lanes.every((lane) => lane.state === 'starting' && lane.buffer.length === 0)).toBe(true);
    while (!partial.done) partial.step();
    while (!reset.done) reset.step();
    expect(partial.lanes).toEqual(reset.lanes);
    expect(partial.events).toEqual(reset.events);
    partial.step();
    expect(partial.ticks).toBe(partial.length);
  });

  it('conserves video seconds, wall clock time, and delivered bits', () => {
    for (const id of scenarioIds) {
      const duel = run(id);
      const delivered = duel.bandwidth.reduce((total, mbps) => total + mbps * TICK_SECONDS, 0);
      for (const lane of duel.lanes) {
        const sum = summarize(lane);
        expect(sum.downloadedSeconds).toBe(sum.playedSeconds + sum.bufferedSeconds);
        expect((sum.startupSeconds ?? STREAM_SECONDS) + sum.playedSeconds + sum.rebufferSeconds).toBe(
          STREAM_SECONDS,
        );
        expect(sum.downloadedMegabits + sum.wastedMegabits).toBeLessThanOrEqual(delivered + 1e-9);
        expect(Math.max(...lane.bufferSeries)).toBeLessThanOrEqual(MAX_BUFFER_SECONDS);
        expect(lane.bufferSeries).toHaveLength(duel.length);
        expect(lane.bitrateSeries).toHaveLength(duel.length);
      }
    }
  });

  it('keeps the fixed lane at 1080p', () => {
    for (const id of scenarioIds) {
      const lane = run(id).lanes[0];
      expect(lane.completed.every((segment) => LADDER[segment.rung]?.label === '1080p')).toBe(true);
      expect(lane.switches).toBe(0);
    }
  });

  it('pins steady home Wi-Fi: both play smoothly and fixed keeps full quality', () => {
    const { fixed, adaptive, duel } = results('steady');
    expect(fixed).toMatchObject({
      startupSeconds: 2,
      stalls: 0,
      rebufferSeconds: 0,
      averageMbps: 5,
      switches: 0,
    });
    expect(adaptive).toMatchObject({
      startupSeconds: 0.5,
      stalls: 0,
      rebufferSeconds: 0,
      switches: 1,
      abandoned: 0,
    });
    expect(adaptive.averageMbps).toBeCloseTo(4.794, 3);
    expect(duel.events.filter((event) => event.marker)).toHaveLength(1);
    expect(duel.events.at(-1)?.text).toBe(
      'Run ends at 90 s. Fixed 1080p never stalled and averaged 5 Mbps. Adaptive ladder never stalled and averaged 4.8 Mbps.',
    );
  });

  it('pins the train: fixed stalls in every tunnel, adaptive steps down and stalls once', () => {
    const { fixed, adaptive, duel } = results('tunnels');
    expect(fixed).toMatchObject({
      startupSeconds: 3,
      stalls: 3,
      rebufferSeconds: 9,
      averageMbps: 5,
      playedSeconds: 78,
    });
    expect(adaptive).toMatchObject({
      startupSeconds: 0.5,
      stalls: 1,
      rebufferSeconds: 2,
      switches: 10,
      abandoned: 1,
      playedSeconds: 87.5,
    });
    expect(adaptive.averageMbps).toBeCloseTo(3.665, 3);
    expect(adaptive.wastedMegabits).toBeCloseTo(0.55, 6);
    expect(duel.events.filter((event) => event.marker)).toHaveLength(14);
    const fixedStalls = duel.events.filter(
      (event) => event.text === 'Fixed 1080p stalls: the buffer is empty.',
    );
    expect(fixedStalls.map((event) => event.at)).toEqual([27, 57, 80]);
    const adaptiveStall = duel.events.find(
      (event) => event.text === 'Adaptive ladder stalls: the buffer is empty.',
    );
    expect(adaptiveStall?.at).toBe(28.5);
    const drop = duel.events.find((event) => event.text.includes('drops segment'));
    expect(drop?.at).toBe(47);
    expect(drop?.text).toContain('at 1080p');
    expect(drop?.text).toContain('again at 360p');
    expect(drop?.text).toContain('with 16 s buffered');
    const rungs = duel.lanes[1].completed.map((segment) => LADDER[segment.rung]?.label);
    expect(rungs.slice(0, 2)).toEqual(['240p', '1080p']);
    expect(rungs[7]).toBe('1080p');
    const downs = duel.events.filter((event) => event.text.includes('steps down')).map((event) => event.at);
    expect(downs).toHaveLength(TUNNELS.length);
    downs.forEach((at, index) => {
      const end = TUNNELS[index]?.[1] ?? 0;
      expect(at).toBeGreaterThanOrEqual(end - 1e-9);
      expect(at).toBeLessThan(end + 1);
    });
  });

  it('pins the train stall on segment 8, a 1080p download caught by the first tunnel', () => {
    const duel = new StreamDuel(streamScenarios.tunnels, 42);
    const firstTunnelStart = TUNNELS[0]?.[0] ?? 0;
    const inFlight: { at: number; index?: number; rung?: string }[] = [];
    let tick = 0;
    while (!duel.done) {
      duel.step();
      tick += 1;
      const at = tick * TICK_SECONDS;
      const download = duel.lanes[1].download;
      if (at === firstTunnelStart || duel.lanes[1].state === 'stalled')
        inFlight.push({
          at,
          index: download?.index,
          rung: download ? LADDER[download.rung]?.label : undefined,
        });
    }
    expect(inFlight[0]).toEqual({ at: firstTunnelStart, index: 7, rung: '1080p' });
    expect(inFlight.length).toBeGreaterThan(1);
    for (const entry of inFlight) expect(entry).toMatchObject({ index: 7, rung: '1080p' });
  });

  it('pins the crowded evening: fixed stalls again and again, adaptive settles on 480p', () => {
    const { fixed, adaptive, duel } = results('crowded');
    expect(fixed).toMatchObject({
      startupSeconds: 7,
      stalls: 11,
      rebufferSeconds: 38.5,
      playedSeconds: 44.5,
    });
    expect(adaptive).toMatchObject({ startupSeconds: 1, stalls: 0, rebufferSeconds: 0, switches: 1 });
    expect(adaptive.averageMbps).toBeCloseTo(1.355, 3);
    expect(duel.lanes[1].completed.slice(1).every((segment) => LADDER[segment.rung]?.label === '480p')).toBe(
      true,
    );
    expect(duel.events.filter((event) => event.marker)).toHaveLength(12);
  });
});

describe('resumable upload', () => {
  it('sends the file once when nothing drops', () => {
    const { single, multipart } = uploadComparison({
      fileMegabytes: 2000,
      partMegabytes: 100,
      drops: 0,
      parallel: 4,
    });
    expect(single).toEqual({ sentMegabytes: 2000, wastedMegabytes: 0, requests: 1 });
    expect(multipart).toMatchObject({ sentMegabytes: 2000, wastedMegabytes: 0, parts: 20, requests: 22 });
  });

  it('retries only the parts in flight', () => {
    const { single, multipart } = uploadComparison({
      fileMegabytes: 2000,
      partMegabytes: 100,
      drops: 3,
      parallel: 4,
    });
    expect(single).toEqual({ sentMegabytes: 5000, wastedMegabytes: 3000, requests: 4 });
    expect(multipart).toEqual({
      sentMegabytes: 2600,
      wastedMegabytes: 600,
      requests: 34,
      parts: 20,
      retriedParts: 12,
    });
    const small = uploadComparison({
      fileMegabytes: 2000,
      partMegabytes: 25,
      drops: 3,
      parallel: 4,
    }).multipart;
    expect(small).toMatchObject({ sentMegabytes: 2150, wastedMegabytes: 150, parts: 80, requests: 94 });
  });

  it('loses its advantage when four parts cover the whole file', () => {
    const { single, multipart } = uploadComparison({
      fileMegabytes: 2000,
      partMegabytes: 500,
      drops: 3,
      parallel: 4,
    });
    expect(multipart.wastedMegabytes).toBe(single.wastedMegabytes);
    const worst = uploadComparison({ fileMegabytes: 2000, partMegabytes: 100, drops: 5, parallel: 4 });
    expect(worst.single.sentMegabytes).toBe(7000);
  });
});

describe('egress estimate', () => {
  it('pins the lesson example', () => {
    const result = egressEstimate({ monthlyViews: 10_000_000, watchMinutes: 6, mbps: 2.8, hitRatio: 0.9 });
    expect(result.deliveredBytes).toBeCloseTo(1.26e15, -6);
    expect(result.originBytes).toBeCloseTo(1.26e14, -6);
    expect(result.costWithoutCdn).toBeCloseTo(63_000, 6);
    expect(result.costWithCdn).toBeCloseTo(31_500, 6);
  });

  it('scales with the ladder choice and the hit ratio', () => {
    const top = egressEstimate({ monthlyViews: 10_000_000, watchMinutes: 6, mbps: 5, hitRatio: 0.9 });
    expect(top.deliveredBytes).toBeCloseTo(2.25e15, -6);
    const noCache = egressEstimate({ monthlyViews: 10_000_000, watchMinutes: 6, mbps: 2.8, hitRatio: 0 });
    expect(noCache.originBytes).toBe(noCache.deliveredBytes);
  });

  it('breaks even at a 40% hit ratio under the illustrative prices', () => {
    const at = (hitRatio: number) =>
      egressEstimate({ monthlyViews: 10_000_000, watchMinutes: 6, mbps: 2.8, hitRatio });
    const even = at(0.4);
    expect(even.costWithCdn).toBeCloseTo(even.costWithoutCdn, 6);
    expect(at(0.2).costWithCdn).toBeGreaterThan(at(0.2).costWithoutCdn);
  });
});

describe('video estimates', () => {
  it('pins the back of the envelope numbers', () => {
    const estimate = videoEstimates();
    expect(estimate.sourceBytesPerUpload).toBeCloseTo(600e6, 0);
    expect(estimate.uploadBytesPerDay).toBeCloseTo(30e12, -3);
    expect(estimate.averageIngestGbps).toBeCloseTo(2.78, 2);
    expect(estimate.ladderMbps).toBeCloseTo(10.4, 9);
    expect(estimate.ladderBytesPerMinute).toBeCloseTo(78e6, 0);
    expect(estimate.ladderBytesPerDay).toBeCloseTo(31.2e12, -3);
    expect(estimate.storedBytesPerDay).toBeCloseTo(61.2e12, -3);
    expect(estimate.storedBytesPerYear / 1e15).toBeCloseTo(22.3, 1);
    expect(estimate.peakEgressGbps).toBe(3000);
    expect(estimate.egressToIngest).toBeCloseTo(1080, 6);
  });

  it('pins the lecture platform challenge', () => {
    const estimate = videoEstimates({
      uploadsPerDay: 2000,
      minutesPerUpload: 45,
      sourceMbps: 10,
      peakViewers: 50_000,
      averageViewMbps: 2,
    });
    expect(estimate.sourceBytesPerUpload).toBeCloseTo(3375e6, 0);
    expect(estimate.uploadBytesPerDay).toBeCloseTo(6.75e12, -3);
    expect(estimate.ladderBytesPerDay).toBeCloseTo(7.02e12, -3);
    expect(estimate.storedBytesPerDay).toBeCloseTo(13.77e12, -3);
    expect(estimate.peakEgressGbps).toBe(100);
    const egress = (hitRatio: number) =>
      egressEstimate({ monthlyViews: 5_000_000, watchMinutes: 20, mbps: 1.4, hitRatio });
    const now = egress(0.7);
    expect(now.deliveredBytes).toBeCloseTo(1.05e15, -6);
    expect(now.originBytes).toBeCloseTo(3.15e14, -6);
    expect(now.costWithoutCdn).toBeCloseTo(52_500, 6);
    expect(now.costWithCdn).toBeCloseTo(36_750, 6);
    expect(egress(0.9).costWithCdn).toBeCloseTo(26_250, 6);
  });
});
