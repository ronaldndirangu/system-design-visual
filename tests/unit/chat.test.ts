import { describe, expect, it } from 'vitest';
import {
  ChatDuel,
  type ChatScenarioId,
  chatEstimates,
  chatScenarios,
  duelScenarioIds,
  MESSAGES,
  makeMessages,
  missingAbove,
  SCREEN_TAIL,
  screenTail,
  summarize,
  tileView,
} from '../../src/lib/models/chat';

function run(duel: ChatDuel): ChatDuel {
  while (!duel.done) duel.step();
  return duel;
}

function finished(id: ChatScenarioId, seed = 42) {
  const duel = run(new ChatDuel(chatScenarios[id], seed));
  return { duel, a: summarize(duel.lanes[0], duel.messages), b: summarize(duel.lanes[1], duel.messages) };
}

function eventLines(duel: ChatDuel): string[] {
  return duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
}

const allIds = Object.keys(chatScenarios) as ChatScenarioId[];
const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
const inSequence = Array.from({ length: MESSAGES }, (_, id) => id);

describe('chat workload', () => {
  it('numbers every message in the order the server receives it', () => {
    const messages = makeMessages(42);
    expect(messages).toHaveLength(MESSAGES);
    expect(messages.map((message) => message.id)).toEqual(inSequence);
    for (let id = 1; id < MESSAGES; id += 1) {
      expect(messages[id]?.arrival).toBeGreaterThanOrEqual(messages[id - 1]?.arrival ?? 0);
    }
    expect(Math.max(...messages.map((message) => message.arrival))).toBeLessThan(200);
  });

  it('shares the conversation across every scenario', () => {
    const first = new ChatDuel(chatScenarios['busy-group'], 9).messages;
    for (const id of allIds) expect(new ChatDuel(chatScenarios[id], 9).messages).toEqual(first);
  });

  it('lists each duel scenario once', () => {
    expect([...duelScenarioIds.ordering, ...duelScenarioIds.sync].sort()).toEqual([...allIds].sort());
  });
});

describe('chat duel', () => {
  it('replays the same seed exactly', () => {
    for (const id of allIds) {
      const first = finished(id, 7);
      const second = finished(id, 7);
      expect(second.duel.lanes[0].state).toEqual(first.duel.lanes[0].state);
      expect(second.duel.lanes[1].state).toEqual(first.duel.lanes[1].state);
      expect(second.duel.events).toEqual(first.duel.events);
    }
  });

  it('accounts for every message the server received on every tick', () => {
    for (const id of allIds) {
      const duel = new ChatDuel(chatScenarios[id], 3);
      while (!duel.done) {
        duel.step();
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel.messages);
          expect(sum.shown + sum.inFlight + sum.queued + sum.held + sum.lost).toBe(sum.sent);
        }
      }
    }
  });

  it('shows every message by the end and never before the server received it', () => {
    for (const seed of seeds) {
      for (const id of allIds) {
        const duel = run(new ChatDuel(chatScenarios[id], seed));
        for (const lane of duel.lanes) {
          const sum = summarize(lane, duel.messages);
          expect(sum.sent).toBe(MESSAGES);
          expect(sum.inFlight + sum.queued + sum.held).toBe(0);
          for (const message of duel.messages) {
            const shownAt = lane.state.shownAt[message.id] ?? -1;
            if (shownAt >= 0) expect(shownAt).toBeGreaterThanOrEqual(message.arrival);
          }
        }
      }
    }
  });

  it('keeps the reorder buffer in strict sequence order', () => {
    for (const seed of seeds) {
      for (const id of allIds) {
        const duel = run(new ChatDuel(chatScenarios[id], seed));
        const buffered = duel.lanes[1];
        expect(buffered.config.reorderBuffer).toBe(true);
        expect(buffered.state.screen).toEqual(inSequence);
        expect(summarize(buffered, duel.messages).outOfOrder).toBe(0);
      }
    }
  });

  it('shows messages out of order in arrival order on every seed, and more with more stalls', () => {
    for (const seed of seeds) {
      const busy = finished('busy-group', seed);
      const stalls = finished('more-stalls', seed);
      expect(busy.a.outOfOrder).toBeGreaterThan(15);
      expect(stalls.a.outOfOrder).toBeGreaterThan(busy.a.outOfOrder);
      expect(busy.b.heldBack).toBeGreaterThan(0);
      expect(busy.b.averageDelaySeconds).toBeGreaterThan(busy.a.averageDelaySeconds);
    }
  });

  it('loses messages in the dead socket without a cursor, fewer with faster heartbeats, and none with one', () => {
    for (const seed of seeds) {
      const tunnel = finished('tunnel', seed);
      const quick = finished('quick-heartbeat', seed);
      expect(tunnel.a.lost).toBeGreaterThan(5);
      expect(quick.a.lost).toBeGreaterThan(0);
      expect(quick.a.lost).toBeLessThan(tunnel.a.lost);
      for (const { a, b } of [tunnel, quick]) {
        expect(b.lost).toBe(0);
        expect(b.recovered).toBe(a.lost);
        expect(a.shown + a.lost).toBe(MESSAGES);
      }
    }
  });

  it('ties with one worker per chat and with a phone that stays online', () => {
    for (const seed of seeds) {
      for (const id of ['one-path', 'online'] as const) {
        const { duel, a, b } = finished(id, seed);
        expect(b).toEqual(a);
        expect(a.outOfOrder + a.lost + a.heldBack).toBe(0);
        expect(duel.lanes[1].state.series).toEqual(duel.lanes[0].state.series);
        expect(duel.events.every((event) => !event.marker)).toBe(true);
      }
    }
  });

  it('pins the seed 42 numbers the lesson quotes', () => {
    const busy = finished('busy-group');
    expect([busy.a.outOfOrder, busy.a.averageDelaySeconds]).toEqual([25, 0.6]);
    expect([
      busy.b.outOfOrder,
      busy.b.heldBack,
      busy.b.averageHoldSeconds,
      busy.b.longestHoldSeconds,
    ]).toEqual([0, 34, 0.7, 1.7]);
    expect(busy.b.averageDelaySeconds).toBe(0.8);
    expect(finished('more-stalls').a.outOfOrder).toBe(46);
    const onePath = finished('one-path');
    expect([onePath.a.outOfOrder, onePath.a.averageDelaySeconds]).toEqual([0, 0.8]);

    const tunnel = finished('tunnel');
    expect([tunnel.a.lost, tunnel.a.shown, tunnel.a.averageDelaySeconds]).toEqual([12, 84, 1.1]);
    expect([tunnel.b.lost, tunnel.b.recovered, tunnel.b.averageDelaySeconds]).toEqual([0, 12, 1.7]);
    expect(finished('quick-heartbeat').a.lost).toBe(3);
  });

  it('pins the illustrative estimates the lesson quotes', () => {
    expect(chatEstimates()).toEqual({
      messagesPerDay: 2_000_000_000,
      averagePerSecond: 23_148,
      peakPerSecond: 69_444,
      deliveriesPerSecond: 347_222,
      openConnections: 20_000_000,
      gatewayServers: 200,
      heartbeatsPerSecond: 666_667,
      storageGigabytesPerDay: 400,
    });
    expect(chatEstimates({ heartbeatSeconds: 10 }).heartbeatsPerSecond).toBe(2_000_000);
  });

  it('writes the transcript the lesson describes', () => {
    expect(eventLines(finished('busy-group').duel)).toEqual([
      '0.9 Sequence numbers and a reorder buffer: message 4 arrives before message 2, so the phone holds it until the gap fills.',
      '1.0 Show in arrival order: message 2 arrives after message 4 and lands below it, out of order.',
      '30.0 Run ends. Messages shown out of order: show in arrival order 25, sequence numbers and a reorder buffer 0. The reorder buffer held back 34 messages, for 0.7 s on average and 1.7 s at most.',
    ]);
    expect(eventLines(finished('tunnel').duel)).toEqual([
      '6.0 The phone loses signal. Its socket dies without a goodbye, so the server still treats it as connected.',
      '9.1 The server hears no heartbeat for 3 s and marks the phone offline. By then it pushed 12 messages into the dead socket. It queues new ones from here.',
      '14.1 Push, and queue while offline: the phone reconnects and the server sends its 25 queued messages. The 12 messages lost in the dead socket never arrive, and the phone cannot tell.',
      '14.1 Cursor catch-up on reconnect: the phone reconnects and says the last message it showed is 29. The server replays the 37 messages after it from the log, including the 12 lost in the dead socket.',
      '30.0 Run ends. Messages missing from the phone: push, and queue while offline 12, cursor catch-up on reconnect 0.',
    ]);
  });

  it('flags late messages and names the gaps above the phone screen', () => {
    const busy = finished('busy-group').duel;
    const late = screenTail(busy.lanes[0], MESSAGES).filter((entry) => entry.flag === 'late');
    expect(late).toHaveLength(25);
    expect(screenTail(busy.lanes[1], MESSAGES).every((entry) => entry.flag === 'ok')).toBe(true);
    expect(screenTail(busy.lanes[0])).toHaveLength(SCREEN_TAIL);
    expect(missingAbove(busy.lanes[0])).toEqual([]);

    const tunnel = finished('tunnel').duel;
    expect(missingAbove(tunnel.lanes[0])).toEqual([{ first: 29, last: 40 }]);
    expect(missingAbove(tunnel.lanes[1])).toEqual([]);

    const midOutage = new ChatDuel(chatScenarios.tunnel);
    while (midOutage.ticks < 100) midOutage.step();
    expect(missingAbove(midOutage.lanes[0])).toEqual([]);
  });

  it('gives each tile a view that matches its phase', () => {
    const busy = finished('busy-group').duel;
    const lateId = busy.lanes[0].state.outOfOrder.indexOf(true);
    expect(tileView(busy.lanes[0], lateId)).toBe('late');
    expect(tileView(busy.lanes[1], lateId)).toBe('shown');

    const tunnel = finished('tunnel').duel;
    const lostId = tunnel.lanes[0].state.phase.indexOf('lost');
    expect(tileView(tunnel.lanes[0], lostId)).toBe('lost');
    expect(tileView(tunnel.lanes[1], lostId)).toBe('recovered');

    const midway = new ChatDuel(chatScenarios.tunnel);
    for (let i = 0; i < 120; i += 1) midway.step();
    expect(midway.lanes[0].state.phase).toContain('queued');
    expect(tileView(midway.lanes[0], midway.lanes[0].state.phase.indexOf('queued'))).toBe('queued');
    expect(tileView(new ChatDuel(chatScenarios.tunnel).lanes[0], 0)).toBe('future');
  });

  it('stops at the run length', () => {
    const duel = run(new ChatDuel(chatScenarios.tunnel));
    expect(duel.ticks).toBe(duel.length);
    const before = structuredClone(duel.lanes[0].state);
    duel.step();
    expect(duel.lanes[0].state).toEqual(before);
    expect(duel.lanes[0].state.series).toHaveLength(duel.length);
    expect(duel.lanes[1].state.series).toHaveLength(duel.length);
  });

  it('resets and resumes from a checkpoint', () => {
    const reference = finished('tunnel', 5).duel;
    const duel = new ChatDuel(chatScenarios.tunnel, 5);
    const start = duel.checkpoint();
    for (let i = 0; i < 100; i += 1) duel.step();
    const middle = duel.checkpoint();
    run(duel);

    duel.restore(start);
    expect(duel.ticks).toBe(0);
    expect(duel.lanes[0].state.phase.every((phase) => phase === 'future')).toBe(true);
    run(duel);
    expect(duel.lanes[1].state).toEqual(reference.lanes[1].state);
    expect(duel.events).toEqual(reference.events);

    const fresh = new ChatDuel(chatScenarios.tunnel, 5);
    fresh.restore(middle);
    run(fresh);
    expect(fresh.lanes[0].state).toEqual(reference.lanes[0].state);
    expect(fresh.events).toEqual(reference.events);
  });

  it('keeps checkpoints independent of later steps', () => {
    const duel = new ChatDuel(chatScenarios['busy-group']);
    for (let i = 0; i < 10; i += 1) duel.step();
    const saved = duel.checkpoint();
    const copy = structuredClone(saved);
    run(duel);
    expect(saved).toEqual(copy);
  });
});
