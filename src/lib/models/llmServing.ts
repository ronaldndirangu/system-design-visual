/**
 * Toy model of an LLM server: a scheduler packs requests into forward passes
 * (steps) on one GPU, and a pool of KV cache blocks holds each request's
 * attention state. Times are toy milliseconds, so every number is illustrative.
 */
import { createRng, hashString, randomInt } from '../rng';
import { percentile } from './serverFarm';

export const SEED = 42;

/** Every step pays a fixed launch and scheduling cost. */
export const STEP_OVERHEAD_MS = 2;
/** Every step reads all the weights once, whatever the batch size. */
export const WEIGHT_READ_MS = 8;
/** Each decoding sequence adds its own KV cache read. */
export const PER_SEQUENCE_MS = 0.15;
/** Tokens the GPU computes per toy millisecond, decode and prompt tokens alike. */
export const TOKENS_PER_MS = 32;
/** Tokens in one step at which compute takes as long as the weight read. */
export const RIDGE_TOKENS = WEIGHT_READ_MS * TOKENS_PER_MS;
/** Tokens per KV cache block, as in vLLM's default. */
export const BLOCK_TOKENS = 16;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Time to move bytes in one step: the weights once, plus each decoding sequence's KV cache. */
export function memoryMs(decodeSequences: number): number {
  return round(WEIGHT_READ_MS + PER_SEQUENCE_MS * decodeSequences);
}

/** Time to do the math in one step: every decode token and every prompt token. */
export function computeMs(decodeSequences: number, prefillTokens: number): number {
  return round((decodeSequences + prefillTokens) / TOKENS_PER_MS);
}

/**
 * Toy time for one forward pass that decodes `decodeSequences` and prefills `prefillTokens`.
 * Memory traffic and math overlap, so the slower of the two sets the step time (a roofline).
 */
export function stepMs(decodeSequences: number, prefillTokens: number): number {
  if (decodeSequences <= 0 && prefillTokens <= 0) return 0;
  return round(
    STEP_OVERHEAD_MS + Math.max(memoryMs(decodeSequences), computeMs(decodeSequences, prefillTokens)),
  );
}

export interface BatchPoint {
  batch: number;
  stepMs: number;
  tokensPerSecond: number;
  perUserTokensPerSecond: number;
}

export const SWEEP_BATCHES = [1, 8, 32, 128, 256] as const;

export function batchPoint(batch: number): BatchPoint {
  const ms = stepMs(batch, 0);
  return { batch, stepMs: ms, tokensPerSecond: (batch * 1000) / ms, perUserTokensPerSecond: 1000 / ms };
}

export function batchSweep(batches: readonly number[] = SWEEP_BATCHES): BatchPoint[] {
  return batches.map(batchPoint);
}

export interface KvShape {
  layers: number;
  kvHeads: number;
  headDim: number;
  bytesPerValue: number;
}

/** Llama 3 8B: 32 layers, 8 KV heads (grouped-query attention), head size 128, bf16. */
export const LLAMA3_8B: KvShape = { layers: 32, kvHeads: 8, headDim: 128, bytesPerValue: 2 };
/** The same model if every one of its 32 query heads kept its own keys and values. */
export const LLAMA3_8B_NO_GQA: KvShape = { ...LLAMA3_8B, kvHeads: 32 };

/** One key and one value vector per layer per KV head. */
export function kvBytesPerToken(shape: KvShape): number {
  return 2 * shape.layers * shape.kvHeads * shape.headDim * shape.bytesPerValue;
}

export const KIB = 1024;
export const MIB = 1024 * KIB;
export const GIB = 1024 * MIB;

export function tokensThatFit(budgetBytes: number, shape: KvShape): number {
  return Math.floor(budgetBytes / kvBytesPerToken(shape));
}

export function blocksFor(tokens: number): number {
  return Math.ceil(tokens / BLOCK_TOKENS);
}

export interface ServeRequest {
  index: number;
  id: string;
  arrivalMs: number;
  promptTokens: number;
  outputTokens: number;
  long: boolean;
}

export type Policy = 'static' | 'continuous';
export type Allocation = 'reserve' | 'paged';

export interface LaneConfig {
  label: string;
  policy: Policy;
  maxSeqs: number;
  totalBlocks: number;
  allocation: Allocation;
  /** Output tokens a reserve-mode server sets aside for every request at admission. */
  reserveTokens: number;
  /** Tokens per step for chunked prefill, or null to prefill a whole prompt in one step. */
  chunkTokens: number | null;
}

export type CellKind = 'prefill' | 'decode' | 'held' | 'empty';

export interface SlotCell {
  kind: CellKind;
  request: number | null;
}

export interface StepRecord {
  step: number;
  startMs: number;
  endMs: number;
  decodeSequences: number;
  prefillTokens: number;
  tokens: number;
  running: number;
  waiting: number;
  idleWhileWaiting: number;
  slots: SlotCell[];
  usedBlocks: number;
  storedTokens: number;
}

export interface RequestResult {
  index: number;
  id: string;
  arrivalMs: number;
  firstTokenMs: number;
  finishMs: number;
  outputTokens: number;
  preemptions: number;
  long: boolean;
}

export type LaneEventKind =
  | 'batch'
  | 'held'
  | 'join'
  | 'rejoin'
  | 'wait'
  | 'preempt'
  | 'resume'
  | 'arrive'
  | 'first';

export interface LaneEvent {
  step: number;
  atMs: number;
  kind: LaneEventKind;
  text: string;
}

export interface BlockCell {
  owner: number | null;
  tokens: number;
}

export interface RunningSeq {
  req: ServeRequest;
  slot: number;
  phase: 'prefill' | 'decode';
  prefillLeft: number;
  cached: number;
  generated: number;
  blocks: number[];
}

export interface WaitingSeq {
  req: ServeRequest;
  generated: number;
}

function byIndex(a: { req: ServeRequest }, b: { req: ServeRequest }): number {
  return a.req.index - b.req.index;
}

/** One server running one scheduling policy over a fixed list of requests. */
export class ServeLane {
  readonly config: LaneConfig;
  readonly requests: readonly ServeRequest[];
  clockMs = 0;
  steps = 0;
  arrived = 0;
  preemptions = 0;
  recomputedTokens = 0;
  waiting: WaitingSeq[] = [];
  running: RunningSeq[] = [];
  results: RequestResult[] = [];
  history: StepRecord[] = [];
  events: LaneEvent[] = [];
  heldSlots = new Set<number>();
  private free: number[];
  private firstTokenAt = new Map<number, number>();
  private preemptCount = new Map<number, number>();
  private blockedNoted = new Set<number>();
  private batches = 0;

  constructor(config: LaneConfig, requests: readonly ServeRequest[]) {
    this.config = config;
    this.requests = requests;
    this.free = Array.from({ length: config.totalBlocks }, (_, index) => index);
  }

  get done(): boolean {
    return this.results.length === this.requests.length;
  }

  get freeBlocks(): number {
    return this.free.length;
  }

  get usedBlocks(): number {
    return this.config.totalBlocks - this.free.length;
  }

  get storedTokens(): number {
    return this.running.reduce((sum, seq) => sum + seq.cached, 0);
  }

  get outputTokens(): number {
    return this.history.reduce((sum, record) => sum + record.tokens, 0);
  }

  /** Which request owns each block and how many token states it holds. */
  blockMap(): BlockCell[] {
    const cells: BlockCell[] = Array.from({ length: this.config.totalBlocks }, () => ({
      owner: null,
      tokens: 0,
    }));
    for (const seq of this.running) {
      seq.blocks.forEach((block, position) => {
        cells[block] = {
          owner: seq.req.index,
          tokens: Math.max(0, Math.min(BLOCK_TOKENS, seq.cached - position * BLOCK_TOKENS)),
        };
      });
    }
    return cells;
  }

  step(): void {
    if (this.done) return;
    this.pullArrivals();
    if (this.running.length === 0 && this.waiting.length === 0) {
      const next = this.requests[this.arrived];
      if (!next) return;
      this.clockMs = Math.max(this.clockMs, next.arrivalMs);
      this.pullArrivals();
    }
    this.steps += 1;
    const step = this.steps;
    const startMs = this.clockMs;

    const preempted = this.growBlocks(step);
    if (this.config.policy === 'static' && this.running.length === 0) {
      this.heldSlots.clear();
      this.formBatch(step);
    }

    const decoders = this.running.filter((seq) => seq.phase === 'decode');
    let budget = (this.config.chunkTokens ?? Number.POSITIVE_INFINITY) - decoders.length;
    const work = new Map<RunningSeq, number>();
    for (const seq of this.running) {
      if (seq.phase !== 'prefill' || budget <= 0) continue;
      const take = Math.min(seq.prefillLeft, budget);
      work.set(seq, take);
      budget -= take;
    }
    if (this.config.policy === 'continuous' && !preempted) {
      while (budget > 0) {
        const seq = this.admitHead(step);
        if (!seq) break;
        const take = Math.min(seq.prefillLeft, budget);
        work.set(seq, take);
        budget -= take;
      }
    }

    const slots: SlotCell[] = Array.from({ length: this.config.maxSeqs }, (_, slot) => {
      const seq = this.running.find((candidate) => candidate.slot === slot);
      if (seq) {
        if (seq.phase === 'decode') return { kind: 'decode', request: seq.req.index };
        if (work.has(seq)) return { kind: 'prefill', request: seq.req.index };
        return { kind: 'empty', request: seq.req.index };
      }
      return this.heldSlots.has(slot) ? { kind: 'held', request: null } : { kind: 'empty', request: null };
    });
    const idleWhileWaiting =
      this.waiting.length > 0
        ? slots.filter((cell) => cell.kind === 'held' || cell.kind === 'empty').length
        : 0;

    let prefillTokens = 0;
    for (const take of work.values()) prefillTokens += take;
    const duration = stepMs(decoders.length, prefillTokens);
    this.clockMs = round(startMs + duration);

    let tokens = 0;
    for (const seq of decoders) {
      seq.cached += 1;
      seq.generated += 1;
      tokens += 1;
    }
    for (const [seq, take] of work) {
      seq.prefillLeft -= take;
      seq.cached += take;
      if (seq.prefillLeft > 0) continue;
      seq.phase = 'decode';
      seq.generated += 1;
      tokens += 1;
      if (!this.firstTokenAt.has(seq.req.index)) {
        this.firstTokenAt.set(seq.req.index, this.clockMs);
        if (seq.req.long) {
          this.note(
            step,
            'first',
            `${seq.req.id} gets its first token ${formatMs(this.clockMs - seq.req.arrivalMs)} after it arrived.`,
          );
        }
      } else {
        this.note(
          step,
          'resume',
          `${seq.req.id} finished recomputing ${seq.req.promptTokens + seq.generated - 1} tokens and resumes.`,
        );
      }
    }

    this.history.push({
      step,
      startMs,
      endMs: this.clockMs,
      decodeSequences: decoders.length,
      prefillTokens,
      tokens,
      running: this.running.length,
      waiting: this.waiting.length,
      idleWhileWaiting,
      slots,
      usedBlocks: this.usedBlocks,
      storedTokens: this.storedTokens,
    });

    for (const seq of [...this.running]) {
      if (seq.generated >= seq.req.outputTokens) this.finish(seq, step);
    }
  }

  private note(step: number, kind: LaneEventKind, text: string): void {
    this.events.push({ step, atMs: this.clockMs, kind, text });
  }

  private pullArrivals(): void {
    for (;;) {
      const req = this.requests[this.arrived];
      if (!req || req.arrivalMs > this.clockMs) return;
      this.waiting.push({ req, generated: 0 });
      this.arrived += 1;
      if (req.long) {
        this.events.push({
          step: this.steps + 1,
          atMs: req.arrivalMs,
          kind: 'arrive',
          text: `${req.id} arrives with a ${req.promptTokens.toLocaleString('en-US')} token prompt.`,
        });
      }
    }
  }

  private admissionBlocks(entry: WaitingSeq): number {
    if (this.config.allocation === 'reserve') {
      return blocksFor(entry.req.promptTokens + this.config.reserveTokens);
    }
    return blocksFor(entry.req.promptTokens + entry.generated);
  }

  private nextSlot(): number {
    for (let slot = 0; slot < this.config.maxSeqs; slot += 1) {
      if (this.heldSlots.has(slot)) continue;
      if (!this.running.some((seq) => seq.slot === slot)) return slot;
    }
    return -1;
  }

  /** Admits the oldest waiting request if a slot is open and its blocks fit. */
  private admitHead(step: number): RunningSeq | null {
    if (this.running.length >= this.config.maxSeqs) return null;
    const head = this.waiting[0];
    if (!head) return null;
    const slot = this.nextSlot();
    if (slot < 0) return null;
    const need = this.admissionBlocks(head);
    if (need > this.free.length) {
      if (!this.blockedNoted.has(head.req.index)) {
        this.blockedNoted.add(head.req.index);
        const free = this.free.length === 1 ? '1 is free' : `${this.free.length} are free`;
        this.note(step, 'wait', `${head.req.id} waits: it needs ${need} blocks and ${free}.`);
      }
      return null;
    }
    this.waiting.shift();
    const target = head.req.promptTokens + head.generated;
    const seq: RunningSeq = {
      req: head.req,
      slot,
      phase: 'prefill',
      prefillLeft: target,
      cached: 0,
      generated: head.generated,
      blocks: this.free.splice(0, need),
    };
    this.running.push(seq);
    this.running.sort(byIndex);
    if (this.config.policy === 'continuous') {
      if (head.generated > 0) {
        this.note(step, 'rejoin', `${seq.req.id} rejoins slot ${slot + 1} and recomputes ${target} tokens.`);
      } else {
        this.note(
          step,
          'join',
          `${seq.req.id} joins slot ${slot + 1} after waiting ${formatMs(this.clockMs - seq.req.arrivalMs)}.`,
        );
      }
    }
    return seq;
  }

  private formBatch(step: number): void {
    while (this.admitHead(step)) {
      // admitHead moves one request per call
    }
    if (this.running.length === 0) return;
    this.batches += 1;
    const ids = this.running.map((seq) => seq.req.id);
    const text =
      ids.length === 1
        ? `Batch ${this.batches} starts with ${ids[0]} alone. Nobody joins until it finishes.`
        : `Batch ${this.batches} starts with ${joinIds(ids)}. Nobody joins until all of them finish.`;
    this.note(step, 'batch', text);
  }

  /** Gives every decoding sequence room for its next token, preempting the latest arrival when the pool is full. */
  private growBlocks(step: number): boolean {
    let preempted = false;
    for (const seq of [...this.running]) {
      if (seq.phase !== 'decode') continue;
      const need = blocksFor(seq.cached + 1);
      while (seq.blocks.length < need && this.running.includes(seq)) {
        const block = this.free.shift();
        if (block !== undefined) {
          seq.blocks.push(block);
          continue;
        }
        const victim = this.running.at(-1);
        if (!victim) break;
        this.preempt(victim, seq, step);
        preempted = true;
      }
    }
    return preempted;
  }

  private preempt(victim: RunningSeq, needy: RunningSeq, step: number): void {
    this.running = this.running.filter((seq) => seq !== victim);
    this.release(victim.blocks);
    this.preemptions += 1;
    this.preemptCount.set(victim.req.index, (this.preemptCount.get(victim.req.index) ?? 0) + 1);
    const recompute = victim.req.promptTokens + victim.generated;
    this.recomputedTokens += recompute;
    this.waiting.push({ req: victim.req, generated: victim.generated });
    this.waiting.sort(byIndex);
    const reason =
      victim === needy
        ? `${victim.req.id} needed a block, the pool was full, and it was the latest arrival`
        : `${needy.req.id} needed a block and the pool was full`;
    this.note(
      step,
      'preempt',
      `${victim.req.id} preempted: ${reason}. It frees ${victim.blocks.length} blocks and will recompute ${recompute} tokens later.`,
    );
  }

  private release(blocks: number[]): void {
    this.free.push(...blocks);
    this.free.sort((a, b) => a - b);
  }

  private finish(seq: RunningSeq, step: number): void {
    this.running = this.running.filter((candidate) => candidate !== seq);
    this.release(seq.blocks);
    this.results.push({
      index: seq.req.index,
      id: seq.req.id,
      arrivalMs: seq.req.arrivalMs,
      firstTokenMs: this.firstTokenAt.get(seq.req.index) ?? this.clockMs,
      finishMs: this.clockMs,
      outputTokens: seq.req.outputTokens,
      preemptions: this.preemptCount.get(seq.req.index) ?? 0,
      long: seq.req.long,
    });
    if (this.config.policy !== 'static') return;
    const remaining = this.running.filter((candidate) => candidate.generated < candidate.req.outputTokens);
    if (remaining.length === 0) return;
    this.heldSlots.add(seq.slot);
    const longest = remaining.reduce((a, b) =>
      b.req.outputTokens - b.generated > a.req.outputTokens - a.generated ? b : a,
    );
    this.note(
      step,
      'held',
      `${seq.req.id} finished after ${seq.req.outputTokens} tokens. Its slot sits idle until ${longest.req.id} finishes.`,
    );
  }
}

export function formatMs(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} ms`;
}

export function joinIds(ids: string[]): string {
  if (ids.length <= 1) return ids.join('');
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids.slice(0, -1).join(', ')}, and ${ids.at(-1)}`;
}

export interface LaneSummary {
  label: string;
  total: number;
  finished: number;
  arrived: number;
  running: number;
  waiting: number;
  steps: number;
  elapsedMs: number;
  outputTokens: number;
  ttftP50: number;
  ttftP95: number;
  tpotMean: number;
  tokensPerSecond: number;
  tokensPerStep: number;
  idleWhileWaiting: number;
  peakRunning: number;
  meanRunning: number;
  tokenShare: number;
  preemptions: number;
  recomputedTokens: number;
  worstGapMs: number;
  p95GapMs: number;
  longTtft: number | null;
}

export function summarizeLane(lane: ServeLane): LaneSummary {
  const ttfts = lane.results.map((r) => r.firstTokenMs - r.arrivalMs).sort((a, b) => a - b);
  const tpots = lane.results
    .filter((r) => r.outputTokens > 1)
    .map((r) => (r.finishMs - r.firstTokenMs) / (r.outputTokens - 1));
  const gaps: number[] = [];
  for (const record of lane.history) {
    for (let i = 0; i < record.decodeSequences; i += 1) gaps.push(record.endMs - record.startMs);
  }
  gaps.sort((a, b) => a - b);
  const outputTokens = lane.outputTokens;
  const elapsedMs = lane.clockMs;
  const steps = lane.history.length;
  let stored = 0;
  let capacity = 0;
  let runningSum = 0;
  let peakRunning = 0;
  for (const record of lane.history) {
    stored += record.storedTokens;
    capacity += record.usedBlocks * BLOCK_TOKENS;
    runningSum += record.running;
    peakRunning = Math.max(peakRunning, record.running);
  }
  const long = lane.results.find((r) => r.long);
  return {
    label: lane.config.label,
    total: lane.requests.length,
    finished: lane.results.length,
    arrived: lane.arrived,
    running: lane.running.length,
    waiting: lane.waiting.length,
    steps,
    elapsedMs,
    outputTokens,
    ttftP50: percentile(ttfts, 0.5),
    ttftP95: percentile(ttfts, 0.95),
    tpotMean: tpots.length > 0 ? tpots.reduce((a, b) => a + b, 0) / tpots.length : 0,
    tokensPerSecond: elapsedMs > 0 ? (outputTokens * 1000) / elapsedMs : 0,
    tokensPerStep: steps > 0 ? outputTokens / steps : 0,
    idleWhileWaiting: lane.history.reduce((sum, record) => sum + record.idleWhileWaiting, 0),
    peakRunning,
    meanRunning: steps > 0 ? runningSum / steps : 0,
    tokenShare: capacity > 0 ? stored / capacity : 0,
    preemptions: lane.preemptions,
    recomputedTokens: lane.recomputedTokens,
    worstGapMs: gaps.at(-1) ?? 0,
    p95GapMs: percentile(gaps, 0.95),
    longTtft: long ? long.firstTokenMs - long.arrivalMs : null,
  };
}

/** Two servers fed the same pre-generated requests, stepped together. */
export class ServeDuel {
  readonly lanes: [ServeLane, ServeLane];
  readonly length: number;
  ticks = 0;

  constructor(configs: [LaneConfig, LaneConfig], requests: readonly ServeRequest[]) {
    this.lanes = [new ServeLane(configs[0], requests), new ServeLane(configs[1], requests)];
    this.length = Math.max(
      ...configs.map((config) => runToEnd(new ServeLane(config, requests)).history.length),
    );
  }

  get done(): boolean {
    return this.lanes.every((lane) => lane.done);
  }

  step(): void {
    if (this.done) return;
    this.ticks += 1;
    for (const lane of this.lanes) lane.step();
  }
}

export function runToEnd<T extends { done: boolean; step(): void }>(sim: T): T {
  while (!sim.done) sim.step();
  return sim;
}

function makeRequest(
  index: number,
  arrivalMs: number,
  promptTokens: number,
  outputTokens: number,
  long = false,
) {
  return { index, id: `R${index + 1}`, arrivalMs, promptTokens, outputTokens, long };
}

function seededRng(id: string) {
  return createRng(hashString(`llm-serving:${id}:${SEED}`));
}

export type BatchScenarioId = 'mixed' | 'uniform' | 'burst';

export interface Scenario<Id extends string> {
  id: Id;
  label: string;
  diff: string;
}

export const batchScenarios: Record<BatchScenarioId, Scenario<BatchScenarioId>> = {
  mixed: {
    id: 'mixed',
    label: 'Mixed lengths',
    diff: '16 requests over about 0.3 s, answers 3 to 28 tokens',
  },
  uniform: {
    id: 'uniform',
    label: 'Uniform lengths',
    diff: '16 requests in groups of 4, every answer 12 tokens',
  },
  burst: {
    id: 'burst',
    label: 'Burst of arrivals',
    diff: '16 requests at once, answers 3 to 28 tokens',
  },
};

export const BATCH_SLOTS = 4;

function mixedOutput(rng: () => number): number {
  return rng() < 0.3 ? randomInt(rng, 18, 28) : randomInt(rng, 3, 8);
}

export function batchWorkload(id: BatchScenarioId): ServeRequest[] {
  const rng = seededRng(`batch-${id}`);
  const requests: ServeRequest[] = [];
  let at = 0;
  for (let index = 0; index < 16; index += 1) {
    if (id === 'uniform') {
      requests.push(makeRequest(index, Math.floor(index / 4) * 160, randomInt(rng, 4, 8) * 10, 12));
      continue;
    }
    if (id === 'mixed' && index > 0) at += randomInt(rng, 4, 36);
    requests.push(makeRequest(index, at, randomInt(rng, 3, 12) * 10, mixedOutput(rng)));
  }
  return requests;
}

function batchLane(label: string, policy: Policy): LaneConfig {
  return {
    label,
    policy,
    maxSeqs: BATCH_SLOTS,
    totalBlocks: 1024,
    allocation: 'paged',
    reserveTokens: 0,
    chunkTokens: null,
  };
}

export function createBatchDuel(id: BatchScenarioId): ServeDuel {
  return new ServeDuel(
    [batchLane('Static batching', 'static'), batchLane('Continuous batching', 'continuous')],
    batchWorkload(id),
  );
}

export type KvScenarioId = 'chat' | 'squeeze';

export const RESERVE_TOKENS = 128;
export const KV_SEQS = 8;
export const KV_BLOCKS = 48;

export const kvScenarios: Record<KvScenarioId, Scenario<KvScenarioId>> = {
  chat: {
    id: 'chat',
    label: 'Chat traffic',
    diff: `14 requests, answers 16 to 64 tokens, ${KV_BLOCKS} blocks`,
  },
  squeeze: {
    id: 'squeeze',
    label: 'Memory squeeze',
    diff: `10 requests within 0.1 s, answers 80 to 120 tokens, ${KV_BLOCKS} blocks`,
  },
};

export function kvWorkload(id: KvScenarioId): ServeRequest[] {
  const rng = seededRng(`kv-${id}`);
  const requests: ServeRequest[] = [];
  let at = 0;
  if (id === 'chat') {
    for (let index = 0; index < 14; index += 1) {
      if (index > 0) at += randomInt(rng, 5, 40);
      requests.push(makeRequest(index, at, randomInt(rng, 16, 64), randomInt(rng, 16, 64)));
    }
    return requests;
  }
  for (let index = 0; index < 10; index += 1) {
    if (index > 0) at += randomInt(rng, 0, 10);
    requests.push(makeRequest(index, at, randomInt(rng, 16, 48), randomInt(rng, 80, 120)));
  }
  return requests;
}

function continuousLane(
  label: string,
  totalBlocks: number,
  allocation: Allocation,
  chunkTokens: number | null,
): LaneConfig {
  return {
    label,
    policy: 'continuous',
    maxSeqs: KV_SEQS,
    totalBlocks,
    allocation,
    reserveTokens: RESERVE_TOKENS,
    chunkTokens,
  };
}

export function kvLaneConfigs(): [LaneConfig, LaneConfig] {
  return [
    continuousLane('Reserve max length', KV_BLOCKS, 'reserve', null),
    continuousLane('Paged blocks', KV_BLOCKS, 'paged', null),
  ];
}

export function createKvDuel(id: KvScenarioId): ServeDuel {
  return new ServeDuel(kvLaneConfigs(), kvWorkload(id));
}

export const LONG_PROMPT_TOKENS = 1024;
export const CHUNK_BLOCKS = 160;
export const CHUNK_BUDGETS = [64, 256] as const;
export type ChunkBudget = (typeof CHUNK_BUDGETS)[number];

export function chunkWorkload(): ServeRequest[] {
  const rng = seededRng('chunk');
  const requests: ServeRequest[] = [];
  let at = 0;
  for (let index = 0; index < 6; index += 1) {
    if (index > 0) at += randomInt(rng, 0, 6);
    requests.push(makeRequest(index, at, randomInt(rng, 16, 48), randomInt(rng, 60, 90)));
  }
  requests.push(makeRequest(6, 150, LONG_PROMPT_TOKENS, 16, true));
  requests.push(makeRequest(7, 260, randomInt(rng, 16, 48), randomInt(rng, 30, 50)));
  return requests;
}

export function chunkLaneConfigs(budget: ChunkBudget): [LaneConfig, LaneConfig] {
  return [
    continuousLane('Whole prompt in one step', CHUNK_BLOCKS, 'paged', null),
    continuousLane(`Chunked prefill, ${budget} tokens per step`, CHUNK_BLOCKS, 'paged', budget),
  ];
}

export function createChunkDuel(budget: ChunkBudget): ServeDuel {
  return new ServeDuel(chunkLaneConfigs(budget), chunkWorkload());
}
