import type { SeriesVariant } from '../sim/TraceChart';
import './WindowBars.css';

/** How a slice of a window's bar was counted. Each kind has its own fill pattern. */
export type BarPart = 'counted' | 'open' | 'corrected' | 'side' | 'dropped';

export interface BarWindow {
  parts: { kind: BarPart; value: number }[];
  /** Clicks that happened in the window so far, drawn as a dashed outline. */
  truth: number;
}

interface Props {
  /** A sentence that describes the bars for screen readers. */
  label: string;
  windows: BarWindow[];
  scaleMax: number;
  variant: SeriesVariant;
  /** Counts above this line page on-call. */
  alert?: number;
  /** Current time and the run length in the same unit, for the "now" line. */
  now: number;
  length: number;
  /** The run length in seconds, for the time axis. */
  seconds: number;
  /** The watermark in the same unit as now, or null when the lane has none yet. */
  watermark?: number | null;
}

const percent = (value: number, max: number) =>
  `${Math.min(100, Math.max(0, (value / max) * 100)).toFixed(2)}%`;

/** Counts per tumbling window on a shared scale, one column per window. */
export function WindowBars({
  label,
  windows,
  scaleMax,
  variant,
  alert,
  now,
  length,
  seconds,
  watermark,
}: Props) {
  return (
    <div className="sdv-wbars" role="img" aria-label={label} data-variant={variant}>
      <div
        className="sdv-wbars__plot"
        style={{ gridTemplateColumns: `repeat(${windows.length}, minmax(0, 1fr))` }}
      >
        {windows.map((window, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: windows are fixed slots in time order
          <div key={index} className="sdv-wbars__col">
            <span className="sdv-wbars__stack">
              {window.parts
                .filter((part) => part.value > 0)
                .map((part) => (
                  <span
                    key={part.kind}
                    className="sdv-wbars__part"
                    data-kind={part.kind}
                    style={{ height: percent(part.value, scaleMax) }}
                  />
                ))}
            </span>
            {window.truth > 0 && (
              <span className="sdv-wbars__truth" style={{ height: percent(window.truth, scaleMax) }} />
            )}
          </div>
        ))}
        {alert !== undefined && (
          <span className="sdv-wbars__alert" style={{ bottom: percent(alert, scaleMax) }} />
        )}
        {watermark !== undefined && watermark !== null && watermark > 0 && (
          <span className="sdv-wbars__watermark" style={{ left: percent(watermark, length) }} />
        )}
        {now > 0 && now < length && (
          <span className="sdv-wbars__now" style={{ left: percent(now, length) }} />
        )}
      </div>
      <div className="sdv-wbars__axis">
        <span>0 s</span>
        <span>{seconds / 2} s</span>
        <span>{seconds} s</span>
      </div>
    </div>
  );
}

const keyText: Record<BarPart | 'truth' | 'alert' | 'now' | 'watermark', string> = {
  counted: 'Clicks counted (solid, in the lane color)',
  open: 'Counted so far, no result yet (hatched)',
  corrected: 'Late clicks added in an update (striped)',
  side: 'Late clicks in the side table (dotted)',
  dropped: 'Late clicks dropped (crossed)',
  truth: 'Clicks that happened in the window so far (dashed outline)',
  alert: 'Spike alert line',
  now: 'Now (solid line)',
  watermark: 'Watermark (dotted line)',
};

export type BarKey = keyof typeof keyText;

/** The legend for WindowBars, listing only the marks a widget uses. */
export function WindowBarsLegend({
  keys,
  labels = {},
}: {
  keys: BarKey[];
  labels?: Partial<Record<BarKey, string>>;
}) {
  return (
    <ul className="sdv-qtracks__legend" aria-label="How to read the window bars">
      {keys.map((key) => (
        <li key={key}>
          <span className="sdv-wbars__key" data-kind={key} aria-hidden="true" />
          {labels[key] ?? keyText[key]}
        </li>
      ))}
    </ul>
  );
}

/** Every number behind the bars, one row per window, folded away until a learner opens it. */
export function WindowTable({
  summary,
  caption,
  columns,
  rows,
}: {
  summary: string;
  caption: string;
  columns: string[];
  rows: { window: string; values: string[] }[];
}) {
  return (
    <details className="sdv-wbars__details">
      <summary>{summary}</summary>
      <table className="sdv-stats sdv-wbars__table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Window</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.window}>
              <th scope="row">{row.window}</th>
              {row.values.map((value, index) => (
                <td key={columns[index]}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
