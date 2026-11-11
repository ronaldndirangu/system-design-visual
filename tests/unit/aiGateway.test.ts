import { describe, expect, it } from 'vitest';
import {
  accountedFor,
  buildArrivals,
  cacheRequests,
  finishedGateway,
  type GatewayScenarioId,
  GatewaySim,
  gatewayScenarioOrder,
  type KeyField,
  keyFieldOrder,
  prefixCacheResult,
  RUN_TICKS,
  runResponseCache,
  tenantOrder,
} from '../../src/lib/models/aiGateway';

describe('GatewaySim', () => {
  it('accounts for every arrival at every tick: served, shed, failed, or in flight', () => {
    for (const scenario of gatewayScenarioOrder) {
      for (const policies of [false, true]) {
        const sim = new GatewaySim(scenario, policies);
        while (!sim.done) {
          sim.step();
          for (const tenant of tenantOrder) {
            const tally = sim.tallies[tenant];
            expect(accountedFor(tally)).toBe(tally.arrived);
          }
        }
        expect(sim.total.inFlight).toBe(0);
        expect(sim.ticks).toBeGreaterThanOrEqual(RUN_TICKS);
      }
    }
  });

  it('replays the same run for the same seed, and a fresh run is a clean reset', () => {
    const played = finishedGateway('outage', true);
    const fresh = new GatewaySim('outage', true);
    expect(fresh.ticks).toBe(0);
    expect(fresh.total.arrived).toBe(0);
    while (!fresh.done) fresh.step();
    expect(fresh.tallies).toEqual(played.tallies);
    expect(fresh.events).toEqual(played.events);
  });

  it('sends Store B the same requests in every scenario, with or without policies', () => {
    const storeB = (scenario: GatewayScenarioId) =>
      buildArrivals(scenario)
        .flat()
        .filter((call) => call.tenant === 'b')
        .map((call) => `${call.id}@${call.arrivalTick}`)
        .sort();
    expect(storeB('noisy')).toEqual(storeB('outage'));
    expect(storeB('noisy')).toEqual(storeB('malformed'));
  });

  it('never hits the shared rate limit with policies on, because store quotas sum to it', () => {
    for (const scenario of gatewayScenarioOrder) {
      expect(finishedGateway(scenario, true).total.rateLimited).toBe(0);
    }
  });
});

describe('pinned gateway scenarios, seed 42', () => {
  it('noisy tenant: without quotas Store B fails; with quotas only Store A is shed', () => {
    const off = finishedGateway('noisy', false);
    const on = finishedGateway('noisy', true);
    expect(off.total).toMatchObject({ arrived: 617, rateLimited: 217 });
    expect(off.tallies.b).toMatchObject({ arrived: 98, rateLimited: 27 });
    expect(on.tallies.a).toMatchObject({ arrived: 428, quota: 261 });
    expect(on.tallies.b).toMatchObject({ arrived: 98, quota: 0, rateLimited: 0, primary: 81, cache: 17 });
    expect(on.tallies.c.quota).toBe(0);
  });

  it('model outage: the breaker sends traffic to Small and nobody gets an error', () => {
    const off = finishedGateway('outage', false);
    const on = finishedGateway('outage', true);
    expect(off.total).toMatchObject({ arrived: 311, outage: 82 });
    expect(off.tallies.b.outage).toBe(30);
    expect(on.total).toMatchObject({ arrived: 311, fallback: 108, outage: 0, handoff: 0 });
    expect(on.breakerOpens).toBe(3);
    expect(on.breaker).toBe('closed');
    const texts = on.events.map((e) => e.text).join(' ');
    expect(texts).toContain('half open');
    expect(texts).toContain('breaker closes');
  });

  it('malformed output: the validator retries once against quota, then hands off', () => {
    const off = finishedGateway('malformed', false);
    const on = finishedGateway('malformed', true);
    expect(off.total).toMatchObject({ arrived: 311, malformed: 61 });
    expect(on.total).toMatchObject({ arrived: 311, malformed: 0, handoff: 9 });
    expect(on.retries).toBe(48);
  });
});

describe('response cache keys', () => {
  const wrongHits = (fields: readonly KeyField[]) =>
    runResponseCache(fields)
      .filter((r) => r.outcome === 'wrongHit')
      .map((r) => [r.request.step, r.from, r.reason]);

  it('serves one correct hit and no wrong answers when the key has every field', () => {
    const results = runResponseCache(keyFieldOrder);
    expect(results.map((r) => r.outcome)).toEqual(['miss', 'hit', ...Array(7).fill('miss')]);
    expect(results.every((r) => r.served === r.request.answer)).toBe(true);
  });

  it('shows exactly one wrong hit for each dropped field', () => {
    const expected: Record<KeyField, [number, number, KeyField]> = {
      tenant: [3, 1, 'tenant'],
      role: [5, 4, 'role'],
      promptVersion: [6, 1, 'promptVersion'],
      model: [8, 7, 'model'],
      settings: [9, 6, 'settings'],
    };
    for (const field of keyFieldOrder) {
      expect(wrongHits(keyFieldOrder.filter((f) => f !== field))).toEqual([expected[field]]);
    }
  });

  it('leaks Store A’s answer to Store B when the store is missing from the key', () => {
    const leak = runResponseCache(['role', 'promptVersion', 'model', 'settings'])[2];
    expect(leak?.request.tenant).toBe('b');
    expect(leak?.served).toBe(cacheRequests[0]?.answer);
  });
});

describe('prefix cache', () => {
  const base = { secondStore: 'same', timestampFirst: false, salt: false, prefixCache: true } as const;

  it('reuses the shared system prompt and store policy, then computes the rest', () => {
    const result = prefixCacheResult(base);
    expect(result.blocks).toHaveLength(25);
    expect(result.reusedBlocks).toBe(22);
    expect(result.computedTokens).toBe(48);
    expect(result.ttftSeconds).toBeCloseTo(0.13, 6);
    expect(result.coldTtftSeconds).toBeCloseTo(0.35, 6);
  });

  it('stops reuse at the first changed block, and a salt keeps stores apart', () => {
    expect(prefixCacheResult({ ...base, prefixCache: false }).reusedBlocks).toBe(0);
    expect(prefixCacheResult({ ...base, secondStore: 'other' })).toMatchObject({
      reusedBlocks: 10,
      ttftSeconds: 0.25,
    });
    expect(prefixCacheResult({ ...base, secondStore: 'other', salt: true }).reusedBlocks).toBe(0);
    expect(prefixCacheResult({ ...base, salt: true }).reusedBlocks).toBe(22);
    expect(prefixCacheResult({ ...base, timestampFirst: true }).reusedBlocks).toBe(0);
  });

  it('reuses only a leading run of blocks', () => {
    const { blocks } = prefixCacheResult({ ...base, secondStore: 'other' });
    const firstComputed = blocks.findIndex((b) => !b.reused);
    expect(blocks.slice(firstComputed).some((b) => b.reused)).toBe(false);
  });
});
