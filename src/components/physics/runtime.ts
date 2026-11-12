import type MatterNamespace from 'matter-js';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type Palette, readPalette } from './drawing';

export { drawBall, hexagon, type Palette, readPalette } from './drawing';

export type Matter = typeof MatterNamespace;

let matterPromise: Promise<Matter> | undefined;

/** Matter.js loads only when a physics view mounts. A failed load is forgotten so Retry can try again. */
export function loadMatter(
  load: () => Promise<{ default: Matter }> = () => import('matter-js'),
): Promise<Matter> {
  matterPromise ??= load().then(
    (mod) => mod.default,
    (reason: unknown) => {
      matterPromise = undefined;
      throw reason;
    },
  );
  return matterPromise;
}

export interface Scene {
  resize(width: number, height: number): void;
  setPalette(palette: Palette): void;
  /** Advance physics by dtMs and draw one frame. `frame(0)` only repaints. */
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

/** Longest slice of time one `frame` call simulates, so a slow display frame or a fast speed stays stable. */
export const MAX_FRAME_MS = 50;

/** Milliseconds of physics one display frame should advance, or 0 when the picture must hold still. */
export function loopDelta(
  elapsedMs: number,
  state: { visible: boolean; hidden: boolean; paused: boolean; speed: number },
): number {
  if (!state.visible || state.hidden || state.paused) return 0;
  return Math.min(Math.max(elapsedMs, 0), MAX_FRAME_MS) * state.speed;
}

/** Advances a scene by `ms` in slices no longer than `chunkMs`. */
export function advanceScene(scene: Pick<Scene, 'frame'>, ms: number, chunkMs = MAX_FRAME_MS): void {
  let left = ms;
  while (left > 0) {
    const dt = Math.min(left, chunkMs);
    scene.frame(dt);
    left -= dt;
  }
}

export type PhysicsStatus = 'off' | 'loading' | 'ready' | 'failed';

export function physicsStatus(state: { enabled: boolean; error: boolean; ready: boolean }): PhysicsStatus {
  if (!state.enabled) return 'off';
  if (state.error) return 'failed';
  return state.ready ? 'ready' : 'loading';
}

export interface PhysicsSceneOptions {
  enabled?: boolean;
  /** Holds the engine still: no stepping, no spawning, only repaints. */
  paused?: boolean;
  /** Multiplies simulated time, matching the playback speed. */
  speed?: number;
}

export interface PhysicsSceneHandle<T extends Scene> {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scene: T | null;
  error: boolean;
  status: PhysicsStatus;
  /** Loads Matter.js and builds the scene again after a failure. */
  retry: () => void;
  /** Advances the scene by `ms` of simulated time, even while paused. */
  advance: (ms: number) => void;
  /** Redraws the current state without advancing it. */
  repaint: () => void;
}

/**
 * Mounts a physics scene on a canvas: lazy loads Matter.js, matches the
 * canvas to its box and pixel ratio, follows the light or dark theme, and
 * stops drawing while the canvas is off screen or the tab is hidden.
 */
export function usePhysicsScene<T extends Scene>(
  factory: (context: SceneContext) => T,
  options: PhysicsSceneOptions = {},
): PhysicsSceneHandle<T> {
  const { enabled = true, paused = false, speed = 1 } = options;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const sceneRef = useRef<T | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
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
        sceneRef.current = current;
        current.frame(0);
        setScene(current);

        // Resizing the canvas wipes it, so redraw the current state right away.
        const resizeObserver = new ResizeObserver(() => {
          const next = measure();
          current?.resize(next.width, next.height);
          current?.frame(0);
        });
        resizeObserver.observe(canvas);
        cleanups.push(() => resizeObserver.disconnect());

        const themeObserver = new MutationObserver(() => {
          current?.setPalette(readPalette(canvas));
          current?.frame(0);
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
          const ms = loopDelta(now - last, {
            visible,
            hidden: document.hidden,
            paused: pausedRef.current,
            speed: speedRef.current,
          });
          last = now;
          if (current) advanceScene(current, ms);
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
      sceneRef.current = null;
      setScene(null);
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setError(false);
    setAttempt((value) => value + 1);
  }, []);
  const advance = useCallback((ms: number) => {
    if (sceneRef.current) advanceScene(sceneRef.current, ms);
  }, []);
  const repaint = useCallback(() => sceneRef.current?.frame(0), []);

  const status = physicsStatus({ enabled, error, ready: scene !== null });
  return { canvasRef, scene, error, status, retry, advance, repaint };
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
