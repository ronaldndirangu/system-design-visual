import { useReducer, useRef, useState } from 'react';
import { keyPosition } from '../../lib/models/hashing';
import {
  CART_KEY,
  confirmedVersion,
  describeOp,
  type FailureId,
  failureOrder,
  failureScenarios,
  isDown,
  lastAnswered,
  listReplicas,
  type OpResult,
  overlaps,
  PREFERENCE,
  type QuorumRun,
  type QuorumSettingId,
  QuorumSim,
  quorumSettingOrder,
  quorumSettings,
  type ReplicaId,
  replicaLabel,
  replicaRing,
  replicaVersion,
  resultText,
  summarize,
  TICK_MS,
} from '../../lib/models/quorums';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots } from '../viz/FlowDots';
import { boxExit, lerp, type Vec } from '../viz/geometry';
import { UiIcon } from '../viz/icons';
import { Edge, SystemNode } from '../viz/SystemNode';
import './QuorumWidget.css';

interface Props {
  settings?: readonly QuorumSettingId[];
  failures?: readonly FailureId[];
  initialSetting?: QuorumSettingId;
  initialFailure?: FailureId;
  title?: string;
  instructions?: string;
}

const RING = { cx: 220, cy: 195, r: 150 };
const REPLICA_W = 84;
const REPLICA_H = 56;
const SERVICE = { x: 220, y: 195, w: 112, h: 64 };
const SAM = { x: 372, y: 48, w: 92, h: 48 };
const RANKS = ['1st', '2nd', '3rd', '4th', '5th'] as const;

/** Keeps the diagram readable when requests and answers overlap. */
const MAX_DOTS = 10;

function pointAt(position: number, radius = RING.r): Vec {
  const angle = position * 2 * Math.PI - Math.PI / 2;
  return [RING.cx + radius * Math.cos(angle), RING.cy + radius * Math.sin(angle)];
}

function arcPath(start: number, end: number): string {
  const [x1, y1] = pointAt(start);
  const [x2, y2] = pointAt(end);
  const large = end - start > 0.5 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${RING.r} ${RING.r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const KEY_AT = keyPosition(CART_KEY);
const ringPosition = new Map(replicaRing.points.map((point) => [point.shard as ReplicaId, point.position]));
const replicaPos = (replica: ReplicaId) => {
  const [x, y] = pointAt(ringPosition.get(replica) ?? 0);
  return { x, y };
};

/** A box height that also clears the sublabel SystemNode draws under the shape. */
const withSublabel = (height: number) => height + 44;

function serviceToReplica(replica: ReplicaId): { from: Vec; to: Vec } {
  const target = replicaPos(replica);
  const replicaBelow = target.y > SERVICE.y;
  return {
    from: boxExit(SERVICE, target, 6, SERVICE.w, replicaBelow ? withSublabel(SERVICE.h) : SERVICE.h),
    to: boxExit(target, SERVICE, 6, REPLICA_W, replicaBelow ? REPLICA_H : withSublabel(REPLICA_H)),
  };
}

const samLink = {
  from: boxExit(SAM, SERVICE, 6, SAM.w, SAM.h),
  to: boxExit(SERVICE, SAM, 6, SERVICE.w, SERVICE.h),
};

/** Clockwise distance from the key to a replica, so an arc can wrap past the top of the ring. */
function arcEnd(replica: ReplicaId): number {
  const position = ringPosition.get(replica) ?? 0;
  return position >= KEY_AT ? position : position + 1;
}

type PillStatus = 'ok' | 'warn' | 'bad' | 'none';

function statusOf(result: OpResult | null, now: number): PillStatus {
  if (!result || result.replyAt >= now) return 'none';
  if (result.outcome === 'failed') return 'bad';
  return result.outcome === 'stale' ? 'warn' : 'ok';
}

function Pill({ status, children }: { status: PillStatus; children: string }) {
  return (
    <span className="sdv-quorum__pill" data-status={status}>
      {status !== 'none' && <UiIcon name={status} />}
      {children}
    </span>
  );
}

function ringFlows(run: QuorumRun, now: number): Flow[] {
  const from = now - TICK_MS;
  const inWindow = (at: number) => at >= from && at < now;
  const flows: Flow[] = [];
  for (const result of run.results) {
    const { op } = result;
    if (inWindow(op.at)) {
      flows.push({ id: `ask-${op.id}`, points: [samLink.from, samLink.to], tone: 'request', duration: 0.25 });
      for (const replica of result.contacted) {
        const segment = serviceToReplica(replica);
        const reached = result.replies.some((reply) => reply.replica === replica);
        flows.push({
          id: `send-${op.id}-${replica}`,
          points: [segment.from, reached ? segment.to : lerp(segment.from, segment.to, 0.5)],
          tone: reached ? 'request' : 'bad',
          duration: 0.25,
        });
      }
    }
    for (const reply of result.replies) {
      if (!inWindow(reply.arriveAt)) continue;
      const segment = serviceToReplica(reply.replica);
      const behind = op.kind === 'read' && reply.version < result.expected;
      flows.push({
        id: `back-${op.id}-${reply.replica}`,
        points: [segment.to, segment.from],
        tone: behind ? 'miss' : 'hit',
        duration: 0.25,
      });
    }
    if (inWindow(result.replyAt)) {
      const status = statusOf(result, result.replyAt + 1);
      flows.push({
        id: `answer-${op.id}`,
        points: [samLink.to, samLink.from],
        tone: status === 'bad' ? 'bad' : status === 'warn' ? 'miss' : 'hit',
        duration: 0.25,
      });
    }
  }
  return flows.slice(0, MAX_DOTS);
}

interface ReplicaView {
  replica: ReplicaId;
  rank: number;
  inSet: boolean;
  down: boolean;
  version: number;
  behind: boolean;
}

function replicaViews(run: QuorumRun, now: number): ReplicaView[] {
  const confirmed = confirmedVersion(run, now);
  return PREFERENCE.map((replica, rank) => {
    const inSet = rank < run.setting.n;
    const down = isDown(run.failure, replica, now - 1);
    const version = replicaVersion(run, replica, now);
    return { replica, rank, inSet, down, version, behind: inSet && version < confirmed };
  });
}

function replicaPhrase(view: ReplicaView): string {
  const name = replicaLabel(view.replica);
  if (!view.inSet) return `${name} holds no copy`;
  const state = view.down ? ' is down and' : '';
  const behind = view.behind ? ', behind the confirmed version' : '';
  return `${name}${state} holds v${view.version}${behind}`;
}

function RingDiagram({ run, now }: { run: QuorumRun; now: number }) {
  const { setting } = run;
  const views = replicaViews(run, now);
  const confirmed = confirmedVersion(run, now);
  const set = PREFERENCE.slice(0, setting.n);
  const last = set.at(-1) as ReplicaId;
  const flows = ringFlows(run, now);
  const from = now - TICK_MS;
  const inWindow = (at: number) => at >= from && at < now;
  const busy = (replica: ReplicaId) =>
    run.results.some(
      (result) =>
        (inWindow(result.op.at) && result.contacted.includes(replica)) ||
        result.replies.some((reply) => reply.replica === replica && inWindow(reply.arriveAt)),
    );
  const samBusy = run.results.some((result) => inWindow(result.op.at) || inWindow(result.replyAt));
  const keyPoint = pointAt(KEY_AT);
  const keyLabel = pointAt(KEY_AT, RING.r + 22);
  const label = `Ring diagram. Sam's cart key sits on the ring between replicas C and A. Walking clockwise from the key, the cart service keeps ${setting.n} copies on ${listReplicas(set)}. ${views.map(replicaPhrase).join('. ')}. Confirmed to Sam: ${confirmed === 0 ? 'nothing yet' : `v${confirmed}`}.`;
  return (
    <DiagramScroll label="Replica ring diagram, scrolls sideways">
      <svg className="sdv-quorum__svg" viewBox="46 10 396 380" role="img" aria-label={label}>
        <circle className="sdv-quorum__track" cx={RING.cx} cy={RING.cy} r={RING.r} />
        <path className="sdv-quorum__arc" d={arcPath(KEY_AT, arcEnd(last))} />
        <Edge from={samLink.from} to={samLink.to} active={samBusy} />
        {views
          .filter((view) => view.inSet)
          .map((view) => {
            const segment = serviceToReplica(view.replica);
            return (
              <Edge
                key={view.replica}
                from={segment.from}
                to={segment.to}
                dashed={view.down}
                active={!view.down && busy(view.replica)}
              />
            );
          })}
        <g className="sdv-quorum__key" transform={`translate(${keyPoint[0]} ${keyPoint[1]})`}>
          <path d="M0 -8L8 0L0 8L-8 0Z" />
        </g>
        <text className="sdv-quorum__key-label" x={keyLabel[0]} y={keyLabel[1] + 4}>
          Sam's cart
        </text>
        <SystemNode
          kind="client"
          x={SAM.x}
          y={SAM.y}
          width={SAM.w}
          height={SAM.h}
          label="Sam"
          sublabel="shopper"
        />
        <SystemNode
          kind="server"
          x={SERVICE.x}
          y={SERVICE.y}
          label="Cart service"
          sublabel={`N ${setting.n}, R ${setting.r}, W ${setting.w}`}
        />
        {views.map((view) => {
          const pos = replicaPos(view.replica);
          const name = replicaLabel(view.replica);
          return (
            <SystemNode
              key={view.replica}
              kind="database"
              x={pos.x}
              y={pos.y}
              width={REPLICA_W}
              height={REPLICA_H}
              label={view.down ? `${name} (down)` : name}
              sublabel={view.inSet ? `${RANKS[view.rank]} copy: v${view.version}` : 'no copy'}
              status={view.down ? 'bad' : view.behind ? 'warn' : undefined}
              dim={!view.inSet}
            />
          );
        })}
        <FlowDots flows={flows} />
      </svg>
    </DiagramScroll>
  );
}

function LatestAnswers({ run, now }: { run: QuorumRun; now: number }) {
  const confirmed = confirmedVersion(run, now);
  const lines = [
    { label: 'Last add', result: lastAnswered(run, now, 'write') },
    { label: 'Last view', result: lastAnswered(run, now, 'read') },
  ];
  return (
    <dl className="sdv-quorum__latest" aria-label="What Sam heard most recently">
      <div>
        <dt>Confirmed to Sam</dt>
        <dd>{confirmed === 0 ? 'Nothing yet: the cart is empty' : `v${confirmed}`}</dd>
      </div>
      {lines.map((line) => (
        <div key={line.label}>
          <dt>{line.label}</dt>
          <dd>
            <Pill status={statusOf(line.result, now)}>
              {line.result
                ? `${describeOp(line.result.op)}: ${resultText(line.result, now)}`
                : 'No answer yet'}
            </Pill>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const ms = (value: number) => `${Math.round(value)} ms`;

function SettingsTable({ sim, now }: { sim: QuorumSim; now: number }) {
  const sums = quorumSettingOrder.map((id) => summarize(sim.runs[id], now));
  const rows: { label: string; values: string[] }[] = [
    {
      label: 'Read and write sets must overlap (R + W > N)',
      values: quorumSettingOrder.map((id) => (overlaps(quorumSettings[id]) ? 'Yes' : 'No')),
    },
    { label: 'Requests so far (same for all)', values: sums.map((sum) => String(sum.issued)) },
    { label: 'Stale reads', values: sums.map((sum) => String(sum.stale)) },
    { label: 'Failed requests', values: sums.map((sum) => String(sum.failed)) },
    { label: 'Still waiting', values: sums.map((sum) => String(sum.inFlight)) },
    { label: 'Average wait per confirmed add', values: sums.map((sum) => ms(sum.averageWriteMs)) },
    { label: 'Average wait per view', values: sums.map((sum) => ms(sum.averageReadMs)) },
  ];
  return (
    <DiagramScroll label="Quorum settings comparison table, scrolls sideways">
      <table className="sdv-stats sdv-compare sdv-quorum__compare">
        <caption>All four settings on the same requests and outage, so far</caption>
        <thead>
          <tr>
            <td />
            {quorumSettingOrder.map((id) => (
              <th key={id} scope="col" data-current={id === sim.setting.id ? '' : undefined}>
                <span className="sdv-compare__head">
                  {quorumSettings[id].label}
                  {id === sim.setting.id && (
                    <>
                      <span className="sdv-visually-hidden">, </span>
                      <ToneBadge tone="neutral">Playing</ToneBadge>
                    </>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, index) => {
                const id = quorumSettingOrder[index] as QuorumSettingId;
                return (
                  <td key={id} data-current={id === sim.setting.id ? '' : undefined}>
                    <div className="sdv-stats__cell">
                      <span className="sdv-stats__value">{value}</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </DiagramScroll>
  );
}

export default function QuorumWidget({
  settings = quorumSettingOrder,
  failures = failureOrder,
  initialSetting,
  initialFailure,
  title = "Sam's cart on a ring of five replicas",
  instructions = 'Pick a quorum setting and a failure, then press Play. Every setting replays the same requests from Sam with the same network delays; only N, R, and W change.',
}: Props) {
  const hydrated = useHydrated();
  const [settingId, setSettingId] = useState<QuorumSettingId>(initialSetting ?? settings[0] ?? 'n3r1w1');
  const [failureId, setFailureId] = useState<FailureId>(initialFailure ?? failures[0] ?? 'none');
  const simRef = useRef<QuorumSim | null>(null);
  if (!simRef.current) simRef.current = new QuorumSim(settingId, failureId);
  const sim = simRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (setting: QuorumSettingId, failure: FailureId) => {
    simRef.current = new QuorumSim(setting, failure);
    rerender();
  };
  const onTick = () => {
    sim.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!sim.done) sim.step();
    rerender();
  };
  const chooseSetting = (id: QuorumSettingId) => {
    setSettingId(id);
    restart(id, failureId);
  };
  const chooseFailure = (id: FailureId) => {
    setFailureId(id);
    restart(settingId, id);
  };

  const now = sim.now;
  const { run } = sim;
  const sum = summarize(run, now);
  const confirmed = confirmedVersion(run, now);
  const seconds = sim.ticks * sim.tickSeconds;
  const totalSeconds = sim.length * sim.tickSeconds;
  const summary = `${seconds.toFixed(1)} s of ${totalSeconds.toFixed(1)} s. ${sim.setting.label} with ${sim.failure.phrase}: ${sum.stale} stale ${sum.stale === 1 ? 'read' : 'reads'}, ${sum.failed} failed, ${sum.inFlight} waiting, out of ${sum.issued} requests. Confirmed to Sam: ${confirmed === 0 ? 'nothing yet' : `v${confirmed}`}.`;
  const chartSummary = `Running totals for ${sim.setting.label}: ${sum.stale} stale reads and ${sum.failed} failed requests so far.`;
  const markerEvents = sim.events.filter((event) => event.marker);
  const status = sim.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : sim.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${totalSeconds.toFixed(1)} s` } as const);

  return (
    <MotionRoot>
      <SimulationShell
        title={title}
        instructions={instructions}
        onTick={onTick}
        onReset={() => restart(settingId, failureId)}
        summary={summary}
        status={status}
        finished={sim.done}
        resetKey={`${settingId}-${failureId}`}
        ticksPerSecond={4}
        controls={
          <div className="sdv-duel__extra">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || sim.done}>
              Skip to the end
            </button>
          </div>
        }
        readout={<SettingsTable sim={sim} now={now} />}
      >
        <ScenarioChips
          label="Quorum setting"
          value={settingId}
          options={settings.map((id) => ({
            value: id,
            label: quorumSettings[id].label,
            diff: quorumSettings[id].diff,
          }))}
          onChange={chooseSetting}
        />
        <ScenarioChips
          label="Failure"
          value={failureId}
          options={failures.map((id) => ({
            value: id,
            label: failureScenarios[id].label,
            diff: failureScenarios[id].diff,
          }))}
          onChange={chooseFailure}
        />
        <RingDiagram run={run} now={now} />
        <LatestAnswers run={run} now={now} />
        <ul className="sdv-quorum__legend" aria-label="How to read the ring">
          <li>
            <Pill status="ok">Up to date</Pill>
            Confirmed, or saw every confirmed add
          </li>
          <li>
            <Pill status="warn">Stale</Pill>
            Answered, but missing a confirmed add
          </li>
          <li>
            <Pill status="bad">Failed</Pill>
            Refused or timed out; Sam sees an error
          </li>
          <li>A dashed replica is down. A warning badge marks a copy behind the confirmed version.</li>
          <li>A dot that stops halfway is a request lost to a replica that went down.</li>
        </ul>
        <TraceChart
          title="Stale reads and failed requests, running total"
          series={[
            { label: 'Stale reads', values: sim.staleSeries, variant: 'a' },
            { label: 'Failed requests', values: sim.failedSeries, variant: 'b' },
          ]}
          length={sim.length}
          tickSeconds={sim.tickSeconds}
          markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
          minMax={10}
          summary={chartSummary}
        />
        <div className="sdv-trace__log">
          <p className="sdv-trace__log-title">What happened</p>
          {markerEvents.length === 0 ? (
            <p className="sdv-trace__empty">
              Key moments appear here, numbered to match the chart, as the run plays.
            </p>
          ) : (
            <ol>
              {markerEvents.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: events only append, so an index stays stable
                <li key={index}>
                  <span className="sdv-trace__num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <time>{(event.at / 1000).toFixed(2)} s</time> {event.text}
                </li>
              ))}
            </ol>
          )}
        </div>
        <details className="sdv-quorum__transcript">
          <summary>Every request and answer ({sum.issued} so far)</summary>
          {sum.issued === 0 ? (
            <p className="sdv-trace__empty">Press Play or Step to start the run.</p>
          ) : (
            <RequestTranscript run={run} now={now} />
          )}
        </details>
      </SimulationShell>
    </MotionRoot>
  );
}

function answersHeard(result: OpResult, now: number): string {
  if (result.contacted.length === 0) return 'None asked';
  const heard = result.replies.filter((reply) => reply.arriveAt < now);
  if (heard.length === 0) return 'None yet';
  if (result.op.kind === 'write') return `${listReplicas(heard.map((reply) => reply.replica))} applied it`;
  return heard.map((reply) => `${replicaLabel(reply.replica)} had v${reply.version}`).join(', ');
}

function RequestTranscript({ run, now }: { run: QuorumRun; now: number }) {
  return (
    <DiagramScroll label="Request transcript table, scrolls sideways">
      <table className="sdv-quorum__table">
        <caption className="sdv-quorum__caption">
          Each request, the replicas that answered, and what Sam heard
        </caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Request</th>
            <th scope="col">Replica answers</th>
            <th scope="col">Sam heard</th>
          </tr>
        </thead>
        <tbody>
          {run.results
            .filter((result) => result.op.at < now)
            .map((result) => (
              <tr key={result.op.id}>
                <td>
                  <time>{(result.op.at / 1000).toFixed(2)} s</time>
                </td>
                <th scope="row">{describeOp(result.op)}</th>
                <td>{answersHeard(result, now)}</td>
                <td>
                  <Pill status={statusOf(result, now)}>{resultText(result, now)}</Pill>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </DiagramScroll>
  );
}
