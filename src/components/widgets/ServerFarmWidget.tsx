import { useCallback, useEffect, useRef, useState } from 'react';
import { type FarmStats, type FarmTick, ServerFarm, type Strategy } from '../../lib/models/serverFarm';
import { BallLegend } from '../physics/BallLegend';
import { type BucketView, FarmScene } from '../physics/FarmScene';
import { PhysicsStage, type StagePlayback } from '../physics/PhysicsStage';
import { usePhysicsScene } from '../physics/runtime';
import { Segmented, Slider, Toggle } from '../sim/controls';
import { LoadBars } from '../sim/LoadBars';
import { SimulationShell } from '../sim/SimulationShell';
import type { StatRow, Tone } from '../sim/StatTable';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';

const BALL_VALUE = 5;
const QUEUE_LIMIT = 60;
const MAX_SERVERS = 4;
const TICKS_PER_SECOND = 10;

const sizes = {
  small: { label: 'Small', capacity: 100 },
  medium: { label: 'Medium (2×)', capacity: 200 },
  large: { label: 'Large (4×)', capacity: 400 },
} as const;
type Size = keyof typeof sizes;

const strategies: { value: Strategy; label: string }[] = [
  { value: 'round-robin', label: 'Round robin' },
  { value: 'random', label: 'Random' },
  { value: 'least-connections', label: 'Least connections' },
];

interface Settings {
  servers: number;
  size: Size;
  rate: number;
  strategy: Strategy;
  heavyShare: number;
}

interface Props {
  /** Starting setup, so each lesson section can open on its own scenario. */
  servers?: number;
  size?: Size;
  rate?: number;
  strategy?: Strategy;
  heavyShare?: number;
  /** Hide controls a section does not need yet. */
  showStrategy?: boolean;
  showHeavy?: boolean;
  title?: string;
  instructions?: string;
}

interface Snapshot {
  stats: FarmStats;
  servers: { id: number; capacity: number; queue: number; up: boolean; inPool: boolean; draining: boolean }[];
  ticks: number;
}

function makeFarm(settings: Settings): ServerFarm {
  return new ServerFarm({
    capacities: Array.from({ length: settings.servers }, () => sizes[settings.size].capacity),
    strategy: settings.strategy,
    arrivalRate: settings.rate,
    heavyShare: settings.heavyShare,
    queueLimit: QUEUE_LIMIT,
  });
}

function snapshot(farm: ServerFarm, ticks: number): Snapshot {
  return {
    stats: farm.stats(),
    ticks,
    servers: farm.serverStates.map((server) => ({
      id: server.id,
      capacity: server.capacity,
      queue: server.queue.length,
      up: server.up,
      inPool: server.inPool,
      draining: server.draining,
    })),
  };
}

function views(farm: ServerFarm): BucketView[] {
  return farm.serverStates.map((server) => ({
    id: server.id,
    label: `Server ${server.id + 1}`,
    detail: `${server.capacity} req/s`,
    up: server.up,
    inPool: server.inPool,
    draining: server.draining,
    queueLength: server.queue.length,
  }));
}

const emptyTick: FarmTick = {
  time: 0,
  arrived: 0,
  served: 0,
  rejected: 0,
  failed: 0,
  servers: [],
  latencies: [],
};

const perSecond = (value: number) => `${Math.round(value)}/s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Servers behind a load balancer, drawn as buckets that fill with request balls. */
export default function ServerFarmWidget({
  servers = 1,
  size = 'small',
  rate = 60,
  strategy = 'round-robin',
  heavyShare = 0,
  showStrategy = true,
  showHeavy = true,
  title = 'The server farm',
  instructions = 'Press Play, then push the traffic slider up until the server melts. Fix it by buying a bigger machine or by adding servers.',
}: Props) {
  const reduced = usePrefersReducedMotion();
  const [physicsChoice, setPhysicsChoice] = useState<boolean | null>(null);
  const showPhysics = physicsChoice ?? !reduced;
  const [settings, setSettings] = useState<Settings>({ servers, size, rate, strategy, heavyShare });
  const farmRef = useRef<ServerFarm | null>(null);
  farmRef.current ??= makeFarm(settings);
  const ticksRef = useRef(0);
  const [snap, setSnap] = useState<Snapshot>(() => snapshot(farmRef.current as ServerFarm, 0));

  const [playback, setPlayback] = useState<StagePlayback>({ playing: false, speed: 1 });
  const physics = usePhysicsScene((context) => new FarmScene(context, BALL_VALUE, QUEUE_LIMIT), {
    enabled: showPhysics,
    paused: !playback.playing,
    speed: playback.speed,
  });
  const { scene, advance, repaint } = physics;

  const farm = () => farmRef.current as ServerFarm;
  const sync = useCallback(() => {
    const current = farmRef.current;
    if (!current) return;
    scene?.applyTick(emptyTick, views(current));
    repaint();
    setSnap(snapshot(current, ticksRef.current));
  }, [scene, repaint]);

  useEffect(() => {
    sync();
  }, [sync]);

  const change = (changes: Partial<Settings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    const current = farm();
    if (changes.rate !== undefined) current.setArrivalRate(next.rate);
    if (changes.strategy !== undefined) current.setStrategy(next.strategy);
    if (changes.heavyShare !== undefined) current.setHeavyShare(next.heavyShare);
    if (changes.servers !== undefined || changes.size !== undefined) {
      current.setCapacities(Array.from({ length: next.servers }, () => sizes[next.size].capacity));
    }
    sync();
  };

  const onTick = () => {
    const current = farm();
    const tick = current.step();
    ticksRef.current += 1;
    scene?.applyTick(tick, views(current));
    // A Step press arrives while paused, so move the balls through the same tick of time.
    if (!playback.playing) advance(1000 / TICKS_PER_SECOND);
    setSnap(snapshot(current, ticksRef.current));
  };

  const onReset = () => {
    farmRef.current = makeFarm(settings);
    ticksRef.current = 0;
    scene?.clear();
    sync();
  };

  const toggleServer = (id: number, up: boolean) => {
    if (up) farm().crash(id);
    else farm().recover(id);
    sync();
  };

  const { stats } = snap;
  const started = snap.ticks > 0;
  const capacity = snap.servers.filter((s) => s.up && s.inPool).reduce((sum, s) => sum + s.capacity, 0);
  const failing = stats.errorRate > 0.01;
  const hot = stats.utilization > 0.85 || stats.p95Ms > 300;
  const status: { tone: Tone; text: string } = !started
    ? { tone: 'neutral', text: 'Ready' }
    : failing
      ? { tone: 'bad', text: 'Dropping requests' }
      : hot
        ? { tone: 'warn', text: 'Running hot' }
        : { tone: 'ok', text: 'Healthy' };

  const rows: StatRow[] = [
    {
      label: 'Traffic in',
      value: perSecond(started ? stats.arrivedPerSecond : settings.rate),
      detail: `capacity in the pool: ${capacity} req/s`,
    },
    { label: 'Served', value: perSecond(stats.servedPerSecond) },
    {
      label: 'Rejected, queue full (503)',
      value: perSecond(stats.rejectedPerSecond),
      ...(stats.rejectedPerSecond >= 0.5 ? { tone: 'bad' as const, note: 'Users see errors' } : {}),
    },
    {
      label: 'Failed, server down',
      value: perSecond(stats.failedPerSecond),
      ...(stats.failedPerSecond >= 0.5 ? { tone: 'bad' as const, note: 'Lost requests' } : {}),
    },
    {
      label: 'Latency, median and 95th percentile',
      value: `${Math.round(stats.p50Ms)} ms and ${Math.round(stats.p95Ms)} ms`,
      ...(stats.p95Ms > 300 ? { tone: 'warn' as const, note: 'Slow' } : {}),
    },
    {
      label: 'Average server busy time',
      value: percent(stats.utilization),
      ...(stats.utilization > 0.85 ? { tone: 'warn' as const, note: 'Near the limit' } : {}),
    },
  ];

  const summary = started
    ? `${status.text}. ${perSecond(stats.arrivedPerSecond)} in, ${perSecond(stats.servedPerSecond)} served, ${percent(stats.errorRate)} errors, 95th percentile latency ${Math.round(stats.p95Ms)} ms.`
    : `Ready: ${settings.servers} ${sizes[settings.size].label.toLowerCase()} server${settings.servers > 1 ? 's' : ''} and ${settings.rate} requests per second.`;

  const active = snap.servers.filter((server) => !server.draining);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      ticksPerSecond={TICKS_PER_SECOND}
      onReset={onReset}
      summary={summary}
      stats={rows}
      status={status}
      controls={
        <>
          <Slider
            label="Traffic"
            value={settings.rate}
            min={20}
            max={600}
            step={10}
            format={(v) => `${v} req/s`}
            onChange={(v) => change({ rate: v })}
          />
          <Segmented
            label="Machine size (vertical scaling)"
            value={settings.size}
            options={(Object.keys(sizes) as Size[]).map((id) => ({
              value: id,
              label: `${sizes[id].label}: ${sizes[id].capacity}/s`,
            }))}
            onChange={(next) => change({ size: next })}
          />
          <Slider
            label="Servers (horizontal scaling)"
            value={settings.servers}
            min={1}
            max={MAX_SERVERS}
            format={(v) => `${v} server${v > 1 ? 's' : ''}`}
            onChange={(v) => change({ servers: v })}
          />
          {showStrategy && (
            <Segmented
              label="Load balancing strategy"
              value={settings.strategy}
              options={strategies}
              onChange={(next) => change({ strategy: next })}
            />
          )}
          {showHeavy && (
            <Slider
              label="Slow requests"
              value={settings.heavyShare}
              min={0}
              max={0.3}
              step={0.05}
              format={percent}
              hint="A slow request takes 10 times as long as a normal one."
              onChange={(v) => change({ heavyShare: v })}
            />
          )}
          <fieldset className="sdv-control sdv-crash">
            <legend>Break something</legend>
            <div className="sdv-crash__buttons">
              {active.map((server) => (
                <button
                  key={server.id}
                  type="button"
                  className="sdv-button"
                  data-tone={server.up ? undefined : 'bad'}
                  onClick={() => toggleServer(server.id, server.up)}
                >
                  {server.up ? `Crash server ${server.id + 1}` : `Recover server ${server.id + 1}`}
                </button>
              ))}
            </div>
            <p className="sdv-control__hint">
              The load balancer needs 2 seconds of failed health checks to notice a crash.
            </p>
          </fieldset>
        </>
      }
    >
      <PhysicsStage
        physics={physics}
        testId="farm-canvas"
        readout={<FarmBars servers={snap.servers} />}
        onPlayback={setPlayback}
      />
      <div className="sdv-farm__footer">
        {showPhysics && <BallLegend>{<li>1 ball = {BALL_VALUE} requests</li>}</BallLegend>}
        <Toggle label="Physics animation" checked={showPhysics} onChange={setPhysicsChoice} />
      </div>
    </SimulationShell>
  );
}

function FarmBars({ servers }: { servers: Snapshot['servers'] }) {
  return (
    <LoadBars
      label="Server queues"
      bars={servers.map((server) => ({
        id: server.id,
        label: `Server ${server.id + 1} (${server.capacity} req/s): ${
          !server.up ? 'Down' : server.draining ? 'Draining' : !server.inPool ? 'Out of pool' : 'Up'
        }`,
        fill: server.queue / QUEUE_LIMIT,
        value: `${server.queue} of ${QUEUE_LIMIT} waiting`,
        down: !server.up,
      }))}
    />
  );
}
