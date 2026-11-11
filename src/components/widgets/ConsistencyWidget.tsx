import { type ReactNode, type RefObject, useEffect, useId, useReducer, useRef, useState } from 'react';
import {
  type AnomalyKind,
  anomalyKinds,
  anomalyLabels,
  ConsistencyLadder,
  chatMessages,
  DEFAULT_WORKLOAD_SEED,
  type Guarantee,
  type GuaranteeId,
  type GuaranteeRun,
  guarantees,
  HORIZON,
  LEADER,
  people,
  type ReadRecord,
  replicaNames,
} from '../../lib/models/consistencyModels';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { StatusBadge, UiIcon } from '../viz/icons';
import { ArrowDefs, safeId } from '../viz/SystemNode';
import './ConsistencyWidget.css';

const WORKLOADS = 20;
const WIDTH = 720;
const LABEL_W = 70;
const TICK_W = 16;
const AXIS_H = 24;
const REPLICA_LANE = 44;
const PERSON_LANE = 62;
const GROUP_GAP = 14;
const ROW_GAP = 11;
const PEOPLE_TOP = AXIS_H + REPLICA_LANE * replicaNames.length + GROUP_GAP;
const HEIGHT = PEOPLE_TOP + PERSON_LANE * people.length + 6;
const messageIds = chatMessages.map((message) => message.id);
const axisTicks = Array.from({ length: HORIZON / 5 + 1 }, (_, index) => index * 5);

const x = (tick: number) => LABEL_W + tick * TICK_W;
const replicaTop = (replica: number) => AXIS_H + replica * REPLICA_LANE;
const personTop = (person: number) => PEOPLE_TOP + person * PERSON_LANE;
const replicaRow = (replica: number, message: number) => replicaTop(replica) + 11 + (message - 1) * ROW_GAP;
const personRow = (person: number, message: number) => personTop(person) + 24 + (message - 1) * ROW_GAP;

const messageOf = (id: number) => chatMessages.find((message) => message.id === id);
const textOf = (id: number) => messageOf(id)?.text ?? '';
const nameOf = (person: number) => people[person] ?? '';
const replicaOf = (replica: number) => replicaNames[replica] ?? '';
const ticks = (count: number) => `${count} ${count === 1 ? 'tick' : 'ticks'}`;
const labelsOf = (kinds: readonly AnomalyKind[]) => kinds.map((kind) => anomalyLabels[kind]).join(', ');

function guaranteeOf(id: GuaranteeId): Guarantee {
  const found = guarantees.find((guarantee) => guarantee.id === id);
  if (!found) throw new Error(`Unknown guarantee ${id}`);
  return found;
}

function RowGuides({ top }: { top: (message: number) => number }) {
  return (
    <>
      {messageIds.map((id) => (
        <g key={id}>
          <line className="sdv-consistency__row-line" x1={x(0)} x2={x(HORIZON)} y1={top(id)} y2={top(id)} />
          <text className="sdv-consistency__row-label" x={LABEL_W - 6} y={top(id) + 3.5} textAnchor="end">
            m{id}
          </text>
        </g>
      ))}
    </>
  );
}

function ReadMarks({ read }: { read: ReadRecord }) {
  const cx = x(read.end);
  const missing = [...new Set(read.gaps.map((gap) => gap.message))];
  return (
    <>
      <line
        className="sdv-consistency__read"
        x1={cx}
        x2={cx}
        y1={personRow(read.person, 1) - 6}
        y2={personRow(read.person, chatMessages.length) + 6}
      />
      {read.sees.map((id) => (
        <circle
          key={`seen-${id}`}
          className="sdv-consistency__seen"
          cx={cx}
          cy={personRow(read.person, id)}
          r={3.5}
        />
      ))}
      {missing.map((id) => (
        <circle
          key={`gap-${id}`}
          className="sdv-consistency__gap"
          cx={cx}
          cy={personRow(read.person, id)}
          r={4}
        />
      ))}
      {read.anomalies.length > 0 && (
        <g transform={`translate(${cx} ${personTop(read.person) + 10}) scale(0.8)`}>
          <StatusBadge status="warn" x={0} y={0} />
        </g>
      )}
    </>
  );
}

function Diamond({ cx, cy }: { cx: number; cy: number }) {
  return (
    <polygon
      className="sdv-consistency__write"
      points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
    />
  );
}

function Timeline({
  run,
  now,
  label,
  arrow,
}: {
  run: GuaranteeRun;
  now: number;
  label: string;
  arrow: string;
}) {
  const linear = run.guarantee === 'linearizable';
  return (
    <DiagramScroll label="Scrollable timeline">
      <svg
        className="sdv-consistency__timeline"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Timeline up to tick ${now} under ${label}. The top lanes show which messages each replica holds; the bottom lanes show what each person saw on every read. The transcript below lists the same events.`}
      >
        <ArrowDefs id={arrow} />
        {axisTicks.map((tick) => (
          <g key={tick}>
            <line
              className="sdv-consistency__grid"
              x1={x(tick)}
              x2={x(tick)}
              y1={AXIS_H - 4}
              y2={HEIGHT - 4}
            />
            <text className="sdv-chart__label" x={x(tick)} y={14} textAnchor="middle">
              {tick}
            </text>
          </g>
        ))}
        {replicaNames.map((name, replica) => (
          <g key={name}>
            {replica > 0 && (
              <line
                className="sdv-consistency__lane-line"
                x1={0}
                x2={WIDTH}
                y1={replicaTop(replica)}
                y2={replicaTop(replica)}
              />
            )}
            <text
              className="sdv-consistency__lane-label"
              x={8}
              y={replicaTop(replica) + (linear && replica === LEADER ? 19 : 26)}
            >
              {name}
            </text>
            {linear && replica === LEADER && (
              <text className="sdv-consistency__row-label" x={8} y={replicaTop(replica) + 32}>
                leader
              </text>
            )}
            <RowGuides top={(message) => replicaRow(replica, message)} />
          </g>
        ))}
        <line
          className="sdv-consistency__group-line"
          x1={0}
          x2={WIDTH}
          y1={PEOPLE_TOP - GROUP_GAP / 2}
          y2={PEOPLE_TOP - GROUP_GAP / 2}
        />
        {people.map((name, person) => (
          <g key={name}>
            {person > 0 && (
              <line
                className="sdv-consistency__lane-line"
                x1={0}
                x2={WIDTH}
                y1={personTop(person)}
                y2={personTop(person)}
              />
            )}
            <text className="sdv-consistency__lane-label" x={8} y={personTop(person) + 39}>
              {name}
            </text>
            <RowGuides top={(message) => personRow(person, message)} />
          </g>
        ))}
        {run.copies.map((copy) => {
          const y = replicaRow(copy.replica, copy.message);
          return (
            <g key={`band-${copy.replica}-${copy.message}`}>
              {copy.apply > copy.arrive && copy.arrive <= now && (
                <line
                  className="sdv-consistency__band sdv-consistency__band--held"
                  x1={x(copy.arrive)}
                  x2={x(Math.min(copy.apply, now))}
                  y1={y}
                  y2={y}
                />
              )}
              {copy.apply <= now && (
                <line className="sdv-consistency__band" x1={x(copy.apply)} x2={x(now)} y1={y} y2={y} />
              )}
            </g>
          );
        })}
        {run.copies.map((copy) => {
          if (copy.from === null || copy.sent > now) return null;
          const x1 = x(copy.sent);
          const y1 = replicaRow(copy.from, copy.message);
          const dx = x(copy.arrive) - x1;
          const dy = replicaRow(copy.replica, copy.message) - y1;
          const arrived = copy.arrive <= now;
          const share = arrived ? 1 - 3 / Math.hypot(dx, dy) : (now - copy.sent) / (copy.arrive - copy.sent);
          return (
            <line
              key={`copy-${copy.replica}-${copy.message}`}
              className={`sdv-consistency__copy${arrived ? '' : ' sdv-consistency__copy--flying'}`}
              x1={x1}
              y1={y1}
              x2={x1 + dx * share}
              y2={y1 + dy * share}
              markerEnd={arrived ? `url(#${arrow})` : undefined}
            />
          );
        })}
        {run.requests.map((request) => {
          if (request.start > now) return null;
          const waitEnd = Math.min(request.end, now);
          const waitY = personTop(request.person) + 55;
          return (
            <g key={`request-${request.person}-${request.start}`}>
              {waitEnd > request.start && (
                <line
                  className="sdv-consistency__wait"
                  x1={x(request.start)}
                  x2={x(waitEnd)}
                  y1={waitY}
                  y2={waitY}
                />
              )}
              {request.kind === 'write' ? (
                <Diamond cx={x(request.start)} cy={personRow(request.person, request.message)} />
              ) : request.end <= now ? (
                <ReadMarks read={request} />
              ) : null}
            </g>
          );
        })}
        <line className="sdv-consistency__now" x1={x(now)} x2={x(now)} y1={AXIS_H - 6} y2={HEIGHT - 2} />
      </svg>
    </DiagramScroll>
  );
}

function Legend({ arrow }: { arrow: string }) {
  return (
    <ul className="sdv-legend sdv-consistency__legend" aria-label="How to read the timeline">
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <line className="sdv-consistency__band" x1={4} x2={20} y1={6} y2={6} />
        </svg>
        Replica holds the message
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <line className="sdv-consistency__band sdv-consistency__band--held" x1={2} x2={22} y1={6} y2={6} />
        </svg>
        Stored, held back from readers
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <line className="sdv-consistency__copy" x1={2} x2={17} y1={6} y2={6} markerEnd={`url(#${arrow})`} />
        </svg>
        Copy travels to another replica
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <Diamond cx={12} cy={6} />
        </svg>
        Person sends a message
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <circle className="sdv-consistency__seen" cx={12} cy={6} r={3.5} />
        </svg>
        Read shows the message
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <circle className="sdv-consistency__gap" cx={12} cy={6} r={4} />
        </svg>
        Read misses a message it should show
      </li>
      <li>
        <svg
          className="sdv-consistency__key sdv-consistency__key--badge"
          viewBox="-10 -10 20 20"
          aria-hidden="true"
        >
          <StatusBadge status="warn" x={0} y={0} />
        </svg>
        Read shows an anomaly
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <line className="sdv-consistency__wait" x1={2} x2={22} y1={6} y2={6} />
        </svg>
        Person waits for a reply
      </li>
      <li>
        <svg className="sdv-consistency__key" viewBox="0 0 24 12" aria-hidden="true">
          <line className="sdv-consistency__now" x1={12} x2={12} y1={0} y2={12} />
        </svg>
        Now
      </li>
    </ul>
  );
}

function latestRead(run: GuaranteeRun, person: number, now: number): ReadRecord | null {
  let latest: ReadRecord | null = null;
  for (const request of run.requests) {
    if (request.kind === 'read' && request.person === person && request.end <= now) latest = request;
  }
  return latest;
}

function Phone({ person, read }: { person: number; read: ReadRecord | null }) {
  const name = nameOf(person);
  const missing = new Set(read?.gaps.map((gap) => gap.message) ?? []);
  const lines = chatMessages.filter((message) => read?.sees.includes(message.id) || missing.has(message.id));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a chat preview
    <div className="sdv-consistency__phone" role="group" aria-label={`${name}'s phone`}>
      <p className="sdv-consistency__phone-title">{name}'s phone</p>
      <p className="sdv-consistency__phone-meta">
        {read ? `Last read from ${replicaOf(read.replica)} at tick ${read.end}` : 'No reads yet'}
      </p>
      {read && lines.length === 0 && <p className="sdv-consistency__phone-empty">The chat is empty</p>}
      {lines.length > 0 && (
        <ol className="sdv-consistency__chat">
          {lines.map((message) =>
            missing.has(message.id) ? (
              <li key={message.id} className="sdv-consistency__line sdv-consistency__line--missing">
                <UiIcon name="warn" />
                <span>
                  Missing {nameOf(message.author)}'s “{message.text}”
                </span>
              </li>
            ) : (
              <li key={message.id} className="sdv-consistency__line">
                <span className="sdv-consistency__author">{nameOf(message.author)}</span> {message.text}
              </li>
            ),
          )}
        </ol>
      )}
      {read && (
        <p
          className={`sdv-consistency__tag sdv-consistency__tag--${read.anomalies.length > 0 ? 'warn' : 'ok'}`}
        >
          <UiIcon name={read.anomalies.length > 0 ? 'warn' : 'ok'} />
          {read.anomalies.length > 0 ? labelsOf(read.anomalies) : 'No anomaly'}
        </p>
      )}
    </div>
  );
}

function TranscriptBox({
  boxRef,
  children,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a transcript
    <div className="sdv-consistency__log" ref={boxRef} tabIndex={0} role="group" aria-label="Transcript">
      {children}
    </div>
  );
}

interface LogEntry {
  tick: number;
  order: number;
  text: string;
}

/** Writes, changed or anomalous reads, held copies, and convergence, in the order the model ran them. */
function transcript(run: GuaranteeRun, now: number): LogEntry[] {
  const entries: LogEntry[] = [];
  const add = (tick: number, order: number, text: string) => entries.push({ tick, order, text });
  for (const copy of run.copies) {
    if (copy.apply > now || copy.apply === copy.arrive) continue;
    const text = textOf(copy.message);
    add(
      copy.apply,
      copy.replica,
      copy.from === null
        ? `${replicaOf(copy.replica)} commits “${text}” once a majority of replicas store it.`
        : `${replicaOf(copy.replica)} shows “${text}” after holding it ${ticks(copy.apply - copy.arrive)} for the message it answers.`,
    );
  }
  for (const id of messageIds) {
    const landed = run.copies.filter((copy) => copy.message === id);
    if (landed.length < replicaNames.length) continue;
    const everywhere = Math.max(...landed.map((copy) => copy.apply));
    if (everywhere <= now) add(everywhere, 9, `Every replica now holds “${textOf(id)}”.`);
  }
  const lastSeen = people.map(() => '');
  for (const request of run.requests) {
    if (request.start > now) continue;
    const who = nameOf(request.person);
    const where = replicaOf(request.replica);
    const base = 10 + request.person * 2;
    if (request.kind === 'write') {
      add(request.start, base, `${who} sends “${textOf(request.message)}” to ${where}.`);
      if (request.end > request.start && request.end <= now) {
        add(
          request.end,
          base + 1,
          `${who}'s message is confirmed after ${ticks(request.end - request.start)}.`,
        );
      }
      continue;
    }
    if (request.end > now) continue;
    const seen = request.sees.join(',');
    const changed = seen !== lastSeen[request.person];
    lastSeen[request.person] = seen;
    const waited = request.end - request.start;
    if (!changed && waited === 0 && request.anomalies.length === 0) continue;
    const view =
      request.sees.length === 0 ? 'no messages' : request.sees.map((id) => `“${textOf(id)}”`).join(', ');
    const pause = waited > 0 ? ` after waiting ${ticks(waited)}` : '';
    const anomaly = request.anomalies.length > 0 ? ` ${labelsOf(request.anomalies)}.` : '';
    add(request.end, base + 1, `${who} reads ${where}${pause} and sees ${view}.${anomaly}`);
  }
  return entries.sort((a, b) => a.tick - b.tick || a.order - b.order);
}

function Ladder({ ladder, choice }: { ladder: ConsistencyLadder; choice: GuaranteeId }) {
  return (
    <DiagramScroll label="Scrollable table">
      <table className="sdv-stats sdv-consistency__ladder">
        <caption>Every promise on the same messages and delays, up to tick {ladder.tick}</caption>
        <thead>
          <tr>
            <th scope="col">Promise</th>
            <th scope="col">Reads with an anomaly</th>
            {anomalyKinds.map((kind) => (
              <th key={kind} scope="col">
                {anomalyLabels[kind]}
              </th>
            ))}
            <th scope="col">Ticks spent waiting</th>
            <th scope="col">Busiest replica's share</th>
          </tr>
        </thead>
        <tbody>
          {guarantees.map((guarantee) => {
            const tally = ladder.tally(guarantee.id);
            const current = guarantee.id === choice;
            return (
              <tr key={guarantee.id} data-current={current ? '' : undefined}>
                <th scope="row">
                  {guarantee.label}
                  {current && <span className="sdv-consistency__showing">Showing</span>}
                </th>
                <td>
                  {tally.anomalousReads} of {tally.reads}
                </td>
                {anomalyKinds.map((kind) => (
                  <td key={kind}>
                    {guarantee.rulesOut.includes(kind) ? (
                      <span className="sdv-consistency__ruled">
                        <UiIcon name="check" />
                        0, ruled out
                      </span>
                    ) : (
                      tally.anomalies[kind]
                    )}
                  </td>
                ))}
                <td>{tally.waitTicks}</td>
                <td>{tally.requests === 0 ? 'none yet' : `${Math.round(tally.busiestShare * 100)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DiagramScroll>
  );
}

export default function ConsistencyWidget() {
  const hydrated = useHydrated();
  const arrow = safeId(useId(), 'cons-arrow');
  const [seed, setSeed] = useState(DEFAULT_WORKLOAD_SEED);
  const [choice, setChoice] = useState<GuaranteeId>('eventual');
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const ladderRef = useRef<ConsistencyLadder | null>(null);
  if (!ladderRef.current || ladderRef.current.workload.seed !== seed) {
    ladderRef.current = new ConsistencyLadder(seed);
  }
  const ladder = ladderRef.current;
  const now = ladder.tick;
  const guarantee = guaranteeOf(choice);
  const run = ladder.runs[choice];
  const tally = ladder.tally(choice);
  const log = transcript(run, now);
  const workload = seed - DEFAULT_WORKLOAD_SEED + 1;
  const logRef = useRef<HTMLDivElement | null>(null);
  const logKey = log.length > 0 ? `${choice}:${log.length}` : '';

  useEffect(() => {
    const box = logRef.current;
    if (box && logKey) box.scrollTop = box.scrollHeight;
  }, [logKey]);

  const skipToEnd = () => {
    while (!ladder.done) ladder.step();
    rerender();
  };
  const nextWorkload = () => {
    setSeed((current) =>
      current - DEFAULT_WORKLOAD_SEED + 1 >= WORKLOADS ? DEFAULT_WORKLOAD_SEED : current + 1,
    );
  };

  const summary = `Tick ${now} of ${HORIZON}, ${guarantee.label}: ${tally.anomalousReads} of ${tally.reads} reads showed an anomaly, and people spent ${ticks(tally.waitTicks)} waiting.`;
  const status = ladder.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : now === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `Tick ${now} of ${HORIZON}` } as const);

  return (
    <SimulationShell
      title="One chat, five promises"
      instructions="Press Play to watch Ana, Ben, and Carla chat through three replicas. Pick a promise to see what readers can see under it. All five promises run on the same messages and network delays, and the table compares them."
      onTick={() => {
        ladder.step();
        rerender();
      }}
      onReset={() => {
        ladder.reset();
        rerender();
      }}
      summary={summary}
      status={status}
      finished={ladder.done}
      resetKey={String(seed)}
      ticksPerSecond={4}
      controls={
        <div className="sdv-duel__extra">
          <button
            type="button"
            className="sdv-button"
            onClick={skipToEnd}
            disabled={!hydrated || ladder.done}
          >
            Skip to the end
          </button>
          <button type="button" className="sdv-button" onClick={nextWorkload} disabled={!hydrated}>
            Next workload
          </button>
          <span className="sdv-consistency__workload">
            Workload {workload} of {WORKLOADS}
          </span>
        </div>
      }
      readout={<Ladder ladder={ladder} choice={choice} />}
    >
      <div className="sdv-consistency">
        <ScenarioChips
          label="Promise"
          value={choice}
          options={guarantees.map((option) => ({ value: option.id, label: option.label, diff: option.rule }))}
          onChange={setChoice}
        />
        <Timeline run={run} now={now} label={guarantee.label} arrow={arrow} />
        <p className="sdv-consistency__rows">
          Rows:{' '}
          {chatMessages
            .map((message) => `m${message.id} is ${nameOf(message.author)}'s “${message.text}”`)
            .join('; ')}
          . One tick is about 100 ms in this toy model.
        </p>
        <Legend arrow={arrow} />
        <div className="sdv-consistency__phones">
          {people.map((name, person) => (
            <Phone key={name} person={person} read={latestRead(run, person, now)} />
          ))}
        </div>
        <div className="sdv-trace__log">
          <p className="sdv-trace__log-title">What happened under {guarantee.label}</p>
          {log.length === 0 ? (
            <p className="sdv-trace__empty">Events appear here, tick by tick, as the run plays.</p>
          ) : (
            <TranscriptBox boxRef={logRef}>
              <ol>
                {log.map((entry) => (
                  <li key={`${entry.tick}-${entry.order}-${entry.text}`}>
                    <time>Tick {entry.tick}</time> {entry.text}
                  </li>
                ))}
              </ol>
            </TranscriptBox>
          )}
        </div>
      </div>
    </SimulationShell>
  );
}
