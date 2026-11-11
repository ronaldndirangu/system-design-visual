import type MatterNamespace from 'matter-js';
import { type RefObject, useEffect, useRef, useState } from 'react';

export type Matter = typeof MatterNamespace;

let matterPromise: Promise<Matter> | undefined;

/** Matter.js loads only when a physics view mounts. */
export function loadMatter(): Promise<Matter> {
  matterPromise ??= import('matter-js').then((mod) => mod.default);
  return matterPromise;
}

export interface Palette {
  request: string;
  ok: string;
  bad: string;
  warn: string;
  text: string;
  muted: string;
  line: string;
  surface: string;
  client: string;
  server: string;
  lb: string;
  font: string;
}

export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    request: read('--sdv-client', '#60a5fa'),
    ok: read('--sdv-ok', '#4ade80'),
    bad: read('--sdv-bad', '#f87171'),
    warn: read('--sdv-warn', '#fbbf24'),
    text: read('--sl-color-white', '#ffffff'),
    muted: read('--sl-color-gray-2', '#c0c2c7'),
    line: read('--sl-color-gray-4', '#545861'),
    surface: read('--sl-color-bg', '#17181c'),
    client: read('--sdv-client', '#60a5fa'),
    server: read('--sdv-server', '#a78bfa'),
    lb: read('--sdv-lb', '#fbbf24'),
    font: read('--sl-font', 'system-ui, sans-serif'),
  };
}

export interface Scene {
  resize(width: number, height: number): void;
  setPalette(palette: Palette): void;
  /** Advance physics by dtMs and draw one frame. */
  frame(dtMs: number): void;
  destroy(): void;
}

export interface SceneContext {
  Matter: Matter;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  palette: Palette;
}

/**
 * Mounts a physics scene on a canvas: lazy loads Matter.js, matches the
 * canvas to its box and pixel ratio, follows the light or dark theme, and
 * stops drawing while the canvas is off screen or the tab is hidden.
 */
export function usePhysicsScene<T extends Scene>(
  factory: (context: SceneContext) => T,
  options: { enabled?: boolean; paused?: boolean } = {},
): { canvasRef: RefObject<HTMLCanvasElement | null>; scene: T | null; error: boolean } {
  const { enabled = true, paused = false } = options;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    let disposed = false;
    let current: T | undefined;
    let frame = 0;
    let visible = true;
    const cleanups: (() => void)[] = [];

    loadMatter()
      .then((Matter) => {
        if (disposed) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        const measure = () => {
          const rect = canvas.getBoundingClientRect();
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.round(rect.width));
          const height = Math.max(1, Math.round(rect.height));
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          return { width, height };
        };

        const size = measure();
        current = factoryRef.current({ Matter, ctx, canvas, ...size, palette: readPalette(canvas) });
        setScene(current);

        const resizeObserver = new ResizeObserver(() => {
          const next = measure();
          current?.resize(next.width, next.height);
        });
        resizeObserver.observe(canvas);
        cleanups.push(() => resizeObserver.disconnect());

        const themeObserver = new MutationObserver(() => current?.setPalette(readPalette(canvas)));
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme'],
        });
        cleanups.push(() => themeObserver.disconnect());

        const intersection = new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? true;
        });
        intersection.observe(canvas);
        cleanups.push(() => intersection.disconnect());

        let last = performance.now();
        const loop = (now: number) => {
          frame = requestAnimationFrame(loop);
          const dt = Math.min(now - last, 50);
          last = now;
          if (!visible || document.hidden || pausedRef.current) return;
          current?.frame(dt);
        };
        frame = requestAnimationFrame(loop);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      for (const cleanup of cleanups) cleanup();
      current?.destroy();
      setScene(null);
    };
  }, [enabled]);

  return { canvasRef, scene, error };
}

/** Fixed-step physics so the motion looks the same at 60 Hz and 144 Hz. */
export function createStepper(stepMs = 1000 / 60, maxSteps = 4) {
  let carry = 0;
  return (dtMs: number, step: (ms: number) => void) => {
    carry += dtMs;
    let steps = 0;
    while (carry >= stepMs && steps < maxSteps) {
      step(stepMs);
      carry -= stepMs;
      steps += 1;
    }
    if (steps === maxSteps) carry = 0;
  };
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  style: 'filled' | 'ring' | 'cross',
  color: string,
  alpha = 1,
) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (style === 'ring') {
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (style === 'cross') {
    const d = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0b0f19';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function hexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const inset = Math.min(14, w / 4);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx - w / 2 + inset, cy - h / 2);
  ctx.lineTo(cx + w / 2 - inset, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx + w / 2 - inset, cy + h / 2);
  ctx.lineTo(cx - w / 2 + inset, cy + h / 2);
  ctx.closePath();
}
