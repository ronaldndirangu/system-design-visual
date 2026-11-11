import { describe, expect, it } from 'vitest';
import {
  type BatchScenarioId,
  BLOCK_TOKENS,
  batchScenarios,
  batchSweep,
  blocksFor,
  CHUNK_BUDGETS,
  chunkLaneConfigs,
  chunkWorkload,
  computeMs,
  createBatchDuel,
  createChunkDuel,
  createKvDuel,
  GIB,
  KIB,
  type KvScenarioId,
  kvBytesPerToken,
  kvScenarios,
  type LaneSummary,
  LLAMA3_8B,
  LLAMA3_8B_NO_GQA,
  MIB,
  memoryMs,
  PER_SEQUENCE_MS,
  RIDGE_TOKENS,
  runToEnd,
  type ServeDuel,
  ServeLane,
  stepMs,
  summarizeLane,
  tokensThatFit,
} from '../../src/lib/models/llmServing';

const batchIds = Object.keys(batchScenarios) as BatchScenarioId[];
const kvIds = Object.keys(kvScenarios) as KvScenarioId[];

function allDuels(): Array<[string, () => ServeDuel]> {
  return [
    ...batchIds.map((id): [string, () => ServeDuel] => [`batch ${id}`, () => createBatchDuel(id)]),
    ...kvIds.map((id): [string, () => ServeDuel] => [`kv ${id}`, () => createKvDuel(id)]),
    ...CHUNK_BUDGETS.map((budget): [string, () => ServeDuel] => [
      `chunk ${budget}`,
      () => createChunkDuel(budget),
    ]),
  ];
}

function finishedPair(duel: ServeDuel): [LaneSummary, LaneSummary] {
  runToEnd(duel);
  const [a, b] = duel.lanes;
  return [summarizeLane(a), summarizeLane(b)];
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function pin(s: LaneSummary) {
  return {
    steps: s.steps,
    elapsedMs: Math.round(s.elapsedMs),
    outputTokens: s.outputTokens,
    ttftP50: Math.round(s.ttftP50),
    ttftP95: Math.round(s.ttftP95),
    tpotMean: round(s.tpotMean, 2),
    tokensPerSecond: Math.round(s.tokensPerSecond),
    tokensPerStep: round(s.tokensPerStep, 2),
    idleWhileWaiting: s.idleWhileWaiting,
    peakRunning: s.peakRunning,
    tokenSharePct: round(s.tokenShare * 100, 1),
    preemptions: s.preemptions,
    recomputedTokens: s.recomputedTokens,
    worstGapMs: round(s.worstGapMs, 1),
    p95GapMs: round(s.p95GapMs, 1),
    longTtft: s.longTtft === null ? null : Math.round(s.longTtft),
  };
}

describe('toy step cost', () => {
  it('charges one weight read per step, so batching raises throughput much faster than step time', () => {
    const sweep = batchSweep();
    expect(sweep.map((point) => point.stepMs)).toEqual([10.15, 11.2, 14.8, 29.2, 48.4]);
    expect(sweep.map((point) => Math.round(point.tokensPerSecond))).toEqual([99, 714, 2162, 4384, 5289]);
    const [one, , , big] = sweep;
    if (!one || !big) throw new Error('expected sweep points');
    expect(round(big.stepMs / one.stepMs, 1)).toBe(2.9);
    expect(Math.round(big.tokensPerSecond / one.tokensPerSecond)).toBe(44);
  });

  it('flattens the gain as the batch grows and never passes the per-sequence ceiling', () => {
    const sweep = batchSweep([1, 2, 4, 8, 16, 32, 64, 128, 256, 512]);
    for (let i = 1; i < sweep.length; i += 1) {
      const prev = sweep[i - 1];
      const next = sweep[i];
      if (!prev || !next) throw new Error('expected sweep points');
      expect(next.tokensPerSecond).toBeGreaterThan(prev.tokensPerSecond);
      expect(next.perUserTokensPerSecond).toBeLessThan(prev.perUserTokensPerSecond);
      expect(next.tokensPerSecond / prev.tokensPerSecond).toBeLessThan(2);
      expect(next.tokensPerSecond).toBeLessThan(1000 / PER_SEQUENCE_MS);
    }
    expect(Math.round(1000 / PER_SEQUENCE_MS)).toBe(6667);
  });

  it('prices a step by its slower resource: the weight read or the math', () => {
    expect(stepMs(0, 0)).toBe(0);
    expect(stepMs(0, 100)).toBe(10);
    expect(stepMs(0, 1000)).toBe(33.25);
    expect(stepMs(4, 0)).toBe(10.6);
  });

  it('crosses from memory bound to compute bound at the 256-token ridge', () => {
    expect(RIDGE_TOKENS).toBe(256);
    expect(computeMs(0, RIDGE_TOKENS)).toBe(memoryMs(0));
    for (const prompt of [1, 64, 128, 255, 256]) expect(stepMs(0, prompt)).toBe(10);
    expect(stepMs(0, 257)).toBeGreaterThan(stepMs(0, 256));
    expect(stepMs(0, 512)).toBe(18);
    expect(stepMs(0, 1024)).toBe(34);
    for (let decoders = 1; decoders <= 512; decoders += 1) {
      expect(stepMs(decoders, 0)).toBe(round(2 + memoryMs(decoders), 6));
    }
  });

  it('lets a prompt chunk below the ridge ride on a decode step for free', () => {
    expect(stepMs(8, 248)).toBe(stepMs(8, 0));
    expect(stepMs(8, 1024)).toBeGreaterThan(3 * stepMs(8, 0));
  });
});

describe('KV cache arithmetic', () => {
  it('matches the Llama 3 8B worked example', () => {
    expect(kvBytesPerToken(LLAMA3_8B)).toBe(131_072);
    expect(kvBytesPerToken(LLAMA3_8B)).toBe(128 * KIB);
    expect(kvBytesPerToken(LLAMA3_8B_NO_GQA)).toBe(512 * KIB);
    expect(8192 * kvBytesPerToken(LLAMA3_8B)).toBe(GIB);
    expect(BLOCK_TOKENS * kvBytesPerToken(LLAMA3_8B)).toBe(2 * MIB);
    expect(tokensThatFit(20 * GIB, LLAMA3_8B)).toBe(163_840);
    expect(tokensThatFit(20 * GIB, LLAMA3_8B_NO_GQA)).toBe(40_960);
  });

  it('rounds blocks up to whole 16-token blocks', () => {
    expect(blocksFor(1)).toBe(1);
    expect(blocksFor(16)).toBe(1);
    expect(blocksFor(17)).toBe(2);
  });
});

describe('ServeDuel', () => {
  it.each(allDuels())('replays %s identically, so reset is a rebuild', (_name, create) => {
    const played = runToEnd(create());
    const again = runToEnd(create());
    const fresh = create();
    expect(fresh.ticks).toBe(0);
    expect(fresh.lanes.every((lane) => lane.history.length === 0 && lane.results.length === 0)).toBe(true);
    for (const [index, lane] of played.lanes.entries()) {
      const other = again.lanes[index];
      if (!other) throw new Error('expected two lanes');
      expect(other.history).toEqual(lane.history);
      expect(other.results).toEqual(lane.results);
      expect(other.events).toEqual(lane.events);
    }
    expect(played.ticks).toBe(played.length);
  });

  it.each(allDuels())('conserves requests and KV blocks at every step of %s', (_name, create) => {
    const duel = create();
    for (const lane of duel.lanes) {
      const total = lane.config.totalBlocks;
      let guard = 0;
      while (!lane.done && guard < 5000) {
        guard += 1;
        lane.step();
        expect(lane.arrived).toBe(lane.results.length + lane.running.length + lane.waiting.length);
        expect(lane.usedBlocks + lane.freeBlocks).toBe(total);
        const owned = lane.blockMap().filter((cell) => cell.owner !== null);
        expect(owned.length).toBe(lane.usedBlocks);
        const runningIds = new Set(lane.running.map((seq) => seq.req.index));
        expect(owned.every((cell) => cell.owner !== null && runningIds.has(cell.owner))).toBe(true);
        expect(lane.running.length).toBeLessThanOrEqual(lane.config.maxSeqs);
        expect(lane.storedTokens).toBeLessThanOrEqual(lane.usedBlocks * BLOCK_TOKENS);
      }
      expect(lane.done).toBe(true);
      expect(lane.usedBlocks).toBe(0);
      const wanted = lane.requests.reduce((sum, req) => sum + req.outputTokens, 0);
      expect(lane.outputTokens).toBe(wanted);
      expect(lane.results.map((r) => r.index).sort((a, b) => a - b)).toEqual(
        lane.requests.map((r) => r.index),
      );
    }
  });
});

describe('static versus continuous batching', () => {
  it('pins the mixed-lengths numbers quoted in the lesson', () => {
    const [stat, cont] = finishedPair(createBatchDuel('mixed'));
    expect(pin(stat)).toMatchObject({
      steps: 89,
      elapsedMs: 920,
      outputTokens: 159,
      ttftP50: 201,
      ttftP95: 523,
      tpotMean: 10.45,
      tokensPerSecond: 173,
      tokensPerStep: 1.79,
      idleWhileWaiting: 179,
    });
    expect(pin(cont)).toMatchObject({
      steps: 50,
      elapsedMs: 521,
      outputTokens: 159,
      ttftP50: 17,
      ttftP95: 96,
      tpotMean: 10.49,
      tokensPerSecond: 305,
      tokensPerStep: 3.18,
      idleWhileWaiting: 0,
    });
  });

  it('ties when every answer has the same length and requests arrive in batch-sized groups', () => {
    const [stat, cont] = finishedPair(createBatchDuel('uniform'));
    expect(pin(stat)).toEqual(pin(cont));
    expect(pin(stat)).toMatchObject({ steps: 48, elapsedMs: 607, tokensPerStep: 4, idleWhileWaiting: 0 });
  });

  it('pins the burst numbers quoted in the lesson', () => {
    const [stat, cont] = finishedPair(createBatchDuel('burst'));
    expect(pin(stat)).toMatchObject({
      elapsedMs: 941,
      ttftP95: 665,
      tokensPerStep: 2.08,
      idleWhileWaiting: 104,
    });
    expect(pin(cont)).toMatchObject({
      elapsedMs: 686,
      ttftP95: 411,
      tokensPerStep: 2.86,
      idleWhileWaiting: 0,
    });
  });

  it('never lets a request join a static batch until the whole batch finishes', () => {
    const lane = createBatchDuel('mixed').lanes[0];
    while (!lane.done) {
      const before = new Set(lane.running.map((seq) => seq.req.index));
      lane.step();
      const joined = lane.running.filter((seq) => !before.has(seq.req.index));
      if (joined.length > 0) expect(before.size).toBe(0);
    }
    expect(lane.events.some((event) => event.kind === 'held')).toBe(true);
    expect(lane.events.some((event) => event.kind === 'join')).toBe(false);
    expect(lane.history.some((record) => record.slots.some((cell) => cell.kind === 'held'))).toBe(true);
  });
});

describe('KV cache allocation', () => {
  it('pins the chat traffic numbers quoted in the lesson', () => {
    const [reserve, paged] = finishedPair(createKvDuel('chat'));
    expect(pin(reserve)).toMatchObject({
      elapsedMs: 1865,
      outputTokens: 582,
      ttftP50: 269,
      ttftP95: 1016,
      peakRunning: 4,
      tokenSharePct: 34.3,
      preemptions: 0,
    });
    expect(pin(paged)).toMatchObject({
      elapsedMs: 1135,
      outputTokens: 582,
      ttftP50: 19,
      ttftP95: 277,
      peakRunning: 8,
      tokenSharePct: 88.9,
      preemptions: 0,
    });
  });

  it('pins the memory squeeze numbers and preempts the latest arrival first', () => {
    const duel = createKvDuel('squeeze');
    const [reserve, paged] = finishedPair(duel);
    expect(pin(reserve)).toMatchObject({
      elapsedMs: 3134,
      ttftP50: 843,
      peakRunning: 4,
      tokenSharePct: 47.5,
      preemptions: 0,
    });
    expect(pin(paged)).toMatchObject({
      elapsedMs: 2214,
      ttftP50: 16,
      peakRunning: 8,
      tokenSharePct: 91.3,
      preemptions: 2,
      recomputedTokens: 183,
    });
    const preempts = duel.lanes[1].events.filter((event) => event.kind === 'preempt');
    expect(preempts.map((event) => [event.step, event.text.split(' ')[0]])).toEqual([
      [66, 'R8'],
      [80, 'R7'],
    ]);
    const hit = duel.lanes[1].results.filter((r) => r.preemptions > 0).map((r) => r.id);
    expect(hit.sort()).toEqual(['R7', 'R8']);
  });

  it('admits a reserve-mode request only when prompt plus reserved output fits', () => {
    const lane = createKvDuel('chat').lanes[0];
    runToEnd(lane);
    const waits = lane.events.filter((event) => event.kind === 'wait');
    expect(waits.length).toBeGreaterThan(0);
    expect(waits[0]?.text).toBe('R5 waits: it needs 10 blocks and 3 are free.');
  });
});

describe('chunked prefill', () => {
  it('keeps every chunked step inside its token budget', () => {
    for (const budget of CHUNK_BUDGETS) {
      const lane = runToEnd(new ServeLane(chunkLaneConfigs(budget)[1], chunkWorkload()));
      for (const record of lane.history) {
        expect(record.decodeSequences + record.prefillTokens).toBeLessThanOrEqual(budget);
      }
    }
  });

  it('keeps decode gaps flat with chunks up to the ridge, and a smaller chunk only delays first tokens', () => {
    const smallDuel = createChunkDuel(64);
    const largeDuel = createChunkDuel(256);
    const [whole, small] = finishedPair(smallDuel);
    const [, large] = finishedPair(largeDuel);
    expect(pin(whole)).toMatchObject({ elapsedMs: 1004, worstGapMs: 34.2, p95GapMs: 11.2, longTtft: 35 });
    expect(pin(small)).toMatchObject({ elapsedMs: 981, worstGapMs: 11.2, p95GapMs: 11.2, longTtft: 197 });
    expect(pin(large)).toMatchObject({ elapsedMs: 981, worstGapMs: 11.2, p95GapMs: 11.2, longTtft: 55 });
    expect(large.longTtft).toBeLessThan(small.longTtft ?? 0);
    const r8Ttft = (lane: ServeLane) => {
      const result = lane.results.find((r) => r.id === 'R8');
      return result ? Math.round(result.firstTokenMs - result.arrivalMs) : null;
    };
    expect([r8Ttft(smallDuel.lanes[0]), r8Ttft(smallDuel.lanes[1]), r8Ttft(largeDuel.lanes[1])]).toEqual([
      13, 98, 11,
    ]);
  });
});
