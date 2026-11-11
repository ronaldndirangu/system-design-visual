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
  PER_SEQUENCE_MS,
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

  it('grows prefill time with prompt length', () => {
    expect(stepMs(0, 0)).toBe(0);
    expect(stepMs(0, 100)).toBe(20);
    expect(stepMs(0, 1000)).toBe(110);
    expect(stepMs(4, 0)).toBe(10.6);
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
      elapsedMs: 1047,
      outputTokens: 159,
      ttftP50: 249,
      ttftP95: 650,
      tpotMean: 10.45,
      tokensPerSecond: 152,
      tokensPerStep: 1.79,
      idleWhileWaiting: 179,
    });
    expect(pin(cont)).toMatchObject({
      steps: 47,
      elapsedMs: 627,
      outputTokens: 159,
      ttftP50: 57,
      ttftP95: 222,
      tpotMean: 12.22,
      tokensPerSecond: 253,
      tokensPerStep: 3.38,
      idleWhileWaiting: 0,
    });
  });

  it('ties when every answer has the same length and requests arrive in batch-sized groups', () => {
    const [stat, cont] = finishedPair(createBatchDuel('uniform'));
    expect(pin(stat)).toEqual(pin(cont));
    expect(pin(stat)).toMatchObject({ steps: 48, elapsedMs: 632, tokensPerStep: 4, idleWhileWaiting: 0 });
  });

  it('pins the burst numbers quoted in the lesson', () => {
    const [stat, cont] = finishedPair(createBatchDuel('burst'));
    expect(pin(stat)).toMatchObject({
      elapsedMs: 1053,
      ttftP95: 777,
      tokensPerStep: 2.08,
      idleWhileWaiting: 104,
    });
    expect(pin(cont)).toMatchObject({
      elapsedMs: 803,
      ttftP95: 528,
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
      elapsedMs: 1922,
      outputTokens: 582,
      ttftP50: 299,
      ttftP95: 1073,
      peakRunning: 4,
      tokenSharePct: 34.3,
      preemptions: 0,
    });
    expect(pin(paged)).toMatchObject({
      elapsedMs: 1162,
      outputTokens: 582,
      ttftP50: 25,
      ttftP95: 313,
      peakRunning: 8,
      tokenSharePct: 88.9,
      preemptions: 0,
    });
  });

  it('pins the memory squeeze numbers and preempts the latest arrival first', () => {
    const duel = createKvDuel('squeeze');
    const [reserve, paged] = finishedPair(duel);
    expect(pin(reserve)).toMatchObject({
      elapsedMs: 3164,
      ttftP50: 858,
      peakRunning: 4,
      tokenSharePct: 47.5,
      preemptions: 0,
    });
    expect(pin(paged)).toMatchObject({
      elapsedMs: 2262,
      ttftP50: 28,
      peakRunning: 8,
      tokenSharePct: 91.3,
      preemptions: 2,
      recomputedTokens: 183,
    });
    const preempts = duel.lanes[1].events.filter((event) => event.kind === 'preempt');
    expect(preempts.map((event) => [event.step, event.text.split(' ')[0]])).toEqual([
      [65, 'R8'],
      [79, 'R7'],
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

  it('flattens the decode stall and delays the first token of the long prompt, more so for small chunks', () => {
    const smallDuel = createChunkDuel(64);
    const largeDuel = createChunkDuel(256);
    const [whole, small] = finishedPair(smallDuel);
    const [, large] = finishedPair(largeDuel);
    expect(pin(whole)).toMatchObject({ elapsedMs: 1104, worstGapMs: 113.3, p95GapMs: 11.2, longTtft: 120 });
    expect(pin(small)).toMatchObject({ elapsedMs: 1104, worstGapMs: 16.7, p95GapMs: 16.7, longTtft: 307 });
    expect(pin(large)).toMatchObject({ elapsedMs: 1104, worstGapMs: 35.9, p95GapMs: 35.9, longTtft: 167 });
    const r8Ttft = (lane: ServeLane) => {
      const result = lane.results.find((r) => r.id === 'R8');
      return result ? Math.round(result.firstTokenMs - result.arrivalMs) : null;
    };
    expect([r8Ttft(smallDuel.lanes[0]), r8Ttft(smallDuel.lanes[1]), r8Ttft(largeDuel.lanes[1])]).toEqual([
      25, 209, 57,
    ]);
  });
});
