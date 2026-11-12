import { useId, useRef, useState } from 'react';
import { type CacheEvent, CacheSim, defaultCacheConfig, topShare } from '../../lib/models/cache';
import { formatCount } from '../../lib/models/estimates';
import { Segmented, Slider } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { SimulationShell } from '../sim/SimulationShell';
import type { Tone } from '../sim/StatTable';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots } from '../viz/FlowDots';
import { link, nodeSize, readableFont } from '../viz/geometry';
import { UiIcon } from '../viz/icons';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';

const TICKS_PER_SECOND = 5;
const TRAIL_TICKS = 6;
const STRIP_LENGTH = 30;
const CHART_KEYS = 60;
const KEYS = defaultCacheConfig.keys;

const centers = {
  server: { x: 72, y: 64, kind: 'server', label: 'App server' },
  cache: { x: 300, y: 64, kind: 'cache', label: 'Cache' },
  database: { x: 528, y: 64, kind: 'database', label: 'Database' },
} as const;
type Spot = (typeof centers)[keyof typeof centers];
const sized = (spot: Spot, minFont: number | undefined) => ({
  ...spot,
  ...nodeSize(spot.kind, spot.label, minFont),
});

const ttlOptions = [
  { value: '0', label: 'Never expire' },
  { value: '50', label: '10 seconds' },
  { value: '5', label: '1 second' },
];

function skewLabel(skew: number): string {
  if (skew === 0) return 'Even (every link equally popular)';
  if (skew < 0.6) return `Mild (${skew.toFixed(1)})`;
  if (skew < 1.1) return `Strong (${skew.toFixed(1)})`;
  return `Extreme (${skew.toFixed(1)})`;
}

interface Props {
  capacity?: number;
  skew?: number;
}

/** A cache in front of the database, with a live chart of which links it holds. */
export default function CacheWidget({ capacity = 0, skew = 1 }: Props) {
  const arrow = safeId(useId(), 'cache-arrow');
  const restartHint = safeId(useId(), 'cache-restart-hint');
  const make = () => new CacheSim({ capacity, skew });
  const simRef = useRef<CacheSim | null>(null);
  simRef.current ??= make();
  const sim = () => simRef.current as CacheSim;

  const [settings, setSettings] = useState({ capacity, skew, ttl: '0' });
  const [trail, setTrail] = useState<{ tick: number; sample: CacheEvent[] }[]>([]);
  const [strip, setStrip] = useState<CacheEvent[]>([]);
  const [stats, setStats] = useState(() => sim().stats());
  const [cached, setCached] = useState<Set<number>>(() => new Set());
  const [scale, setScale] = useState(1);
  const minFont = readableFont(scale);
  const nodes = {
    server: sized(centers.server, minFont),
    cache: sized(centers.cache, minFont),
    database: sized(centers.database, minFont),
  };
  const toCache = link(nodes.server, nodes.cache);
  const toDatabase = link(nodes.cache, nodes.database);
  const nodeTop = nodes.cache.y - Math.max(nodes.cache.h, nodes.database.h) / 2;

  const refresh = () => {
    setStats(sim().stats());
    setCached(new Set(sim().cachedKeys));
  };

  const onTick = () => {
    const tick = sim().step();
    setTrail((current) => [...current.slice(-(TRAIL_TICKS - 1)), { tick: tick.tick, sample: tick.sample }]);
    setStrip((current) => [...current, ...tick.sample].slice(-STRIP_LENGTH));
    refresh();
  };

  const onReset = () => {
    simRef.current = new CacheSim({
      capacity: settings.capacity,
      skew: settings.skew,
      ttlTicks: Number(settings.ttl),
    });
    setTrail([]);
    setStrip([]);
    refresh();
  };

  const change = (changes: Partial<typeof settings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    if (changes.capacity !== undefined) sim().setCapacity(next.capacity);
    if (changes.skew !== undefined) sim().setSkew(next.skew);
    if (changes.ttl !== undefined) sim().setTtl(Number(next.ttl));
    refresh();
  };

  const flush = () => {
    sim().flush();
    refresh();
  };

  const flows: Flow[] = trail.flatMap(({ tick, sample }) =>
    sample.map((event, index) => ({
      id: `${tick}-${index}`,
      tone: event.hit ? ('hit' as const) : ('miss' as const),
      delay: index * 0.03,
      duration: event.hit ? 0.7 : 1.4,
      points: event.hit
        ? [toCache.from, toCache.to, toCache.from]
        : [toCache.from, toCache.to, toDatabase.to, toCache.to, toCache.from],
    })),
  );

  const started = stats.totalRequests > 0;
  const best = topShare(KEYS, settings.capacity, settings.skew);
  const dbReadsPerSecond = stats.databaseReadsPerTick * TICKS_PER_SECOND;
  const status: { tone: Tone; text: string } = !started
    ? { tone: 'neutral', text: 'Ready' }
    : stats.hitRatio >= 0.8
      ? { tone: 'ok', text: 'Database relaxed' }
      : stats.hitRatio >= 0.4
        ? { tone: 'warn', text: 'Many misses' }
        : { tone: 'bad', text: 'Database doing all the work' };

  const weights = Array.from({ length: CHART_KEYS }, (_, k) => 1 / (k + 1) ** settings.skew);
  const top = weights[0] ?? 1;
  const chart = { left: 24, top: 150, width: 552, height: 72 };
  const barWidth = chart.width / CHART_KEYS;
  const cachedInChart = weights.filter((_, k) => cached.has(k)).length;

  const summary = started
    ? `${status.text}. Hit ratio ${Math.round(stats.hitRatio * 100)} percent, ${Math.round(dbReadsPerSecond)} database reads per second, average ${stats.averageLatencyMs.toFixed(1)} ms.`
    : `Ready. Cache size ${settings.capacity} links.`;

  return (
    <MotionRoot>
      <SimulationShell
        title="Cache the hot links"
        instructions="Press Play with no cache and watch every request hit the database. Then give the cache some room and see how few links it needs."
        ticksPerSecond={TICKS_PER_SECOND}
        onTick={onTick}
        onReset={onReset}
        summary={summary}
        status={status}
        stats={[
          {
            label: 'Hit ratio (last 4 seconds)',
            value: `${Math.round(stats.hitRatio * 100)}%`,
            detail: `best possible with ${settings.capacity} slots: ${Math.round(best * 100)}%`,
          },
          {
            label: 'Database reads',
            value: `${Math.round(dbReadsPerSecond)}/s`,
            detail: `out of ${defaultCacheConfig.requestsPerTick * TICKS_PER_SECOND} requests per second`,
          },
          {
            label: 'Average response time',
            value: `${stats.averageLatencyMs.toFixed(1)} ms`,
            detail: `cache hit ${defaultCacheConfig.hitMs} ms, miss ${defaultCacheConfig.missMs} ms`,
          },
          { label: 'Links in the cache', value: `${formatCount(cached.size)} of ${formatCount(KEYS)}` },
        ]}
        controls={
          <>
            <Slider
              label="Cache size"
              value={settings.capacity}
              min={0}
              max={400}
              step={10}
              format={(v) => (v === 0 ? 'No cache' : `${v} links (${Math.round((v / KEYS) * 100)}% of all)`)}
              onChange={(v) => change({ capacity: v })}
            />
            <Slider
              label="How uneven is popularity?"
              value={settings.skew}
              min={0}
              max={1.4}
              step={0.1}
              format={skewLabel}
              hint="Real traffic is uneven: a few links get most of the clicks."
              onChange={(v) => change({ skew: Math.round(v * 10) / 10 })}
            />
            <Segmented
              label="Entries expire after (TTL)"
              value={settings.ttl}
              options={ttlOptions}
              onChange={(ttl) => change({ ttl })}
            />
            <div className="sdv-control">
              <button
                type="button"
                className="sdv-button"
                onClick={flush}
                disabled={cached.size === 0}
                aria-describedby={restartHint}
              >
                <UiIcon name="reset" /> Restart cache
              </button>
              <p className="sdv-control__hint" id={restartHint}>
                {cached.size === 0
                  ? 'Cache is already empty. Run some traffic to fill it first.'
                  : 'Restarting empties the cache. Every request misses until it fills again.'}
              </p>
            </div>
          </>
        }
      >
        <DiagramScroll label="Scrollable diagram" onScale={setScale}>
          <svg
            className="sdv-cache"
            viewBox="0 0 600 260"
            role="img"
            aria-label={`App server, cache, and database. The chart shows the ${CHART_KEYS} most popular links; ${cachedInChart} of them are in the cache.`}
          >
            <ArrowDefs id={arrow} />
            <Edge from={toCache.from} to={toCache.to} marker={arrow} />
            <Edge from={toDatabase.from} to={toDatabase.to} marker={arrow} dashed />
            <SystemNode
              kind="server"
              x={nodes.server.x}
              y={nodes.server.y}
              label="App server"
              minFontSize={minFont}
            />
            <SystemNode
              kind="cache"
              x={nodes.cache.x}
              y={nodes.cache.y}
              label="Cache"
              sublabel={settings.capacity === 0 ? 'off' : `${settings.capacity} slots`}
              dim={settings.capacity === 0}
              minFontSize={minFont}
            />
            <SystemNode
              kind="database"
              x={nodes.database.x}
              y={nodes.database.y}
              label="Database"
              sublabel="1,000 links"
              minFontSize={minFont}
            />
            <text
              className="sdv-chart__label"
              x={(toDatabase.from[0] + toDatabase.to[0]) / 2}
              y={nodeTop - 8}
              textAnchor="middle"
            >
              only on a miss
            </text>
            <FlowDots flows={flows} />

            {weights.map((weight, k) => {
              const height = Math.max(2, (weight / top) * chart.height);
              const inCache = cached.has(k);
              const x = chart.left + k * barWidth + 1;
              return (
                <g
                  // biome-ignore lint/suspicious/noArrayIndexKey: bars are ranks
                  key={k}
                  className={inCache ? 'sdv-cache__rank sdv-cache__rank--cached' : 'sdv-cache__rank'}
                >
                  <rect
                    className="sdv-cache__bar"
                    x={x}
                    y={chart.top + chart.height - height}
                    width={barWidth - 2}
                    height={height}
                  />
                  <rect
                    className="sdv-cache__marker"
                    x={x}
                    y={chart.top + chart.height + 6}
                    width={barWidth - 2}
                    height={barWidth - 2}
                    rx={1}
                  />
                </g>
              );
            })}
            <line
              className="sdv-chart__axis"
              x1={chart.left}
              x2={chart.left + chart.width}
              y1={chart.top + chart.height + 0.5}
              y2={chart.top + chart.height + 0.5}
            />
          </svg>
        </DiagramScroll>
        <p className="sdv-sim__note">
          Bottom chart: the {CHART_KEYS} most clicked links, most popular first. A filled square means cached.
        </p>
        <div className="sdv-strip">
          <p className="sdv-strip__label" id={`${arrow}-strip`}>
            Last {STRIP_LENGTH} requests
          </p>
          <ol className="sdv-strip__items" aria-labelledby={`${arrow}-strip`}>
            {strip.map((event, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: position in a rolling window
                key={index}
                className={event.hit ? 'sdv-strip__hit' : 'sdv-strip__miss'}
              >
                <span className="sdv-visually-hidden">{event.hit ? 'Hit' : 'Miss'}</span>
              </li>
            ))}
          </ol>
          <ul className="sdv-legend" aria-label="Legend">
            <li>
              <span className="sdv-strip__hit" aria-hidden="true" /> Hit: served from the cache
            </li>
            <li>
              <span className="sdv-strip__miss" aria-hidden="true" /> Miss: went to the database
            </li>
          </ul>
        </div>
      </SimulationShell>
    </MotionRoot>
  );
}
