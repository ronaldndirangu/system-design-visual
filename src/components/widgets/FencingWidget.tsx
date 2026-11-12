import { useMemo, useReducer, useRef, useState } from 'react';
import {
  FENCE_RUN_S,
  FenceDuel,
  type FenceLane,
  type FenceScenarioId,
  type FenceSummary,
  fenceScenarios,
  LEASE_S,
  RENEW_EVERY_S,
} from '../../lib/models/fencing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { FenceTimeLanes } from './FenceTimeLanes';

interface Props {
  scenarios?: FenceScenarioId[];
  initial?: FenceScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

function laneHealth(sum: FenceSummary, started: boolean): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  if (sum.clashes > 0) {
    return {
      tone: 'bad',
      text: `${sum.clashes} ${sum.clashes === 1 ? 'sequence number' : 'sequence numbers'} used twice`,
    };
  }
  if (sum.staleRejected > 0) return { tone: 'ok', text: 'Stale writes blocked' };
  return { tone: 'ok', text: 'Log consistent' };
}

function serverAState(lane: FenceLane): string {
  const a = lane.servers.A;
  const waiting =
    lane.inFlight > 0 ? `, ${lane.inFlight} ${lane.inFlight === 1 ? 'write' : 'writes'} still in flight` : '';
  if (a.role === 'out') return `Server A: stopped${waiting}`;
  if (lane.frozen(lane.now)) return 'Server A: frozen mid write';
  return `Server A: writing as owner${waiting}`;
}

function LanePane({
  lane,
  sum,
  variant,
  started,
}: {
  lane: FenceLane;
  sum: FenceSummary;
  variant: SeriesVariant;
  started: boolean;
}) {
  const health = laneHealth(sum, started);
  const { holder, token, expiresAt } = lane.lock;
  const highestSeq = lane.entries.reduce((high, entry) => Math.max(high, entry.seq), 0);
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <p className="sdv-qtracks__meta">
        <span>
          Lock: {holder ? `server ${holder}, token ${token}, expires at ${expiresAt.toFixed(1)} s` : 'free'}
        </span>
        <span>
          Chat log: {sum.entries} {sum.entries === 1 ? 'message' : 'messages'}, highest seq {highestSeq}
        </span>
        <span>
          {lane.policy === 'fenced' ? `Log's highest token: ${lane.maxToken}` : 'Log checks no tokens'}
        </span>
        <span>{serverAState(lane)}</span>
      </p>
    </section>
  );
}

export default function FencingWidget({
  scenarios = ['pause', 'delay', 'skew', 'calm'],
  initial,
  title = 'One chat, two servers, one lease',
  instructions = 'Pick a fault, then press Play. Both lanes replay the same script; only the chat log differs. In the Lease plus fencing token lane, the log refuses any write whose token is older than one it has already seen. Use Step to move through the time lanes one half second at a time.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<FenceScenarioId>(initial ?? scenarios[0] ?? 'pause');
  const duelRef = useRef<FenceDuel | null>(null);
  if (!duelRef.current) duelRef.current = new FenceDuel(fenceScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const poster = useMemo(() => {
    const full = new FenceDuel(fenceScenarios[scenarioId]);
    while (!full.done) full.step();
    return full;
  }, [scenarioId]);

  const restart = (id: FenceScenarioId) => {
    duelRef.current = new FenceDuel(fenceScenarios[id]);
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
  const chooseScenario = (id: FenceScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [first.summary(), second.summary()] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const started = duel.ticks > 0;

  const rows: CompareRow[] = [
    { label: 'Messages in the chat log', values: [sums[0].entries, sums[1].entries] },
    {
      label: 'Stale writes that reached the log',
      values: [sums[0].staleAccepted + sums[0].staleRejected, sums[1].staleAccepted + sums[1].staleRejected],
    },
    {
      label: 'Stale writes accepted',
      values: [sums[0].staleAccepted, sums[1].staleAccepted],
      better: 'lower',
    },
    { label: 'Stale writes rejected', values: [sums[0].staleRejected, sums[1].staleRejected] },
    { label: 'Sequence numbers used twice', values: [sums[0].clashes, sums[1].clashes], better: 'lower' },
  ];

  const describeLane = (lane: FenceLane, sum: FenceSummary) =>
    `${lane.label}: ${sum.staleAccepted} stale writes accepted, ${sum.staleRejected} rejected, ${sum.clashes} sequence numbers used twice`;
  const summary = `${seconds.toFixed(1)} s of ${FENCE_RUN_S} s. ${describeLane(first, sums[0])}. ${describeLane(second, sums[1])}.`;

  const timeline = duel.timeline();

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${FENCE_RUN_S} s` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

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
          caption="Whole run so far, same script for both"
          columns={[first.label, second.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Fault"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: fenceScenarios[id].label,
          diff: fenceScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <FenceTimeLanes
        lanes={poster.lanes}
        scenario={fenceScenarios[scenarioId]}
        variants={variants}
        now={seconds}
        stepping={started && !duel.done}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.policy}
            lane={lane}
            sum={sums[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
            started={started}
          />
        ))}
      </div>
      <p className="sdv-sim__note">
        Toy model, illustrative numbers. The lease lasts {LEASE_S} s and the owner renews every{' '}
        {RENEW_EVERY_S} s. The owner sends one chat message every 2 s; server B checks the lock every second.
        A stale write carries a token older than the newest one the lock service has issued.
      </p>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {timeline.length === 0 ? (
          <p className="sdv-trace__empty">
            Press Play. Each step of the handover appears here as it happens.
          </p>
        ) : (
          <ol>
            {timeline.map((event, index) => (
              <li key={`${event.t}-${event.lane ?? 'both'}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{event.t.toFixed(1)} s</time> {event.lane ? `${event.lane}: ` : ''}
                {event.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </SimulationShell>
  );
}
