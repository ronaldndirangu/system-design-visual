import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** Longest stretch a visual may animate on its own before it rests (WCAG 2.2.2). */
export const AUTOPLAY_MS = 5000;

/** Autoplay runs for `loops` passes of the animation, capped at `capMs`. */
export function autoplayBudget(loopMs: number, loops = 2, capMs = AUTOPLAY_MS): number {
  return Math.max(0, Math.min(capMs, loops * loopMs));
}

/**
 * auto: plays on its own until the budget runs out.
 * playing: the reader pressed Play, so it loops until they pause.
 * paused: the reader pressed Pause.
 * done: the autoplay budget ran out.
 */
type Mode = 'auto' | 'playing' | 'paused' | 'done';

interface Options {
  reduced: boolean;
  budgetMs?: number;
}

export interface Autoplay {
  /** Motion should render right now: wanted, on screen, and in a visible tab. */
  playing: boolean;
  /** Motion is wanted. Drives the Pause or Play label. */
  wantsMotion: boolean;
  toggle: () => void;
  /** Call when the content changes, so autoplay gets a fresh budget unless the reader paused. */
  restart: () => void;
}

/**
 * Pause control for looping visuals. Autoplay never starts under reduced motion,
 * rests after its budget, and the budget only counts down while the target is on
 * screen in a visible tab.
 */
export function useAutoplay(
  target: RefObject<Element | null>,
  { reduced, budgetMs = AUTOPLAY_MS }: Options,
): Autoplay {
  const [mode, setMode] = useState<Mode>('auto');
  const [runKey, setRunKey] = useState(0);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setVisible(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const wantsMotion = mode === 'playing' || (mode === 'auto' && !reduced);
  const playing = wantsMotion && visible && !hidden;

  const remaining = useRef(budgetMs);
  const run = useRef(runKey);
  useEffect(() => {
    if (run.current !== runKey) {
      run.current = runKey;
      remaining.current = budgetMs;
    }
    if (!playing || mode !== 'auto') return;
    const started = performance.now();
    const timer = window.setTimeout(() => setMode('done'), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [playing, mode, runKey, budgetMs]);

  const toggle = useCallback(() => {
    setMode(wantsMotion ? 'paused' : 'playing');
  }, [wantsMotion]);

  const restart = useCallback(() => {
    setMode((current) => (current === 'done' ? 'auto' : current));
    setRunKey((key) => key + 1);
  }, []);

  return { playing, wantsMotion, toggle, restart };
}
