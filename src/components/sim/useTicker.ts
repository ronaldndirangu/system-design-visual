import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

const MAX_CATCH_UP_TICKS = 5;

/**
 * Calls onTick at a fixed rate while running. The loop stops while the tab is
 * hidden or the target element is off screen, and it never replays more than a
 * few missed ticks, so a sleeping laptop does not fast forward the model.
 */
export function useTicker(
  running: boolean,
  ticksPerSecond: number,
  onTick: () => void,
  target?: RefObject<Element | null>,
): void {
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  // The loop below stops in a passive effect, which can land a frame late.
  // This flag flips before paint, so a pause never lets one more tick through.
  const runningRef = useRef(running);
  useLayoutEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!running || ticksPerSecond <= 0) return;
    const interval = 1000 / ticksPerSecond;
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    let visible = true;

    const observer =
      target?.current && 'IntersectionObserver' in window
        ? new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
          })
        : undefined;
    if (observer && target?.current) observer.observe(target.current);

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const elapsed = now - last;
      last = now;
      if (!runningRef.current || document.hidden || !visible) return;
      carry += elapsed;
      let ticks = 0;
      while (carry >= interval && ticks < MAX_CATCH_UP_TICKS) {
        tickRef.current();
        carry -= interval;
        ticks += 1;
      }
      if (ticks === MAX_CATCH_UP_TICKS) carry = 0;
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [running, ticksPerSecond, target]);
}
