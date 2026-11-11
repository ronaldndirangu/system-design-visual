import { m } from 'motion/react';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';

export type Point = readonly [number, number];

export interface Flow {
  id: string;
  points: readonly Point[];
  tone?: 'request' | 'hit' | 'miss' | 'bad';
  /** Seconds to travel the whole path. */
  duration: number;
  delay?: number;
}

/**
 * Decorative dots that travel along a path, one per sampled request. The
 * text readout carries the same information, so under reduced motion the
 * dots are simply left out.
 */
export function FlowDots({ flows, radius = 5 }: { flows: readonly Flow[]; radius?: number }) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;
  return (
    <g>
      {flows.map((flow) => {
        const first = flow.points[0];
        if (!first) return null;
        const tone = flow.tone && flow.tone !== 'request' ? ` sdv-dot--${flow.tone}` : '';
        return (
          <m.circle
            key={flow.id}
            className={`sdv-dot${tone}`}
            r={radius}
            initial={{ cx: first[0], cy: first[1], opacity: 0 }}
            animate={{
              cx: flow.points.map((point) => point[0]),
              cy: flow.points.map((point) => point[1]),
              opacity: [0, 1, 1, 1, 0],
            }}
            transition={{ duration: flow.duration, delay: flow.delay ?? 0, ease: 'linear' }}
          />
        );
      })}
    </g>
  );
}
