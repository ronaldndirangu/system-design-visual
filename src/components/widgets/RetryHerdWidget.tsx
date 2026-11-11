import { useReducer, useRef } from 'react';
import {
  HERD_CAPACITY,
  HERD_CLIENTS,
  HERD_RESTART_MS,
  HERD_RUN_SECONDS,
  HERD_STEP_MS,
  HerdDuel,
  type HerdLane,
} from '../../lib/models/retries';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './RetryHerdWidget.css';

interface Props {
  title?: string;
  instructions?: string;
}

type SenderState = 'waiting' | 'turned' | 'served';

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

/** Served senders stay served; a sender turned away in the latest step shows that until its next try. */
function senderStates(lane: HerdLane, lastStep: number): SenderState[] {
  const states: SenderState[] = Array.from({ length: HERD_CLIENTS }, () => 'waiting');
  for (const mark of lane.marks) {
    if (mark.outcome === 'served') states[mark.client] = 'served';
    else if (mark.step === lastStep && states[mark.client] !== 'served') states[mark.client] = 'turned';
  }
  return states;
}

function laneHealth(lane: HerdLane, started: boolean, stepMs: number): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  if (lane.herd.waiting === 0) return { tone: 'ok', text: 'Everyone connected' };
  if (stepMs < HERD_RESTART_MS) return { tone: 'bad', text: 'Restarting, refusing connections' };
  const latest = lane.series.at(-1) ?? 0;
  if (latest > HERD_CAPACITY) return { tone: 'bad', text: 'Herd arrives at once, most get 503' };
  if (latest === 0) return { tone: 'warn', text: 'Service has room, nobody tries' };
  return { tone: 'ok', text: 'Senders trickle in' };
}

function LanePane({
  lane,
  variant,
  started,
  stepMs,
}: {
  lane: HerdLane;
  variant: SeriesVariant;
  started: boolean;
  stepMs: number;
}) {
  const lastStep = lane.herd.ticks - 1;
  const states = senderStates(lane, lastStep);
  const turned = states.filter((state) => state === 'turned').length;
  const latest = lane.series.at(-1) ?? 0;
  const health = laneHealth(lane, started, stepMs);
  return (
    <section className="sdv-duel__lane sdv-rh__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <div className="sdv-rh__pool">
        <p className="sdv-rh__pool-name">{HERD_CLIENTS} redirect servers</p>
        <span className="sdv-rh__senders" aria-hidden="true">
          {states.map((state, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: senders have no identity beyond their position
            <span key={index} className="sdv-rh__sender" data-state={state} />
          ))}
        </span>
        <p className="sdv-qtracks__meta">
          <span>
            {HERD_CLIENTS - lane.herd.waiting} of {HERD_CLIENTS} connected
          </span>
          <span>
            Last step: {latest} {latest === 1 ? 'attempt' : 'attempts'}, {turned} turned away
          </span>
        </p>
      </div>
    </section>
  );
}

export default function RetryHerdWidget({
  title = 'Forty senders reconnect after a restart',
  instructions = `Press Play. The ingest service restarts and every redirect server loses its connection at the same moment. Both lanes retry with the same doubling backoff; only the jitter differs. The service is back at ${(HERD_RESTART_MS / 1000).toFixed(1)} s and takes ${HERD_CAPACITY} attempts every ${HERD_STEP_MS} ms.`,
}: Props) {
  const hydrated = useHydrated();
  const duelRef = useRef<HerdDuel | null>(null);
  if (!duelRef.current) duelRef.current = new HerdDuel();
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = () => {
    duelRef.current = new HerdDuel();
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

  const [first, second] = duel.lanes;
  const started = duel.ticks > 0;
  const seconds = duel.ticks * duel.tickSeconds;
  const stepMs = Math.max(0, duel.ticks - 1) * HERD_STEP_MS;
  const served = duel.lanes.map((lane) => lane.herd.allServedAt ?? Number.POSITIVE_INFINITY) as [
    number,
    number,
  ];
  const formatServed = (value: number) => {
    if (Number.isFinite(value)) return `${(value / 1000).toFixed(2)} s`;
    return duel.done ? 'Never in this run' : 'Not yet';
  };
  const turnedAway = (lane: HerdLane) => lane.herd.totals.rejected + lane.herd.totals.refused;

  const rows: CompareRow[] = [
    {
      label: 'Senders connected',
      values: [first.herd.totals.served, second.herd.totals.served],
      better: 'higher',
    },
    { label: 'Still waiting', values: [first.herd.waiting, second.herd.waiting], better: 'lower' },
    {
      label: 'Attempts sent',
      values: [first.herd.totals.attempts, second.herd.totals.attempts],
      better: 'lower',
    },
    { label: 'Attempts turned away', values: [turnedAway(first), turnedAway(second)], better: 'lower' },
    {
      label: `Most attempts in one ${HERD_STEP_MS} ms step`,
      values: [first.peakAttempts, second.peakAttempts],
      better: 'lower',
    },
    {
      label: 'Steps where the service sat idle while senders waited',
      values: [first.idleSteps, second.idleSteps],
      better: 'lower',
    },
    {
      label: 'Last sender connected at',
      values: served,
      format: formatServed,
      better: served.some(Number.isFinite) ? 'lower' : undefined,
    },
  ];

  const describeLane = (lane: HerdLane) =>
    `${lane.label}: ${HERD_CLIENTS - lane.herd.waiting} of ${HERD_CLIENTS} connected after ${lane.herd.totals.attempts} attempts`;
  const summary = `${seconds.toFixed(2)} s of ${HERD_RUN_SECONDS} s. ${describeLane(first)}. ${describeLane(second)}.`;

  const chartTitle = `Attempts per ${HERD_STEP_MS} ms step (the service takes ${HERD_CAPACITY})`;
  const chartSummary = `${chartTitle}. ${first.label} peaked at ${first.peakAttempts}. ${second.label} peaked at ${second.peakAttempts}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(2)} s of ${HERD_RUN_SECONDS} s` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={restart}
      summary={summary}
      status={status}
      finished={duel.done}
      ticksPerSecond={10}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same 40 senders for both"
          columns={[first.label, second.label]}
          rows={rows}
        />
      }
    >
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.policy}
            lane={lane}
            variant={variants[index] ?? 'a'}
            started={started}
            stepMs={stepMs}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the senders">
        <li>
          <span className="sdv-rh__sender" data-state="waiting" aria-hidden="true" /> Waiting out its backoff
        </li>
        <li>
          <span className="sdv-rh__sender" data-state="turned" aria-hidden="true" /> Just tried and got turned
          away
        </li>
        <li>
          <span className="sdv-rh__sender" data-state="served" aria-hidden="true" /> Connected again
        </li>
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
        minMax={HERD_CLIENTS}
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
                <time>{(event.tick * duel.tickSeconds).toFixed(2)} s</time> {event.text}
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
