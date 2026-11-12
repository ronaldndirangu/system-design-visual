import { describe, expect, it } from 'vitest';
import { boxExit, link, NODE_H, NODE_W, nodeSize, textWidth } from '../../src/components/viz/geometry';

describe('nodeSize', () => {
  it('keeps the default box for a short label', () => {
    const box = nodeSize('server', 'Cache');
    expect(box).toMatchObject({ w: NODE_W, h: NODE_H, lines: ['Cache'], px: 14, subPx: 13 });
  });

  it('wraps and grows a long label at the phone font size', () => {
    const box = nodeSize('database', 'Write-ahead log', 12 / 0.62);
    expect(box.lines).toEqual(['Write-ahead', 'log']);
    expect(box.h).toBeGreaterThan(NODE_H);
    const [first = 0, second = 0] = box.baselines;
    expect(second - first).toBeGreaterThan(box.px);
    expect(second).toBeLessThan(box.h / 2);
  });

  it('widens the box until every line fits inside the shape', () => {
    const box = nodeSize('loadBalancer', 'Load balancer', 18);
    const widest = Math.max(...box.lines.map((line) => textWidth(line, box.px)));
    expect(box.w).toBeGreaterThanOrEqual(widest + 40);
  });
});

describe('link', () => {
  it('ends at each node’s real bounds', () => {
    const { from, to } = link({ x: 0, y: 0, w: 200, h: 64 }, { x: 400, y: 0, w: 120, h: 64 });
    expect(from).toEqual([106, 0]);
    expect(to).toEqual([334, 0]);
  });

  it('falls back to the default node size', () => {
    const a = { x: 70, y: 160 };
    const b = { x: 290, y: 60 };
    expect(link(a, b)).toEqual({ from: boxExit(a, b), to: boxExit(b, a) });
  });
});
