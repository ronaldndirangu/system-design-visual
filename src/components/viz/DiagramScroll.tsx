import type { ReactNode } from 'react';

/**
 * Keeps wide diagrams legible on phones: below the breakpoint the SVG keeps a
 * minimum width and this box scrolls sideways. Focusable so keyboard users can
 * scroll it too.
 */
export function DiagramScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a figure
    <div className="sdv-scroll-x" tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  );
}
