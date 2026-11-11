import { useEffect, useRef, useState } from 'react';
import { BallLegend } from '../physics/BallLegend';
import type { LandingScene as LandingSceneType, LandingStats } from '../physics/LandingScene';
import { LandingScene } from '../physics/LandingScene';
import { usePhysicsScene } from '../physics/runtime';
import { Slider } from '../sim/controls';
import { ToneBadge } from '../sim/StatTable';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { UiIcon } from '../viz/icons';
import { ArrowDefs, Edge, SystemNode } from '../viz/SystemNode';

const MAX_SERVERS = 4;
const PER_SERVER = 5;

/** Landing page toy: drag the traffic up, add servers, and watch requests pile up or flow. */
export default function LandingHero() {
  const reduced = usePrefersReducedMotion();
  const [optIn, setOptIn] = useState(false);
  const enabled = !reduced || optIn;
  const [paused, setPaused] = useState(false);
  const [servers, setServers] = useState(1);
  const [rate, setRate] = useState(8);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const initial = useRef({ servers, rate });

  const { canvasRef, scene, error } = usePhysicsScene<LandingSceneType>(
    (context) => {
      const created = new LandingScene(context, initial.current.servers);
      created.rate = initial.current.rate;
      return created;
    },
    { enabled, paused },
  );

  useEffect(() => {
    initial.current.servers = servers;
    if (scene && scene.stats().servers !== servers) scene.setServers(servers);
  }, [scene, servers]);

  useEffect(() => {
    initial.current.rate = rate;
    if (scene) scene.rate = rate;
  }, [scene, rate]);

  useEffect(() => {
    if (!scene || paused) return;
    const timer = window.setInterval(() => setStats(scene.stats()), 1000);
    return () => window.clearInterval(timer);
  }, [scene, paused]);

  const capacity = servers * PER_SERVER;
  const overloaded = rate > capacity;

  return (
    <div className="sdv-hero-toy not-content">
      <div className="sdv-hero-toy__stage">
        {enabled && !error ? (
          // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is not focusable; the text below describes it
          <canvas
            ref={canvasRef}
            className="sdv-hero-toy__canvas"
            aria-hidden="true"
            data-testid="hero-canvas"
          />
        ) : (
          <StaticHero servers={servers} />
        )}
        {enabled && !error && !scene && <StaticHero servers={servers} placeholder />}
      </div>
      <p className="sdv-visually-hidden">
        Animation: users send requests into a funnel. A load balancer throws each request into the next
        server's bucket. Each server finishes {PER_SERVER} requests per second. When requests arrive faster
        than the servers finish them, the buckets overflow and requests fall away.
      </p>

      <div className="sdv-hero-toy__panel">
        <div className="sdv-hero-toy__status" aria-live="polite">
          <ToneBadge tone={overloaded ? 'bad' : 'ok'}>{overloaded ? 'Overloaded' : 'Keeping up'}</ToneBadge>
          <span>
            {rate} requests/s arriving, capacity {capacity}/s
          </span>
        </div>
        <Slider
          label="Traffic"
          value={rate}
          min={2}
          max={30}
          onChange={setRate}
          format={(value) => `${value} requests/s`}
        />
        <div className="sdv-hero-toy__buttons">
          {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section */}
          <div role="group" aria-label="Servers" className="sdv-hero-toy__stepper">
            <button
              type="button"
              className="sdv-button"
              onClick={() => setServers((count) => Math.max(1, count - 1))}
              disabled={servers <= 1}
              aria-label="Remove a server"
            >
              −
            </button>
            <span>
              {servers} {servers === 1 ? 'server' : 'servers'}
            </span>
            <button
              type="button"
              className="sdv-button"
              onClick={() => setServers((count) => Math.min(MAX_SERVERS, count + 1))}
              disabled={servers >= MAX_SERVERS}
              aria-label="Add a server"
            >
              +
            </button>
          </div>
          {enabled ? (
            <button
              type="button"
              className="sdv-button"
              onClick={() => setPaused((value) => !value)}
              aria-pressed={paused}
            >
              <UiIcon name={paused ? 'play' : 'pause'} />
              {paused ? 'Resume animation' : 'Pause animation'}
            </button>
          ) : (
            <button type="button" className="sdv-button" onClick={() => setOptIn(true)}>
              <UiIcon name="play" />
              Play animation
            </button>
          )}
        </div>
        {enabled && stats && (
          <p className="sdv-hero-toy__readout">
            Last few seconds: {stats.arrivedPerSecond.toFixed(1)} arrived, {stats.servedPerSecond.toFixed(1)}{' '}
            served, {stats.droppedPerSecond.toFixed(1)} dropped per second.
          </p>
        )}
        <BallLegend>{enabled && <li>Drag the balls with a mouse.</li>}</BallLegend>
      </div>
    </div>
  );
}

function StaticHero({ servers, placeholder = false }: { servers: number; placeholder?: boolean }) {
  const ys = Array.from(
    { length: servers },
    (_, index) => 60 + (index * 200) / Math.max(1, servers - 1 || 1),
  );
  const centered = servers === 1 ? [160] : ys;
  const arrowId = placeholder ? 'hero-placeholder-arrow' : 'hero-static-arrow';
  return (
    <svg
      className={
        placeholder ? 'sdv-hero-toy__static sdv-hero-toy__static--placeholder' : 'sdv-hero-toy__static'
      }
      viewBox="0 0 480 320"
      aria-hidden={placeholder || undefined}
      role={placeholder ? undefined : 'img'}
      aria-label={
        placeholder ? undefined : 'Users send requests to a load balancer, which spreads them across servers.'
      }
    >
      <ArrowDefs id={arrowId} />
      <Edge from={[106, 160]} to={[150, 160]} marker={arrowId} />
      {centered.map((y) => (
        <Edge key={y} from={[282, 160]} to={[334, y]} marker={arrowId} />
      ))}
      <SystemNode kind="client" x={56} y={160} width={96} label="Users" />
      <SystemNode kind="loadBalancer" x={216} y={160} width={132} />
      {centered.map((y, index) => (
        <SystemNode
          key={y}
          kind="server"
          x={400}
          y={y}
          width={120}
          height={52}
          label={`Server ${index + 1}`}
        />
      ))}
    </svg>
  );
}
