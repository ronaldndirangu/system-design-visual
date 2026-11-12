import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button, IconButton } from '../ui/Button';
import { type Speed, SpeedControl } from '../ui/SpeedControl';
import { type Playback, PlaybackContext } from './playback';
import { type StatRow, StatTable, type Tone, ToneBadge } from './StatTable';
import { useAnnouncer } from './useAnnouncer';
import { useTicker } from './useTicker';

/** Lets the widget rerender with the new state before the summary is read. */
const SETTLE_MS = 50;

export const TOY_MODEL_ASSUMPTIONS =
  'The simulations are toy models: small and deterministic, so the same settings always produce the same result. Each one keeps the mechanism the lesson teaches and leaves out the rest on purpose, such as network jitter, garbage collection, and other tenants.';

export interface KeyStat {
  label: string;
  value: ReactNode;
}

export interface SimulationShellProps {
  title: string;
  /** One sentence telling the learner what to try. */
  instructions?: string;
  /** A short, always visible line naming what the model leaves out. */
  assumptions?: ReactNode;
  /** Advances the model by one tick. */
  onTick: () => void;
  onReset: () => void;
  /** Plain sentence describing the current state, announced to screen readers. */
  summary: string;
  stats?: StatRow[];
  /** Replaces the stats table when a simulation needs a richer text readout, such as a comparison. */
  readout?: ReactNode;
  /**
   * Two or three headline numbers shown as tiles under the controls. When set,
   * the full readout folds into an "All numbers" disclosure below the tiles.
   */
  keyStats?: KeyStat[];
  /** Rows in the folded readout, shown in its summary. Defaults to the stats count; omitted when a custom readout has no count. */
  readoutCount?: number;
  /**
   * Whether the run has begun, so the tiles show numbers. Without it the shell
   * tracks Play, Step, and Reset itself; pass it when the widget can advance the
   * model outside the shell, such as a "Skip to the end" button.
   */
  started?: boolean;
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
 * How much the widest stage drawing is shrunk on screen, from 1 (full size) up.
 * Stage CSS multiplies SVG text sizes by it so labels keep their real pixel size
 * on a phone. A DiagramScroll inside the stage publishes the same factor for its
 * own drawing, which takes precedence there.
 */
function useStageScale(stageRef: RefObject<HTMLDivElement | null>, resetKey?: string): number {
  const [scale, setScale] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scenario can swap the drawing without resizing the stage
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const root: HTMLDivElement = stage;
    const observer = new ResizeObserver(() => measure());
    function measure() {
      let widest: SVGSVGElement | undefined;
      let widestViewBox = 0;
      for (const svg of root.querySelectorAll<SVGSVGElement>('svg[viewBox]')) {
        const viewBoxWidth = svg.viewBox.baseVal?.width ?? 0;
        if (svg.clientWidth > 0 && viewBoxWidth > widestViewBox) {
          widest = svg;
          widestViewBox = viewBoxWidth;
        }
      }
      if (widest) observer.observe(widest);
      const next = widest ? Math.max(1, widestViewBox / widest.clientWidth) : 1;
      const rounded = Math.ceil(next * 100) / 100;
      setScale((current) => (current === rounded ? current : rounded));
    }
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [stageRef, resetKey]);
  return scale;
}

/**
 * Shared frame for every simulation: a visual, the learner's controls, run
 * controls, and a text readout that mirrors the visual. Nothing plays until
 * the learner presses Play.
 */
export function SimulationShell({
  title,
  instructions,
  assumptions,
  onTick,
  onReset,
  summary,
  stats = [],
  readout,
  keyStats,
  readoutCount,
  started,
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
  const stageRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>('1');
  const [ranOnce, setRanOnce] = useState(false);
  const { message, announce, push, pushEvent, cancel } = useAnnouncer();
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const stageScale = useStageScale(stageRef, resetKey);

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
    setRanOnce(false);
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

  const play = () => {
    if (running) return;
    if (finished) onReset();
    setRunning(true);
    setRanOnce(true);
    window.clearTimeout(summaryTimer.current);
    push('Playing.');
  };
  const pause = () => {
    if (!running) return;
    setRunning(false);
    announceSummary();
  };
  const toggle = () => (running ? pause() : play());
  const step = () => {
    setRunning(false);
    if (finished) {
      onReset();
      setRanOnce(false);
    } else {
      onTick();
      setRanOnce(true);
    }
    announceSummary();
  };
  const reset = () => {
    setRunning(false);
    setRanOnce(false);
    onReset();
    announceSummary();
  };
  const playback: Playback = { playing: running, speed, play, pause, toggle, step, reset, setSpeed };

  const hasStarted = started ?? ranOnce;
  const tableCount = readoutCount ?? (readout ? undefined : stats.length);
  const table = readout ?? <StatTable rows={stats} />;

  return (
    <PlaybackContext.Provider value={playback}>
      <section ref={rootRef} className="sdv-sim not-content" aria-label={`Simulation: ${title}`}>
        <header className="sdv-sim__header">
          <h3 className="sdv-sim__title">{title}</h3>
          {status && <ToneBadge tone={status.tone}>{status.text}</ToneBadge>}
        </header>
        {instructions && <p className="sdv-sim__instructions">{instructions}</p>}
        {assumptions && <p className="sdv-sim__assumptions">{assumptions}</p>}
        {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section */}
        <div className="sdv-sim__toolbar" role="group" aria-label="Simulation controls">
          <Button variant="primary" icon={running ? 'pause' : 'play'} onClick={toggle}>
            {running ? 'Pause' : finished ? 'Replay' : 'Play'}
          </Button>
          <IconButton label="Step" icon="step" onClick={step} />
          <IconButton label="Reset" icon="reset" onClick={reset} />
          <SpeedControl value={speed} onChange={setSpeed} />
        </div>
        <div
          ref={stageRef}
          className="sdv-sim__stage"
          style={{ '--sdv-dscale': stageScale } as CSSProperties}
        >
          {children}
        </div>
        {controls && <div className="sdv-sim__controls">{controls}</div>}
        {keyStats ? (
          <>
            {hasStarted ? (
              <dl className="sdv-sim__keystats">
                {keyStats.map((stat) => (
                  <div key={stat.label} className="sdv-sim__keystat">
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="sdv-sim__keystats sdv-sim__keystats--empty">Press Play to see live numbers</p>
            )}
            <details className="sdv-sim__more">
              <summary>{tableCount === undefined ? 'All numbers' : `All numbers (${tableCount})`}</summary>
              {table}
            </details>
          </>
        ) : (
          table
        )}
        <p className="sdv-visually-hidden" aria-live="polite" aria-atomic="true">
          {message}
        </p>
      </section>
    </PlaybackContext.Provider>
  );
}
