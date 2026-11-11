import { useRef } from 'react';
import { niceScale } from '../../lib/niceScale';
import { useElementWidth } from './useElementWidth';

export type SeriesVariant = 'a' | 'b' | 'c';

/** Series styles in column order: solid, dashed, dotted. */
export const seriesVariants: readonly SeriesVariant[] = ['a', 'b', 'c'];

export interface TraceSeries {
  label: string;
  values: number[];
  variant: SeriesVariant;
}

export interface TraceMarker {
  tick: number;
  number: number;
}

interface Props {
  /** Names the metric and its unit, such as "Longest queue (requests)". */
  title: string;
  series: TraceSeries[];
  /** Total ticks in a run, so the time axis stays fixed while the lines grow. */
  length: number;
  tickSeconds: number;
  markers: TraceMarker[];
  /** The smallest axis maximum, so a flat line still sits low on the chart. */
  minMax?: number;
  /** Plain sentence describing the lines for screen readers. */
  summary: string;
}

const HEIGHT = 190;
const pad = { top: 26, right: 12, bottom: 26, left: 36 };
const MARKER_GAP = 24;

/** Solid, dashed, then dotted, so the lines differ without color. */
export function SeriesSwatch({ variant }: { variant: SeriesVariant }) {
  return (
    <svg className="sdv-swatch" width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
      <line x1="1" y1="5" x2="27" y2="5" className={`sdv-trace__line sdv-trace__line--${variant}`} />
    </svg>
  );
}

export function TraceChart({ title, series, length, tickSeconds, markers, minMax = 10, summary }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef, 640);
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = HEIGHT - pad.top - pad.bottom;
  const highest = Math.max(minMax, ...series.flatMap((line) => line.values));
  const scale = niceScale(highest);
  const x = (tick: number) => pad.left + (tick / length) * plotWidth;
  const y = (value: number) => pad.top + plotHeight - (value / scale.max) * plotHeight;
  const seconds = length * tickSeconds;
  const xTicks = Array.from({ length: Math.floor(seconds / 5) + 1 }, (_, index) => index * 5);
  const yTicks = Array.from(
    { length: Math.round(scale.max / scale.step) + 1 },
    (_, index) => index * scale.step,
  );

  let lastLabel = -Infinity;
  const placed = markers.map((marker) => {
    const at = x(marker.tick);
    const label = Math.min(pad.left + plotWidth, Math.max(at, lastLabel + MARKER_GAP));
    lastLabel = label;
    return { ...marker, x: at, label };
  });

  return (
    <figure className="sdv-trace">
      <figcaption className="sdv-trace__caption">
        <span className="sdv-trace__title">{title}</span>
        <span className="sdv-trace__legend">
          {series.map((line) => (
            <span key={line.label} className="sdv-trace__key">
              <SeriesSwatch variant={line.variant} />
              {line.label}
            </span>
          ))}
        </span>
      </figcaption>
      <div ref={frameRef} className="sdv-trace__frame">
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={summary}>
          {yTicks.map((value) => (
            <g key={`y${value}`}>
              <line
                className="sdv-trace__grid"
                x1={pad.left}
                x2={pad.left + plotWidth}
                y1={y(value)}
                y2={y(value)}
              />
              <text className="sdv-trace__tick" x={pad.left - 6} y={y(value)} dy="0.35em" textAnchor="end">
                {value}
              </text>
            </g>
          ))}
          {xTicks.map((second) => (
            <text
              key={`x${second}`}
              className="sdv-trace__tick"
              x={x(second / tickSeconds)}
              y={HEIGHT - 8}
              textAnchor={second === 0 ? 'start' : second === seconds ? 'end' : 'middle'}
            >
              {second} s
            </text>
          ))}
          {placed.map((marker) => (
            <g key={`m${marker.number}`} className="sdv-trace__marker">
              <line x1={marker.x} x2={marker.x} y1={pad.top - 4} y2={pad.top + plotHeight} />
              <circle cx={marker.label} cy={12} r="9" />
              <text x={marker.label} y={12} dy="0.35em" textAnchor="middle">
                {marker.number}
              </text>
            </g>
          ))}
          {series.map((line) => (
            <polyline
              key={line.label}
              className={`sdv-trace__line sdv-trace__line--${line.variant}`}
              points={[
                `${x(0)},${y(0)}`,
                ...line.values.map((value, tick) => `${x(tick + 1)},${y(value)}`),
              ].join(' ')}
            />
          ))}
        </svg>
      </div>
    </figure>
  );
}
