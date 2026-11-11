export interface LoadBar {
  id: string | number;
  label: string;
  /** Fill from 0 to 1. Values above 1 draw full and flagged. */
  fill: number;
  value: string;
  /** Marks the row as out of action (crossed out, dimmed). */
  down?: boolean;
  /** Extra attributes such as data-shard for per-row colors. */
  data?: Record<`data-${string}`, string>;
}

interface LoadBarsProps {
  bars: LoadBar[];
  label: string;
  /** Draw a reference mark at this fraction of the track, for example an even share. */
  target?: { at: number; label: string };
  /** Append "(full)" to rows at or above a fill of 1. */
  flagFull?: boolean;
}

/** Horizontal load meters with text values, used as the non-animated readout of node load. */
export function LoadBars({ bars, label, target, flagFull = true }: LoadBarsProps) {
  return (
    <ul className="sdv-bars" aria-label={label}>
      {bars.map((bar) => {
        const full = flagFull && bar.fill >= 1;
        return (
          <li key={bar.id} data-down={bar.down ? 'true' : undefined} {...bar.data}>
            <span className="sdv-bars__label">{bar.label}</span>
            <span className="sdv-bars__track" aria-hidden="true">
              <span
                className="sdv-bars__fill"
                style={{ width: `${Math.min(1, Math.max(0, bar.fill)) * 100}%` }}
                data-full={full ? 'true' : undefined}
              />
              {target && (
                <span
                  className="sdv-bars__target"
                  style={{ left: `${target.at * 100}%` }}
                  title={target.label}
                />
              )}
            </span>
            <span className="sdv-bars__value">
              {bar.value}
              {full && !bar.down ? ' (full)' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
