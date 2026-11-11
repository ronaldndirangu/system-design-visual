import { useId, useMemo, useRef, useState } from 'react';
import {
  type Actor,
  defaultJourneyInputs,
  distancePresets,
  type JourneyInputs,
  type JourneyStep,
  networkShare,
  planJourney,
  totalMs,
} from '../../lib/models/requestJourney';
import { Segmented, Toggle } from '../sim/controls';
import { SimulationShell } from '../sim/SimulationShell';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { lerp, link, type Vec } from '../viz/geometry';
import type { ComponentKind } from '../viz/kinds';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';

/** Simulated milliseconds per tick: at 30 ticks a second, one real second shows 60 ms. */
const MS_PER_TICK = 2;
const TICKS_PER_SECOND = 30;

const actors: Record<Actor, { kind: ComponentKind; label: string; sublabel: string; x: number; y: number }> =
  {
    browser: { kind: 'client', label: 'Browser', sublabel: 'you', x: 72, y: 120 },
    dns: { kind: 'dns', label: 'DNS resolver', sublabel: 'name to IP', x: 296, y: 46 },
    server: { kind: 'server', label: 'sho.rt server', sublabel: 'app', x: 296, y: 190 },
    database: { kind: 'database', label: 'Database', sublabel: 'links', x: 520, y: 190 },
  };

const wires: [Actor, Actor][] = [
  ['browser', 'dns'],
  ['browser', 'server'],
  ['server', 'database'],
];

interface Leg {
  from: Actor;
  to: Actor;
  ms: number;
}

function legsFor(step: JourneyStep, inputs: JourneyInputs): Leg[] {
  const trip = (a: Actor, b: Actor, ms: number): Leg[] => [
    { from: a, to: b, ms: ms / 2 },
    { from: b, to: a, ms: ms / 2 },
  ];
  switch (step.id) {
    case 'dns':
      return trip('browser', 'dns', step.durationMs);
    case 'tcp':
      return trip('browser', 'server', step.durationMs);
    case 'tls': {
      const trips = inputs.tlsVersion === '1.3' ? 1 : 2;
      return Array.from({ length: trips }, () => trip('browser', 'server', step.durationMs / trips)).flat();
    }
    case 'request':
      return [
        { from: 'browser', to: 'server', ms: inputs.rttMs / 2 },
        { from: 'server', to: 'server', ms: inputs.serverMs },
      ];
    case 'lookup':
      return trip('server', 'database', step.durationMs);
    case 'response':
      return [{ from: 'server', to: 'browser', ms: step.durationMs }];
  }
}

function pointOnLeg(leg: Leg, t: number): Vec {
  const a = actors[leg.from];
  if (leg.from === leg.to) return [a.x, a.y - 44];
  const segment = link(a, actors[leg.to]);
  return lerp(segment.from, segment.to, t);
}

function packetAt(step: JourneyStep, inputs: JourneyInputs, elapsed: number, stepped: boolean): Vec {
  const legs = legsFor(step, inputs);
  let clock = 0;
  for (const leg of legs) {
    if (elapsed < clock + leg.ms || leg === legs[legs.length - 1]) {
      const t = leg.ms === 0 ? 1 : Math.min(1, (elapsed - clock) / leg.ms);
      return pointOnLeg(leg, stepped ? 1 : t);
    }
    clock += leg.ms;
  }
  return [actors.browser.x, actors.browser.y];
}

function formatMs(ms: number): string {
  return `${Number(ms.toFixed(ms < 10 ? 1 : 0))} ms`;
}

/** Slow motion replay of one click on a short link, from DNS to redirect. */
export default function RequestJourneyWidget() {
  const [inputs, setInputs] = useState<JourneyInputs>(defaultJourneyInputs);
  const [clock, setClock] = useState(0);
  const reduced = usePrefersReducedMotion();
  const arrow = safeId(useId(), 'journey-arrow');

  const steps = useMemo(() => planJourney(inputs), [inputs]);
  const total = totalMs(steps);
  const totalRef = useRef(total);
  totalRef.current = total;
  const finished = clock >= total;
  const active = steps.find(
    (step) => !step.skipped && clock >= step.startMs && clock < step.startMs + step.durationMs,
  );
  const lastStep = [...steps].reverse().find((step) => !step.skipped);
  const shown = active ?? (finished && clock > 0 ? lastStep : undefined);
  const share = networkShare(steps, inputs);
  const distance = distancePresets.find((preset) => preset.rttMs === inputs.rttMs)?.id ?? 'continent';
  const roundTrips = steps
    .filter((step) => !step.skipped && step.from === 'browser' && step.id !== 'request')
    .reduce((sum, step) => sum + (step.id === 'tls' && inputs.tlsVersion === '1.2' ? 2 : 1), 0);

  const change = (changes: Partial<JourneyInputs>) => {
    setInputs((current) => ({ ...current, ...changes }));
    setClock(0);
  };

  const packet = shown ? packetAt(shown, inputs, clock - shown.startMs, reduced) : undefined;
  const activeWire = shown ? [shown.from, shown.to].sort().join('>') : '';
  const summary = finished
    ? `Redirect complete after ${formatMs(total)}. ${Math.round(share * 100)} percent of the time was network travel.`
    : shown
      ? `${formatMs(clock)} of ${formatMs(total)}. ${shown.label}: ${shown.explanation}`
      : `Ready. The full journey takes ${formatMs(total)}.`;

  return (
    <SimulationShell
      title="Follow one click"
      instructions="Press Play to watch the request in slow motion. Then change the distance and toggle the caches to see which steps disappear."
      ticksPerSecond={TICKS_PER_SECOND}
      onTick={() => setClock((value) => Math.min(totalRef.current, value + MS_PER_TICK))}
      onReset={() => setClock(0)}
      finished={finished && clock > 0}
      summary={summary}
      status={
        finished && clock > 0
          ? { tone: 'ok', text: `Redirected in ${formatMs(total)}` }
          : { tone: 'neutral', text: `${formatMs(clock)} elapsed` }
      }
      stats={[
        { label: 'Time to redirect', value: formatMs(total) },
        {
          label: 'Spent on the network',
          value: `${Math.round(share * 100)}%`,
          detail: `server and database work: ${formatMs(inputs.serverMs + inputs.databaseMs)}`,
        },
        { label: 'Round trips before the request', value: String(roundTrips) },
        {
          label: 'Current step',
          value: shown ? shown.label : finished && clock > 0 ? 'Done' : 'Not started',
        },
      ]}
      controls={
        <>
          <Segmented
            label="Distance to the server"
            value={distance}
            options={distancePresets.map((preset) => ({
              value: preset.id,
              label: `${preset.label} (${preset.rttMs} ms)`,
            }))}
            onChange={(id) =>
              change({ rttMs: distancePresets.find((preset) => preset.id === id)?.rttMs ?? 40 })
            }
          />
          <Segmented
            label="TLS version"
            value={inputs.tlsVersion}
            options={[
              { value: '1.3', label: 'TLS 1.3' },
              { value: '1.2', label: 'TLS 1.2' },
            ]}
            onChange={(tlsVersion) => change({ tlsVersion })}
          />
          <Toggle
            label="DNS answer already cached"
            checked={inputs.dnsCached}
            onChange={(dnsCached) => change({ dnsCached })}
          />
          <Toggle
            label="Reuse an open connection"
            checked={inputs.connectionReused}
            onChange={(connectionReused) => change({ connectionReused })}
          />
        </>
      }
    >
      <DiagramScroll label="Scrollable diagram">
        <svg
          className="sdv-journey"
          viewBox="0 0 592 248"
          role="img"
          aria-label={`Diagram of the browser, DNS resolver, server, and database. ${shown ? `Now: ${shown.label}.` : ''}`}
        >
          <ArrowDefs id={arrow} />
          {wires.map(([a, b]) => {
            const segment = link(actors[a], actors[b]);
            return (
              <Edge
                key={`${a}-${b}`}
                from={segment.from}
                to={segment.to}
                active={activeWire === [a, b].sort().join('>')}
                dashed={(a === 'browser' && b === 'dns' && inputs.dnsCached) || undefined}
              />
            );
          })}
          {(Object.keys(actors) as Actor[]).map((id) => {
            const actor = actors[id];
            const involved = shown ? shown.from === id || shown.to === id : true;
            return (
              <SystemNode
                key={id}
                kind={actor.kind}
                x={actor.x}
                y={actor.y}
                label={actor.label}
                sublabel={actor.sublabel}
                highlight={Boolean(shown) && involved}
                dim={Boolean(shown) && !involved}
              />
            );
          })}
          {packet && <circle className="sdv-dot sdv-journey__packet" cx={packet[0]} cy={packet[1]} r={8} />}
        </svg>
      </DiagramScroll>
      <ol className="sdv-waterfall" aria-label="Timeline">
        {steps.map((step) => {
          const done = !step.skipped && clock >= step.startMs + step.durationMs && clock > 0;
          const running = step === active;
          const progress = step.skipped
            ? 0
            : Math.min(1, Math.max(0, (clock - step.startMs) / Math.max(step.durationMs, 0.001)));
          const state = step.skipped ? 'skipped' : done ? 'done' : running ? 'running' : 'waiting';
          return (
            <li key={step.id} className="sdv-waterfall__row" data-state={state}>
              <span className="sdv-waterfall__label">{step.label}</span>
              <span className="sdv-waterfall__track" aria-hidden="true">
                {!step.skipped && (
                  <span
                    className="sdv-waterfall__bar"
                    style={{
                      left: `${(step.startMs / Math.max(total, 1)) * 100}%`,
                      width: `${Math.max(0.6, (step.durationMs / Math.max(total, 1)) * 100)}%`,
                    }}
                  >
                    <span className="sdv-waterfall__fill" style={{ transform: `scaleX(${progress})` }} />
                  </span>
                )}
              </span>
              <span className="sdv-waterfall__time">
                {step.skipped ? 'Skipped' : formatMs(step.durationMs)}
                <span className="sdv-visually-hidden">
                  {state === 'done' ? ', done' : state === 'running' ? ', in progress' : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sdv-sim__note">
        Slow motion: one second on screen shows {MS_PER_TICK * TICKS_PER_SECOND} ms of real time.
        {shown && <> {shown.explanation}</>}
      </p>
    </SimulationShell>
  );
}
