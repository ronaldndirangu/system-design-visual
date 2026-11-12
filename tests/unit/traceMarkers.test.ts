import { describe, expect, it } from 'vitest';
import { layoutMarkers, type MarkerLayout } from '../../src/components/sim/traceMarkers';
import { BreakerDuel, breakerScenarios } from '../../src/lib/models/circuitBreaker';

const WIDTH = 285;
const LEFT = 36;
const PLOT = WIDTH - LEFT - 12;

function probeMarkers() {
  const duel = new BreakerDuel(breakerScenarios.probe);
  while (!duel.done) duel.step();
  const events = duel.events.filter((event) => event.marker && !event.minor);
  return events.map((event, index) => ({ number: index + 1, x: LEFT + (event.tick / duel.length) * PLOT }));
}

function expectReadable(layout: MarkerLayout, count: number, minX: number, maxX: number) {
  const covered = layout.labels.flatMap((label) => label.numbers).sort((a, b) => a - b);
  expect(covered).toEqual(Array.from({ length: count }, (_, index) => index + 1));
  for (const label of layout.labels) {
    expect(label.x - label.width / 2).toBeGreaterThanOrEqual(minX);
    expect(label.x + label.width / 2).toBeLessThanOrEqual(maxX);
    expect(label.kind).toBe(label.numbers.length === 1 ? 'single' : 'group');
  }
  for (let lane = 0; lane < layout.lanes; lane += 1) {
    const row = layout.labels.filter((label) => label.lane === lane).sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) {
      const before = row[index - 1];
      const after = row[index];
      if (!before || !after) continue;
      expect(after.x - after.width / 2).toBeGreaterThanOrEqual(before.x + before.width / 2);
    }
  }
}

describe('layoutMarkers', () => {
  it('keeps all 14 probe-scenario markers readable at 285 px', () => {
    const markers = probeMarkers();
    expect(markers).toHaveLength(14);
    const layout = layoutMarkers(markers, 2, WIDTH - 2);
    expect(layout.lanes).toBeLessThanOrEqual(2);
    expect(layout.labels.some((label) => label.kind === 'group')).toBe(true);
    expectReadable(layout, 14, 2, WIDTH - 2);
  });

  it('leaves well spaced markers as single badges at their events', () => {
    const markers = [100, 200, 300].map((x, index) => ({ number: index + 1, x }));
    const layout = layoutMarkers(markers, 0, 640);
    expect(layout.lanes).toBe(1);
    expect(layout.labels.map((label) => [label.text, label.x])).toEqual([
      ['1', 100],
      ['2', 200],
      ['3', 300],
    ]);
  });

  it('labels a group with its first and last event numbers', () => {
    const markers = Array.from({ length: 5 }, (_, index) => ({ number: index + 3, x: 50 }));
    const layout = layoutMarkers(markers, 0, 100, 1);
    expect(layout.labels.map((label) => [label.text, label.numbers])).toEqual([['3-7', [3, 4, 5, 6, 7]]]);
  });
});
