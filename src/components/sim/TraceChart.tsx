import { useId, useRef, useState } from 'react';
import { niceScale } from '../../lib/niceScale';
import { safeId } from '../viz/SystemNode';
import { BADGE_SIZE, layoutMarkers } from './traceMarkers';
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

const BASE_HEIGHT = 190;
const pad = { top: 26, right: 12, bottom: 26, left: 36 };
const LANE_STEP = 22;
const BADGE_Y = 12;

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
  const listId = safeId(useId(), 'trace-markers');
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const width = useElementWidth(frameRef, 640);
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const atX = (tick: number) => pad.left + (tick / length) * plotWidth;
  const layout = layoutMarkers(
    markers.map((marker) => ({ number: marker.number, x: atX(marker.tick) })),
    2,
    width - 2,
  );
  const extra = (layout.lanes - 1) * LANE_STEP;
  const height = BASE_HEIGHT + extra;
  const top = pad.top + extra;
  const badgeY = (lane: number) => BADGE_Y + (layout.lanes - 1 - lane) * LANE_STEP;
  const plotHeight = height - top - pad.bottom;
  const highest = Math.max(minMax, ...series.flatMap((line) => line.values));
  const scale = niceScale(highest);
  const x = atX;
  const y = (value: number) => top + plotHeight - (value / scale.max) * plotHeight;
  const seconds = length * tickSeconds;
  const xTicks = Array.from({ length: Math.floor(seconds / 5) + 1 }, (_, index) => index * 5);
  const yTicks = Array.from(
    { length: Math.round(scale.max / scale.step) + 1 },
    (_, index) => index * scale.step,
  );

  const tickOf = new Map(markers.map((marker) => [marker.number, marker.tick]));
  const formatSeconds = (tick: number) => `${Number((tick * tickSeconds).toFixed(1))} s`;
  const groups = layout.labels.filter((label) => label.kind === 'group');
  const openLabel = groups.find((label) => label.numbers[0] === openGroup);

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
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
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
              y={height - 8}
              textAnchor={second === 0 ? 'start' : second === seconds ? 'end' : 'middle'}
            >
              {second} s
            </text>
          ))}
          {layout.labels.map((label) => (
            <g key={`m${label.numbers[0]}`} className="sdv-trace__marker">
              {label.xs.map((at, index) => (
                <g key={label.numbers[index]}>
                  <line x1={at} x2={at} y1={top - 4} y2={top + plotHeight} />
                  <line
                    className="sdv-trace__connector"
                    x1={label.x}
                    x2={at}
                    y1={badgeY(label.lane) + BADGE_SIZE / 2}
                    y2={top - 4}
                  />
                </g>
              ))}
            </g>
          ))}
          {layout.labels
            .filter((label) => label.kind === 'single')
            .map((label) => (
              <g key={`b${label.numbers[0]}`} className="sdv-trace__marker">
                <circle cx={label.x} cy={badgeY(label.lane)} r={BADGE_SIZE / 2} />
                <text x={label.x} y={badgeY(label.lane)} dy="0.35em" textAnchor="middle">
                  {label.text}
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
        {groups.map((label) => {
          const first = label.numbers[0] ?? 0;
          const last = label.numbers.at(-1) ?? first;
          const open = openGroup === first;
          return (
            <button
              key={`g${first}`}
              type="button"
              className="sdv-trace__group"
              style={{
                left: label.x - label.width / 2,
                top: badgeY(label.lane) - BADGE_SIZE / 2,
                width: label.width,
                height: BADGE_SIZE,
              }}
              aria-expanded={open}
              aria-controls={listId}
              aria-label={`Events ${first} to ${last}`}
              onClick={() => setOpenGroup(open ? null : first)}
            >
              {label.text}
            </button>
          );
        })}
      </div>
      <ul id={listId} className="sdv-trace__group-list" hidden={!openLabel}>
        {openLabel?.numbers.map((number) => (
          <li key={number}>
            Event {number} at {formatSeconds(tickOf.get(number) ?? 0)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
