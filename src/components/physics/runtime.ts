import type MatterNamespace from 'matter-js';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { type Palette, readPalette } from './drawing';

export { drawBall, hexagon, type Palette, readPalette } from './drawing';

export type Matter = typeof MatterNamespace;

let matterPromise: Promise<Matter> | undefined;

/** Matter.js loads only when a physics view mounts. */
export function loadMatter(): Promise<Matter> {
  matterPromise ??= import('matter-js').then((mod) => mod.default);
  return matterPromise;
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

        const themeObserver = new MutationObserver(() => {
          current?.setPalette(readPalette(canvas));
          // A paused loop draws nothing, so repaint the frozen frame in the new colors.
          if (pausedRef.current) current?.frame(0);
        });
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
