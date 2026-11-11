import { useId, useMemo, useReducer, useRef, useState } from 'react';
import {
  accountedFor,
  answeredCount,
  type BreakerState,
  failedCount,
  finishedGateway,
  type GatewayHop,
  type GatewayScenarioId,
  GatewaySim,
  gatewayScenarioOrder,
  gatewayScenarios,
  NOISY_BURST,
  type Outcome,
  outcomeLabels,
  outcomeOrder,
  RUN_TICKS,
  type TenantId,
  type TenantTally,
  TICK_SECONDS,
  tenantOrder,
  tenants,
  UPSTREAM_LIMIT,
} from '../../lib/models/aiGateway';
import { Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots } from '../viz/FlowDots';
import { link, type Vec } from '../viz/geometry';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';
import './GatewayWidgets.css';

interface Props {
  initial?: GatewayScenarioId;
  title?: string;
  instructions?: string;
}

interface Spot {
  x: number;
  y: number;
}

interface TrailHop extends GatewayHop {
  tick: number;
  index: number;
  at: number;
}

const STORES: Record<TenantId, Spot> = {
  a: { x: 70, y: 60 },
  b: { x: 70, y: 150 },
  c: { x: 70, y: 240 },
};
const GATEWAY: Spot = { x: 310, y: 150 };
const MEDIUM: Spot = { x: 560, y: 80 };
const SMALL: Spot = { x: 560, y: 220 };
const center = (spot: Spot): Vec => [spot.x, spot.y];

const MAX_DOTS = 24;
const DOT_LIFE_MS = 650;
const STRIP_LENGTH = 40;

const breakerNames: Record<BreakerState, string> = {
  closed: 'closed',
  open: 'open',
  halfOpen: 'half open',
};

const marks: Record<Outcome, { letter: string; tone: Tone }> = {
  primary: { letter: '✓', tone: 'ok' },
  cache: { letter: 'C', tone: 'ok' },
  fallback: { letter: 'F', tone: 'warn' },
  handoff: { letter: 'H', tone: 'warn' },
  quota: { letter: 'Q', tone: 'neutral' },
  rateLimited: { letter: 'X', tone: 'bad' },
  outage: { letter: 'X', tone: 'bad' },
  malformed: { letter: 'X', tone: 'bad' },
};

const clock = (tick: number) => `${(tick * TICK_SECONDS).toFixed(1)} s`;

function flowFor(hop: TrailHop, generation: number): Flow {
  const store = center(STORES[hop.tenant]);
  const gateway = center(GATEWAY);
  const id = `${generation}-${hop.tick}-${hop.index}-${hop.callId}-${hop.kind}`;
  switch (hop.kind) {
    case 'toMedium':
      return { id, points: [store, gateway, center(MEDIUM)], duration: 0.5 };
    case 'retry':
      return { id, points: [gateway, center(MEDIUM)], tone: 'miss', duration: 0.4 };
    case 'toSmall':
      return { id, points: [gateway, center(SMALL)], tone: 'miss', duration: 0.4 };
    case 'answer':
      return { id, points: [center(MEDIUM), gateway, store], tone: 'hit', duration: 0.5 };
    case 'fallbackAnswer':
      return { id, points: [center(SMALL), gateway, store], tone: 'hit', duration: 0.5 };
    case 'cacheHit':
      return { id, points: [store, gateway, store], tone: 'hit', duration: 0.5 };
    case 'shed':
      return { id, points: [store, gateway, store], tone: 'bad', duration: 0.5 };
    default:
      return { id, points: [gateway, store], tone: 'bad', duration: 0.4 };
  }
}

function tallyLine(tally: TenantTally): string {
  return `${tally.arrived} arrived, ${answeredCount(tally)} answered, ${tally.handoff} handed off, ${
    tally.quota
  } shed by quota, ${failedCount(tally)} failed`;
}

function resolutionText(outcome: Outcome, callId: string, tick: number): string {
  return `${callId} at ${clock(tick + 1)}: ${outcomeLabels[outcome]}`;
}

export default function GatewayPipelineWidget({
  initial = 'noisy',
  title = 'Requests from three stores through one gateway',
  instructions = 'Pick a scenario, then press Play or Step. Run it with gateway policies off, then turn them on and run it again.',
}: Props) {
  const hydrated = useHydrated();
  const baseId = safeId(useId(), 'gw-pipe');
  const arrow = `${baseId}-arrow`;
  const [scenarioId, setScenarioId] = useState<GatewayScenarioId>(initial);
  const [policies, setPolicies] = useState(false);
  const runRef = useRef<GatewaySim | null>(null);
  const generation = useRef(0);
  const trail = useRef<TrailHop[]>([]);
  runRef.current ??= new GatewaySim(scenarioId, policies);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const other = useMemo(() => finishedGateway(scenarioId, !policies), [scenarioId, policies]);

  const restart = (id: GatewayScenarioId, withPolicies: boolean) => {
    runRef.current = new GatewaySim(id, withPolicies);
    generation.current += 1;
    trail.current = [];
    rerender();
  };
  const onTick = () => {
    run.step();
    const now = Date.now();
    const fresh = run.hops.map((hop, index) => ({ ...hop, tick: run.ticks, index, at: now }));
    trail.current = [...trail.current.filter((hop) => now - hop.at < DOT_LIFE_MS), ...fresh].slice(-MAX_DOTS);
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    trail.current = [];
    rerender();
  };
  const chooseScenario = (id: GatewayScenarioId) => {
    setScenarioId(id);
    restart(id, policies);
  };
  const choosePolicies = (checked: boolean) => {
    setPolicies(checked);
    restart(scenarioId, checked);
  };

  const total = run.total;
  const started = run.ticks > 0;
  const latestTick = run.ticks - 1;
  const down = run.primaryDown;
  const storeB = run.tallies.b;
  const otherB = other.tallies.b;
  const policyName = policies ? 'on' : 'off';
  const otherName = policies ? 'off' : 'on';
  const inBurst =
    scenarioId === 'noisy' && latestTick >= NOISY_BURST.startTick && latestTick < NOISY_BURST.endTick;

  const latest = new Map<TenantId, { outcome: Outcome; callId: string; tick: number }>();
  for (const resolution of run.resolutions) latest.set(resolution.tenant, resolution);
  const nowResolutions = run.resolutions.filter((resolution) => resolution.tick === latestTick);
  const touched = new Set(run.hops.map((hop) => hop.kind));
  const touchedStores = new Set(run.hops.map((hop) => hop.tenant));

  const status = run.done
    ? failedCount(total) === 0
      ? ({ tone: 'ok', text: 'Run complete: no failed requests' } as const)
      : ({ tone: 'bad', text: `Run complete: ${failedCount(total)} failed requests` } as const)
    : !started
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : down
        ? ({ tone: 'bad', text: `${clock(run.ticks)}: Medium is returning errors` } as const)
        : policies && run.breaker !== 'closed'
          ? ({ tone: 'warn', text: `${clock(run.ticks)}: breaker ${breakerNames[run.breaker]}` } as const)
          : ({ tone: 'neutral', text: `${clock(run.ticks)} of ${clock(RUN_TICKS)}` } as const);

  const summary = started
    ? `${clock(run.ticks)}, gateway policies ${policyName}. Store B: ${tallyLine(storeB)}. All stores: ${tallyLine(
        total,
      )}, ${total.inFlight} in flight.${policies ? ` Breaker ${breakerNames[run.breaker]}.` : ''}`
    : `No requests yet. ${run.scenario.label}: ${run.scenario.diff}. Gateway policies ${policyName}.`;

  const nowText = started
    ? `At ${clock(run.ticks)}, Medium is ${down ? 'returning errors' : 'healthy'}${
        policies ? ` and the breaker is ${breakerNames[run.breaker]}` : ''
      }. ${nowResolutions.length} requests finished on this tick.`
    : 'No requests yet.';

  const flows = trail.current.map((hop) => flowFor(hop, generation.current));
  const storeLinks = tenantOrder.map((id) => ({ id, ...link(STORES[id], GATEWAY) }));
  const toMedium = link(GATEWAY, MEDIUM);
  const toSmall = link(GATEWAY, SMALL);

  const columns = [
    ...tenantOrder.map((id) => ({ key: id, label: tenants[id].label, tally: run.tallies[id] })),
    { key: 'total', label: 'All stores', tally: total },
  ];
  const rows: { key: string; label: string; value: (tally: TenantTally) => number }[] = [
    { key: 'arrived', label: 'Arrived', value: (tally) => tally.arrived },
    ...outcomeOrder.map((outcome) => ({
      key: outcome,
      label: outcomeLabels[outcome],
      value: (tally: TenantTally) => tally[outcome],
    })),
    { key: 'inFlight', label: 'Still in flight', value: (tally) => tally.inFlight },
    { key: 'accounted', label: 'Accounted for', value: accountedFor },
  ];

  const markerEvents = run.events.filter((event) => event.marker);
  const notes = run.events.filter((event) => !event.marker);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId, policies)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={`${scenarioId}-${policyName}`}
      ticksPerSecond={10}
      controls={
        <div className="sdv-duel__extra">
          <Toggle
            label="Gateway policies: quota, cache, validator, fallback, and breaker"
            checked={policies}
            onChange={choosePolicies}
          />
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <DiagramScroll label="Request counts by store, scrollable">
          <table className="sdv-stats sdv-compare sdv-gw-table">
            <caption>
              Every request so far, by store. Accounted for adds every outcome and the requests still in
              flight, so it always equals Arrived.
            </caption>
            <thead>
              <tr>
                <td />
                {columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <span className="sdv-stats__value">{row.value(column.tally)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DiagramScroll>
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={gatewayScenarioOrder.map((id) => ({
          value: id,
          label: gatewayScenarios[id].label,
          diff: gatewayScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-gw-now">
          <p className="sdv-gw-title">Right now</p>
          <div className="sdv-gw-now-body">
            <p className="sdv-gw-line">
              <span className="sdv-gw-id">{started ? clock(run.ticks) : '0.0 s'}</span>
              <span className="sdv-gw-pill" data-emphasis={down}>
                {down ? 'Medium: returning errors' : 'Medium: healthy'}
              </span>
              <span className="sdv-gw-pill" data-emphasis={policies && run.breaker !== 'closed'}>
                {policies ? `Breaker: ${breakerNames[run.breaker]}` : 'No breaker'}
              </span>
              {inBurst && (
                <span className="sdv-gw-pill" data-emphasis>
                  Store A backfill running
                </span>
              )}
            </p>
            {latest.size > 0 ? (
              <ul className="sdv-gw-badges" aria-label="The latest finished request from each store">
                {tenantOrder.map((id) => {
                  const last = latest.get(id);
                  return last ? (
                    <li key={id}>
                      <ToneBadge tone={marks[last.outcome].tone}>
                        {`${tenants[id].label}: ${outcomeLabels[last.outcome]}`}
                      </ToneBadge>
                    </li>
                  ) : null;
                })}
              </ul>
            ) : (
              <p className="sdv-trace__empty">Press Play or Step to start the stores sending requests.</p>
            )}
          </div>
        </div>
        <DiagramScroll label="Gateway diagram, scrollable">
          <svg
            className="sdv-gw-diagram"
            viewBox="0 0 640 300"
            role="img"
            aria-label={`Stores A, B, and C send requests to one gateway. ${
              policies
                ? 'The gateway checks each store’s quota and the response cache, calls Medium, validates the reply, and falls back to Small.'
                : 'The gateway passes every request straight to Medium.'
            } Medium and Small share an upstream limit of ${UPSTREAM_LIMIT} requests per second. ${nowText}`}
          >
            <ArrowDefs id={arrow} />
            {storeLinks.map((edge) => (
              <Edge
                key={edge.id}
                from={edge.from}
                to={edge.to}
                marker={arrow}
                active={touchedStores.has(edge.id)}
              />
            ))}
            <Edge
              from={toMedium.from}
              to={toMedium.to}
              marker={arrow}
              active={touched.has('toMedium') || touched.has('retry') || touched.has('answer')}
            />
            <Edge
              from={toSmall.from}
              to={toSmall.to}
              marker={arrow}
              active={touched.has('toSmall') || touched.has('fallbackAnswer')}
              dashed
            />
            <text className="sdv-chart__label" x={MEDIUM.x} y={150} textAnchor="middle">
              {`shared limit ${UPSTREAM_LIMIT} req/s`}
            </text>
            <text className="sdv-chart__label" x={445} y={218} textAnchor="middle">
              {policies ? 'fallback' : 'unused'}
            </text>
            {tenantOrder.map((id) => (
              <SystemNode
                key={id}
                kind="client"
                x={STORES[id].x}
                y={STORES[id].y}
                label={tenants[id].label}
                sublabel={policies ? `quota ${tenants[id].quota} req/s` : 'no quota'}
                highlight={touchedStores.has(id)}
              />
            ))}
            <SystemNode
              kind="loadBalancer"
              x={GATEWAY.x}
              y={GATEWAY.y}
              label="Gateway"
              sublabel={policies ? `breaker ${breakerNames[run.breaker]}` : 'pass through'}
              status={policies && run.breaker !== 'closed' ? 'warn' : undefined}
              highlight={run.hops.length > 0}
            />
            <SystemNode
              kind="model"
              x={MEDIUM.x}
              y={MEDIUM.y}
              label="Medium"
              sublabel={down ? 'errors' : 'primary'}
              status={down ? 'bad' : undefined}
              highlight={touched.has('toMedium') || touched.has('retry')}
            />
            <SystemNode
              kind="model"
              x={SMALL.x}
              y={SMALL.y}
              label="Small"
              sublabel="fallback"
              highlight={touched.has('toSmall')}
              dim={!policies}
            />
            <FlowDots flows={flows} />
          </svg>
        </DiagramScroll>
        <div className="sdv-duel__lanes">
          {tenantOrder.map((id) => {
            const stripId = `${baseId}-${id}`;
            const tally = run.tallies[id];
            const recent = run.resolutions
              .filter((resolution) => resolution.tenant === id)
              .slice(-STRIP_LENGTH);
            return (
              <section key={id} className="sdv-duel__lane" aria-label={tenants[id].label}>
                <h4 className="sdv-duel__lane-title">{tenants[id].label}</h4>
                <div className="sdv-strip">
                  <p className="sdv-strip__label" id={stripId}>
                    Latest {STRIP_LENGTH} outcomes, oldest first
                  </p>
                  <ol className="sdv-strip__items" aria-labelledby={stripId}>
                    {recent.map((resolution) => {
                      const mark = marks[resolution.outcome];
                      const text = resolutionText(resolution.outcome, resolution.callId, resolution.tick);
                      return (
                        <li
                          key={resolution.callId}
                          className="sdv-gw-strip-mark"
                          data-tone={mark.tone}
                          title={text}
                        >
                          <span aria-hidden="true">{mark.letter}</span>
                          <span className="sdv-visually-hidden">{text}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <p className="sdv-gw-meta">{tally.arrived === 0 ? 'No requests yet' : tallyLine(tally)}</p>
              </section>
            );
          })}
        </div>
      </MotionRoot>
      <p className="sdv-gw-meta">
        {`For comparison, the full run with policies ${otherName}: Store B ends with ${tallyLine(
          otherB,
        )}. All stores: ${answeredCount(other.total)} answered, ${failedCount(other.total)} failed.`}
      </p>
      <ul className="sdv-legend" aria-label="How to read the outcome strips">
        <li>
          <span className="sdv-gw-strip-mark" data-tone="ok" aria-hidden="true">
            ✓
          </span>{' '}
          Answered by Medium
        </li>
        <li>
          <span className="sdv-gw-strip-mark" data-tone="ok" aria-hidden="true">
            C
          </span>{' '}
          Answered from the response cache
        </li>
        <li>
          <span className="sdv-gw-strip-mark" data-tone="warn" aria-hidden="true">
            F
          </span>{' '}
          Answered by Small as a fallback
        </li>
        <li>
          <span className="sdv-gw-strip-mark" data-tone="warn" aria-hidden="true">
            H
          </span>{' '}
          Handed off: please try again
        </li>
        <li>
          <span className="sdv-gw-strip-mark" data-tone="neutral" aria-hidden="true">
            Q
          </span>{' '}
          Shed by the store’s quota
        </li>
        <li>
          <span className="sdv-gw-strip-mark" data-tone="bad" aria-hidden="true">
            X
          </span>{' '}
          Failed: rate limit, model error, or malformed reply
        </li>
        <li>Arrival rates, timings, limits, and failure odds are toy numbers.</li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            The first quota shed, failure, fallback, and breaker change appear here.
          </p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{clock(event.tick)}</time> {event.text}
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
  );
}
