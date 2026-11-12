import { type ReactNode, useId, useReducer, useRef, useState } from 'react';
import { stepScheduled } from '../../lib/models/adapter';
import {
  formatSeconds,
  type InFlight,
  MS_PER_TICK,
  nodeName,
  RaftCluster,
  type RaftNode,
  type RaftScenarioId,
  raftScenarios,
} from '../../lib/models/raft';
import { Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type StatRow, StatTable, type Tone } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { lerp, link, nodeSize, readableFont, textWidth, type Vec } from '../viz/geometry';
import { UiIcon } from '../viz/icons';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';
import './RaftWidget.css';

const scenarioIds: RaftScenarioId[] = ['crash', 'split', 'partition', 'old-entry'];

const centers: Vec[] = [
  [300, 65],
  [443, 169],
  [420, 336],
  [180, 336],
  [157, 169],
];

const chatWords = ['brb', 'on my way', 'ok', 'thanks', 'deal', 'lol'];

const MAX_GLYPHS = 40;
const TIMELINE_LEFT = 20;
const TIMELINE_WIDTH = 560;

function center(id: number): Vec {
  return centers[id] ?? [300, 205];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roleLabel(node: RaftNode, cutOff: boolean): string {
  if (!node.up) return 'Down';
  if (node.role === 'leader') return `Leader, term ${node.term}${cutOff ? ', cut off' : ''}`;
  if (node.role === 'candidate') return `Candidate, term ${node.term}`;
  return `Follower, term ${node.term}`;
}

function nodeRole(node: RaftNode): 'leader' | 'candidate' | undefined {
  return node.up && (node.role === 'leader' || node.role === 'candidate') ? node.role : undefined;
}

function timerMs(node: RaftNode, ticks: number): number {
  return Math.max(0, node.deadline - ticks) * MS_PER_TICK;
}

function MessageGlyph({ flight }: { flight: InFlight }) {
  const { message } = flight;
  if (message.type === 'vote') return <path className="sdv-raft__glyph-fill" d="M0 -6 L6 0 L0 6 L-6 0 Z" />;
  if (message.type === 'vote-reply') {
    return (
      <path
        className={
          message.granted ? 'sdv-raft__glyph-line' : 'sdv-raft__glyph-line sdv-raft__glyph-line--dashed'
        }
        d="M0 -6 L6 0 L0 6 L-6 0 Z"
      />
    );
  }
  if (message.type === 'append') {
    return message.entries.length > 0 ? (
      <rect className="sdv-raft__glyph-fill" x={-5} y={-5} width={10} height={10} />
    ) : (
      <circle className="sdv-raft__glyph-fill" r={3.5} />
    );
  }
  return (
    <circle
      className={
        message.success ? 'sdv-raft__glyph-line' : 'sdv-raft__glyph-line sdv-raft__glyph-line--dashed'
      }
      r={4.5}
    />
  );
}

function LegendGlyph({ children }: { children: ReactNode }) {
  return (
    <svg className="sdv-raft__glyph" viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function RaftWidget() {
  const hydrated = useHydrated();
  const reducedMotion = usePrefersReducedMotion();
  const hatchId = safeId(useId(), 'raft-hatch');
  const arrowId = safeId(useId(), 'raft-arrow');
  const [scenarioId, setScenarioId] = useState<RaftScenarioId>('crash');
  const [unsafeCommit, setUnsafeCommit] = useState(false);
  const [scale, setScale] = useState(1);
  const [timelineScale, setTimelineScale] = useState(1);
  const minFont = readableFont(scale);
  const textPx = Math.max(13, minFont ?? 0);
  const runPx = readableFont(timelineScale) ?? 12;
  const clusterRef = useRef<RaftCluster | null>(null);
  if (!clusterRef.current)
    clusterRef.current = new RaftCluster(raftScenarios[scenarioId].seed, { unsafeCommit });
  const cluster = clusterRef.current;
  const runRef = useRef(0);
  const wordRef = useRef(0);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const scenario = raftScenarios[scenarioId];
  const done = cluster.ticks >= scenario.length;

  const restart = (id: RaftScenarioId, unsafe = unsafeCommit) => {
    clusterRef.current = new RaftCluster(raftScenarios[id].seed, { unsafeCommit: unsafe });
    runRef.current += 1;
    wordRef.current = 0;
    rerender();
  };
  const chooseScenario = (id: RaftScenarioId) => {
    setScenarioId(id);
    restart(id);
  };
  const chooseUnsafe = (unsafe: boolean) => {
    setUnsafeCommit(unsafe);
    restart(scenarioId, unsafe);
  };
  const onTick = () => {
    if (cluster.ticks >= scenario.length) return;
    stepScheduled(cluster, scenario.schedule);
    rerender();
  };
  const skipToEnd = () => {
    while (cluster.ticks < scenario.length) stepScheduled(cluster, scenario.schedule);
    rerender();
  };
  const sendMessage = () => {
    const text = chatWords[wordRef.current % chatWords.length] ?? 'ok';
    wordRef.current += 1;
    cluster.apply({ type: 'send', text });
    rerender();
  };
  const crashLeader = () => {
    cluster.apply({ type: 'crash', node: 'leader' });
    rerender();
  };
  const recoverAll = () => {
    cluster.apply({ type: 'recover', node: 'all' });
    rerender();
  };

  const stats = cluster.stats();
  const ticks = cluster.ticks;
  const nodes = cluster.nodes;
  const groups = cluster.groups;
  const working = cluster.workingLeader();
  const anyLeader = cluster.leaderId();
  const allUp = nodes.every((node) => node.up);
  const committed = cluster.committedLog();
  const isCutOff = (node: RaftNode) => node.role === 'leader' && groups !== null && working !== node.id;

  const status: { tone: Tone; text: string } =
    ticks === 0
      ? { tone: 'neutral', text: 'Ready' }
      : groups !== null
        ? { tone: 'bad', text: 'Network split' }
        : working !== null
          ? { tone: 'ok', text: `Leader: ${nodeName(working)}` }
          : { tone: 'warn', text: 'Electing' };

  const summary =
    ticks === 0
      ? `${scenario.label}. Press Play to start the run.`
      : `At ${formatSeconds(ticks)}, term ${stats.term}, ${
          working === null ? 'no server leads' : `${nodeName(working)} leads`
        }. ${stats.committed} of ${stats.sent} chat messages committed.${
          stats.committedErased > 0
            ? ` The unsafe rule let later leaders overwrite ${stats.committedErased} committed copies.`
            : ''
        }`;

  const centerLine =
    groups !== null ? 'Network split' : working === null ? 'No leader' : `Leader: ${nodeName(working)}`;
  const box = (id: number) => {
    const [x, y] = center(id);
    return { x, y, ...nodeSize('server', nodeName(id), minFont) };
  };
  const nodeBox = box(0);
  const panel = {
    w: Math.max(120, textWidth('Leader: Node 5', textPx) + 24),
    h: Math.max(50, textPx * 2.6 + 12),
  };
  // Enlarged side-node sublabels reach toward the center, so the panel drops below them.
  const panelTop = minFont === undefined ? 192 : 169 + nodeBox.sublabelY + 14;
  const timerOffset = nodeBox.sublabelY + 9;
  const viewHeight = Math.max(410, Math.ceil(336 + timerOffset + 10));

  const diagramLabel = `Five servers. ${nodes
    .map((node) => `${nodeName(node.id)}: ${roleLabel(node, isCutOff(node))}`)
    .join('. ')}. ${centerLine}.`;

  const pairs: [number, number][] = [];
  for (let a = 0; a < nodes.length; a += 1) for (let b = a + 1; b < nodes.length; b += 1) pairs.push([a, b]);

  const flights = cluster.inFlight.slice(0, MAX_GLYPHS);
  const busyLinks = [...new Set(flights.map((flight) => `${flight.from}>${flight.to}`))].map(
    (key) => key.split('>').map(Number) as [number, number],
  );

  const rows: StatRow[] = [
    { label: 'Time', value: formatSeconds(ticks), detail: `Each tick is an illustrative ${MS_PER_TICK} ms` },
    working === null
      ? { label: 'Leader', value: 'None', tone: 'warn', note: 'no working leader' }
      : { label: 'Leader', value: nodeName(working), tone: 'ok', note: 'reaches a majority' },
    { label: 'Term', value: String(stats.term) },
    {
      label: 'Committed chat',
      value: `${stats.committed} of ${stats.sent} sent`,
      detail: 'Stored on at least 3 of 5 servers',
    },
    {
      label: 'Elections started',
      value: String(stats.electionsStarted),
      detail: `Terms with no winner: ${stats.splitTerms}`,
    },
    {
      label: 'Time without a working leader',
      value: `${stats.leaderlessTicks * MS_PER_TICK} ms`,
      detail: 'Counted after the first election',
    },
    stats.lost > 0
      ? {
          label: 'Messages lost',
          value: String(stats.lost),
          tone: 'bad',
          note: stats.committedErased > 0 ? undefined : 'never committed',
          detail: `Erased copies: ${stats.erasedCopies}`,
        }
      : { label: 'Messages lost', value: '0', detail: `Erased copies: ${stats.erasedCopies}` },
    stats.committedErased > 0
      ? {
          label: 'Committed copies erased',
          value: String(stats.committedErased),
          tone: 'bad',
          note: 'safety broken',
          detail: 'Copies a server had marked committed, then overwrote',
        }
      : { label: 'Committed copies erased', value: '0', detail: 'Raft never overwrites a committed entry' },
  ];

  const xAt = (tick: number) => TIMELINE_LEFT + (tick * TIMELINE_WIDTH) / scenario.length;
  const events = cluster.events;

  return (
    <MotionRoot>
      <div className={reducedMotion ? 'sdv-raft sdv-raft--still' : 'sdv-raft'}>
        <SimulationShell
          title="Simplified Raft: five servers agree on a chat log"
          instructions="Pick a scenario, then press Play. Watch the timer bars drain: the first follower to run out stands for election. Each tick is an illustrative 10 ms."
          onTick={onTick}
          onReset={() => restart(scenarioId)}
          summary={summary}
          status={status}
          finished={done}
          resetKey={`${scenarioId}-${unsafeCommit ? 'unsafe' : 'raft'}`}
          controls={
            <div className="sdv-raft__actions">
              <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || done}>
                Skip to the end
              </button>
              <button type="button" className="sdv-button" onClick={sendMessage} disabled={!hydrated || done}>
                Send a chat message
              </button>
              <button
                type="button"
                className="sdv-button"
                onClick={crashLeader}
                disabled={!hydrated || done || anyLeader === null}
              >
                Crash the leader
              </button>
              <button
                type="button"
                className="sdv-button"
                onClick={recoverAll}
                disabled={!hydrated || done || allUp}
              >
                Recover servers
              </button>
              <Toggle
                label="Unsafe rule: commit any entry a majority stores"
                checked={unsafeCommit}
                onChange={chooseUnsafe}
              />
              <p className="sdv-raft__hint">
                Buttons act on the next tick. After a click, the run drifts from the numbers the lesson
                quotes.
              </p>
            </div>
          }
          readout={
            <div className="sdv-raft__readout">
              <StatTable rows={rows} caption="Live readout" />
              <div className="sdv-raft__timeline">
                <p className="sdv-trace__log-title">Who led, over time</p>
                <DiagramScroll label="Leader timeline" onScale={setTimelineScale}>
                  <svg
                    viewBox="0 0 600 80"
                    role="img"
                    aria-label={`Leader timeline up to ${formatSeconds(ticks)}. ${
                      cluster.runs
                        .filter((run) => run.leader !== null)
                        .map(
                          (run) =>
                            `${nodeName(run.leader ?? 0)} led term ${run.term} from ${formatSeconds(run.start)}`,
                        )
                        .join('. ') || 'No leader yet'
                    }.`}
                  >
                    <defs>
                      <pattern
                        id={hatchId}
                        width="6"
                        height="6"
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(45)"
                      >
                        <line className="sdv-raft__hatch-line" x1="0" y1="0" x2="0" y2="6" />
                      </pattern>
                    </defs>
                    <rect
                      className="sdv-raft__lane"
                      x={TIMELINE_LEFT}
                      y={10}
                      width={TIMELINE_WIDTH}
                      height={24}
                    />
                    {cluster.runs.map((run) => {
                      const end = Math.min(run.end, ticks);
                      if (end <= run.start) return null;
                      const x = xAt(run.start);
                      const width = xAt(end) - x;
                      if (run.leader === null) {
                        return (
                          <rect
                            key={`${run.start}-none`}
                            className="sdv-raft__run sdv-raft__run--none"
                            x={x}
                            y={10}
                            width={width}
                            height={24}
                            fill={`url(#${hatchId})`}
                          />
                        );
                      }
                      const runLabel = `${nodeName(run.leader)}, T${run.term}`;
                      return (
                        <g key={`${run.start}-${run.leader}`}>
                          <rect className="sdv-raft__run" x={x} y={10} width={width} height={24} />
                          {width >= textWidth(runLabel, runPx) + 12 && (
                            <text
                              className="sdv-raft__run-label"
                              x={x + 6}
                              y={22 + runPx * 0.35}
                              style={{ fontSize: `${runPx}px` }}
                            >
                              {runLabel}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {ticks > 0 && (
                      <line className="sdv-raft__now" x1={xAt(ticks)} x2={xAt(ticks)} y1={4} y2={40} />
                    )}
                    {[0, 50, 100, 150, 200, 250].map((tick) => (
                      <text key={tick} className="sdv-chart__label" x={xAt(tick)} y={58} textAnchor="middle">
                        {`${((tick * MS_PER_TICK) / 1000).toFixed(1)} s`}
                      </text>
                    ))}
                  </svg>
                </DiagramScroll>
                <ul className="sdv-legend" aria-label="How to read the timeline">
                  <li>
                    <span className="sdv-raft__swatch" aria-hidden="true" /> Solid: a working leader
                  </li>
                  <li>
                    <span className="sdv-raft__swatch sdv-raft__swatch--none" aria-hidden="true" /> Hatched:
                    no working leader
                  </li>
                </ul>
              </div>
              <div className="sdv-trace__log">
                <p className="sdv-trace__log-title">What happened</p>
                {events.length === 0 && (
                  <p className="sdv-trace__empty">Events appear here, numbered, as the run plays.</p>
                )}
                {events.length > 0 && (
                  <ol>
                    {events.map((event, index) => (
                      <li key={`${event.tick}-${event.kind}-${event.node}-${event.text}`}>
                        <span className="sdv-trace__num" aria-hidden="true">
                          {index + 1}
                        </span>
                        <time>{formatSeconds(event.tick)}</time> {event.text}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="sdv-trace__note">
                  Simplified Raft: no snapshots, membership changes, or pre-vote. Each tick is an illustrative
                  10 ms, and every message takes 20 or 30 ms.
                </p>
              </div>
            </div>
          }
        >
          <ScenarioChips
            label="Scenario"
            value={scenarioId}
            options={scenarioIds.map((id) => ({
              value: id,
              label: raftScenarios[id].label,
              diff: raftScenarios[id].diff,
            }))}
            onChange={chooseScenario}
          />
          <DiagramScroll label="Five servers and the messages between them" onScale={setScale}>
            <svg viewBox={`0 0 600 ${viewHeight}`} role="img" aria-label={diagramLabel}>
              <ArrowDefs id={arrowId} />
              {pairs.map(([a, b]) => {
                const ends = link(box(a), box(b));
                const cut = !cluster.connected(a, b);
                return (
                  <line
                    key={`${a}-${b}`}
                    className={cut ? 'sdv-raft__link sdv-raft__link--cut' : 'sdv-raft__link'}
                    x1={ends.from[0]}
                    y1={ends.from[1]}
                    x2={ends.to[0]}
                    y2={ends.to[1]}
                  />
                );
              })}
              {busyLinks.map(([from, to]) => {
                const ends = link(
                  { x: center(from)[0], y: center(from)[1] },
                  { x: center(to)[0], y: center(to)[1] },
                );
                return <Edge key={`${from}>${to}`} from={ends.from} to={ends.to} marker={arrowId} active />;
              })}
              <rect
                className="sdv-raft__panel"
                x={300 - panel.w / 2}
                y={panelTop}
                width={panel.w}
                height={panel.h}
                rx={8}
              />
              <text
                className="sdv-chart__label"
                x={300}
                y={panelTop + 6 + textPx * 1.1}
                textAnchor="middle"
                style={{ fontSize: `${textPx}px` }}
              >
                {`Term ${stats.term}`}
              </text>
              <text
                className="sdv-chart__label"
                x={300}
                y={panelTop + 6 + textPx * 2.4}
                textAnchor="middle"
                style={{ fontSize: `${textPx}px` }}
              >
                {centerLine}
              </text>
              {nodes.map((node) => {
                const [x, y] = center(node.id);
                const leader = node.up && node.role === 'leader';
                const nodeStatus = !node.up ? 'bad' : node.role === 'candidate' ? 'warn' : 'ok';
                const showTimer = node.up && node.role !== 'leader';
                const fraction = node.timeout > 0 ? clamp01((node.deadline - ticks) / node.timeout) : 0;
                return (
                  <g key={node.id}>
                    <SystemNode
                      kind="server"
                      x={x}
                      y={y}
                      label={nodeName(node.id)}
                      sublabel={leader ? (isCutOff(node) ? 'Cut off' : undefined) : roleLabel(node, false)}
                      status={nodeStatus}
                      role={nodeRole(node)}
                      badge={leader ? `Leader, term ${node.term}` : undefined}
                      minFontSize={minFont}
                    />
                    {showTimer && (
                      <g>
                        <rect
                          className="sdv-raft__timer"
                          x={x - 40}
                          y={y + timerOffset}
                          width={80}
                          height={6}
                          rx={3}
                        />
                        <rect
                          className="sdv-raft__timer-fill"
                          x={x - 40}
                          y={y + timerOffset}
                          width={80 * fraction}
                          height={6}
                          rx={3}
                        />
                      </g>
                    )}
                  </g>
                );
              })}
              {flights.map((flight) => {
                const ends = link(box(flight.from), box(flight.to));
                const t = clamp01(
                  (ticks - flight.sentAt - 1) / Math.max(1, flight.deliverAt - flight.sentAt - 1),
                );
                const [px, py] = lerp(ends.from, ends.to, t);
                return (
                  <g
                    key={`${runRef.current}-${flight.seq}`}
                    className="sdv-raft__msg"
                    style={{ transform: `translate(${px}px, ${py}px)` }}
                  >
                    <MessageGlyph flight={flight} />
                  </g>
                );
              })}
            </svg>
          </DiagramScroll>
          <ul className="sdv-legend" aria-label="How to read the diagram">
            <li>
              <LegendGlyph>
                <path className="sdv-raft__glyph-fill" d="M0 -6 L6 0 L0 6 L-6 0 Z" />
              </LegendGlyph>{' '}
              Vote request
            </li>
            <li>
              <LegendGlyph>
                <path className="sdv-raft__glyph-line" d="M0 -6 L6 0 L0 6 L-6 0 Z" />
              </LegendGlyph>{' '}
              Vote granted
            </li>
            <li>
              <LegendGlyph>
                <path
                  className="sdv-raft__glyph-line sdv-raft__glyph-line--dashed"
                  d="M0 -6 L6 0 L0 6 L-6 0 Z"
                />
              </LegendGlyph>{' '}
              Vote refused
            </li>
            <li>
              <LegendGlyph>
                <rect className="sdv-raft__glyph-fill" x={-5} y={-5} width={10} height={10} />
              </LegendGlyph>{' '}
              New chat entries
            </li>
            <li>
              <LegendGlyph>
                <circle className="sdv-raft__glyph-fill" r={3.5} />
              </LegendGlyph>{' '}
              Heartbeat
            </li>
            <li>
              <LegendGlyph>
                <circle className="sdv-raft__glyph-line" r={4.5} />
              </LegendGlyph>{' '}
              Reply (dashed: rejected)
            </li>
            <li>
              <LegendGlyph>
                <rect className="sdv-raft__glyph-fill" x={-7} y={-5} width={14} height={10} rx={2} />
              </LegendGlyph>{' '}
              Filled: leader
            </li>
            <li>
              <LegendGlyph>
                <rect
                  className="sdv-raft__glyph-line sdv-raft__glyph-line--dashed"
                  x={-7}
                  y={-5}
                  width={14}
                  height={10}
                  rx={2}
                />
              </LegendGlyph>{' '}
              Dashed outline: candidate
            </li>
            <li>
              <LegendGlyph>
                <line className="sdv-edge sdv-edge--active" x1={-7} y1={0} x2={7} y2={0} />
              </LegendGlyph>{' '}
              Bold link: message in flight
            </li>
            <li>
              <LegendGlyph>
                <line className="sdv-raft__link sdv-raft__link--cut" x1={-7} y1={0} x2={7} y2={0} />
              </LegendGlyph>{' '}
              Dashed link: cut off
            </li>
            <li>
              <span className="sdv-raft__bar-swatch" aria-hidden="true" /> Bar: election timer left
            </li>
          </ul>
          <div className="sdv-raft__logs">
            <p className="sdv-trace__log-title">Each server&apos;s chat log</p>
            {nodes.map((node) => (
              <div key={node.id} className={node.up ? 'sdv-raft__row' : 'sdv-raft__row sdv-raft__row--down'}>
                <p className="sdv-raft__row-head">
                  <strong>{nodeName(node.id)}</strong>{' '}
                  <span>
                    {roleLabel(node, isCutOff(node))}
                    {node.up && node.role !== 'leader' ? `, election timer ${timerMs(node, ticks)} ms` : ''}
                  </span>
                </p>
                {node.log.length === 0 ? (
                  <p className="sdv-raft__empty">Empty log</p>
                ) : (
                  <ol className="sdv-raft__cells" aria-label={`${nodeName(node.id)} log`}>
                    {node.log.map((entry, index) => {
                      const isCommitted = index < node.commitIndex;
                      return (
                        <li
                          key={entry.id}
                          className={
                            isCommitted ? 'sdv-raft__cell sdv-raft__cell--committed' : 'sdv-raft__cell'
                          }
                        >
                          {isCommitted && <UiIcon name="check" />}
                          <span className="sdv-raft__cell-term">T{entry.term}</span> {entry.text}
                          <span className="sdv-visually-hidden">
                            {isCommitted ? ', committed' : ', not committed yet'}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
            <ul className="sdv-legend" aria-label="How to read the logs">
              <li>
                <span className="sdv-raft__cell sdv-raft__cell--committed" aria-hidden="true">
                  <UiIcon name="check" /> T1
                </span>{' '}
                Committed, as this server knows it
              </li>
              <li>
                <span className="sdv-raft__cell" aria-hidden="true">
                  T1
                </span>{' '}
                Stored, not committed yet
              </li>
            </ul>
            <p className="sdv-raft__chat">
              <strong>Committed chat:</strong>{' '}
              {committed.length === 0 ? 'nothing yet' : committed.map((entry) => entry.text).join(', ')}
            </p>
            {cluster.pending.length > 0 && (
              <p className="sdv-raft__chat">
                <strong>Waiting for a leader:</strong> {cluster.pending.join(', ')}
              </p>
            )}
          </div>
        </SimulationShell>
      </div>
    </MotionRoot>
  );
}
