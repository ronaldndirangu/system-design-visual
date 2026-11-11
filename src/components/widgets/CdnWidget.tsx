import { useReducer, useRef, useState } from 'react';
import {
  CDN_SECONDS,
  CdnDuel,
  type CdnLane,
  type CdnSample,
  type CdnScenarioId,
  CITIES,
  type ClickPath,
  cdnScenarioIds,
  cdnScenarios,
  summarizeCdnLane,
} from '../../lib/models/cdn';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots, type Point } from '../viz/FlowDots';
import { KindIcon } from '../viz/icons';
import './CdnWidget.css';

const ORIGIN_X = 60;
const MAP_WIDTH = 420;
const MAP_KM = 16000;
const ROW_TOP = 34;
const ROW_GAP = 38;
const RULER_Y = 212;
const EDGE_MIN_X = 72;
const VIEW_WIDTH = 560;
const DOT_PX_PER_SECOND = 780;
const DOT_MIN_SECONDS = 0.4;
const DOT_STEP_PX = 24;
const MAX_DOTS = 24;
const variants: readonly SeriesVariant[] = ['a', 'b'];

const PATH_TEXT: Record<ClickPath, string> = {
  direct: 'crossed to the origin',
  'edge-hit': 'answered at the edge',
  'shield-hit': 'answered by the shield',
  'edge-miss': 'missed the edge, fetched from the origin',
};

const METRIC_CHART = {
  latency: { title: 'Average click latency (ms, last second)', minMax: 500 },
  origin: { title: 'Requests reaching origin per second', minMax: 200 },
  counted: { title: 'Clicks counted so far (%)', minMax: 100 },
} as const;

const cityX = (km: number) => ORIGIN_X + (km * MAP_WIDTH) / MAP_KM;
const rowY = (index: number) => ROW_TOP + index * ROW_GAP;
const edgeX = (km: number) => Math.max(cityX(km), EDGE_MIN_X);

function formatMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : ms.toFixed(0);
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** Spreads points evenly along the path so a dot moves at one steady speed. */
function resample(points: readonly Point[]): { points: Point[]; length: number } {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as Point;
    const [bx, by] = points[i] as Point;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(bx - ax, by - ay));
  }
  const total = lengths.at(-1) ?? 0;
  const steps = Math.max(2, Math.ceil(total / DOT_STEP_PX));
  const out: Point[] = [];
  let segment = 1;
  for (let s = 0; s <= steps; s++) {
    const target = (total * s) / steps;
    while (segment < points.length - 1 && (lengths[segment] ?? 0) < target) segment++;
    const [ax, ay] = points[segment - 1] as Point;
    const [bx, by] = points[segment] as Point;
    const start = lengths[segment - 1] ?? 0;
    const span = (lengths[segment] ?? 0) - start;
    const t = span > 0 ? (target - start) / span : 0;
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return { points: out, length: total };
}

interface LiveDot extends Flow {
  bornMs: number;
}

function dotFor(sample: CdnSample, id: string, bornMs: number): LiveDot | null {
  const city = CITIES[sample.city];
  if (!city) return null;
  const y = rowY(sample.city);
  const c: Point = [cityX(city.km), y];
  const o: Point = [ORIGIN_X, y];
  const hop: Point = [edgeX(city.km), y - 12];
  const raw: Point[] =
    sample.path === 'direct'
      ? [c, o, c, o, c, o, c]
      : sample.path === 'edge-hit'
        ? [c, hop, c]
        : [c, hop, o, hop, c];
  const { points, length } = resample(raw);
  return {
    id,
    points,
    tone: sample.path === 'direct' ? 'request' : sample.path === 'edge-hit' ? 'hit' : 'miss',
    duration: Math.max(DOT_MIN_SECONDS, length / DOT_PX_PER_SECOND),
    bornMs,
  };
}

function latestSample(lane: CdnLane, ticks: number): CdnSample | undefined {
  return ticks > 0 ? lane.samples[ticks - 1]?.[0] : undefined;
}

function LanePane({
  lane,
  variant,
  dots,
  latest,
}: {
  lane: CdnLane;
  variant: SeriesVariant;
  dots: readonly Flow[];
  latest: CdnSample | undefined;
}) {
  const withCdn = lane.id === 'cdn';
  const shield = withCdn && lane.model.settings.shield;
  const stats = lane.model.cityStats;
  const latestCity = latest ? CITIES[latest.city] : undefined;
  const latestText =
    latest && latestCity
      ? ` Latest click: ${latestCity.name}, ${PATH_TEXT[latest.path]}, ${formatMs(latest.ms)} ms.`
      : ' No clicks yet.';
  const label = `${lane.label}: five cities placed by distance from the origin in Virginia${
    withCdn ? ', each with an edge server beside it' : ''
  }${shield ? ', plus an origin shield' : ''}.${latestText}`;

  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <DiagramScroll label="Scrollable diagram">
        <svg viewBox={`0 0 ${VIEW_WIDTH} 240`} role="img" aria-label={label} className="sdv-cdn__map">
          <rect className="sdv-cdn__site" x={4} y={10} width={ORIGIN_X - 4} height={190} rx={8} />
          <text className="sdv-node__sublabel" x={32} y={26} textAnchor="middle">
            Virginia
          </text>
          <g className="sdv-node sdv-node--server">
            <KindIcon kind="server" size={22} x={21} y={36} />
            <text className="sdv-node__label sdv-cdn__site-label" x={32} y={76} textAnchor="middle">
              Origin
            </text>
          </g>
          {shield && (
            <g className="sdv-node sdv-node--cdn">
              <KindIcon kind="cdn" size={22} x={21} y={112} />
              <text className="sdv-node__label sdv-cdn__site-label" x={32} y={152} textAnchor="middle">
                Shield
              </text>
            </g>
          )}
          {CITIES.map((city, index) => {
            const y = rowY(index);
            const x = cityX(city.km);
            const ex = edgeX(city.km);
            const stat = stats[index];
            const isLatest = latest?.city === index;
            const crossed = isLatest && latest?.path !== 'edge-hit';
            const atEdge = isLatest && latest?.path === 'edge-hit';
            const mean =
              stat && stat.clicks > 0 ? `avg ${formatMs(stat.latencyMs / stat.clicks)} ms` : 'no clicks yet';
            return (
              <g key={city.name}>
                <line
                  className={`sdv-edge${withCdn ? ' sdv-edge--dashed' : ''}${crossed ? ' sdv-edge--active' : ''}`}
                  x1={ORIGIN_X}
                  y1={y}
                  x2={x}
                  y2={y}
                />
                {withCdn && (
                  <>
                    <line
                      className={`sdv-edge${atEdge ? ' sdv-edge--active' : ''}`}
                      x1={x}
                      y1={y}
                      x2={ex}
                      y2={y - 6}
                    />
                    <g className="sdv-node sdv-node--cdn">
                      <KindIcon kind="cdn" size={16} x={ex - 8} y={y - 22} />
                    </g>
                  </>
                )}
                <circle className="sdv-cdn__city" cx={x} cy={y} r={4} />
                <text className="sdv-node__sublabel" x={66} y={y + 15}>
                  {city.name}, {formatCount(city.km)} km
                </text>
                <text
                  className={`sdv-node__sublabel sdv-cdn__mean${isLatest ? ' sdv-cdn__mean--latest' : ''}`}
                  x={VIEW_WIDTH - 6}
                  y={y + 15}
                  textAnchor="end"
                >
                  {mean}
                </text>
              </g>
            );
          })}
          <g className="sdv-cdn__ruler">
            <line x1={ORIGIN_X} y1={RULER_Y} x2={ORIGIN_X + MAP_WIDTH} y2={RULER_Y} />
            {[0, 5000, 10000, 15000].map((km) => (
              <g key={km}>
                <line x1={cityX(km)} y1={RULER_Y - 4} x2={cityX(km)} y2={RULER_Y + 4} />
                <text className="sdv-node__sublabel" x={cityX(km)} y={RULER_Y + 20} textAnchor="middle">
                  {km === 0 ? '0 km' : km === 15000 ? '15,000 km' : formatCount(km)}
                </text>
              </g>
            ))}
          </g>
          <FlowDots flows={dots} radius={4} />
        </svg>
      </DiagramScroll>
    </section>
  );
}

export interface CdnWidgetProps {
  scenarios?: readonly CdnScenarioId[];
  initial?: CdnScenarioId;
  title?: string;
  instructions?: string;
}

export default function CdnWidget({
  scenarios = cdnScenarioIds,
  initial,
  title = 'Same clicks, with and without a CDN',
  instructions = 'Pick a scenario, then press Play. Both panes receive the exact same clicks from the same cities; only the CDN differs.',
}: CdnWidgetProps) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<CdnScenarioId>(initial ?? scenarios[0] ?? 'worldwide');
  const duelRef = useRef<CdnDuel | null>(null);
  if (!duelRef.current) duelRef.current = new CdnDuel(cdnScenarios[scenarioId]);
  const duel = duelRef.current;
  const dotsRef = useRef<LiveDot[][]>([[], []]);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const clearDots = () => {
    dotsRef.current = [[], []];
  };

  const restart = (id: CdnScenarioId) => {
    duelRef.current = new CdnDuel(cdnScenarios[id]);
    clearDots();
    rerender();
  };

  const onTick = () => {
    duel.step();
    const now = performance.now();
    dotsRef.current = duel.lanes.map((lane, index) => {
      const alive = (dotsRef.current[index] ?? []).filter(
        (dot) => now - dot.bornMs < (dot.duration + 0.15) * 1000,
      );
      const sample = latestSample(lane, duel.ticks);
      if (sample && alive.length < MAX_DOTS) {
        const dot = dotFor(sample, `${lane.id}-${duel.ticks}`, now);
        if (dot) alive.push(dot);
      }
      return alive;
    });
    rerender();
  };

  const skipToEnd = () => {
    while (!duel.done) duel.step();
    clearDots();
    rerender();
  };

  const chooseScenario = (id: CdnScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const scenario = duel.scenario;
  const [first, second] = duel.lanes;
  const [a, b] = duel.lanes.map((lane) => summarizeCdnLane(lane.model));
  if (!a || !b) return null;
  const seconds = duel.ticks * duel.tickSeconds;
  const hasData = a.clicks > 0;
  const shield = scenario.config.shield;

  const rows: CompareRow[] = [
    { label: 'Clicks', values: [a.clicks, b.clicks], format: formatCount },
    {
      label: 'Mean latency (ms)',
      values: [a.meanMs, b.meanMs],
      format: formatMs,
      better: hasData ? 'lower' : undefined,
    },
    {
      label: '95th percentile latency (ms)',
      values: [a.p95Ms, b.p95Ms],
      format: formatMs,
      better: hasData ? 'lower' : undefined,
    },
    {
      label: 'Answered at the edge (%)',
      values: [a.edgeHitRatio * 100, b.edgeHitRatio * 100],
      format: (value) => value.toFixed(0),
      better: hasData ? 'higher' : undefined,
    },
    ...(shield
      ? [
          {
            label: 'Answered by the shield',
            values: [a.shieldHits, b.shieldHits] as [number, number],
            format: formatCount,
          },
        ]
      : []),
    {
      label: 'Requests reaching origin',
      values: [a.originRequests, b.originRequests],
      format: formatCount,
      better: hasData ? 'lower' : undefined,
    },
    {
      label: 'Clicks counted (%)',
      values: [a.countedPercent, b.countedPercent],
      format: (value) => value.toFixed(0),
      better: hasData ? 'higher' : undefined,
    },
  ];

  const describeLane = (label: string, summary: typeof a) =>
    `${label}: mean ${formatMs(summary.meanMs)} ms, ${(summary.edgeHitRatio * 100).toFixed(0)}% answered at the edge, ${formatCount(summary.originRequests)} requests reached the origin, ${summary.countedPercent.toFixed(0)}% of clicks counted`;
  const summary = hasData
    ? `${seconds.toFixed(1)} s of ${CDN_SECONDS} s. ${describeLane(first?.label ?? 'Origin only', a)}. ${describeLane(second?.label ?? 'With CDN', b)}.`
    : `Ready. Press Play to send the same ${scenario.label.toLowerCase()} clicks to both panes.`;

  const chart = METRIC_CHART[scenario.metric];
  const latest = (lane: CdnLane | undefined) => {
    const value = lane?.series.at(-1);
    return value === undefined ? 'no data' : formatMs(value);
  };
  const chartSummary = `${chart.title}. ${first?.label} now ${latest(first)}, ${second?.label} now ${latest(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${CDN_SECONDS} s` } as const);

  const cityRows = CITIES.map((city, index) => {
    const origin = first?.model.cityStats[index];
    const cdn = second?.model.cityStats[index];
    const mean = (stat: typeof origin) =>
      stat && stat.clicks > 0 ? formatMs(stat.latencyMs / stat.clicks) : 'none yet';
    const edge = cdn && cdn.clicks > 0 ? `${((cdn.edgeHits / cdn.clicks) * 100).toFixed(0)}` : 'none yet';
    return { city, origin: mean(origin), cdn: mean(cdn), edge };
  });

  return (
    <MotionRoot>
      <SimulationShell
        title={title}
        instructions={instructions}
        onTick={onTick}
        onReset={() => restart(scenarioId)}
        summary={summary}
        status={status}
        finished={duel.done}
        resetKey={scenarioId}
        controls={
          <div className="sdv-duel__extra">
            <button
              type="button"
              className="sdv-button"
              onClick={skipToEnd}
              disabled={!hydrated || duel.done}
            >
              Skip to the end
            </button>
          </div>
        }
        readout={
          <>
            <CompareTable
              caption="Whole run so far, same clicks for both"
              columns={[first?.label ?? 'Origin only', second?.label ?? 'With CDN']}
              rows={rows}
            />
            <DiagramScroll label="Scrollable table">
              <table className="sdv-cdn__cities">
                <caption>Average click latency by city (ms)</caption>
                <thead>
                  <tr>
                    <th scope="col">City</th>
                    <th scope="col">Distance</th>
                    <th scope="col">{first?.label}</th>
                    <th scope="col">{second?.label}</th>
                    <th scope="col">Answered at edge (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {cityRows.map((row) => (
                    <tr key={row.city.name}>
                      <th scope="row">{row.city.name}</th>
                      <td>{formatCount(row.city.km)} km</td>
                      <td>{row.origin}</td>
                      <td>{row.cdn}</td>
                      <td>{row.edge}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DiagramScroll>
          </>
        }
      >
        <ScenarioChips
          label="Scenario"
          value={scenarioId}
          options={scenarios.map((id) => ({
            value: id,
            label: cdnScenarios[id].label,
            diff: cdnScenarios[id].diff,
          }))}
          onChange={chooseScenario}
        />
        <div className="sdv-duel__lanes sdv-cdn__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane
              key={lane.id}
              lane={lane}
              variant={variants[index] ?? 'a'}
              dots={dotsRef.current[index] ?? []}
              latest={latestSample(lane, duel.ticks)}
            />
          ))}
        </div>
        <p className="sdv-cdn__note">
          Distances are to scale. Dots move at one slow speed, so a longer trip takes visibly longer. An edge
          hit is a short hop to the edge icon and back.
        </p>
        <ul className="sdv-legend sdv-cdn__legend" aria-label="How to read the map">
          <li>
            <span className="sdv-cdn__key sdv-cdn__key--hit" aria-hidden="true" /> Answered at the edge (short
            hop)
          </li>
          <li>
            <span className="sdv-cdn__key sdv-cdn__key--miss" aria-hidden="true" /> Edge miss, crossed to the
            {shield ? ' shield or origin' : ' origin'}
          </li>
          <li>
            <span className="sdv-cdn__key sdv-cdn__key--origin" aria-hidden="true" /> Origin only, three round
            trips
          </li>
          <li>
            <svg className="sdv-cdn__key-icon" viewBox="0 0 16 16" aria-hidden="true">
              <g className="sdv-node sdv-node--cdn">
                <KindIcon kind="cdn" size={16} />
              </g>
            </svg>
            Edge server, about 50 km from its city
          </li>
        </ul>
        <TraceChart
          title={chart.title}
          series={duel.lanes.map((lane, index) => ({
            label: lane.label,
            values: lane.series,
            variant: variants[index] ?? 'a',
          }))}
          length={duel.length}
          tickSeconds={duel.tickSeconds}
          markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
          minMax={chart.minMax}
          summary={chartSummary}
        />
        <div className="sdv-trace__log">
          <p className="sdv-trace__log-title">What happened</p>
          {markerEvents.length === 0 && notes.length === 0 && (
            <p className="sdv-trace__empty">
              Events appear here, numbered to match the chart, as the run plays.
            </p>
          )}
          {markerEvents.length > 0 && (
            <ol>
              {markerEvents.map((event, index) => (
                <li key={`${event.tick}-${event.text}`}>
                  <span className="sdv-trace__num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time> {event.text}
                </li>
              ))}
            </ol>
          )}
          {notes.map((event) => (
            <p key={`${event.tick}-${event.text}`} className="sdv-trace__note">
              {event.text}
            </p>
          ))}
        </div>
      </SimulationShell>
    </MotionRoot>
  );
}
