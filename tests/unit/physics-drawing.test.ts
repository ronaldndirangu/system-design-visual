import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawBall, readPalette } from '../../src/components/physics/drawing';

const tokens: Record<string, string> = {
  '--sdv-packet': '#60a5fa',
  '--sdv-bad': '#f87171',
  '--sdv-ink-on-status': '#0b0f19',
  '--sdv-queue': '#94a3b8',
};

afterEach(() => vi.unstubAllGlobals());

describe('physics drawing', () => {
  it('reads every canvas color from the theme tokens', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => ` ${tokens[name] ?? ''} `,
    }));
    const palette = readPalette({} as Element);
    expect(palette.request).toBe(tokens['--sdv-packet']);
    expect(palette.bad).toBe(tokens['--sdv-bad']);
    expect(palette.ink).toBe(tokens['--sdv-ink-on-status']);
    expect(palette.queue).toBe(tokens['--sdv-queue']);
    expect(palette.warn).toBe('gray');
  });

  it('strokes the dropped request cross in the status ink', () => {
    const strokes: string[] = [];
    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      lineWidth: 0,
      set strokeStyle(value: string) {
        strokes.push(value);
      },
      beginPath() {},
      arc() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
    } as unknown as CanvasRenderingContext2D;
    drawBall(ctx, 0, 0, 6, 'cross', '#f87171', 1, '#0b0f19');
    expect(strokes).toEqual(['#0b0f19']);
  });
});
