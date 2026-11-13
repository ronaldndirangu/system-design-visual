import { useId, useRef, useState } from 'react';
import {
  defaultReplicationConfig,
  type ReplicationConfig,
  type ReplicationEvent,
  ReplicationSim,
  type ReplicationTick,
} from '../../lib/models/replication';
import { Slider, Toggle } from '../sim/controls';
import { LoadBars } from '../sim/LoadBars';
import { MotionRoot } from '../sim/MotionRoot';
import { SimulationShell } from '../sim/SimulationShell';
import type { Tone } from '../sim/StatTable';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots, type Point } from '../viz/FlowDots';
import { link } from '../viz/geometry';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';

const TICKS_PER_SECOND = 10;
const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const TRAIL_TICKS = 4;
const STRIP_LENGTH = 30;
const CAPACITY = defaultReplicationConfig.nodeCapacity;
const APP = { x: 300, y: 48 };
const DB_WIDTH = 104;
const ROW_Y = 186;
const NODE_BOTTOM = ROW_Y + 32;

const REPLAY_COST = defaultReplicationConfig.replayCost;

type Settings = Pick<
  ReplicationConfig,
  'replicas' | 'lagTicks' | 'writesPerTick' | 'readsPerTick' | 'freshReadShare' | 'readYourWrites'
>;

function nodeX(index: number, count: number): number {
  return APP.x + (index - (count - 1) / 2) * 118;
}

function curve(from: Point, to: Point, depth: number): { via: [number, number]; points: Point[] } {
  const via: [number, number] = [(from[0] + to[0]) / 2, from[1] + depth];
  const points = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6;
    const u = 1 - t;
    return [
      u * u * from[0] + 2 * u * t * via[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * via[1] + t * t * to[1],
    ] as const;
  });
  return { via, points };
}

function nodeName(node: ReplicationEvent['node']): string {
  return node === 'primary' ? 'primary' : `replica ${node + 1}`;
}

interface Props extends Partial<Settings> {
  title?: string;
  instructions?: string;
  /** Show the controls for fresh reads and read-your-writes. */
  showConsistency?: boolean;
}

/** A primary database that takes every write, plus read replicas that copy it after a delay. */
export default function ReplicationWidget({
  title = 'Add read replicas',
  instructions = 'Press Play. One database cannot keep up with the reads. Add replicas to spread them out, then watch for stale reads.',
  showConsistency = true,
  ...initial
}: Props) {
  const arrow = safeId(useId(), 'replication-arrow');
  const start: Settings = {
    replicas: initial.replicas ?? 0,
    lagTicks: initial.lagTicks ?? defaultReplicationConfig.lagTicks,
    writesPerTick: initial.writesPerTick ?? defaultReplicationConfig.writesPerTick,
    readsPerTick: initial.readsPerTick ?? defaultReplicationConfig.readsPerTick,
    freshReadShare: initial.freshReadShare ?? defaultReplicationConfig.freshReadShare,
    readYourWrites: initial.readYourWrites ?? false,
  };
  const simRef = useRef<ReplicationSim | null>(null);
  simRef.current ??= new ReplicationSim(start);
  const sim = () => simRef.current as ReplicationSim;

  const [settings, setSettings] = useState(start);
  const [last, setLast] = useState<ReplicationTick | null>(null);
  const [trail, setTrail] = useState<ReplicationTick[]>([]);
  const [reads, setReads] = useState<ReplicationEvent[]>([]);
  const [stats, setStats] = useState(() => sim().stats());

  const onTick = () => {
    const tick = sim().step();
    setLast(tick);
    setTrail((current) => [...current.slice(-(TRAIL_TICKS - 1)), tick]);
    setReads((current) =>
      [...current, ...tick.sample.filter((event) => event.kind === 'read')].slice(-STRIP_LENGTH),
    );
    setStats(sim().stats());
  };

  const onReset = () => {
    simRef.current = new ReplicationSim(settings);
    setLast(null);
    setTrail([]);
    setReads([]);
    setStats(sim().stats());
  };

  const change = (changes: Partial<Settings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    sim().update(changes);
    setStats(sim().stats());
  };

  const count = settings.replicas + 1;
  const nodeIds = ['primary', ...Array.from({ length: settings.replicas }, (_, i) => `replica-${i + 1}`)];
  const position = (node: ReplicationEvent['node']): { x: number; y: number } => {
    const index = node === 'primary' ? 0 : node + 1;
    return { x: nodeX(Math.min(index, count - 1), count), y: ROW_Y };
  };
  const primary = position('primary');
  const replicaCurves = Array.from({ length: settings.replicas }, (_, i) => {
    const to = position(i);
    return {
      id: `replica-${i + 1}`,
      ...curve([primary.x + 20, NODE_BOTTOM], [to.x - 20, NODE_BOTTOM], 40 + i * 18),
    };
  });

  const replicaLagsMs = sim()
    .replicaLags()
    .map((lag) => lag * MS_PER_TICK);
  const flows: Flow[] = trail.flatMap((tick) => {
    const items: Flow[] = [];
    tick.sample.forEach((event, index) => {
      const target = link(APP, position(event.node));
      if (event.kind === 'write') {
        items.push({
          id: `${tick.tick}-w${index}`,
          points: [target.from, target.to],
          duration: 0.5,
          delay: index * 0.04,
        });
        if (index === 0) {
          replicaCurves.forEach((replica, r) => {
            items.push({
              id: `${tick.tick}-c${r}`,
              points: replica.points,
              duration: Math.max(0.15, (replicaLagsMs[r] ?? 0) / 1000),
              delay: 0.5,
            });
          });
        }
      } else {
        items.push({
          id: `${tick.tick}-r${index}`,
          tone: event.stale ? 'bad' : 'hit',
          points: [target.from, target.to, target.from],
          duration: 0.8,
          delay: index * 0.04,
        });
      }
    });
    return items;
  });

  const loads = Array.from({ length: count }, (_, i) => last?.loads[i] ?? 0);
  const utilization = loads.map((load) => load / CAPACITY);
  const busiest = Math.max(...utilization);
  const started = last !== null;
  const status: { tone: Tone; text: string } = !started
    ? { tone: 'neutral', text: 'Ready' }
    : stats.overloadedPerTick > 0
      ? { tone: 'bad', text: 'Overloaded: reads over capacity' }
      : stats.timeTravelReads > 0
        ? { tone: 'warn', text: 'Some reads went back in time' }
        : stats.staleReadRate > 0
          ? { tone: 'warn', text: 'Some reads are stale' }
          : { tone: 'ok', text: 'Healthy' };

  const lagMs = settings.lagTicks * MS_PER_TICK;
  const perSecond = (ops: number) => Math.round(ops * TICKS_PER_SECOND).toLocaleString('en-US');
  const replayed = settings.writesPerTick * REPLAY_COST;
  const loss = sim().failoverLoss();
  const fewestLost = Math.min(...loss);
  const mostLost = Math.max(...loss);
  const capacityDetail =
    settings.replicas === 0
      ? `the primary alone: ${perSecond(CAPACITY)}/s minus ${perSecond(settings.writesPerTick)}/s of writes`
      : `${settings.replicas} ${settings.replicas === 1 ? 'replica' : 'replicas'} × (${perSecond(CAPACITY)}/s minus ${perSecond(replayed)}/s of replayed writes); the primary only writes`;
  const lagList = replicaLagsMs
    .map((ms, i) => `replica ${i + 1} ${ms.toLocaleString('en-US')} ms`)
    .join(', ');
  const summary = started
    ? `${status.text}. Busiest database at ${Math.round(busiest * 100)} percent. ${(stats.staleReadRate * 100).toFixed(1)} percent of reads were stale, and ${stats.timeTravelReads} went back in time.`
    : `Ready. ${settings.replicas} replicas.`;

  return (
    <MotionRoot>
      <SimulationShell
        title={title}
        instructions={instructions}
        ticksPerSecond={TICKS_PER_SECOND}
        onTick={onTick}
        onReset={onReset}
        summary={summary}
        status={status}
        stats={[
          {
            label: 'Read capacity',
            value: `${perSecond(stats.readCapacityPerTick)}/s`,
            detail: capacityDetail,
          },
          {
            label: 'Busiest database',
            value: `${Math.round(busiest * 100)}%`,
            tone: busiest > 1 ? 'bad' : busiest > 0.85 ? 'warn' : undefined,
          },
          {
            label: 'Reads over capacity',
            value: `${Math.round(stats.overloadedPerTick * TICKS_PER_SECOND)}/s`,
            tone: stats.overloadedPerTick > 0 ? 'bad' : undefined,
          },
          {
            label: 'Stale reads (last 2 seconds)',
            value: `${(stats.staleReadRate * 100).toFixed(1)}%`,
            detail: 'a replica answered before the newest write reached it',
            tone: stats.staleReadRate > 0 ? 'warn' : undefined,
          },
          {
            label: 'Went back in time (last 2 seconds)',
            value: stats.timeTravelReads.toLocaleString('en-US'),
            detail: 'an earlier read found the link, then a more lagging replica answered Not found',
            tone: stats.timeTravelReads > 0 ? 'warn' : undefined,
          },
          ...(settings.replicas > 0
            ? [
                {
                  label: 'Writes at risk if the primary crashed now',
                  value:
                    fewestLost === mostLost
                      ? fewestLost.toLocaleString('en-US')
                      : `${fewestLost.toLocaleString('en-US')} to ${mostLost.toLocaleString('en-US')}`,
                  detail:
                    'acknowledged writes a replica has not received; these toy replicas apply on arrival, so promoting the least lagging one risks the fewest',
                  tone: mostLost > 0 ? ('warn' as const) : undefined,
                },
              ]
            : []),
        ]}
        controls={
          <>
            <Slider
              label="Read replicas"
              value={settings.replicas}
              min={0}
              max={4}
              format={(v) => (v === 0 ? 'None (primary only)' : String(v))}
              onChange={(v) => change({ replicas: v })}
            />
            <Slider
              label="Reads per second"
              value={settings.readsPerTick}
              min={10}
              max={120}
              step={5}
              format={(v) => (v * TICKS_PER_SECOND).toLocaleString('en-US')}
              hint={`Each database handles ${CAPACITY * TICKS_PER_SECOND} requests per second.`}
              onChange={(v) => change({ readsPerTick: v })}
            />
            <Slider
              label="Writes per second"
              value={settings.writesPerTick}
              min={1}
              max={20}
              format={(v) => (v * TICKS_PER_SECOND).toLocaleString('en-US')}
              hint="Every replica replays every write, so writes use up replica capacity too."
              onChange={(v) => change({ writesPerTick: v })}
            />
            <Slider
              label="Average replication lag"
              value={settings.lagTicks}
              min={0}
              max={20}
              format={(v) => `${(v * MS_PER_TICK).toLocaleString('en-US')} ms`}
              hint="Each replica trails by its own amount, from half to one and a half times this."
              onChange={(v) => change({ lagTicks: v })}
            />
            {showConsistency && (
              <>
                <Slider
                  label="Reads of links created a moment ago"
                  value={settings.freshReadShare}
                  min={0}
                  max={0.5}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  hint="For example, a user who shortens a link and opens it right away."
                  onChange={(v) => change({ freshReadShare: Math.round(v * 100) / 100 })}
                />
                <Toggle
                  label="Read your own writes: a replica that lacks your write's log position hands the read to the primary"
                  checked={settings.readYourWrites}
                  onChange={(readYourWrites) => change({ readYourWrites })}
                />
              </>
            )}
          </>
        }
      >
        <DiagramScroll label="Scrollable diagram">
          <svg
            className="sdv-replication"
            viewBox="0 0 600 330"
            role="img"
            aria-label={`App server sending writes to the primary database and reads to ${settings.replicas === 0 ? 'the primary' : `${settings.replicas} replicas`}.${settings.replicas > 0 ? ` Replicas copy each write after their own lag: ${lagList}.` : ''}`}
          >
            <ArrowDefs id={arrow} />
            {nodeIds.map((id, i) => {
              const edge = link(APP, { x: nodeX(i, count), y: ROW_Y });
              return <Edge key={id} from={edge.from} to={edge.to} marker={arrow} />;
            })}
            {replicaCurves.map((replica) => {
              const first = replica.points[0] as Point;
              const end = replica.points[replica.points.length - 1] as Point;
              return (
                <Edge
                  key={replica.id}
                  from={[first[0], first[1]]}
                  to={[end[0], end[1]]}
                  via={replica.via}
                  marker={arrow}
                  dashed
                />
              );
            })}
            <SystemNode kind="server" x={APP.x} y={APP.y} label="App server" />
            {nodeIds.map((id, i) => (
              <SystemNode
                key={id}
                kind="database"
                x={nodeX(i, count)}
                y={ROW_Y}
                width={DB_WIDTH}
                label={i === 0 ? 'Primary' : `Replica ${i}`}
                sublabel={
                  i === 0 ? undefined : `lag ${(replicaLagsMs[i - 1] ?? 0).toLocaleString('en-US')} ms`
                }
                highlight={i === 0}
                status={utilization[i] !== undefined && utilization[i] > 0.85 ? 'warn' : undefined}
              />
            ))}
            <FlowDots flows={flows} />
            {settings.replicas > 0 && (
              <text className="sdv-chart__label" x={APP.x} y={322} textAnchor="middle">
                Dashed lines copy each write. Each replica trails by its own lag, spread around{' '}
                {lagMs.toLocaleString('en-US')} ms.
              </text>
            )}
          </svg>
        </DiagramScroll>
        <LoadBars
          label="Database load"
          bars={loads.map((load, i) => ({
            id: i,
            label: i === 0 ? 'Primary (all writes)' : `Replica ${i}`,
            fill: utilization[i] ?? 0,
            value: `${perSecond(load)} of ${perSecond(CAPACITY)}/s`,
          }))}
        />
        <div className="sdv-strip">
          <p className="sdv-strip__label" id={`${arrow}-strip`}>
            Last {STRIP_LENGTH} reads
          </p>
          <ol className="sdv-strip__items" aria-labelledby={`${arrow}-strip`}>
            {reads.map((event, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: position in a rolling window
                key={index}
                className={event.stale ? 'sdv-strip__bad' : 'sdv-strip__hit'}
                title={`Read from the ${nodeName(event.node)}${event.timeTravel ? ': went back in time' : event.stale ? ': stale' : ''}`}
              >
                <span className="sdv-visually-hidden">
                  {event.timeTravel ? 'Went back in time' : event.stale ? 'Stale' : 'Fresh'} read from the{' '}
                  {nodeName(event.node)}
                </span>
              </li>
            ))}
          </ol>
          <ul className="sdv-legend" aria-label="Legend">
            <li>
              <span className="sdv-strip__hit" aria-hidden="true" /> Up to date
            </li>
            <li>
              <span className="sdv-strip__bad" aria-hidden="true" /> Stale: the link was missing or old
            </li>
          </ul>
        </div>
      </SimulationShell>
    </MotionRoot>
  );
}
