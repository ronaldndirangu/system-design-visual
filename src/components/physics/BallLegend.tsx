import type { ReactNode } from 'react';

/** Key for the request balls drawn by the physics scenes. Shapes differ, so color is never the only cue. */
export function BallLegend({ children }: { children?: ReactNode }) {
  return (
    <ul className="sdv-legend" aria-label="Legend">
      <li>
        <span className="sdv-legend__ball sdv-legend__ball--waiting" aria-hidden="true" /> Waiting (solid)
      </li>
      <li>
        <span className="sdv-legend__ball sdv-legend__ball--served" aria-hidden="true" /> Served (ring)
      </li>
      <li>
        <span className="sdv-legend__ball sdv-legend__ball--dropped" aria-hidden="true" /> Dropped (cross)
      </li>
      {children}
    </ul>
  );
}
