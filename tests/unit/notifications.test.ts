import { describe, expect, it } from 'vitest';
import {
  BACKOFF_CAP_SECONDS,
  backoffTicks,
  CODES,
  DEADLINE_SECONDS,
  duelScenarioIds,
  makeCodes,
  NotifDuel,
  type NotifScenarioId,
  notificationsEstimates,
  notifScenarios,
  oldestWaitSeconds,
  queueView,
  summarize,
  TICK_SECONDS,
  tileView,
} from '../../src/lib/models/notifications';

function run(duel: NotifDuel): NotifDuel {
  while (!duel.done) duel.step();
  return duel;
}

function finished(id: NotifScenarioId, seed = 42) {
  const duel = run(new NotifDuel(notifScenarios[id], seed));
  return { duel, a: summarize(duel.lanes[0], duel.codes), b: summarize(duel.lanes[1], duel.codes) };
}

function eventLines(duel: NotifDuel): string[] {
  return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
}

const allIds = Object.keys(notifScenarios) as NotifScenarioId[];
const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
const deadlineTicks = Math.round(DEADLINE_SECONDS / TICK_SECONDS);

describe('notifications workload', () => {
  it('numbers every code in request order with a 5 s deadline', () => {
    const codes = makeCodes(42);
    expect(codes).toHaveLength(CODES);
    expect(codes.map((code) => code.id)).toEqual(Array.from({ length: CODES }, (_, id) => id));
    for (let id = 1; id < CODES; id += 1) {
      expect(codes[id]?.arrival).toBeGreaterThanOrEqual(codes[id - 1]?.arrival ?? 0);
    }
    for (const code of codes) expect(code.deadline - code.arrival).toBe(deadlineTicks);
    expect(Math.max(...codes.map((code) => code.deadline))).toBeLessThan(300);
  });

  it('shares the codes across every scenario', () => {
    const first = new NotifDuel(notifScenarios.campaign, 9).codes;
    for (const id of allIds) expect(new NotifDuel(notifScenarios[id], 9).codes).toEqual(first);
  });

  it('lists each duel scenario once', () => {
    expect([...duelScenarioIds.deadline, ...duelScenarioIds.outage].sort()).toEqual([...allIds].sort());
  });

  it('doubles the retry delay from 0.5 s and caps it at 4 s', () => {
    expect([1, 2, 3, 4, 5, 6].map((failures) => backoffTicks(failures) * TICK_SECONDS)).toEqual([
      0.5,
      1,
      2,
      4,
      BACKOFF_CAP_SECONDS,
      BACKOFF_CAP_SECONDS,
    ]);
  });
});

describe('notifications duel', () => {
  it('replays the same seed exactly', () => {
    for (const id of allIds) {
      const first = finished(id, 7);
      const second = finished(id, 7);
      expect(second.duel.checkpoint()).toEqual(first.duel.checkpoint());
      expect(second.a).toEqual(first.a);
      expect(second.b).toEqual(first.b);
    }
  });

  it('accounts for every code and every marketing message on every tick', () => {
    for (const id of allIds) {
      const duel = new NotifDuel(notifScenarios[id], 42);
      while (!duel.done) {
        duel.step();
        const arrived = duel.codes.filter((code) => code.arrival < duel.ticks).length;
        const campaign = duel.campaignTick >= 0 && duel.ticks > duel.campaignTick ? duel.campaignSize : 0;
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel.codes);
          expect(sum.requested).toBe(arrived);
          expect(sum.onTime + sum.late + sum.expired + sum.pending).toBe(arrived);
          expect(sum.marketingSent + sum.marketingQueued).toBe(campaign);
          expect(lane.state.series.at(-1)).toBe(sum.missed);
        }
      }
    }
  });

  it('sends or drops every code by the end of the run', () => {
    for (const id of allIds) {
      const { a, b } = finished(id);
      for (const sum of [a, b]) {
        expect(sum.requested).toBe(CODES);
        expect(sum.pending).toBe(0);
        expect(sum.marketingQueued).toBe(0);
      }
    }
  });

  it('never sends a code late or drops one in the priority lane during a campaign', () => {
    for (const seed of seeds) {
      for (const id of ['campaign', 'double-rate'] as const) {
        const { a, b } = finished(id, seed);
        expect(b.missed).toBe(0);
        expect(a.late).toBeGreaterThan(0);
        expect(a.expired).toBe(0);
        expect(b.campaignDoneSeconds).toBeGreaterThanOrEqual(a.campaignDoneSeconds);
      }
    }
  });

  it('keeps every code on time with failover while retries alone lose codes', () => {
    for (const seed of seeds) {
      for (const id of ['sms-outage', 'long-outage'] as const) {
        const { a, b } = finished(id, seed);
        expect(b.missed).toBe(0);
        expect(b.viaBackup).toBeGreaterThan(0);
        expect(a.expired).toBeGreaterThan(0);
        expect(a.late).toBe(0);
        expect(a.failedSends).toBeGreaterThan(b.failedSends);
      }
    }
  });

  it('runs the two lanes identically without a campaign or an outage', () => {
    for (const seed of seeds) {
      for (const id of ['no-campaign', 'no-outage'] as const) {
        const { duel, a, b } = finished(id, seed);
        expect(b).toEqual(a);
        expect(duel.lanes[1].state.series).toEqual(duel.lanes[0].state.series);
        expect(duel.events.every((event) => !event.marker)).toBe(true);
      }
    }
  });

  it('pins the numbers the lesson quotes', () => {
    const campaign = finished('campaign');
    expect([campaign.a.late, campaign.a.missed, campaign.b.missed]).toEqual([28, 28, 0]);
    expect([campaign.a.averageWaitSeconds, campaign.b.averageWaitSeconds]).toEqual([5.2, 0]);
    expect([campaign.a.campaignDoneSeconds, campaign.b.campaignDoneSeconds]).toEqual([17, 19.1]);

    const doubled = finished('double-rate');
    expect([doubled.a.missed, doubled.b.missed]).toEqual([5, 0]);
    expect([doubled.a.campaignDoneSeconds, doubled.b.campaignDoneSeconds]).toEqual([9.5, 10]);

    const outage = finished('sms-outage');
    expect([outage.a.expired, outage.b.missed]).toEqual([15, 0]);
    expect([outage.a.failedSends, outage.b.failedSends]).toEqual([85, 3]);
    expect(outage.b.viaBackup).toBe(27);

    const long = finished('long-outage');
    expect([long.a.expired, long.b.missed]).toEqual([42, 0]);
    expect([long.a.failedSends, long.b.failedSends]).toEqual([177, 3]);
    expect(long.b.viaBackup).toBe(45);
  });

  it('pins the illustrative estimates', () => {
    expect(notificationsEstimates()).toEqual({
      notificationsPerDay: 100_000_000,
      averagePerSecond: 1157,
      peakPerSecond: 3472,
      codesPerSecond: 23,
      campaignDrainMinutes: 42,
      storageGigabytesPerDay: 50,
    });
    expect(notificationsEstimates({ providerSendsPerSecond: 20_000 }).campaignDrainMinutes).toBe(4);
  });

  it('writes the transcript the lesson describes', () => {
    expect(eventLines(finished('campaign').duel)).toEqual([
      '2.0 A marketing campaign drops 300 messages into the queue at once.',
      '2.2 Priority lane for codes: code 9 skips past 298 marketing messages and goes out at once.',
      '7.2 One shared queue: code 9 has waited 5 s, its whole lifetime. It is useless now, and the queue will still send it.',
      '30.0 Run ends. Codes that missed the 5 s deadline: one shared queue 28, priority lane for codes 0. Last campaign message sent: one shared queue 17.0 s, priority lane for codes 19.1 s.',
    ]);
    expect(eventLines(finished('sms-outage').duel)).toEqual([
      '5.0 The primary SMS provider starts rejecting every send.',
      '5.9 Fail over to a backup: 3 sends in a row fail, so the circuit breaker opens and codes go to the backup provider.',
      '10.1 Retry the same provider: code 16 reaches its 5 s deadline after 4 failed sends, so the lane drops it. The user never gets a code.',
      '15.0 The primary SMS provider recovers.',
      '15.9 Fail over to a backup: a health check reaches the primary, so the breaker closes and codes go back to it.',
      '30.0 Run ends. Codes that missed the 5 s deadline: retry the same provider 15, fail over to a backup 0. The backup carried 27 codes.',
    ]);
  });

  it('shows the queue in the order each lane drains it', () => {
    const duel = new NotifDuel(notifScenarios.campaign, 42);
    while (duel.ticks < 30) duel.step();
    const [shared, priority] = duel.lanes;
    const sharedView = queueView(shared, 8);
    const priorityView = queueView(priority, 8);
    expect(sharedView.marketing).toBeGreaterThan(200);
    expect(sharedView.nextCodePlace).toBeGreaterThan(200);
    expect(sharedView.head.every((entry) => entry === 'marketing')).toBe(true);
    expect(priorityView.codes === 0 || priorityView.nextCodePlace === 1).toBe(true);
    expect(queueView(shared, 8).head).toHaveLength(8);
    expect(oldestWaitSeconds(shared, duel.codes, duel.ticks)).toBeGreaterThan(0);
    expect(oldestWaitSeconds(priority, duel.codes, duel.ticks)).toBe(0);
  });

  it('maps every code to the tile its phase implies', () => {
    for (const id of ['campaign', 'sms-outage'] as const) {
      const duel = new NotifDuel(notifScenarios[id], 42);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          for (const code of duel.codes) {
            const view = tileView(lane, code.id);
            const phase = lane.state.phase[code.id];
            if (view === 'overdue') expect(phase).toBe('waiting');
            else if (view === 'backup')
              expect([phase, lane.state.viaBackup[code.id]]).toEqual(['onTime', true]);
            else expect(view).toBe(phase);
          }
        }
      }
    }
  });

  it('stops at the run length', () => {
    const { duel } = finished('campaign');
    const before = duel.checkpoint();
    duel.step();
    expect(duel.checkpoint()).toEqual(before);
    for (const lane of duel.lanes) expect(lane.state.series).toHaveLength(duel.length);
  });

  it('resets and resumes to the same run', () => {
    for (const id of allIds) {
      const reference = finished(id).duel.checkpoint();
      const duel = new NotifDuel(notifScenarios[id], 42);
      const start = duel.checkpoint();
      while (duel.ticks < 120) duel.step();
      const middle = duel.checkpoint();
      duel.restore(start);
      expect(duel.ticks).toBe(0);
      expect(duel.lanes[0].state.phase.every((phase) => phase === 'future')).toBe(true);
      expect(run(duel).checkpoint()).toEqual(reference);

      const resumed = new NotifDuel(notifScenarios[id], 42);
      resumed.restore(middle);
      expect(run(resumed).checkpoint()).toEqual(reference);
    }
  });

  it('keeps checkpoints independent of later steps', () => {
    const duel = new NotifDuel(notifScenarios['sms-outage'], 42);
    while (duel.ticks < 80) duel.step();
    const saved = duel.checkpoint();
    const copy = structuredClone(saved);
    run(duel);
    expect(saved).toEqual(copy);
  });
});
