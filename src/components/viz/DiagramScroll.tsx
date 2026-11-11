import { type ReactNode, useEffect, useRef, useState } from 'react';

interface Overflow {
  measured: boolean;
  overflowing: boolean;
  start: boolean;
  end: boolean;
}

const UNMEASURED: Overflow = { measured: false, overflowing: false, start: false, end: false };

function sameOverflow(a: Overflow, b: Overflow) {
  return (
    a.measured === b.measured && a.overflowing === b.overflowing && a.start === b.start && a.end === b.end
  );
}

/**
 * Sideways scroll box for wide diagrams and tables. It measures its content and,
 * only while the content is wider than the box, takes keyboard focus, fades the
 * edges that hide more content and shows a "see more" cue until the first scroll.
 * Server markup stays focusable because overflow is unknown until hydration.
 */
export function DiagramScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>(UNMEASURED);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const left = Math.abs(el.scrollLeft);
      const overflowing = max > 1;
      const next = {
        measured: true,
        overflowing,
        start: overflowing && left > 1,
        end: overflowing && left < max - 1,
      };
      setOverflow((prev) => (sameOverflow(prev, next) ? prev : next));
    };
    const onScroll = () => {
      if (Math.abs(el.scrollLeft) > 1) setScrolled(true);
      measure();
    };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, []);

  const focusable = !overflow.measured || overflow.overflowing;
  return (
    <div className="sdv-scroll">
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a figure */}
      <div
        ref={ref}
        className="sdv-scroll-x"
        tabIndex={focusable ? 0 : undefined}
        role="group"
        aria-label={label}
        data-overflow-start={overflow.start ? '' : undefined}
        data-overflow-end={overflow.end ? '' : undefined}
      >
        {children}
      </div>
      {overflow.overflowing && !scrolled ? (
        <span className="sdv-scroll-cue" aria-hidden="true">
          <span className="sdv-scroll-cue__fine">Scroll to see more →</span>
          <span className="sdv-scroll-cue__coarse">Swipe to see more →</span>
        </span>
      ) : null}
    </div>
  );
}
