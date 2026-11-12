import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../ui/Button';
import { type Speed, SpeedControl } from '../ui/SpeedControl';
import { type StatRow, StatTable, type Tone, ToneBadge } from './StatTable';
import { useAnnouncer } from './useAnnouncer';
import { useTicker } from './useTicker';

/** Lets the widget rerender with the new state before the summary is read. */
const SETTLE_MS = 50;

export interface SimulationShellProps {
  title: string;
  /** One sentence telling the learner what to try. */
  instructions?: string;
  /** Advances the model by one tick. */
  onTick: () => void;
  onReset: () => void;
  /** Plain sentence describing the current state, announced to screen readers. */
  summary: string;
  stats?: StatRow[];
  /** Replaces the stats table when a simulation needs a richer text readout, such as a comparison. */
  readout?: ReactNode;
  status?: { tone: Tone; text: string };
  controls?: ReactNode;
  children: ReactNode;
  ticksPerSecond?: number;
  /** When true the run stops; pressing Play again starts over. */
  finished?: boolean;
  /** Changing this value pauses the run, for example when the learner picks a new scenario. */
  resetKey?: string;
  /**
   * A short sentence naming the current state, free of tick by tick numbers, such
   * as "Queue overflowing". While running, each change is spoken, at most once per
   * 600 ms. Without it, a change of status tone speaks the status text, except
   * changes back to neutral.
   */
  announceState?: string;
  /** Result of a learner action outside the run controls, such as a crash. A new `id` speaks `text`. */
  notice?: { id: number; text: string };
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
  stats = [],
  readout,
  status,
  controls,
  children,
  ticksPerSecond = 10,
  finished = false,
  resetKey,
  announceState,
  notice,
}: SimulationShellProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>('1');
  const { message, announce, push, pushEvent, cancel } = useAnnouncer();
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useTicker(running, ticksPerSecond * Number(speed), onTick, rootRef);

  // Every paused event in one burst (Step, Reset, Pause, a finished run, a new scenario) speaks the summary once.
  const summaryTimer = useRef<number | undefined>(undefined);
  const announceSummary = useCallback(() => {
    cancel();
    window.clearTimeout(summaryTimer.current);
    summaryTimer.current = window.setTimeout(() => announce(summaryRef.current), SETTLE_MS);
  }, [announce, cancel]);
  useEffect(() => () => window.clearTimeout(summaryTimer.current), []);

  useEffect(() => {
    if (!finished) return;
    setRunning(false);
    announceSummary();
  }, [finished, announceSummary]);

  // Pausing during render means the render that shows a new scenario never ticks it.
  const [pausedForKey, setPausedForKey] = useState(resetKey);
  if (pausedForKey !== resetKey) {
    setPausedForKey(resetKey);
    setRunning(false);
  }
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    announceSummary();
  }, [resetKey, announceSummary]);

  const lastNoticeId = useRef(notice?.id);
  useEffect(() => {
    if (!notice || lastNoticeId.current === notice.id) return;
    lastNoticeId.current = notice.id;
    if (running) pushEvent(notice.text);
    else announce(notice.text);
  }, [notice, running, announce, pushEvent]);

  const stateKey = announceState ?? status?.tone;
  const stateText = announceState ?? (status && status.tone !== 'neutral' ? status.text : '');
  const lastStateKey = useRef(stateKey);
  useEffect(() => {
    if (lastStateKey.current === stateKey) return;
    lastStateKey.current = stateKey;
    if (running && !finished && stateText) push(stateText);
  }, [stateKey, stateText, running, finished, push]);

  const toggle = () => {
    if (running) {
      setRunning(false);
      announceSummary();
      return;
    }
    if (finished) onReset();
    setRunning(true);
    window.clearTimeout(summaryTimer.current);
    push('Playing.');
  };
  const step = () => {
    setRunning(false);
    if (finished) onReset();
    else onTick();
    announceSummary();
  };
  const reset = () => {
    setRunning(false);
    onReset();
    announceSummary();
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
        <Button variant="primary" icon={running ? 'pause' : 'play'} onClick={toggle}>
          {running ? 'Pause' : finished ? 'Replay' : 'Play'}
        </Button>
        <IconButton label="Step" icon="step" onClick={step} />
        <IconButton label="Reset" icon="reset" onClick={reset} />
        <SpeedControl value={speed} onChange={setSpeed} />
      </div>
      {controls && <div className="sdv-sim__controls">{controls}</div>}
      {readout ?? <StatTable rows={stats} />}
      <p className="sdv-visually-hidden" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </section>
  );
}
