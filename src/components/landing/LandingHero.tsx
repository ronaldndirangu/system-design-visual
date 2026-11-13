import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  HOME_CAPACITIES,
  HOME_FOURTH_SERVER,
  HOME_QUEUE_LIMIT,
  HOME_RATE,
  HOME_RATE_MAX,
  HOME_SERVER_NAMES,
  HOME_TICK_SECONDS,
  HOME_TICKS,
  type HomePolicy,
  homePolicyLabels,
  type RoutingRun,
  type RoutingSummary,
  runRouting,
  summarizeRouting,
  turnTakingShare,
} from '../../lib/models/homeRouting';
import type { AssignmentEvent } from '../../lib/models/serverFarm';
import { lessonHref } from '../../lib/paths';
import { Segmented, Slider, Toggle } from '../sim/controls';
import { TranscriptScroll } from '../sim/TranscriptScroll';
import { useAnnouncer } from '../sim/useAnnouncer';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { useTicker } from '../sim/useTicker';
import { Button } from '../ui/Button';
import { DiagramScroll } from '../viz/DiagramScroll';
import { readableFont } from '../viz/geometry';
import { safeId } from '../viz/SystemNode';
import { LandingRoutingDiagram } from './LandingRoutingDiagram';

const POLICIES: HomePolicy[] = ['round-robin', 'least-connections'];
const END_TIME = HOME_TICKS * HOME_TICK_SECONDS;
/** Model seconds per animation tick: the 20 second run plays in 10 seconds. */
const SECONDS_PER_TICK = 0.2;
const TICKS_PER_SECOND = 10;
const LOG_LINES = 40;

interface Setup {
  rate: number;
  fourth: boolean;
}

const DEFAULT_SETUP: Setup = { rate: HOME_RATE, fourth: false };

interface Prepared {
  run: RoutingRun;
  events: AssignmentEvent[];
  summary: RoutingSummary;
  rejectionIndex: number;
}

interface Cursor {
  index: number;
  done: boolean;
  clock: number;
}

const START: Cursor = { index: -1, done: false, clock: 0 };

const setupKey = (setup: Setup) => `${setup.rate}/${setup.fourth ? 4 : 3}`;
const runKey = (policy: HomePolicy, setup: Setup) => `${policy}@${setupKey(setup)}`;
const serverName = (id: number) => HOME_SERVER_NAMES[id] ?? String(id + 1);
const policyName = (policy: HomePolicy) =>
  `${homePolicyLabels[policy].plain} (${homePolicyLabels[policy].technical})`;
const perSecond = (value: number) => String(Number(value.toFixed(2)));

const prepared = new Map<string, Prepared>();
function prepare(policy: HomePolicy, setup: Setup): Prepared {
  const key = runKey(policy, setup);
  const hit = prepared.get(key);
  if (hit) return hit;
  const run = runRouting({
    policy,
    capacities: setup.fourth ? HOME_FOURTH_SERVER : HOME_CAPACITIES,
    rate: setup.rate,
  });
  const events = run.frames.flatMap((frame) => frame.events);
  const made: Prepared = {
    run,
    events,
    summary: summarizeRouting(run),
    rejectionIndex: events.findIndex((event) => event.outcome !== 'queued'),
  };
  prepared.set(key, made);
  return made;
}

const STATIC_RESULTS = [DEFAULT_SETUP, { rate: HOME_RATE, fourth: true }].flatMap((setup) =>
  POLICIES.map((policy) => prepare(policy, setup).summary),
);

interface Snapshot {
  arrived: number;
  served: number;
  rejected: number;
  inFlight: number;
  queues: number[];
  sent: number[];
  event: AssignmentEvent | null;
}

/** Counts right after decision `index`. Every arrival is one decision, so prefix sums give the totals. */
function snapshotAt({ run, events }: Prepared, cursor: Cursor): Snapshot {
  const servers = run.capacities.length;
  if (cursor.done) {
    const last = run.frames[run.frames.length - 1];
    return { ...run.totals, queues: last?.queues ?? [], sent: run.assigned, event: null };
  }
  const sent = Array.from({ length: servers }, () => 0);
  let rejected = 0;
  for (let i = 0; i <= cursor.index; i += 1) {
    const event = events[i];
    if (!event) break;
    if (event.chosen !== null) sent[event.chosen] = (sent[event.chosen] ?? 0) + 1;
    if (event.outcome !== 'queued') rejected += 1;
  }
  const event = events[cursor.index] ?? null;
  const queues = Array.from({ length: servers }, () => 0);
  if (event) {
    for (const candidate of event.candidates) queues[candidate.id] = candidate.queueLength;
    if (event.outcome === 'queued' && event.chosen !== null)
      queues[event.chosen] = (queues[event.chosen] ?? 0) + 1;
  }
  const inFlight = queues.reduce((sum, queue) => sum + queue, 0);
  const arrived = Math.max(0, cursor.index + 1);
  return { arrived, served: arrived - rejected - inFlight, rejected, inFlight, queues, sent, event };
}

function loads(event: AssignmentEvent): string {
  return event.candidates
    .map((candidate) => `${serverName(candidate.id)} ${candidate.queueLength}`)
    .join(', ');
}

function decisionText(policy: HomePolicy, event: AssignmentEvent, index: number): string {
  const head = `Request ${index + 1} at ${event.time.toFixed(1)} s. Unfinished: ${loads(event)}.`;
  if (event.chosen === null) return `${head} No server can take it, so it is turned away.`;
  const who = serverName(event.chosen);
  const rule =
    policy === 'round-robin' ? `It is ${who}'s turn` : `${who} holds the fewest unfinished requests`;
  if (event.outcome === 'queued') return `${head} ${rule}, so ${who} takes it.`;
  return `${head} ${rule}, but ${who} already holds ${HOME_QUEUE_LIMIT}, so the request is turned away.`;
}

function rejectionWhy(policy: HomePolicy, { run }: Prepared): string {
  const capacities = run.capacities;
  const total = capacities.reduce((sum, capacity) => sum + capacity, 0);
  if (run.rate > total) {
    return `Traffic averages ${run.rate}/s, but these servers finish at most ${total}/s together. No rule can keep every queue short.`;
  }
  if (policy === 'round-robin') {
    const slow = capacities.indexOf(Math.min(...capacities));
    const share = perSecond(turnTakingShare(run.rate, capacities.length));
    const more =
      capacities.length > HOME_CAPACITIES.length ? ' A fourth server helps, yet C still gets its turn.' : '';
    return `${serverName(slow)}'s turn came while it already held ${HOME_QUEUE_LIMIT} unfinished requests. Taking turns sends ${serverName(slow)} about ${share}/s, but it finishes ${capacities[slow]}/s.${more}`;
  }
  return 'Every server already held its limit of unfinished requests at that moment.';
}

function doneText(snapshot: Snapshot): string {
  return `After ${END_TIME} s: ${snapshot.arrived} arrived, ${snapshot.served} finished, ${snapshot.rejected} turned away, ${snapshot.inFlight} still processing.`;
}

function sentText(sent: readonly number[]): string {
  return sent.map((count, id) => `${serverName(id)} ${count}`).join(', ');
}

/**
 * The home page routing challenge. The same arrivals replay through two balancer
 * rules, one decision at a time, so the learner sees why taking turns overloads the slow server.
 */
export default function LandingHero() {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const { message, announce, push } = useAnnouncer();
  const arrowId = safeId(useId(), 'routing-arrow');
  const predictName = useId();
  const moreHint = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [policy, setPolicy] = useState<HomePolicy>('round-robin');
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [prediction, setPrediction] = useState<'short' | 'overflow' | null>(null);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<ReadonlySet<string>>(() => new Set());
  const cursorRef = useRef<Cursor>(START);
  const [cursor, setCursorState] = useState<Cursor>(START);
  const setCursor = useCallback((next: Cursor) => {
    cursorRef.current = next;
    setCursorState(next);
  }, []);

  const current = prepare(policy, setup);
  const snapshot = snapshotAt(current, cursor);
  const unlocked = POLICIES.every((each) => finished.has(runKey(each, DEFAULT_SETUP)));
  const isDefault = setupKey(setup) === setupKey(DEFAULT_SETUP);

  const restart = useCallback(() => {
    setRunning(false);
    setCursor(START);
  }, [setCursor]);

  const finish = useCallback(() => {
    const done: Cursor = { index: current.events.length - 1, done: true, clock: END_TIME };
    setCursor(done);
    setRunning(false);
    setFinished((seen) => new Set(seen).add(runKey(policy, setup)));
    announce(doneText(snapshotAt(current, done)));
  }, [current, policy, setup, setCursor, announce]);

  const stopAtRejection = useCallback(
    (index: number) => {
      const event = current.events[index];
      if (!event) return;
      setCursor({ index, done: false, clock: event.time });
      setRunning(false);
      announce(`${decisionText(policy, event, index)} ${rejectionWhy(policy, current)}`);
    },
    [current, policy, setCursor, announce],
  );

  const onTick = () => {
    const { index, clock } = cursorRef.current;
    const next = clock + SECONDS_PER_TICK;
    let target = index;
    while ((current.events[target + 1]?.time ?? Number.POSITIVE_INFINITY) <= next) target += 1;
    const rejection = current.rejectionIndex;
    if (rejection >= 0 && index < rejection && target >= rejection) {
      stopAtRejection(rejection);
      return;
    }
    if (next >= END_TIME) {
      finish();
      return;
    }
    setCursor({ index: target, done: false, clock: next });
  };
  useTicker(running, TICKS_PER_SECOND, onTick, stageRef);

  useEffect(() => {
    if (reduced) setRunning(false);
  }, [reduced]);

  const choosePolicy = (next: HomePolicy) => {
    setPolicy(next);
    restart();
    announce(`${policyName(next)}. Same arrivals, ready to replay.`);
  };

  const changeSetup = (next: Setup) => {
    setSetup(next);
    restart();
  };

  const run = () => {
    if (running) {
      setRunning(false);
      announce(cursorRef.current.index >= 0 ? `Paused. ${panelText()}` : 'Paused.');
      return;
    }
    if (cursorRef.current.done) setCursor(START);
    setRunning(true);
    push('Running.');
  };

  const nextDecision = () => {
    const { index, done } = cursorRef.current;
    if (done) return;
    setRunning(false);
    const nextIndex = index + 1;
    const event = current.events[nextIndex];
    if (!event) {
      finish();
      return;
    }
    if (nextIndex === current.rejectionIndex) {
      stopAtRejection(nextIndex);
      return;
    }
    setCursor({ index: nextIndex, done: false, clock: event.time });
    announce(decisionText(policy, event, nextIndex));
  };

  const showResult = () => {
    const { index, done } = cursorRef.current;
    if (done) return;
    setRunning(false);
    if (current.rejectionIndex > index) stopAtRejection(current.rejectionIndex);
    else finish();
  };

  const replay = () => {
    restart();
    announce(`Back to the start. ${policyName(policy)}.`);
  };

  function panelText(): string {
    if (cursor.done) return doneText(snapshot);
    const event = snapshot.event;
    if (!event) {
      return `Press Run or Next decision. Both rules see the same ${current.run.totals.arrived} arrivals over ${END_TIME} seconds.`;
    }
    const text = decisionText(policy, event, cursor.index);
    return cursor.index === current.rejectionIndex ? `${text} ${rejectionWhy(policy, current)}` : text;
  }

  const overflowed = current.rejectionIndex >= 0 && (cursor.done || cursor.index >= current.rejectionIndex);
  const verdict =
    prediction && isDefault && policy === 'round-robin' && overflowed
      ? prediction === 'overflow'
        ? 'You called it: one queue overflowed.'
        : 'You predicted every queue stays short. One queue overflowed.'
      : '';

  const rows: { key: string; setup: Setup; policy: HomePolicy }[] = [
    DEFAULT_SETUP,
    ...(isDefault ? [] : [setup]),
  ].flatMap((each) => POLICIES.map((rule) => ({ key: runKey(rule, each), setup: each, policy: rule })));

  const log = current.events
    .slice(Math.max(0, cursor.index + 1 - LOG_LINES), cursor.index + 1)
    .map((event, offset) => {
      const index = Math.max(0, cursor.index + 1 - LOG_LINES) + offset;
      return { index, text: decisionText(policy, event, index) };
    })
    .reverse();

  const diagramLabel = `Users send ${setup.rate} requests per second on average to a balancer and ${current.run.capacities.length} servers. Unfinished requests: ${snapshot.queues
    .map((queue, id) => `${serverName(id)} ${queue} of ${HOME_QUEUE_LIMIT}`)
    .join(', ')}. Sent so far: ${sentText(snapshot.sent)}.`;

  return (
    <section ref={stageRef} className="sdv-routing not-content" aria-labelledby="routing-challenge">
      <h2 id="routing-challenge" className="sdv-routing__title">
        Three servers. Why are people still waiting?
      </h2>

      <fieldset className="sdv-routing__predict">
        <legend className="sdv-predict__question">
          Two servers finish 5 requests/s. C finishes 1. Traffic averages 8 requests/s. Will taking turns keep
          every queue short?
        </legend>
        <div className="sdv-choices">
          {(
            [
              ['short', 'Yes, every queue stays short'],
              ['overflow', 'No, one queue overflows'],
            ] as const
          ).map(([value, text], position) => (
            <label key={value} className="sdv-choice">
              <input
                type="radio"
                name={predictName}
                checked={prediction === value}
                disabled={!hydrated}
                onChange={() => setPrediction(value)}
              />
              <span className="sdv-choice__key" aria-hidden="true">
                {String.fromCharCode(65 + position)}
              </span>
              <span className="sdv-choice__text">{text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sdv-routing__controls">
        <Segmented
          label="Balancer rule"
          value={policy}
          options={POLICIES.map((value) => ({ value, label: policyName(value) }))}
          onChange={choosePolicy}
        />
        {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section */}
        <div className="sdv-sim__toolbar sdv-routing__toolbar" role="group" aria-label="Replay controls">
          {!reduced && (
            <Button variant="primary" icon={running ? 'pause' : 'play'} onClick={run} disabled={!hydrated}>
              {running ? 'Pause' : cursor.done ? 'Run again' : 'Run'}
            </Button>
          )}
          <Button
            icon="step"
            onClick={nextDecision}
            disabled={!hydrated}
            aria-disabled={cursor.done || undefined}
          >
            Next decision
          </Button>
          <Button onClick={showResult} disabled={!hydrated} aria-disabled={cursor.done || undefined}>
            Show result
          </Button>
          <Button icon="reset" onClick={replay} disabled={!hydrated}>
            Replay
          </Button>
        </div>
      </div>

      <div className="sdv-routing__panel" data-testid="routing-panel">
        <p>{panelText()}</p>
        {verdict && <p className="sdv-routing__verdict">{verdict}</p>}
      </div>

      <div className="sdv-routing__diagram">
        <DiagramScroll label="Routing diagram" onScale={setScale}>
          <LandingRoutingDiagram
            capacities={current.run.capacities}
            rate={setup.rate}
            queues={snapshot.queues}
            sent={snapshot.sent}
            candidates={new Set(snapshot.event?.candidates.map((candidate) => candidate.id) ?? [])}
            chosen={snapshot.event?.chosen ?? null}
            outcome={snapshot.event?.outcome ?? null}
            decisionKey={cursor.index}
            minFont={readableFont(scale)}
            arrowId={arrowId}
            label={diagramLabel}
          />
        </DiagramScroll>
      </div>

      <p className="sdv-visually-hidden" aria-live="polite">
        {message}
      </p>

      <div className="sdv-routing__results">
        <DiagramScroll label="Results, scrolls sideways">
          <table>
            <caption>Same arrivals, {END_TIME} seconds per run</caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Setup</th>
                <th scope="col">Arrived</th>
                <th scope="col">Finished</th>
                <th scope="col">Turned away</th>
                <th scope="col">Still processing</th>
                <th scope="col">Sent per server</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const summary = finished.has(row.key) ? prepare(row.policy, row.setup).summary : null;
                const blank = <span className="sdv-routing__pending">Run to see</span>;
                return (
                  <tr key={row.key} data-row={row.key}>
                    <th scope="row">{policyName(row.policy)}</th>
                    <td>
                      {row.setup.rate}/s, {row.setup.fourth ? 4 : 3} servers
                    </td>
                    <td>{summary ? summary.arrived : blank}</td>
                    <td>{summary ? summary.served : blank}</td>
                    <td>{summary ? summary.rejected : blank}</td>
                    <td>{summary ? summary.inFlight : blank}</td>
                    <td>{summary ? sentText(summary.assigned) : blank}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DiagramScroll>
      </div>

      <fieldset className="sdv-routing__more" disabled={!unlocked || !hydrated} aria-describedby={moreHint}>
        <legend>Try more traffic or a fourth server</legend>
        <p id={moreHint} className="sdv-control__hint">
          {unlocked
            ? 'Each change replays both rules with the same kind of traffic.'
            : 'Finish a run with both rules at 8/s to unlock these.'}
        </p>
        <Slider
          label="Average traffic"
          value={setup.rate}
          min={4}
          max={HOME_RATE_MAX}
          step={4}
          format={(value) => `${value} requests/s`}
          onChange={(rate) => changeSetup({ ...setup, rate })}
        />
        <Toggle
          label="Add a fourth server (D, 5/s)"
          checked={setup.fourth}
          onChange={(fourth) => changeSetup({ ...setup, fourth })}
        />
      </fieldset>

      <p className="sdv-routing__assumptions">
        The model counts one connection per unfinished request, serves each server's requests one at a time,
        and ignores network and database limits. Fewest unfinished sees how many requests a server holds, not
        how long they will take. {HOME_RATE}/s is an average, so some seconds bring more. Taking turns sends C
        about {perSecond(turnTakingShare(HOME_RATE, 3))}/s with three servers and still about{' '}
        {perSecond(turnTakingShare(HOME_RATE, 4))}/s with four. More machines help, at a cost. At{' '}
        {HOME_RATE_MAX}/s both rules turn requests away.{' '}
        <a href={lessonHref('scaling/load-balancing')}>Learn load balancing</a>.
      </p>

      <details className="sdv-sim__more">
        <summary>Decision log</summary>
        <TranscriptScroll label="Decision log">
          {log.length === 0 ? (
            <p className="sdv-routing__log-empty">No decisions yet.</p>
          ) : (
            <ol className="sdv-routing__log">
              {log.map((line) => (
                <li key={line.index}>{line.text}</li>
              ))}
            </ol>
          )}
        </TranscriptScroll>
      </details>

      <details className="sdv-sim__more">
        <summary>Results without animation</summary>
        <DiagramScroll label="Every run, scrolls sideways">
          <table>
            <caption>Every run, computed ahead of time</caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Servers</th>
                <th scope="col">Arrived</th>
                <th scope="col">Finished</th>
                <th scope="col">Turned away</th>
                <th scope="col">First turned away</th>
                <th scope="col">Sent per server</th>
              </tr>
            </thead>
            <tbody>
              {STATIC_RESULTS.map((summary) => (
                <tr key={`${summary.policy}-${summary.servers}`}>
                  <th scope="row">{policyName(summary.policy)}</th>
                  <td>{summary.servers}</td>
                  <td>{summary.arrived}</td>
                  <td>{summary.served}</td>
                  <td>{summary.rejected}</td>
                  <td>
                    {summary.firstRejectionSeconds === null ? 'Never' : `${summary.firstRejectionSeconds} s`}
                  </td>
                  <td>{sentText(summary.assigned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DiagramScroll>
      </details>
    </section>
  );
}
