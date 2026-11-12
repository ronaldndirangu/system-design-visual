import type { ReactNode } from 'react';

/**
 * Caps a growing event log at a fixed height so the page below it stays put.
 * It never scrolls itself or takes focus; the learner scrolls it by mouse or keyboard.
 */
export function TranscriptScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a transcript
    <div className="sdv-transcript-scroll" tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  );
}
