import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useStageScale } from '../viz/drawingScale';
import { type StatRow, StatTable, type Tone, ToneBadge } from './StatTable';

interface WidgetFrameProps {
  title: string;
  instructions?: string;
  /** Plain sentence describing the current result, announced after changes settle. */
  summary: string;
  stats: StatRow[];
  status?: { tone: Tone; text: string };
  controls?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  statsCaption?: string;
}

/** Frame for interactive widgets that react to controls instead of running over time. */
export function WidgetFrame({
  title,
  instructions,
  summary,
  stats,
  status,
  controls,
  actions,
  children,
  statsCaption,
}: WidgetFrameProps) {
  const [announcement, setAnnouncement] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  useStageScale(stageRef);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(summary), 700);
    return () => window.clearTimeout(timer);
  }, [summary]);

  return (
    <section className="sdv-sim not-content" aria-label={`Interactive: ${title}`}>
      <header className="sdv-sim__header">
        <h3 className="sdv-sim__title">{title}</h3>
        {status && <ToneBadge tone={status.tone}>{status.text}</ToneBadge>}
      </header>
      {instructions && <p className="sdv-sim__instructions">{instructions}</p>}
      <div ref={stageRef} className="sdv-sim__stage">
        {children}
      </div>
      {actions && (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section
        <div className="sdv-sim__toolbar" role="group" aria-label="Actions">
          {actions}
        </div>
      )}
      {controls && <div className="sdv-sim__controls">{controls}</div>}
      <StatTable rows={stats} caption={statsCaption} />
      <p className="sdv-visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}
