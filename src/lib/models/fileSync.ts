import { createRng } from '../rng';

/**
 * Two upload strategies run on identical seeded links: a single whole-file request that restarts
 * from zero when the link drops, and content-hashed 4 MB blocks that the server can
 * deduplicate and the client can resume. Time moves in 100 ms steps; sizes are whole KB.
 */

export type FileSyncDuelId = 'flaky' | 'edit' | 'tiny';

export interface FileSyncScenario {
  id: FileSyncDuelId;
  label: string;
  diff: string;
  fileMb: number;
  /** Blocks the server lacks; null means the whole file is new. */
  changedBlocks: number | null;
  uplinkMbps: number;
  rttMs: number;
  /** Mean seconds between link drops; null keeps the link up. */
  dropEverySeconds: number | null;
  downSeconds: number;
  tickSeconds: number;
  maxSeconds: number;
}

export const BLOCK_MB = 4;
export const HASH_MB_PER_SECOND = 500;
const STEP_MS = 100;
const KB_PER_MB = 1000;

export const fileSyncScenarios: Record<FileSyncDuelId, FileSyncScenario> = {
  flaky: {
    id: 'flaky',
    label: 'Flaky train Wi-Fi',
    diff: 'New 300 MB video, 20 Mbit/s uplink, the link drops for 5 s about every 2 minutes',
    fileMb: 300,
    changedBlocks: null,
    uplinkMbps: 20,
    rttMs: 100,
    dropEverySeconds: 120,
    downSeconds: 5,
    tickSeconds: 1,
    maxSeconds: 1200,
  },
  edit: {
    id: 'edit',
    label: 'Small edit, big file',
    diff: 'The server holds v1 of a 1 GB file; the edit rewrites 1 of its 250 blocks in place. Link stays up',
    fileMb: 1000,
    changedBlocks: 1,
    uplinkMbps: 20,
    rttMs: 100,
    dropEverySeconds: null,
    downSeconds: 0,
    tickSeconds: 2,
    maxSeconds: 1200,
  },
  tiny: {
    id: 'tiny',
    label: 'Small file, good link',
    diff: 'New 2 MB note, 20 Mbit/s uplink, the link stays up',
    fileMb: 2,
    changedBlocks: null,
    uplinkMbps: 20,
    rttMs: 100,
    dropEverySeconds: null,
    downSeconds: 0,
    tickSeconds: 0.1,
    maxSeconds: 60,
  },
};

export interface FileSyncTotals {
  /** MB of the file the server holds or is receiving in the current attempt. */
  progressMb: number;
  sentMb: number;
  wastedMb: number;
  skippedMb: number;
  requests: number;
  drops: number;
  /** Seconds until the server committed the file, or null while still uploading. */
  finishedAt: number | null;
}

export interface FileSyncEvent {
  tick: number;
  text: string;
  marker: boolean;
}

interface Request {
  kind: 'whole' | 'check' | 'block' | 'commit';
  payloadKb: number;
  rttLeft: number;
  sentKb: number;
}

interface Loss {
  lostKb: number;
  restarted: boolean;
}

const mb = (kb: number) => Math.round(kb / 100) / 10;

class Lane {
  readonly blocks: boolean;
  private readonly fileKb: number;
  private readonly missing: number[];
  private readonly rateKb: number;
  private readonly rttSteps: number;
  private hashLeft: number;
  private queue: Request[] = [];
  private current: Request | null = null;
  private checked = false;
  private skippedKb = 0;
  private uploadedKb = 0;
  sentKb = 0;
  wastedKb = 0;
  requests = 0;
  drops = 0;
  finishedStep: number | null = null;

  constructor(scenario: FileSyncScenario, blocks: boolean) {
    this.blocks = blocks;
    this.fileKb = scenario.fileMb * KB_PER_MB;
    this.rateKb = (scenario.uplinkMbps / 8) * KB_PER_MB * (STEP_MS / 1000);
    this.rttSteps = Math.round(scenario.rttMs / STEP_MS);
    const blockKb = BLOCK_MB * KB_PER_MB;
    const allBlocks = Array.from({ length: Math.ceil(this.fileKb / blockKb) }, (_, index) =>
      Math.min(blockKb, this.fileKb - index * blockKb),
    );
    this.missing = scenario.changedBlocks === null ? allBlocks : allBlocks.slice(0, scenario.changedBlocks);
    this.hashLeft = blocks ? Math.ceil((scenario.fileMb / HASH_MB_PER_SECOND) * (1000 / STEP_MS)) : 0;
    this.queue = blocks ? [this.request('check', 0)] : [this.request('whole', this.fileKb)];
  }

  get done(): boolean {
    return this.finishedStep !== null;
  }

  get progressKb(): number {
    if (this.done) return this.fileKb;
    if (!this.blocks) return this.current?.sentKb ?? 0;
    const inFlight = this.current?.kind === 'block' ? this.current.sentKb : 0;
    return this.skippedKb + this.uploadedKb + inFlight;
  }

  get skipped(): number {
    return this.skippedKb;
  }

  private request(kind: Request['kind'], payloadKb: number): Request {
    return { kind, payloadKb, rttLeft: this.rttSteps, sentKb: 0 };
  }

  /** The link went down: the request in flight is gone, and whole-file uploads start over. */
  dropLink(): Loss | null {
    if (this.done) return null;
    this.drops += 1;
    const lost = this.current;
    if (!lost) return { lostKb: 0, restarted: false };
    this.current = null;
    this.wastedKb += lost.sentKb;
    if (!this.blocks) {
      this.queue = [this.request('whole', this.fileKb)];
      return { lostKb: lost.sentKb, restarted: true };
    }
    // Resume: ask which blocks the server holds, then send only the rest.
    const retry = lost.kind === 'check' ? [] : [this.request(lost.kind, lost.payloadKb)];
    this.queue = this.checked
      ? [this.request('check', 0), ...retry, ...this.queue]
      : [this.request('check', 0)];
    return { lostKb: lost.sentKb, restarted: false };
  }

  /** Advance 100 ms. Returns what finished in this step, if anything. */
  step(stepIndex: number, linkUp: boolean): Request['kind'] | null {
    if (this.done) return null;
    if (this.hashLeft > 0) {
      this.hashLeft -= 1;
      return null;
    }
    if (!linkUp) return null;
    if (!this.current) {
      this.current = this.queue.shift() ?? null;
      if (!this.current) return null;
      this.requests += 1;
    }
    const active = this.current;
    if (active.rttLeft > 0) {
      active.rttLeft -= 1;
    } else {
      const chunk = Math.min(this.rateKb, active.payloadKb - active.sentKb);
      active.sentKb += chunk;
      this.sentKb += chunk;
    }
    if (active.rttLeft > 0 || active.sentKb < active.payloadKb) return null;
    this.current = null;
    if (active.kind === 'whole' || active.kind === 'commit') {
      this.finishedStep = stepIndex + 1;
    } else if (active.kind === 'block') {
      this.uploadedKb += active.payloadKb;
    } else if (!this.checked) {
      this.checked = true;
      const missingKb = this.missing.reduce((sum, size) => sum + size, 0);
      this.skippedKb = this.fileKb - missingKb;
      this.queue = [...this.missing.map((size) => this.request('block', size)), this.request('commit', 0)];
    }
    return active.kind;
  }

  totals(): FileSyncTotals {
    return {
      progressMb: mb(this.progressKb),
      sentMb: mb(this.sentKb),
      wastedMb: mb(this.wastedKb),
      skippedMb: mb(this.skippedKb),
      requests: this.requests,
      drops: this.drops,
      finishedAt: this.finishedStep === null ? null : (this.finishedStep * STEP_MS) / 1000,
    };
  }
}

/** Seeded link outages as [start, end) windows in 100 ms steps. */
export function linkOutages(scenario: FileSyncScenario, seed = 42): Array<[number, number]> {
  const outages: Array<[number, number]> = [];
  if (scenario.dropEverySeconds === null) return outages;
  const rng = createRng(seed);
  const stepsPerSecond = 1000 / STEP_MS;
  const limit = scenario.maxSeconds * stepsPerSecond;
  let at = 0;
  while (at < limit) {
    const gap = -scenario.dropEverySeconds * Math.log(1 - rng());
    const start = at + Math.max(1, Math.round(gap * stepsPerSecond));
    const end = start + scenario.downSeconds * stepsPerSecond;
    if (start >= limit) break;
    outages.push([start, end]);
    at = end;
  }
  return outages;
}

/** Both strategies upload the same file over the same link, sampled once per chart tick. */
export class FileSyncRun {
  readonly scenario: FileSyncScenario;
  readonly length: number;
  readonly tickSeconds: number;
  readonly series: [number[], number[]] = [[], []];
  readonly events: FileSyncEvent[] = [];
  private readonly snapshots: Array<[FileSyncTotals, FileSyncTotals]> = [];
  private readonly timeline: FileSyncEvent[] = [];
  private readonly initial: [FileSyncTotals, FileSyncTotals];
  private readonly final: [FileSyncTotals, FileSyncTotals];
  private tickCount = 0;

  constructor(scenario: FileSyncScenario, seed = 42) {
    this.scenario = scenario;
    this.tickSeconds = scenario.tickSeconds;
    const stepsPerTick = Math.round((scenario.tickSeconds * 1000) / STEP_MS);
    const limit = (scenario.maxSeconds * 1000) / STEP_MS;
    const outages = linkOutages(scenario, seed);
    const lanes: [Lane, Lane] = [new Lane(scenario, false), new Lane(scenario, true)];
    const tickOf = (step: number) => Math.floor(step / stepsPerTick);
    this.initial = [lanes[0].totals(), lanes[1].totals()];
    let announcedSkip = false;
    let outage = 0;
    let step = 0;
    while (step < limit && !(lanes[0].done && lanes[1].done)) {
      const window = outages[outage];
      if (window && step === window[0]) {
        const [whole, blocks] = lanes.map((lane) => lane.dropLink());
        const parts = [`Link drops for ${scenario.downSeconds} s`];
        if (whole?.restarted)
          parts.push(`the whole-file upload throws away ${mb(whole.lostKb)} MB and starts over`);
        if (blocks) parts.push(`the block upload loses ${mb(blocks.lostKb)} MB in flight and resumes`);
        this.timeline.push({ tick: tickOf(step), text: parts.join('; '), marker: true });
      }
      if (window && step >= window[1]) outage += 1;
      const linkUp = !(window && step >= window[0] && step < window[1]);
      lanes.forEach((lane) => {
        const finished = lane.step(step, linkUp);
        if (finished === 'check' && lane.skipped > 0 && !announcedSkip) {
          announcedSkip = true;
          this.timeline.push({
            tick: tickOf(step),
            text: `The server already holds ${mb(lane.skipped)} MB of matching blocks, so only ${mb(scenario.fileMb * KB_PER_MB - lane.skipped)} MB remain`,
            marker: true,
          });
        }
        if (lane.done && lane.finishedStep === step + 1) {
          const name = lane.blocks ? 'Block upload' : 'Whole-file upload';
          this.timeline.push({ tick: tickOf(step), text: `${name} finishes`, marker: true });
        }
      });
      step += 1;
      if (step % stepsPerTick === 0 || (lanes[0].done && lanes[1].done) || step >= limit) {
        this.snapshots.push([lanes[0].totals(), lanes[1].totals()]);
      }
    }
    this.length = this.snapshots.length;
    this.final = [lanes[0].totals(), lanes[1].totals()];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  get labels(): [string, string] {
    return ['Whole file, one request', 'Hashed 4 MB blocks'];
  }

  totals(): [FileSyncTotals, FileSyncTotals] {
    if (this.tickCount === 0) return this.initial;
    return this.snapshots[this.tickCount - 1] ?? this.final;
  }

  /** Totals at the end of the run, whatever tick the run has reached. */
  finalTotals(): [FileSyncTotals, FileSyncTotals] {
    return this.final;
  }

  step() {
    if (this.done) return;
    const tick = this.tickCount;
    const snapshot = this.snapshots[tick];
    if (snapshot) {
      this.series[0].push(snapshot[0].progressMb);
      this.series[1].push(snapshot[1].progressMb);
    }
    this.events.push(...this.timeline.filter((event) => event.tick === tick));
    this.tickCount += 1;
    if (this.done) {
      const [whole, blocks] = this.final;
      const time = (totals: FileSyncTotals) =>
        totals.finishedAt === null ? 'did not finish' : `finished in ${totals.finishedAt.toFixed(1)} s`;
      const requests = (count: number) => `${count} ${count === 1 ? 'request' : 'requests'}`;
      const note = `Whole file sent ${whole.sentMb} MB in ${requests(whole.requests)} and ${time(whole)}. Blocks sent ${blocks.sentMb} MB in ${requests(blocks.requests)} and ${time(blocks)}.`;
      this.events.push({ tick: this.length, text: note, marker: false });
    }
  }
}
