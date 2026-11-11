import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCE_GAP_MS, createAnnouncer } from '../../src/lib/announcer';

describe('createAnnouncer', () => {
  let spoken: { at: number; text: string }[];
  const start = 1_000_000;
  const speak = (text: string) => spoken.push({ at: Date.now() - start, text });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    spoken = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks the first push at once', () => {
    createAnnouncer(speak).push('Playing.');
    expect(spoken).toEqual([{ at: 0, text: 'Playing.' }]);
  });

  it('holds pushes inside the gap and speaks only the latest when the gap ends', () => {
    const announcer = createAnnouncer(speak);
    announcer.push('Playing.');
    vi.advanceTimersByTime(100);
    announcer.push('Lag is growing.');
    vi.advanceTimersByTime(100);
    announcer.push('Consumers are catching up.');
    expect(spoken).toHaveLength(1);
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    expect(spoken).toEqual([
      { at: 0, text: 'Playing.' },
      { at: ANNOUNCE_GAP_MS, text: 'Consumers are catching up.' },
    ]);
  });

  it('never speaks twice within the gap, however fast the state changes', () => {
    const announcer = createAnnouncer(speak);
    for (let ms = 0; ms < 5000; ms += 16) {
      announcer.push(ms % 32 === 0 ? 'Queue overflowing.' : 'Queue draining.');
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    expect(spoken.length).toBeGreaterThan(1);
    for (let index = 1; index < spoken.length; index += 1) {
      const gap = (spoken[index]?.at ?? 0) - (spoken[index - 1]?.at ?? 0);
      expect(gap).toBeGreaterThanOrEqual(ANNOUNCE_GAP_MS);
    }
  });

  it('keeps queued events when a newer state arrives and speaks them ahead of it', () => {
    const announcer = createAnnouncer(speak);
    announcer.push('Playing.');
    announcer.pushEvent('Consumer 1 crashes.');
    announcer.push('The group is rebalancing.');
    announcer.pushEvent('Consumer 2 joins.');
    announcer.push('Lag is growing.');
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    expect(spoken).toEqual([
      { at: 0, text: 'Playing.' },
      { at: ANNOUNCE_GAP_MS, text: 'Consumer 1 crashes. Consumer 2 joins. Lag is growing.' },
    ]);
  });

  it('flush speaks at once and drops the queued message', () => {
    const announcer = createAnnouncer(speak);
    announcer.push('Playing.');
    announcer.push('Lag is growing.');
    vi.advanceTimersByTime(50);
    announcer.flush('Paused. Lag 40 events.');
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS * 2);
    expect(spoken.map((entry) => entry.text)).toEqual(['Playing.', 'Paused. Lag 40 events.']);
  });

  it('makes a push after flush wait out the gap', () => {
    const announcer = createAnnouncer(speak);
    announcer.flush('Step. Lag 3 events.');
    vi.advanceTimersByTime(200);
    announcer.push('Playing.');
    expect(spoken).toHaveLength(1);
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS - 200);
    expect(spoken.at(-1)).toEqual({ at: ANNOUNCE_GAP_MS, text: 'Playing.' });
  });

  it('cancel drops the queued message and keeps the announcer usable', () => {
    const announcer = createAnnouncer(speak);
    announcer.push('Playing.');
    announcer.push('Lag is growing.');
    announcer.cancel();
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS * 2);
    announcer.push('Consumers are keeping up.');
    expect(spoken.map((entry) => entry.text)).toEqual(['Playing.', 'Consumers are keeping up.']);
  });
});
