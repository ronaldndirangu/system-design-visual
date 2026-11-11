import type { ReactNode } from 'react';
import type { LaneEventKind, ServeDuel } from '../../lib/models/llmServing';
import type { Tone } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant } from '../sim/TraceChart';
import { UiIcon } from '../viz/icons';
import './ServingParts.css';

export const laneVariants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

export function duelStatus(duel: ServeDuel): { tone: Tone; text: string } {
  if (duel.done) return { tone: 'ok', text: 'Run complete' };
  if (duel.ticks === 0) return { tone: 'neutral', text: 'Ready' };
  return { tone: 'neutral', text: `Step ${duel.ticks} of ${duel.length}` };
}

export function SkipButton({ onSkip, disabled }: { onSkip: () => void; disabled: boolean }) {
  return (
    <div className="sdv-duel__extra">
      <button type="button" className="sdv-button" onClick={onSkip} disabled={disabled}>
        Skip to the end
      </button>
    </div>
  );
}

const eventIcons: Partial<Record<LaneEventKind, 'warn' | 'ok' | 'bad'>> = {
  preempt: 'warn',
  rejoin: 'warn',
  wait: 'warn',
  held: 'bad',
  resume: 'ok',
  first: 'ok',
};

interface EventLogProps {
  duel: ServeDuel;
  /** Short lane names, used as a prefix on every line. */
  tags: [string, string];
  kinds: readonly LaneEventKind[];
  empty: string;
  limit?: number;
}

/** Transcript of both lanes, in step order, newest last. */
export function EventLog({ duel, tags, kinds, empty, limit = 10 }: EventLogProps) {
  const all = duel.lanes
    .flatMap((lane, lanePos) =>
      lane.events.filter((event) => kinds.includes(event.kind)).map((event) => ({ event, lanePos })),
    )
    .sort((a, b) => a.event.step - b.event.step || a.lanePos - b.lanePos);
  const shown = all.slice(-limit);
  return (
    <div className="sdv-trace__log">
      <p className="sdv-trace__log-title">What happened</p>
      {shown.length === 0 ? (
        <p className="sdv-trace__empty">{empty}</p>
      ) : (
        <ol className="sdv-serve-log">
          {shown.map(({ event, lanePos }) => {
            const icon = eventIcons[event.kind];
            return (
              <li key={`${lanePos}-${event.step}-${event.text}`} data-kind={event.kind}>
                <span className="sdv-serve-log__icon">{icon && <UiIcon name={icon} />}</span>
                <span className="sdv-serve-log__text">
                  <span className="sdv-serve-log__tag">
                    <SeriesSwatch variant={laneVariants[lanePos] ?? 'a'} />
                    {tags[lanePos]}, step {event.step}:
                  </span>{' '}
                  {event.text}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {all.length > shown.length && (
        <p className="sdv-trace__note">
          Showing the latest {shown.length} of {all.length} events.
        </p>
      )}
    </div>
  );
}

/** Pane wrapper for one side of a duel, titled with its series swatch. */
export function LanePane({
  label,
  variant,
  children,
}: {
  label: string;
  variant: SeriesVariant;
  children: ReactNode;
}) {
  return (
    <section className="sdv-duel__lane" aria-label={label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {label}
      </h4>
      {children}
    </section>
  );
}

export const toyNote = 'toy model, illustrative ms';
