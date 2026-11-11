import { useReducer, useRef, useState } from 'react';
import {
  DUEL_SECONDS,
  Duel,
  type DuelLane,
  type DuelScenarioId,
  duelScenarios,
  sentPerSecond,
  summarize,
} from '../../lib/models/balancerDuel';
import type { ServerState } from '../../lib/models/serverFarm';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';

/** Each queue track shows this much waiting work, end to end. */
const TRACK_MS = 500;

interface Props {
  scenarios?: DuelScenarioId[];
  initial?: DuelScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

function workMs(server: ServerState, work: number): number {
  return (work / server.capacity) * 1000;
}

function ServerRow({ server, sent }: { server: ServerState; sent: number }) {
  const waiting = server.queue.length;
  const totalMs = server.queue.reduce((sum, request) => sum + workMs(server, request.remaining), 0);
  let used = 0;
  const shown: { width: number; slow: boolean }[] = [];
  for (const request of server.queue) {
    if (used >= TRACK_MS) break;
    const ms = Math.min(workMs(server, request.remaining), TRACK_MS - used);
    used += ms;
    shown.push({ width: (ms / TRACK_MS) * 100, slow: request.slow });
  }
  const failing = !server.up && server.inPool;
  return (
    <li className="sdv-qtracks__row" data-down={server.up ? undefined : ''}>
      <div className="sdv-qtracks__head">
        <span className="sdv-qtracks__name">Server {server.id + 1}</span>
        {!server.up &&
          (server.inPool ? (
            <ToneBadge tone="bad">Down, still in the pool</ToneBadge>
          ) : (
            <ToneBadge tone="neutral">Down, removed from the pool</ToneBadge>
          ))}
      </div>
      <div className="sdv-qtracks__track" aria-hidden="true">
        {shown.map((request, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: queued requests have no identity beyond their position
            key={index}
            className="sdv-qtracks__req"
            data-slow={request.slow ? '' : undefined}
            data-head={index === 0 ? '' : undefined}
            style={{ width: `${request.width}%` }}
          />
        ))}
        {totalMs > TRACK_MS && (
          <span className="sdv-qtracks__more">+{Math.round(totalMs - TRACK_MS)} ms</span>
        )}
      </div>
      <p className="sdv-qtracks__meta">
        <span>
          {waiting} waiting ({Math.round(totalMs)} ms of work)
        </span>
        <span>
          Sent {Math.round(sent)}/s{failing && sent > 0 ? ', all failing' : ''}
        </span>
      </p>
    </li>
  );
}

function LanePane({
  lane,
  variant,
  tickSeconds,
}: {
  lane: DuelLane;
  variant: SeriesVariant;
  tickSeconds: number;
}) {
  const sent = sentPerSecond(lane, tickSeconds);
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ul className="sdv-qtracks">
        {lane.farm.serverStates.map((server) => (
          <ServerRow key={server.id} server={server} sent={sent.get(server.id) ?? 0} />
        ))}
      </ul>
    </section>
  );
}

const ms = (value: number) => `${Math.round(value)} ms`;

export default function BalancerDuelWidget({
  scenarios = ['equal', 'slow'],
  initial,
  title = 'Same traffic, two balancers',
  instructions = 'Pick a scenario, then press Play. Both balancers receive the exact same requests; only the routing differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<DuelScenarioId>(initial ?? scenarios[0] ?? 'equal');
  const duelRef = useRef<Duel | null>(null);
  if (!duelRef.current) duelRef.current = new Duel(duelScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: DuelScenarioId) => {
    duelRef.current = new Duel(duelScenarios[id]);
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
  const chooseScenario = (id: DuelScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarize(first), summarize(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const failedMetric = duel.scenario.metric === 'failed-total';
  const bothServed = sums[0].served > 0 && sums[1].served > 0;
  const latency = (value: number, column: number) =>
    (sums[column]?.served ?? 0) > 0 ? ms(value) : 'none yet';

  const rows: CompareRow[] = [
    { label: 'Requests in (same traffic)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Served', values: [sums[0].served, sums[1].served] },
    {
      label: 'p95 latency, whole run',
      values: [sums[0].p95Ms, sums[1].p95Ms],
      format: latency,
      better: bothServed ? 'lower' : undefined,
    },
    {
      label: 'Median latency',
      values: [sums[0].p50Ms, sums[1].p50Ms],
      format: latency,
      better: bothServed ? 'lower' : undefined,
    },
    {
      label: 'Largest queue, sampled every 0.1 s',
      values: [sums[0].longestQueue, sums[1].longestQueue],
      better: 'lower',
    },
    { label: 'Failed (sent to a down server)', values: [sums[0].failed, sums[1].failed], better: 'lower' },
    { label: 'Rejected (queue full, 503)', values: [sums[0].rejected, sums[1].rejected], better: 'lower' },
  ];

  const describeLane = (lane: DuelLane, index: 0 | 1) => {
    const sum = sums[index];
    return failedMetric
      ? `${lane.label}: ${sum.failed} failed`
      : `${lane.label}: p95 ${sum.served > 0 ? ms(sum.p95Ms) : 'none yet'}, largest sampled queue ${sum.longestQueue}`;
  };
  const summary = `${seconds.toFixed(1)} s of ${DUEL_SECONDS} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;

  const chartTitle = failedMetric
    ? 'Failed requests, running total'
    : 'Longest queue at any server, sampled every 0.1 s (requests)';
  const latest = (lane: DuelLane) => lane.series.at(-1) ?? 0;
  const chartSummary = failedMetric
    ? `${chartTitle}. ${first.label} ${latest(first)}, ${second.label.toLowerCase()} ${latest(second)}.`
    : `${chartTitle}. ${first.label} now ${latest(first)}, peak ${first.peak.value}. ${second.label} now ${latest(second)}, peak ${second.peak.value}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${DUEL_SECONDS} s` } as const);

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
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same requests for both"
          columns={[first.label, second.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: duelScenarios[id].label,
          diff: duelScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.strategy}
            lane={lane}
            variant={variants[index] ?? 'a'}
            tickSeconds={duel.tickSeconds}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the queues">
        <li>
          <span className="sdv-qtracks__req" aria-hidden="true" /> A waiting request; its width is the work it
          needs
        </li>
        <li>
          <span className="sdv-qtracks__req" data-slow="" aria-hidden="true" /> A slow request
        </li>
        <li>
          <span className="sdv-qtracks__req" data-head="" aria-hidden="true" /> Being served now
        </li>
        <li>Each track holds {TRACK_MS} ms of work</li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={failedMetric ? 100 : 10}
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
  );
}
