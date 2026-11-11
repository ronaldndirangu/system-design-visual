import { createRng } from '../rng';

/**
 * Toy video player duel. Two players watch the same video over the same
 * seeded network trace: one always fetches 1080p, the other adapts its
 * bitrate. Segments, buffer, and stalls follow simple rules so the run is easy
 * to read; real players use richer buffer based or hybrid algorithms.
 */

export interface Rung {
  label: string;
  /** Illustrative video bitrate in megabits per second. */
  mbps: number;
}

export const LADDER: readonly Rung[] = [
  { label: '240p', mbps: 0.4 },
  { label: '360p', mbps: 0.8 },
  { label: '480p', mbps: 1.4 },
  { label: '720p', mbps: 2.8 },
  { label: '1080p', mbps: 5 },
];
export const TOP_RUNG = LADDER.length - 1;
export const SEGMENT_SECONDS = 4;
export const TICK_SECONDS = 0.5;
export const STREAM_SECONDS = 90;
/** The player stops fetching once this much video waits in the buffer. */
export const MAX_BUFFER_SECONDS = 20;
/** Playback starts, or resumes after a stall, once one whole segment is buffered. */
export const START_BUFFER_SECONDS = SEGMENT_SECONDS;
/** The adaptive player spends at most this share of the throughput it measured. */
export const SAFETY_FRACTION = 0.8;
/** How many recent segment downloads the adaptive player averages. */
export const THROUGHPUT_WINDOW = 3;

const ladderMbps = (rung: number) => LADDER[rung]?.mbps ?? 0;
const ladderLabel = (rung: number) => LADDER[rung]?.label ?? '';

export type StreamScenarioId = 'steady' | 'tunnels' | 'crowded';

export interface StreamScenario {
  id: StreamScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
}

export const streamScenarios: Record<StreamScenarioId, StreamScenario> = {
  steady: {
    id: 'steady',
    label: 'Steady home Wi-Fi',
    diff: 'Bandwidth wanders between about 11 and 13 Mbps, more than twice the 5 Mbps that 1080p needs.',
  },
  tunnels: {
    id: 'tunnels',
    label: 'Train through tunnels',
    diff: 'About 5 to 8 Mbps in the open. Tunnels at 20 to 30 s, 46 to 58 s, and 72 to 82 s cut it to about 1 Mbps.',
  },
  crowded: {
    id: 'crowded',
    label: 'Crowded evening',
    diff: 'A shared link gives 2 to 3.6 Mbps all evening, always below the 5 Mbps that 1080p needs.',
  },
};

export const TUNNELS: readonly [number, number][] = [
  [20, 30],
  [46, 58],
  [72, 82],
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

/** Available bandwidth in Mbps for every tick of a run, generated once per scenario and seed. */
export function bandwidthTrace(id: StreamScenarioId, seed = 42): number[] {
  const rng = createRng(seed);
  const ticks = Math.round(STREAM_SECONDS / TICK_SECONDS);
  const walk = (center: number, spread: number, min: number, max: number) => {
    let value = center;
    return () => {
      value += (rng() - 0.5) * spread;
      value += (center - value) * 0.15;
      value = clamp(value, min, max);
      return value;
    };
  };
  const steady = walk(12, 1.2, 10.5, 13.5);
  const open = walk(7, 1.6, 5, 9);
  const crowded = walk(2.8, 0.9, 2, 3.6);
  const trace: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const time = tick * TICK_SECONDS;
    if (id === 'steady') trace.push(tenth(steady()));
    else if (id === 'crowded') trace.push(tenth(crowded()));
    else {
      const outside = open();
      const inTunnel = TUNNELS.some(([start, end]) => time >= start && time < end);
      trace.push(tenth(inTunnel ? 0.6 + rng() * 0.6 : outside));
    }
  }
  return trace;
}

export type LaneId = 'fixed' | 'adaptive';
export type PlayState = 'starting' | 'playing' | 'stalled';

export interface SegmentRecord {
  /** Zero based position in the video. */
  index: number;
  rung: number;
}

export interface Download extends SegmentRecord {
  sizeMegabits: number;
  doneMegabits: number;
  startedAt: number;
}

export interface StreamLane {
  id: LaneId;
  label: string;
  state: PlayState;
  /** Buffered video in play order, each piece tagged with the rung it was fetched at. */
  buffer: { rung: number; seconds: number }[];
  download: Download | null;
  completed: SegmentRecord[];
  /** Measured throughput of each completed segment download, in Mbps. */
  throughputs: number[];
  startupSeconds: number | null;
  stallStartedAt: number | null;
  stalls: number;
  rebufferSeconds: number;
  playedSeconds: number;
  playedMegabits: number;
  switches: number;
  abandoned: number;
  wastedMegabits: number;
  /** Bitrate of the segment being fetched (or last fetched) after every tick. */
  bitrateSeries: number[];
  /** Seconds of buffered video after every tick. */
  bufferSeries: number[];
}

export interface StreamEvent {
  /** Seconds from the start of the run. */
  at: number;
  text: string;
  /** True for events numbered on the chart: stalls, quality switches, and abandoned downloads. */
  marker: boolean;
}

export const laneLabels: Record<LaneId, string> = {
  fixed: 'Fixed 1080p',
  adaptive: 'Adaptive ladder',
};

export function bufferedSeconds(lane: StreamLane): number {
  return lane.buffer.reduce((sum, piece) => sum + piece.seconds, 0);
}

/** Highest rung whose bitrate fits under the budget, capped at `ceiling`. */
export function highestRungWithin(budgetMbps: number, ceiling = TOP_RUNG): number {
  let pick = 0;
  for (let rung = 0; rung <= ceiling; rung += 1) {
    if (ladderMbps(rung) <= budgetMbps + 1e-9) pick = rung;
  }
  return pick;
}

function recentThroughput(lane: StreamLane): number {
  const recent = lane.throughputs.slice(-THROUGHPUT_WINDOW);
  return recent.length === 0 ? 0 : recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

const mbpsText = (value: number) => `${Number(value.toFixed(1))} Mbps`;
const secondsText = (value: number) => `${Number(value.toFixed(1))} s`;

export class StreamDuel {
  readonly scenario: StreamScenario;
  readonly bandwidth: number[];
  readonly length: number;
  readonly tickSeconds = TICK_SECONDS;
  readonly lanes: [StreamLane, StreamLane];
  readonly events: StreamEvent[] = [];
  private tickCount = 0;

  constructor(scenario: StreamScenario, seed = 42) {
    this.scenario = scenario;
    this.bandwidth = bandwidthTrace(scenario.id, seed);
    this.length = this.bandwidth.length;
    const lane = (id: LaneId): StreamLane => ({
      id,
      label: laneLabels[id],
      state: 'starting',
      buffer: [],
      download: null,
      completed: [],
      throughputs: [],
      startupSeconds: null,
      stallStartedAt: null,
      stalls: 0,
      rebufferSeconds: 0,
      playedSeconds: 0,
      playedMegabits: 0,
      switches: 0,
      abandoned: 0,
      wastedMegabits: 0,
      bitrateSeries: [],
      bufferSeries: [],
    });
    this.lanes = [lane('fixed'), lane('adaptive')];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** Bandwidth during the most recent tick, or the first tick before the run starts. */
  get bandwidthNow(): number {
    return this.bandwidth[Math.max(0, this.tickCount - 1)] ?? 0;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    const start = tick * TICK_SECONDS;
    const end = start + TICK_SECONDS;
    const mbps = Math.max(0.01, this.bandwidth[tick] ?? 0);
    const fresh: StreamEvent[] = [];
    for (const lane of this.lanes) {
      this.fetch(lane, mbps, start, fresh);
      if (lane.id === 'adaptive') this.maybeAbandon(lane, end, fresh);
      this.play(lane, start, end, fresh);
      const last = lane.completed.at(-1);
      lane.bitrateSeries.push(ladderMbps(lane.download?.rung ?? last?.rung ?? 0));
      lane.bufferSeries.push(bufferedSeconds(lane));
    }
    fresh.sort((a, b) => a.at - b.at);
    this.events.push(...fresh);
    this.tickCount += 1;
    if (this.done) {
      const [fixed, adaptive] = this.lanes;
      const recap = (lane: StreamLane) => {
        const sum = summarize(lane);
        const stalls =
          sum.stalls === 0
            ? 'never stalled'
            : `stalled ${sum.stalls} ${sum.stalls === 1 ? 'time' : 'times'} for ${secondsText(sum.rebufferSeconds)}`;
        return `${lane.label} ${stalls} and averaged ${mbpsText(sum.averageMbps)}`;
      };
      this.events.push({
        at: STREAM_SECONDS,
        text: `Run ends at ${STREAM_SECONDS} s. ${recap(fixed)}. ${recap(adaptive)}.`,
        marker: false,
      });
    }
  }

  private choose(lane: StreamLane, index: number, at: number, fresh: StreamEvent[]): number {
    if (lane.id === 'fixed') return TOP_RUNG;
    const previous = lane.completed.at(-1)?.rung;
    const buffered = bufferedSeconds(lane);
    const measured = recentThroughput(lane);
    let rung: number;
    let reason: string;
    if (lane.throughputs.length === 0 || buffered < START_BUFFER_SECONDS) {
      rung = 0;
      reason =
        lane.throughputs.length === 0
          ? 'nothing measured yet and the buffer is empty'
          : `only ${secondsText(buffered)} buffered, so it refills with the smallest rung`;
    } else {
      rung = highestRungWithin(SAFETY_FRACTION * measured);
      reason = `recent throughput ${mbpsText(measured)}, and 80% of that is ${mbpsText(SAFETY_FRACTION * measured)}`;
    }
    if (previous === undefined) {
      fresh.push({
        at,
        text: `${lane.label} fetches segment 1 at ${ladderLabel(rung)}: ${reason}.`,
        marker: false,
      });
    } else if (rung !== previous) {
      const direction = rung > previous ? 'up' : 'down';
      fresh.push({
        at,
        text: `${lane.label} steps ${direction} to ${ladderLabel(rung)} for segment ${index + 1}: ${reason}.`,
        marker: true,
      });
    }
    return rung;
  }

  private fetch(lane: StreamLane, mbps: number, start: number, fresh: StreamEvent[]): void {
    let left = TICK_SECONDS;
    while (left > 1e-9) {
      const now = start + TICK_SECONDS - left;
      if (!lane.download) {
        if (bufferedSeconds(lane) + SEGMENT_SECONDS > MAX_BUFFER_SECONDS + 1e-9) return;
        const index = lane.completed.length;
        const rung = this.choose(lane, index, now, fresh);
        lane.download = {
          index,
          rung,
          sizeMegabits: ladderMbps(rung) * SEGMENT_SECONDS,
          doneMegabits: 0,
          startedAt: now,
        };
      }
      const download = lane.download;
      const need = (download.sizeMegabits - download.doneMegabits) / mbps;
      if (need > left) {
        download.doneMegabits += mbps * left;
        return;
      }
      left -= need;
      const finished = start + TICK_SECONDS - left;
      lane.throughputs.push(download.sizeMegabits / Math.max(1e-6, finished - download.startedAt));
      const previous = lane.completed.at(-1);
      if (previous && previous.rung !== download.rung) lane.switches += 1;
      lane.completed.push({ index: download.index, rung: download.rung });
      lane.buffer.push({ rung: download.rung, seconds: SEGMENT_SECONDS });
      lane.download = null;
    }
  }

  /**
   * A download that cannot finish before the buffer runs dry is dropped and
   * fetched again at a rung the current speed can carry, the way real players
   * abandon slow requests.
   */
  private maybeAbandon(lane: StreamLane, now: number, fresh: StreamEvent[]): void {
    const download = lane.download;
    if (!download || download.rung === 0) return;
    const elapsed = now - download.startedAt;
    if (elapsed < TICK_SECONDS - 1e-9) return;
    const speed = download.doneMegabits / elapsed;
    if (speed <= 0) return;
    const remaining = (download.sizeMegabits - download.doneMegabits) / speed;
    const buffered = bufferedSeconds(lane);
    if (remaining <= buffered) return;
    const target = highestRungWithin(SAFETY_FRACTION * speed, download.rung - 1);
    const refetch = (ladderMbps(target) * SEGMENT_SECONDS) / speed;
    if (refetch >= remaining) return;
    lane.abandoned += 1;
    lane.wastedMegabits += download.doneMegabits;
    fresh.push({
      at: now,
      text: `${lane.label} drops segment ${download.index + 1} at ${ladderLabel(download.rung)}: at ${mbpsText(speed)} it needs about ${secondsText(remaining)} more, with ${secondsText(buffered)} buffered. It fetches the segment again at ${ladderLabel(target)}.`,
      marker: true,
    });
    lane.download = {
      index: download.index,
      rung: target,
      sizeMegabits: ladderMbps(target) * SEGMENT_SECONDS,
      doneMegabits: 0,
      startedAt: now,
    };
  }

  private play(lane: StreamLane, start: number, end: number, fresh: StreamEvent[]): void {
    if (lane.state === 'playing') {
      if (bufferedSeconds(lane) >= TICK_SECONDS - 1e-9) {
        let left = TICK_SECONDS;
        while (left > 1e-9) {
          const front = lane.buffer[0];
          if (!front) break;
          const take = Math.min(left, front.seconds);
          front.seconds -= take;
          left -= take;
          lane.playedSeconds += take;
          lane.playedMegabits += take * ladderMbps(front.rung);
          if (front.seconds <= 1e-9) lane.buffer.shift();
        }
        return;
      }
      lane.state = 'stalled';
      lane.stalls += 1;
      lane.stallStartedAt = start;
      fresh.push({ at: start, text: `${lane.label} stalls: the buffer is empty.`, marker: true });
    }
    if (lane.state === 'stalled') lane.rebufferSeconds += TICK_SECONDS;
    if (bufferedSeconds(lane) < START_BUFFER_SECONDS - 1e-9) return;
    if (lane.state === 'starting') {
      lane.startupSeconds = end;
      fresh.push({ at: end, text: `${lane.label} starts playing after ${secondsText(end)}.`, marker: false });
    } else {
      const waited = end - (lane.stallStartedAt ?? end);
      fresh.push({
        at: end,
        text: `${lane.label} resumes after ${secondsText(waited)} stalled.`,
        marker: false,
      });
    }
    lane.state = 'playing';
    lane.stallStartedAt = null;
  }
}

export interface StreamSummary {
  /** Seconds until the first frame plays, or null if it never started. */
  startupSeconds: number | null;
  stalls: number;
  rebufferSeconds: number;
  playedSeconds: number;
  /** Average bitrate of the video actually watched. */
  averageMbps: number;
  switches: number;
  abandoned: number;
  wastedMegabits: number;
  downloadedSeconds: number;
  downloadedMegabits: number;
  bufferedSeconds: number;
}

export function summarize(lane: StreamLane): StreamSummary {
  return {
    startupSeconds: lane.startupSeconds,
    stalls: lane.stalls,
    rebufferSeconds: lane.rebufferSeconds,
    playedSeconds: lane.playedSeconds,
    averageMbps: lane.playedSeconds > 0 ? lane.playedMegabits / lane.playedSeconds : 0,
    switches: lane.switches,
    abandoned: lane.abandoned,
    wastedMegabits: lane.wastedMegabits,
    downloadedSeconds: lane.completed.length * SEGMENT_SECONDS,
    downloadedMegabits: lane.completed.reduce(
      (sum, segment) => sum + ladderMbps(segment.rung) * SEGMENT_SECONDS,
      0,
    ),
    bufferedSeconds: bufferedSeconds(lane),
  };
}

/* Resumable upload: one request versus multipart parts. */

export interface UploadInputs {
  fileMegabytes: number;
  partMegabytes: number;
  drops: number;
  /** Parts uploading at the same time. */
  parallel: number;
}

export interface UploadPlan {
  sentMegabytes: number;
  wastedMegabytes: number;
  requests: number;
}

export interface UploadComparison {
  single: UploadPlan;
  multipart: UploadPlan & { parts: number; retriedParts: number };
}

/**
 * Toy accounting: every connection drop lands halfway through whatever is in
 * flight. One request loses half the file; multipart loses half of each part
 * in flight and retries only those parts.
 */
export function uploadComparison({
  fileMegabytes,
  partMegabytes,
  drops,
  parallel,
}: UploadInputs): UploadComparison {
  const singleWasted = drops * (fileMegabytes / 2);
  const parts = Math.ceil(fileMegabytes / partMegabytes);
  const inFlight = Math.min(parallel, parts);
  const partSize = fileMegabytes / parts;
  const retriedParts = drops * inFlight;
  const multipartWasted = retriedParts * (partSize / 2);
  return {
    single: {
      sentMegabytes: fileMegabytes + singleWasted,
      wastedMegabytes: singleWasted,
      requests: drops + 1,
    },
    multipart: {
      sentMegabytes: fileMegabytes + multipartWasted,
      wastedMegabytes: multipartWasted,
      // Initiate and complete are one request each, on top of every part attempt.
      requests: parts + retriedParts + 2,
      parts,
      retriedParts,
    },
  };
}

/* Egress: what serving the video costs each month. */

/** Illustrative round prices for the lesson, not quotes from any provider. */
export const ILLUSTRATIVE_ORIGIN_PER_GB = 0.05;
export const ILLUSTRATIVE_CDN_PER_GB = 0.02;

export interface EgressInputs {
  monthlyViews: number;
  watchMinutes: number;
  /** Average bitrate actually delivered to viewers. */
  mbps: number;
  /** Share of bytes the CDN serves from its edge cache, 0 to 1. */
  hitRatio: number;
}

export interface EgressResult {
  deliveredBytes: number;
  originBytes: number;
  costWithoutCdn: number;
  costWithCdn: number;
}

export function egressEstimate({ monthlyViews, watchMinutes, mbps, hitRatio }: EgressInputs): EgressResult {
  const deliveredBytes = (monthlyViews * watchMinutes * 60 * mbps * 1e6) / 8;
  const originBytes = deliveredBytes * (1 - hitRatio);
  const deliveredGb = deliveredBytes / 1e9;
  const originGb = originBytes / 1e9;
  return {
    deliveredBytes,
    originBytes,
    costWithoutCdn: deliveredGb * ILLUSTRATIVE_ORIGIN_PER_GB,
    costWithCdn: deliveredGb * ILLUSTRATIVE_CDN_PER_GB + originGb * ILLUSTRATIVE_ORIGIN_PER_GB,
  };
}

/* Back of the envelope numbers for the lesson. All inputs are illustrative. */

export interface VideoEstimateInputs {
  uploadsPerDay: number;
  minutesPerUpload: number;
  sourceMbps: number;
  peakViewers: number;
  averageViewMbps: number;
}

export const videoEstimateInputs: VideoEstimateInputs = {
  uploadsPerDay: 50_000,
  minutesPerUpload: 8,
  sourceMbps: 10,
  peakViewers: 1_000_000,
  averageViewMbps: 3,
};

export interface VideoEstimates {
  sourceBytesPerUpload: number;
  uploadBytesPerDay: number;
  averageIngestGbps: number;
  ladderMbps: number;
  ladderBytesPerMinute: number;
  ladderBytesPerDay: number;
  storedBytesPerDay: number;
  storedBytesPerYear: number;
  peakEgressGbps: number;
  egressToIngest: number;
}

export function videoEstimates(inputs: VideoEstimateInputs = videoEstimateInputs): VideoEstimates {
  const minutesPerDay = inputs.uploadsPerDay * inputs.minutesPerUpload;
  const sourceBytesPerUpload = (inputs.minutesPerUpload * 60 * inputs.sourceMbps * 1e6) / 8;
  const uploadBytesPerDay = inputs.uploadsPerDay * sourceBytesPerUpload;
  const averageIngestGbps = (uploadBytesPerDay * 8) / 86_400 / 1e9;
  const ladderMbps = LADDER.reduce((sum, rung) => sum + rung.mbps, 0);
  const ladderBytesPerMinute = (ladderMbps * 1e6 * 60) / 8;
  const ladderBytesPerDay = minutesPerDay * ladderBytesPerMinute;
  const storedBytesPerDay = uploadBytesPerDay + ladderBytesPerDay;
  const peakEgressGbps = (inputs.peakViewers * inputs.averageViewMbps) / 1000;
  return {
    sourceBytesPerUpload,
    uploadBytesPerDay,
    averageIngestGbps,
    ladderMbps,
    ladderBytesPerMinute,
    ladderBytesPerDay,
    storedBytesPerDay,
    storedBytesPerYear: storedBytesPerDay * 365,
    peakEgressGbps,
    egressToIngest: peakEgressGbps / averageIngestGbps,
  };
}
