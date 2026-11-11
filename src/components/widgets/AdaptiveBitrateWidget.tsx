import { useReducer, useRef, useState } from 'react';
import {
  bufferedSeconds,
  LADDER,
  MAX_BUFFER_SECONDS,
  SEGMENT_SECONDS,
  START_BUFFER_SECONDS,
  STREAM_SECONDS,
  StreamDuel,
  type StreamEvent,
  type StreamLane,
  type StreamScenarioId,
  streamScenarios,
  summarize,
  TUNNELS,
} from '../../lib/models/videoStreaming';
import { niceScale } from '../../lib/niceScale';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant } from '../sim/TraceChart';
import { useElementWidth } from '../sim/useElementWidth';
import { useHydrated } from '../sim/useHydrated';
import './AdaptiveBitrateWidget.css';

interface Props {
  scenarios?: StreamScenarioId[];
  initial?: StreamScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
/** Six half second ticks per real second, so 1× speed plays the video three times faster than real time. */
const TICKS_PER_SECOND = 6;
/** Recent segments shown per lane, including the one downloading. */
const SEGMENT_SLOTS = 8;

const rungLabel = (rung: number) => LADDER[rung]?.label ?? '';
const rungMbps = (rung: number) => LADDER[rung]?.mbps ?? 0;
const oneDecimal = (value: number) => Number(value.toFixed(1)).toString();
const currentRung = (lane: StreamLane) => lane.download?.rung ?? lane.completed.at(-1)?.rung ?? null;

const playStates: Record<StreamLane['state'], { tone: Tone; text: string }> = {
  starting: { tone: 'neutral', text: 'Starting' },
  playing: { tone: 'ok', text: 'Playing' },
  stalled: { tone: 'bad', text: 'Stalled' },
};

function LanePane({
  lane,
  variant,
  started,
}: {
  lane: StreamLane;
  variant: SeriesVariant;
  started: boolean;
}) {
  const buffered = bufferedSeconds(lane);
  const state = playStates[lane.state];
  const download = lane.download;
  const recent = lane.completed.slice(-(download ? SEGMENT_SLOTS - 1 : SEGMENT_SLOTS));
  const fetching = download
    ? `Fetching segment ${download.index + 1} at ${rungLabel(download.rung)}, ${Math.floor((download.doneMegabits / download.sizeMegabits) * 100)}% done`
    : started
      ? 'Buffer full, waiting before the next fetch'
      : 'Waiting for Play';

  return (
    <section className="sdv-duel__lane sdv-abr__lane" data-variant={variant} aria-label={lane.label}>
      <div className="sdv-abr__head">
        <h4 className="sdv-duel__lane-title">
          <SeriesSwatch variant={variant} />
          {lane.label}
        </h4>
        <ToneBadge tone={state.tone}>{state.text}</ToneBadge>
      </div>
      <div className="sdv-abr__buffer">
        <p className="sdv-abr__line">
          Buffer <strong>{oneDecimal(buffered)} s</strong> of {MAX_BUFFER_SECONDS} s
        </p>
        <div className="sdv-abr__meter" aria-hidden="true">
          {lane.buffer.map((piece, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: buffered pieces have no identity beyond their position
              key={index}
              className="sdv-abr__piece"
              style={{ width: `${(piece.seconds / MAX_BUFFER_SECONDS) * 100}%` }}
            />
          ))}
          <span
            className="sdv-abr__start"
            style={{ left: `${(START_BUFFER_SECONDS / MAX_BUFFER_SECONDS) * 100}%` }}
          />
        </div>
      </div>
      {recent.length === 0 && !download ? (
        <p className="sdv-abr__line sdv-abr__muted">No segments downloaded yet</p>
      ) : (
        <ol className="sdv-abr__segments" aria-label="Latest segments, oldest first">
          {recent.map((segment) => (
            <li key={segment.index} className="sdv-abr__segment">
              <span className="sdv-abr__bar" aria-hidden="true">
                <span
                  className="sdv-abr__fill"
                  style={{ height: `${((segment.rung + 1) / LADDER.length) * 100}%` }}
                />
              </span>
              <span className="sdv-abr__rung">{rungLabel(segment.rung)}</span>
            </li>
          ))}
          {download && (
            <li key={`d${download.index}`} className="sdv-abr__segment" data-loading="">
              <span className="sdv-abr__bar" aria-hidden="true">
                <span
                  className="sdv-abr__slot"
                  style={{ height: `${((download.rung + 1) / LADDER.length) * 100}%` }}
                >
                  <span
                    className="sdv-abr__fill"
                    style={{ height: `${(download.doneMegabits / download.sizeMegabits) * 100}%` }}
                  />
                </span>
              </span>
              <span className="sdv-abr__rung">
                {rungLabel(download.rung)}
                <span className="sdv-visually-hidden"> downloading</span>
              </span>
            </li>
          )}
        </ol>
      )}
      <p className="sdv-abr__line sdv-abr__muted">{fetching}</p>
    </section>
  );
}

const CHART_ROW = 20;
const CHART_ROWS = 3;
const MARKER_GAP = 22;
const TOP_PANEL = 120;
const BOTTOM_PANEL = 80;
const pad = { left: 36, right: 12, title: 18, between: 30, bottom: 24 };

interface ChartProps {
  duel: StreamDuel;
  markers: { at: number; number: number }[];
}

/** Two stacked panels on one time axis: network and bitrate on top, buffer below. */
function RunChart({ duel, markers }: ChartProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef, 640);
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const markerArea = CHART_ROWS * CHART_ROW + 6;
  const topY = markerArea + pad.title;
  const bottomY = topY + TOP_PANEL + pad.between;
  const height = bottomY + BOTTOM_PANEL + pad.bottom;
  const [fixed, adaptive] = duel.lanes;
  const ts = duel.tickSeconds;
  const seen = duel.bandwidth.slice(0, duel.ticks);

  const scale = niceScale(Math.max(6, ...duel.bandwidth));
  const x = (seconds: number) => pad.left + (seconds / STREAM_SECONDS) * plotWidth;
  const yTop = (mbps: number) => topY + TOP_PANEL - (mbps / scale.max) * TOP_PANEL;
  const yBottom = (seconds: number) => bottomY + BOTTOM_PANEL - (seconds / MAX_BUFFER_SECONDS) * BOTTOM_PANEL;
  const steps = (values: number[]) =>
    values.flatMap((value, tick) => [
      `${x(tick * ts)},${yTop(value)}`,
      `${x((tick + 1) * ts)},${yTop(value)}`,
    ]);
  const area =
    seen.length === 0
      ? ''
      : `M${x(0)},${yTop(0)} L${steps(seen).join(' L')} L${x(seen.length * ts)},${yTop(0)} Z`;
  const bufferLine = (values: number[]) =>
    [`${x(0)},${yBottom(0)}`, ...values.map((value, tick) => `${x((tick + 1) * ts)},${yBottom(value)}`)].join(
      ' ',
    );

  const xStep = plotWidth < 420 ? 15 : 10;
  const xTicks = Array.from({ length: Math.floor(STREAM_SECONDS / xStep) + 1 }, (_, index) => index * xStep);
  const topTicks = Array.from(
    { length: Math.round(scale.max / scale.step) + 1 },
    (_, index) => index * scale.step,
  );
  const bottomTicks = [0, MAX_BUFFER_SECONDS / 2, MAX_BUFFER_SECONDS];

  const lastInRow: number[] = Array.from({ length: CHART_ROWS }, () => -Infinity);
  const placed = markers.map((marker) => {
    const at = x(marker.at);
    let row = lastInRow.findIndex((last) => at >= last + MARKER_GAP);
    let label = at;
    if (row === -1) {
      row = lastInRow.indexOf(Math.min(...lastInRow));
      label = (lastInRow[row] ?? at) + MARKER_GAP;
    }
    label = Math.min(pad.left + plotWidth - 4, label);
    lastInRow[row] = label;
    return { ...marker, x: at, label, cy: row * CHART_ROW + 11 };
  });

  const latest = (values: number[]) => values.at(-1) ?? 0;
  const summary =
    duel.ticks === 0
      ? `Chart of network bandwidth, the bitrate each player fetches, and each buffer over ${STREAM_SECONDS} s. Empty until the run starts.`
      : `After ${oneDecimal(duel.ticks * ts)} s: network ${oneDecimal(duel.bandwidthNow)} Mbps. ${fixed.label} fetches ${oneDecimal(latest(fixed.bitrateSeries))} Mbps with ${oneDecimal(latest(fixed.bufferSeries))} s buffered. ${adaptive.label} fetches ${oneDecimal(latest(adaptive.bitrateSeries))} Mbps with ${oneDecimal(latest(adaptive.bufferSeries))} s buffered. ${markers.length} numbered events.`;

  return (
    <figure className="sdv-trace sdv-abr__chart">
      <figcaption className="sdv-trace__caption">
        <span className="sdv-trace__title">Network, bitrate, and buffer</span>
        <span className="sdv-trace__legend">
          <span className="sdv-trace__key">
            <span className="sdv-abr__area-key" aria-hidden="true" />
            Network bandwidth
          </span>
          {duel.lanes.map((lane, index) => (
            <span key={lane.id} className="sdv-trace__key">
              <SeriesSwatch variant={variants[index] ?? 'a'} />
              {lane.label}
            </span>
          ))}
          <span className="sdv-trace__key">
            <span className="sdv-abr__threshold-key" aria-hidden="true" />
            {START_BUFFER_SECONDS} s buffered: playback can start
          </span>
        </span>
      </figcaption>
      <div ref={frameRef} className="sdv-trace__frame">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
          <text className="sdv-abr__panel-title" x={pad.left} y={topY - 6}>
            Bandwidth and bitrate fetched (Mbps)
          </text>
          <text className="sdv-abr__panel-title" x={pad.left} y={bottomY - 6}>
            Buffer (seconds of video ready)
          </text>
          {topTicks.map((value) => (
            <g key={`t${value}`}>
              <line
                className="sdv-trace__grid"
                x1={pad.left}
                x2={pad.left + plotWidth}
                y1={yTop(value)}
                y2={yTop(value)}
              />
              <text className="sdv-trace__tick" x={pad.left - 6} y={yTop(value)} dy="0.35em" textAnchor="end">
                {value}
              </text>
            </g>
          ))}
          {bottomTicks.map((value) => (
            <g key={`b${value}`}>
              <line
                className="sdv-trace__grid"
                x1={pad.left}
                x2={pad.left + plotWidth}
                y1={yBottom(value)}
                y2={yBottom(value)}
              />
              <text
                className="sdv-trace__tick"
                x={pad.left - 6}
                y={yBottom(value)}
                dy="0.35em"
                textAnchor="end"
              >
                {value}
              </text>
            </g>
          ))}
          <line
            className="sdv-abr__threshold"
            x1={pad.left}
            x2={pad.left + plotWidth}
            y1={yBottom(START_BUFFER_SECONDS)}
            y2={yBottom(START_BUFFER_SECONDS)}
          />
          {xTicks.map((second) => (
            <text
              key={`x${second}`}
              className="sdv-trace__tick"
              x={x(second)}
              y={height - 8}
              textAnchor={second === 0 ? 'start' : second === STREAM_SECONDS ? 'end' : 'middle'}
            >
              {second} s
            </text>
          ))}
          {area && <path className="sdv-abr__area" d={area} />}
          {duel.lanes.map((lane, index) => (
            <polyline
              key={`r${lane.id}`}
              className={`sdv-trace__line sdv-trace__line--${variants[index] ?? 'a'}`}
              points={steps(lane.bitrateSeries).join(' ')}
            />
          ))}
          {duel.lanes.map((lane, index) => (
            <polyline
              key={`f${lane.id}`}
              className={`sdv-trace__line sdv-trace__line--${variants[index] ?? 'a'}`}
              points={bufferLine(lane.bufferSeries)}
            />
          ))}
          {placed.map((marker) => (
            <g key={`m${marker.number}`} className="sdv-trace__marker">
              <line x1={marker.x} x2={marker.x} y1={marker.cy + 9} y2={bottomY + BOTTOM_PANEL} />
              <circle cx={marker.label} cy={marker.cy} r="9" />
              <text x={marker.label} y={marker.cy} dy="0.35em" textAnchor="middle">
                {marker.number}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}

function EventLog({ events }: { events: StreamEvent[] }) {
  let number = 0;
  return (
    <div className="sdv-trace__log">
      <p className="sdv-trace__log-title">What happened</p>
      {events.length === 0 ? (
        <p className="sdv-trace__empty">
          Events appear here as the run plays. Numbered ones match the chart.
        </p>
      ) : (
        <ol>
          {events.map((event) => {
            if (event.marker) number += 1;
            return (
              <li key={`${event.at}-${event.text}`}>
                {event.marker ? (
                  <span className="sdv-trace__num" aria-hidden="true">
                    {number}
                  </span>
                ) : (
                  <span className="sdv-abr__nonum" aria-hidden="true" />
                )}
                <time>{oneDecimal(event.at)} s</time> {event.text}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const inTunnel = (seconds: number) => TUNNELS.some(([start, end]) => seconds >= start && seconds < end);

export default function AdaptiveBitrateWidget({
  scenarios = ['steady', 'tunnels', 'crowded'],
  initial,
  title = 'Fixed 1080p versus adaptive ladder',
  instructions = 'Toy model of the first 90 s of a long video. Pick a network, then press Play; 1× speed runs three times faster than real time. Both players stream the same video over the same bandwidth trace, and only the bitrate choice differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<StreamScenarioId>(initial ?? scenarios[0] ?? 'tunnels');
  const duelRef = useRef<StreamDuel | null>(null);
  if (!duelRef.current) duelRef.current = new StreamDuel(streamScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: StreamScenarioId) => {
    duelRef.current = new StreamDuel(streamScenarios[id]);
    rerender();
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };
  const chooseScenario = (id: StreamScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [fixed, adaptive] = duel.lanes;
  const sums = [summarize(fixed), summarize(adaptive)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const bothStarted = sums[0].startupSeconds !== null && sums[1].startupSeconds !== null;
  const bothPlayed = sums[0].playedSeconds > 0 && sums[1].playedSeconds > 0;

  const rows: CompareRow[] = [
    {
      label: 'Startup time',
      values: [sums[0].startupSeconds ?? 0, sums[1].startupSeconds ?? 0],
      format: (value, column) =>
        sums[column]?.startupSeconds === null ? 'not yet' : `${oneDecimal(value)} s`,
      better: bothStarted ? 'lower' : undefined,
    },
    { label: 'Stalls', values: [sums[0].stalls, sums[1].stalls], better: 'lower' },
    {
      label: 'Rebuffering (seconds stalled)',
      values: [sums[0].rebufferSeconds, sums[1].rebufferSeconds],
      format: (value) => `${oneDecimal(value)} s`,
      better: 'lower',
    },
    {
      label: 'Video watched',
      values: [sums[0].playedSeconds, sums[1].playedSeconds],
      format: (value) => `${oneDecimal(value)} s`,
      better: 'higher',
    },
    {
      label: 'Average bitrate watched',
      values: [sums[0].averageMbps, sums[1].averageMbps],
      format: (value, column) =>
        (sums[column]?.playedSeconds ?? 0) > 0 ? `${oneDecimal(value)} Mbps` : 'none yet',
      better: bothPlayed ? 'higher' : undefined,
    },
    { label: 'Quality switches', values: [sums[0].switches, sums[1].switches], better: 'lower' },
    {
      label: 'Downloads dropped and refetched',
      values: [sums[0].abandoned, sums[1].abandoned],
      better: 'lower',
    },
  ];

  const laneText = (lane: StreamLane, index: 0 | 1) => {
    const rung = currentRung(lane);
    const quality = rung === null ? '' : ` at ${rungLabel(rung)}`;
    const stalls = sums[index].stalls;
    return `${lane.label}: ${playStates[lane.state].text.toLowerCase()}${quality}, ${oneDecimal(bufferedSeconds(lane))} s buffered, ${stalls} ${stalls === 1 ? 'stall' : 'stalls'}`;
  };
  const summary = `${oneDecimal(seconds)} s of ${STREAM_SECONDS} s. ${laneText(fixed, 0)}. ${laneText(adaptive, 1)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const tunnelNow = duel.scenario.id === 'tunnels' && duel.ticks > 0 && inTunnel(seconds - duel.tickSeconds);
  const ladderFits = LADDER.filter((rung) => rung.mbps <= duel.bandwidthNow).at(-1);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${oneDecimal(seconds)} s of ${STREAM_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={scenarioId}
      ticksPerSecond={TICKS_PER_SECOND}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same network for both players"
          columns={[fixed.label, adaptive.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Network"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: streamScenarios[id].label,
          diff: streamScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <p className="sdv-abr__now">
        {duel.ticks === 0 ? 'Network at the start: ' : 'Network now: '}
        <strong>{oneDecimal(duel.bandwidthNow)} Mbps</strong>
        {tunnelNow ? ', inside a tunnel' : ''}. The highest rung that fits is{' '}
        <strong>
          {ladderFits
            ? `${ladderFits.label} (${oneDecimal(ladderFits.mbps)} Mbps)`
            : `none, even ${rungLabel(0)} needs ${rungMbps(0)} Mbps`}
        </strong>
        .
      </p>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.id} lane={lane} variant={variants[index] ?? 'a'} started={duel.ticks > 0} />
        ))}
      </div>
      <ul className="sdv-legend" aria-label="How to read the lanes">
        <li>
          <span className="sdv-abr__legend-bar" aria-hidden="true" />
          Taller block, higher rung:{' '}
          {LADDER.map((rung) => `${rung.label} ${oneDecimal(rung.mbps)} Mbps`).join(', ')}
        </li>
        <li>
          Each segment holds {SEGMENT_SECONDS} s of video. Playback starts, or resumes, once{' '}
          {START_BUFFER_SECONDS} s are buffered (the dashed tick).
        </li>
      </ul>
      <RunChart
        duel={duel}
        markers={markerEvents.map((event, index) => ({ at: event.at, number: index + 1 }))}
      />
      <EventLog events={duel.events} />
    </SimulationShell>
  );
}
