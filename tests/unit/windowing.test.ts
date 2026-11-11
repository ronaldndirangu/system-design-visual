import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  ALLOWED_LATENESS_SECONDS,
  ClockCounter,
  ClockDuel,
  type ClockScenario,
  type ConsumerCommand,
  type LatePolicy,
  makeClicks,
  OUTAGE,
  SHAPES_ALERT,
  SLOW_SHARE,
  STREAM_TICKS,
  WatermarkCounter,
  WatermarkDuel,
  windowName,
  windowOf,
  windowShapes,
} from '../../src/lib/models/windowing';

function finish(run: ClockDuel | WatermarkDuel): void {
  while (!run.done) run.step();
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function checkClockConservation(model: ClockCounter): void {
  const t = model.totals;
  expect(t.arrived + t.onTheWay).toBe(t.happened);
  expect(t.read + t.waiting).toBe(t.arrived);
  expect(sum(model.windowCounts)).toBe(t.read);
  expect(sum(model.truth)).toBe(t.happened);
}

function checkWatermarkConservation(model: WatermarkCounter): void {
  const t = model.totals;
  expect(t.read + t.onTheWay).toBe(t.happened);
  expect(t.ontime + t.late).toBe(t.read);
  expect(t.corrected + t.dropped + t.side).toBe(t.late);
  const windows = model.windows;
  expect(sum(windows.map((w) => w.ontime + w.corrected + w.dropped + w.side))).toBe(t.read);
  expect(sum(model.truth)).toBe(t.happened);
}

const restartSchedule: ScheduledCommand<ConsumerCommand>[] = [
  { at: 50, command: { type: 'stop' } },
  { at: 90, command: { type: 'start' } },
];

describe('makeClicks', () => {
  it('replays the same clicks for a seed', () => {
    expect(makeClicks(7, { slowShare: SLOW_SHARE, outage: OUTAGE })).toEqual(
      makeClicks(7, { slowShare: SLOW_SHARE, outage: OUTAGE }),
    );
  });

  it('keeps event times identical across options so scenarios differ only in delivery', () => {
    const plain = makeClicks(7);
    const outage = makeClicks(7, { outage: OUTAGE });
    expect(outage.map((c) => c.eventTick)).toEqual(plain.map((c) => c.eventTick));
    expect(plain.every((c) => c.arriveTick - c.eventTick <= 3)).toBe(true);
    const until = OUTAGE.untilSeconds * 10;
    for (const click of outage) {
      if (click.held) {
        expect(click.eventTick).toBeGreaterThanOrEqual(OUTAGE.fromSeconds * 10);
        expect(click.arriveTick).toBeGreaterThanOrEqual(until);
      }
    }
  });
});

describe('ClockCounter', () => {
  it('conserves clicks every tick while it stops and starts', () => {
    const clicks = makeClicks(7);
    for (const clock of ['processing', 'event'] as const) {
      const model = new ClockCounter(clock, clicks);
      for (let i = 0; i < STREAM_TICKS; i += 1) {
        stepScheduled(model, restartSchedule);
        checkClockConservation(model);
      }
    }
  });

  it('restores a checkpoint to an equivalent state', () => {
    const clicks = makeClicks(7);
    const model = new ClockCounter('processing', clicks);
    for (let i = 0; i < 70; i += 1) stepScheduled(model, restartSchedule);
    const saved = model.checkpoint();
    const first = Array.from({ length: 80 }, () => stepScheduled(model, restartSchedule));
    const firstTotals = model.totals;
    model.restore(saved);
    const second = Array.from({ length: 80 }, () => stepScheduled(model, restartSchedule));
    expect(second).toEqual(first);
    expect(model.totals).toEqual(firstTotals);
  });

  it('counts by event time in the window each click happened in', () => {
    const clicks = makeClicks(7, { outage: OUTAGE });
    const model = new ClockCounter('event', clicks);
    for (let i = 0; i < STREAM_TICKS; i += 1) model.step();
    expect(model.totals.wrongWindow).toBe(0);
    const unread = Array.from({ length: 10 }, () => 0);
    for (const click of clicks) {
      const index = windowOf(click.eventTick);
      if (click.arriveTick >= STREAM_TICKS) unread[index] = (unread[index] ?? 0) + 1;
    }
    expect(model.windowCounts).toEqual(model.truth.map((count, index) => count - (unread[index] ?? 0)));
  });
});

describe('ClockDuel', () => {
  it('replays identically for a seed', () => {
    for (const scenario of ['restart', 'outage', 'steady'] as ClockScenario[]) {
      const a = new ClockDuel(scenario);
      const b = new ClockDuel(scenario);
      finish(a);
      finish(b);
      expect(b.events).toEqual(a.events);
      expect(b.lanes.map((lane) => lane.series)).toEqual(a.lanes.map((lane) => lane.series));
    }
  });

  it('pins the restart numbers the lesson quotes', () => {
    const duel = new ClockDuel('restart');
    finish(duel);
    const [processing, event] = duel.lanes;
    expect(duel.truth).toEqual([58, 40, 44, 38, 36, 39, 32, 41, 35, 52]);
    expect(processing.model.windowCounts).toEqual([52, 43, 22, 0, 98, 39, 32, 39, 36, 52]);
    expect(processing.model.totals).toMatchObject({ read: 413, wrongWindow: 80, alerts: 1 });
    expect(event.model.totals).toMatchObject({ read: 413, wrongWindow: 0, afterEnd: 80, alerts: 0 });
    expect(Math.max(...processing.series)).toBe(62);
    expect(Math.max(...event.series)).toBe(38);
    expect(event.series.at(-1)).toBe(2);
    expect(duel.events.map((e) => e.text)).toContain(
      'The job starts again with 85 clicks waiting and reads up to 10 every 0.1 s.',
    );
    checkClockConservation(processing.model);
    checkClockConservation(event.model);
  });

  it('pins the mid run restart overcount the lesson quotes', () => {
    const duel = new ClockDuel('restart');
    for (let i = 0; i < 97; i += 1) duel.step();
    const processing = duel.lanes[0].model;
    expect(processing.windowCounts[4]).toBe(70);
    expect(processing.truth[4]).toBe(33);
  });

  it('pins the outage and steady numbers the lesson quotes', () => {
    const outage = new ClockDuel('outage');
    finish(outage);
    expect(outage.lanes[0].model.windowCounts[5]).toBe(81);
    expect(outage.truth[5]).toBe(39);
    expect(outage.lanes[0].model.totals).toMatchObject({ wrongWindow: 60, alerts: 1 });
    expect(outage.lanes[1].model.totals).toMatchObject({ wrongWindow: 0, afterEnd: 60, alerts: 0 });
    expect(outage.events[0]?.text).toBe(
      'The edge region reconnects and sends the 42 clicks it buffered since 4 s.',
    );

    const steady = new ClockDuel('steady');
    finish(steady);
    expect(steady.lanes[0].model.totals).toMatchObject({ wrongWindow: 20, alerts: 0 });
    expect(steady.lanes[1].model.totals).toMatchObject({ wrongWindow: 0, alerts: 0 });
  });

  it('ends a fresh duel the same way after a restart from scratch', () => {
    const used = new ClockDuel('restart');
    for (let i = 0; i < 120; i += 1) used.step();
    const fresh = new ClockDuel('restart');
    finish(fresh);
    finish(used);
    expect(used.lanes[0].model.totals).toEqual(fresh.lanes[0].model.totals);
    expect(used.events).toEqual(fresh.events);
  });
});

describe('WatermarkCounter', () => {
  const clicks = makeClicks(7, { slowShare: SLOW_SHARE, outage: OUTAGE });
  const config = (policy: LatePolicy) => ({
    waitTicks: 5,
    policy,
    allowedTicks: ALLOWED_LATENESS_SECONDS * 10,
  });

  it('conserves clicks every tick under every policy', () => {
    for (const policy of ['drop', 'update', 'side'] as LatePolicy[]) {
      const model = new WatermarkCounter(clicks, config(policy));
      for (let i = 0; i < STREAM_TICKS; i += 1) {
        model.step();
        checkWatermarkConservation(model);
      }
    }
  });

  it('restores a checkpoint to an equivalent state', () => {
    const model = new WatermarkCounter(clicks, config('update'));
    for (let i = 0; i < 95; i += 1) model.step();
    const saved = model.checkpoint();
    const first = Array.from({ length: 60 }, () => model.step());
    const firstWindows = model.windows;
    model.restore(saved);
    const second = Array.from({ length: 60 }, () => model.step());
    expect(second).toEqual(first);
    expect(model.windows).toEqual(firstWindows);
  });

  it('publishes a window only after the watermark passes its end', () => {
    const model = new WatermarkCounter(clicks, config('drop'));
    for (let i = 0; i < STREAM_TICKS; i += 1) {
      model.step();
      const watermark = model.watermark ?? -1;
      model.windows.forEach((window, index) => {
        expect(window.publishedAt !== null).toBe((index + 1) * 20 <= watermark);
      });
    }
  });
});

describe('WatermarkDuel', () => {
  it('replays identically for a seed', () => {
    const a = new WatermarkDuel('update');
    const b = new WatermarkDuel('update');
    finish(a);
    finish(b);
    expect(b.events).toEqual(a.events);
    expect(b.lanes.map((lane) => lane.model.windows)).toEqual(a.lanes.map((lane) => lane.model.windows));
  });

  it('pins the drop numbers the lesson quotes', () => {
    const duel = new WatermarkDuel('drop');
    finish(duel);
    const [short, long] = duel.lanes;
    expect(short.model.totals).toMatchObject({ read: 410, late: 36, dropped: 36, published: 9 });
    expect(long.model.totals).toMatchObject({ read: 410, late: 12, dropped: 12, published: 8 });
    expect(short.model.meanPublishDelay?.toFixed(1)).toBe('0.6');
    expect(long.model.meanPublishDelay?.toFixed(1)).toBe('3.1');
    expect(duel.truth[0]).toBe(58);
    expect(short.model.windows[0]).toMatchObject({ ontime: 56, publishedAt: 26 });
    expect(long.model.windows[0]).toMatchObject({ ontime: 58, publishedAt: 50 });
    expect(short.model.firstResultClicks).toBe(327);
    expect(long.model.firstResultClicks).toBe(316);
    expect(duel.events.map((e) => e.text)).toContain(
      'The buffered clicks are in. Wait 0.5 s found 26 of them late, and Wait 3 s found 12 late.',
    );
    checkWatermarkConservation(short.model);
    checkWatermarkConservation(long.model);
  });

  it('pins the allowed lateness and side table numbers the lesson quotes', () => {
    const update = new WatermarkDuel('update');
    finish(update);
    expect(update.lanes[0].model.totals).toMatchObject({
      late: 36,
      corrected: 36,
      dropped: 0,
      corrections: 18,
    });
    expect(update.lanes[1].model.totals).toMatchObject({
      late: 12,
      corrected: 12,
      dropped: 0,
      corrections: 4,
    });
    expect(update.lanes[0].model.held).toBe(6);

    const side = new WatermarkDuel('side');
    finish(side);
    expect(side.lanes[0].model.totals).toMatchObject({ late: 36, side: 36, dropped: 0 });
    expect(side.lanes[1].model.totals).toMatchObject({ late: 12, side: 12, dropped: 0 });
  });

  it('gives every policy the same first results and the same late clicks', () => {
    const runs = (['drop', 'update', 'side'] as LatePolicy[]).map((policy) => {
      const duel = new WatermarkDuel(policy);
      finish(duel);
      return duel.lanes.map((lane) => lane.model.windows.map((w) => [w.ontime, w.publishedAt]));
    });
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });
});

describe('windowShapes', () => {
  it('keeps the background clicks the same for both bursts', () => {
    const inside = windowShapes('inside');
    const across = windowShapes('across');
    const background = (shape: typeof inside) => shape.clicks.filter((c) => !c.burst).map((c) => c.tick);
    expect(background(across)).toEqual(background(inside));
    expect(windowShapes('inside')).toEqual(inside);
  });

  it('pins the tumbling and sliding counts the lesson quotes', () => {
    const inside = windowShapes('inside');
    const across = windowShapes('across');
    expect(inside.tumbling.map((w) => w.count)).toEqual([17, 43, 18]);
    expect(across.tumbling.map((w) => w.count)).toEqual([17, 32, 29]);
    expect(Math.max(...inside.sliding.map((w) => w.count))).toBe(44);
    expect(Math.max(...across.sliding.map((w) => w.count))).toBe(44);
    expect(across.tumbling.some((w) => w.count > SHAPES_ALERT)).toBe(false);
    expect(across.sliding.some((w) => w.count > SHAPES_ALERT)).toBe(true);
    expect(inside.sliding).toHaveLength(11);
  });

  it('counts every click once in tumbling windows', () => {
    const shape = windowShapes('across');
    expect(sum(shape.tumbling.map((w) => w.count))).toBe(shape.clicks.length);
  });
});

it('names windows in seconds', () => {
  expect(windowName(2)).toBe('4 to 6 s');
});
