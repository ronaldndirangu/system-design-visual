import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { UiIcon } from '../viz/icons';
import { type StatRow, StatTable, type Tone, ToneBadge } from './StatTable';
import { useTicker } from './useTicker';

const ANNOUNCE_EVERY_MS = 4000;
const speeds = [0.5, 1, 2, 4] as const;

export interface SimulationShellProps {
  title: string;
  /** One sentence telling the learner what to try. */
  instructions?: string;
  /** Advances the model by one tick. */
  onTick: () => void;
  onReset: () => void;
  /** Plain sentence describing the current state, announced to screen readers. */
  summary: string;
  stats: StatRow[];
  status?: { tone: Tone; text: string };
  controls?: ReactNode;
  children: ReactNode;
  ticksPerSecond?: number;
  /** When true the run stops; pressing Play again starts over. */
  finished?: boolean;
}

/**
 * Shared frame for every simulation: a visual, the learner's controls, run
 * controls, and a text readout that mirrors the visual. Nothing plays until
 * the learner presses Play.
 */
export function SimulationShell({
  title,
  instructions,
  onTick,
  onReset,
  summary,
  stats,
  status,
  controls,
  children,
  ticksPerSecond = 10,
  finished = false,
}: SimulationShellProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  const [announcement, setAnnouncement] = useState('');
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useTicker(running, ticksPerSecond * speed, onTick, rootRef);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setAnnouncement(summaryRef.current), ANNOUNCE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const announceSoon = useCallback(() => {
    window.setTimeout(() => setAnnouncement(summaryRef.current), 50);
  }, []);

  useEffect(() => {
    if (!finished) return;
    setRunning(false);
    setAnnouncement(summaryRef.current);
  }, [finished]);

  const toggle = () => {
    if (!running && finished) onReset();
    setRunning((value) => !value);
    announceSoon();
  };
  const step = () => {
    setRunning(false);
    if (finished) onReset();
    else onTick();
    announceSoon();
  };
  const reset = () => {
    setRunning(false);
    onReset();
    announceSoon();
  };
  const nextSpeed = () => {
    const index = speeds.indexOf(speed);
    setSpeed(speeds[(index + 1) % speeds.length] ?? 1);
  };

  return (
    <section ref={rootRef} className="sdv-sim not-content" aria-label={`Simulation: ${title}`}>
      <header className="sdv-sim__header">
        <h3 className="sdv-sim__title">{title}</h3>
        {status && <ToneBadge tone={status.tone}>{status.text}</ToneBadge>}
      </header>
      {instructions && <p className="sdv-sim__instructions">{instructions}</p>}
      <div className="sdv-sim__stage">{children}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section */}
      <div className="sdv-sim__toolbar" role="group" aria-label="Simulation controls">
        <button type="button" className="sdv-button sdv-button--primary" onClick={toggle}>
          <UiIcon name={running ? 'pause' : 'play'} />
          {running ? 'Pause' : finished ? 'Replay' : 'Play'}
        </button>
        <button type="button" className="sdv-button" onClick={step}>
          <UiIcon name="step" />
          Step
        </button>
        <button type="button" className="sdv-button" onClick={reset}>
          <UiIcon name="reset" />
          Reset
        </button>
        <button
          type="button"
          className="sdv-button"
          onClick={nextSpeed}
          aria-label={`Speed ${speed} times. Change speed`}
        >
          {speed}×
        </button>
      </div>
      {controls && <div className="sdv-sim__controls">{controls}</div>}
      <StatTable rows={stats} />
      <p className="sdv-visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}
