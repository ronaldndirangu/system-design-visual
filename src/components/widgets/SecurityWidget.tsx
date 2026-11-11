import { m } from 'motion/react';
import { type ReactNode, useMemo, useReducer, useRef, useState } from 'react';
import {
  KEY_DETECT_TICK,
  KEY_REDEPLOY_TICK,
  KEY_ROTATE_TICK,
  laneTotals,
  SEC_DEFENSES,
  SEC_GATE_OFFSETS,
  SEC_GATES,
  SEC_SECONDS,
  SEC_TICK_SECONDS,
  SEC_TICKS,
  type SecDefense,
  SecDuel,
  type SecGate,
  type SecLane,
  type SecRequest,
  type SecScenarioId,
  type SecVerdict,
  secScenarios,
  trackProgress,
} from '../../lib/models/security';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import './SecurityWidget.css';

/** A finished request stays on the track this many ticks so you can see where it ended. */
const LINGER_TICKS = 6;
const ROW_REM = 1.6;

/** Positions as a fraction of the rail: arrival, the three checkpoints, and the deleted zone. */
const START_X = 0;
const GATE_X: Record<SecGate, number> = { tls: 0.2, authn: 0.47, authz: 0.74 };
const END_X = 1;
const STOPS = SEC_GATES.map((gate) => ({ at: SEC_GATE_OFFSETS[gate], x: GATE_X[gate] }));

interface Props {
  scenarios?: SecScenarioId[];
  initial?: SecScenarioId;
  title?: string;
  instructions?: string;
}

type IconName = 'lock' | 'badge' | 'shield' | 'key' | 'clock';

const iconPaths: Record<IconName, ReactNode> = {
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  badge: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16c.6-1.5 1.7-2.3 3-2.3s2.4.8 3 2.3M14 10h4M14 13h3" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2 2M14 9l2 2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
};

function SecIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="sdv-sec__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

const gateInfo: Record<SecGate, { icon: IconName; label: string }> = {
  tls: { icon: 'lock', label: 'TLS' },
  authn: { icon: 'badge', label: 'Sign-in' },
  authz: { icon: 'shield', label: 'Access' },
};

const defenseIcon: Record<SecDefense, IconName> = {
  tls: 'lock',
  expiry: 'clock',
  secretManager: 'key',
  ownership: 'shield',
};

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const verdictTone: Record<SecVerdict, Tone> = {
  allowedCorrect: 'ok',
  rejectedCorrect: 'neutral',
  wronglyAllowed: 'bad',
  wronglyRejected: 'warn',
};

const verdictLabel: Record<SecVerdict, string> = {
  allowedCorrect: 'Allowed',
  rejectedCorrect: 'Stopped',
  wronglyAllowed: 'Wrongly allowed',
  wronglyRejected: 'Wrongly rejected',
};

/** Maps progress along the request path (0 to 1) onto the track, so each checkpoint lines up with its gate. */
function trackX(progress: number): number {
  const ticks = progress * SEC_GATE_OFFSETS.authz;
  let from = { at: 0, x: START_X };
  for (const stop of STOPS) {
    if (ticks <= stop.at) {
      const span = stop.at - from.at;
      return span === 0 ? stop.x : from.x + ((ticks - from.at) / span) * (stop.x - from.x);
    }
    from = stop;
  }
  return from.x;
}

/** One row per request while it is on screen, so two tokens never overlap. Both lanes share the rows. */
function trackRows(requests: readonly SecRequest[]): number[] {
  const ends: number[] = [];
  return requests.map((request) => {
    let row = ends.findIndex((until) => until <= request.arriveAt);
    if (row === -1) row = ends.length;
    ends[row] = request.arriveAt + SEC_GATE_OFFSETS.authz + LINGER_TICKS + 1;
    return row;
  });
}

function tokenTag(request: SecRequest): string {
  switch (request.caller) {
    case 'other':
      return `${request.user}→${request.owner}`;
    case 'expired':
      return 'Old token';
    case 'anonymous':
      return 'Anon';
    case 'job':
      return 'Job';
    case 'keyHolder':
      return 'Reader';
    default:
      return request.who;
  }
}

function Track({
  duel,
  lane,
  rows,
  gaps,
}: {
  duel: SecDuel;
  lane: SecLane;
  rows: readonly number[];
  gaps: readonly SecGate[];
}) {
  const reduced = usePrefersReducedMotion();
  const at = duel.ticks - 1;
  const rowCount = Math.max(1, ...rows.map((row) => row + 1));
  const tokens = duel.requests.flatMap((request) => {
    const index = request.id - 1;
    if (!lane.started[index]) return [];
    const result = lane.results[index];
    if (result && at - result.tick >= LINGER_TICKS) return [];
    const x = result ? (result.allowed ? END_X : GATE_X[result.gate]) : trackX(trackProgress(request, at));
    return [{ request, result, x, row: rows[index] ?? 0 }];
  });

  return (
    <div className="sdv-sec__track" aria-hidden="true">
      <div className="sdv-sec__head">
        <div className="sdv-sec__rail">
          {SEC_GATES.map((gate) => (
            <span
              key={gate}
              className="sdv-sec__gate-label"
              data-gap={gaps.includes(gate) ? '' : undefined}
              style={{ left: `${GATE_X[gate] * 100}%` }}
            >
              <span className="sdv-sec__gate-name">
                <SecIcon name={gateInfo[gate].icon} />
                <span className="sdv-sec__gate-text">{gateInfo[gate].label}</span>
              </span>
              {gaps.includes(gate) && <span className="sdv-sec__gap">Gap</span>}
            </span>
          ))}
          <span className="sdv-sec__gate-label sdv-sec__gate-label--end">
            <span className="sdv-sec__gate-name">Deleted</span>
          </span>
        </div>
      </div>
      <div className="sdv-sec__field" style={{ height: `${rowCount * ROW_REM + 0.4}rem` }}>
        <div className="sdv-sec__rail">
          {SEC_GATES.map((gate) => (
            <span
              key={gate}
              className="sdv-sec__gate-line"
              data-gap={gaps.includes(gate) ? '' : undefined}
              style={{ left: `${GATE_X[gate] * 100}%` }}
            />
          ))}
          <span className="sdv-sec__end" />
          {tokens.map(({ request, result, x, row }) => (
            <m.div
              key={request.id}
              className="sdv-sec__slot"
              style={{ top: `${0.2 + row * ROW_REM}rem` }}
              initial={{ left: `${x * 100}%`, opacity: 0 }}
              animate={{ left: `${x * 100}%`, opacity: 1 }}
              transition={{ duration: reduced ? 0 : 0.09, ease: 'linear' }}
            >
              <span
                className="sdv-sec__token"
                data-legit={request.legit ? 'true' : 'false'}
                data-verdict={result?.verdict}
              >
                {result && <span className="sdv-sec__mark">{result.allowed ? '✓' : '✕'}</span>}
                {tokenTag(request)}
              </span>
            </m.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WirePanel({ lane }: { lane: SecLane }) {
  const seen = lane.seen;
  let body: ReactNode = <p className="sdv-sec__muted">Nothing has crossed the cafe Wi-Fi yet.</p>;
  if (seen?.readable) {
    body = (
      <>
        <pre className="sdv-sec__wire" data-readable="true">
          {`DELETE /links/${seen.code} HTTP/1.1\nHost: sho.rt\nCookie: session=<${seen.user}'s session token>`}
        </pre>
        <p className="sdv-sec__note">
          <ToneBadge tone="bad">Readable</ToneBadge> The path, the headers, and the session cookie all cross
          as plain text.
        </p>
      </>
    );
  } else if (seen) {
    body = (
      <>
        <pre className="sdv-sec__wire" data-readable="false">
          {'TLS record for sho.rt\n▒▒▒▒ ▒▒▒▒ ▒▒▒▒ ▒▒▒▒ ▒▒▒▒\n▒▒▒▒ ▒▒▒▒ ▒▒▒▒ ▒▒▒▒'}
        </pre>
        <p className="sdv-sec__note">
          <ToneBadge tone="ok">Encrypted</ToneBadge> The listener sees the server name, the timing, and the
          size. The path, headers, and cookie stay hidden.
        </p>
      </>
    );
  }
  return (
    <div className="sdv-sec__panel">
      <p className="sdv-sec__label">What a listener on the cafe Wi-Fi sees</p>
      {body}
      <p className="sdv-sec__muted">
        Sessions a listener could copy: {lane.exposed.length === 0 ? 'none' : lane.exposed.join(', ')}
      </p>
    </div>
  );
}

const keySteps = [
  { tick: 0, text: 'Key committed to the repo' },
  { tick: KEY_DETECT_TICK, text: 'Audit log shows unfamiliar admin deletes' },
  { tick: KEY_ROTATE_TICK, text: 'New key issued, old key revoked' },
  { tick: KEY_REDEPLOY_TICK, text: 'Job ships a build that reads a secret manager' },
];

function KeyPanel({ lane, now }: { lane: SecLane; now: number }) {
  const inRepo = !lane.defenses.secretManager;
  const holders = inRepo
    ? [
        'Every developer with read access to the repo',
        'The CI runner and its build logs',
        'Every laptop clone and fork',
        'Git history, even after someone deletes the line',
      ]
    : ['The deploy service, which reads it at startup'];
  return (
    <div className="sdv-sec__panel">
      <p className="sdv-sec__label">Who holds the admin key</p>
      <ul className="sdv-sec__holders">
        {holders.map((holder) => (
          <li key={holder}>
            <SecIcon name="key" />
            {holder}
          </li>
        ))}
      </ul>
      {inRepo ? (
        <>
          <p className="sdv-sec__label">Rotation timeline</p>
          <ol className="sdv-sec__steps">
            {keySteps.map((step) => {
              const done = step.tick === 0 || now > step.tick;
              return (
                <li key={step.tick} data-done={done ? '' : undefined}>
                  <span className="sdv-sec__step-mark" aria-hidden="true">
                    {done ? '✓' : '○'}
                  </span>
                  <time>{step.tick === 0 ? 'Before' : `${(step.tick * SEC_TICK_SECONDS).toFixed(0)} s`}</time>
                  <span>{step.text}</span>
                </li>
              );
            })}
          </ol>
          <div className="sdv-sec__progress" aria-hidden="true">
            <span style={{ width: `${(now / SEC_TICKS) * 100}%` }} />
          </div>
        </>
      ) : (
        <p className="sdv-sec__muted">
          Rotating the key means updating one secret manager entry. The service reads the new key with no code
          change, so the cleanup job keeps working.
        </p>
      )}
    </div>
  );
}

function LanePane({
  duel,
  lane,
  variant,
  rows,
}: {
  duel: SecDuel;
  lane: SecLane;
  variant: SeriesVariant;
  rows: readonly number[];
}) {
  const scenarioId = duel.scenario.id;
  const gaps = SEC_DEFENSES.filter((defense) => !lane.defenses[defense.id]).map((defense) => defense.gate);
  const flying = duel.inFlight(lane).length;
  const latestId = lane.finished.at(-1);
  const latest = latestId ? lane.results[latestId - 1] : null;
  return (
    <section className="sdv-duel__lane sdv-sec__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ul className="sdv-sec__defenses" aria-label={`Defenses in ${lane.label}`}>
        {SEC_DEFENSES.map((defense) => {
          const on = lane.defenses[defense.id];
          return (
            <li key={defense.id} data-on={on ? 'true' : 'false'}>
              <SecIcon name={defenseIcon[defense.id]} />
              <span className="sdv-sec__defense-text">{on ? defense.on : defense.off}</span>
              <ToneBadge tone={on ? 'ok' : 'bad'}>{on ? 'On' : 'Missing'}</ToneBadge>
            </li>
          );
        })}
      </ul>
      <Track duel={duel} lane={lane} rows={rows} gaps={gaps} />
      <div className="sdv-sec__latest">
        <p className="sdv-sec__label">Latest request</p>
        {latest ? (
          <p className="sdv-sec__latest-text">
            <ToneBadge tone={verdictTone[latest.verdict]}>{verdictLabel[latest.verdict]}</ToneBadge>{' '}
            {latest.text}
          </p>
        ) : (
          <p className="sdv-sec__muted">None yet</p>
        )}
        <p className="sdv-sec__muted">In flight now: {flying}</p>
      </div>
      {scenarioId === 'plainHttp' && <WirePanel lane={lane} />}
      {scenarioId === 'repoKey' && <KeyPanel lane={lane} now={duel.ticks} />}
    </section>
  );
}

function compareRows(duel: SecDuel): CompareRow[] {
  const [a, b] = duel.lanes.map(laneTotals);
  if (!a || !b) return [];
  return [
    { label: 'Requests arrived (same for both)', values: [a.arrived, b.arrived] },
    { label: 'Allowed correctly', values: [a.allowedCorrect, b.allowedCorrect], better: 'higher' },
    { label: 'Rejected correctly', values: [a.rejectedCorrect, b.rejectedCorrect], better: 'higher' },
    { label: 'Wrongly allowed', values: [a.wronglyAllowed, b.wronglyAllowed], better: 'lower' },
    { label: 'Wrongly rejected', values: [a.wronglyRejected, b.wronglyRejected], better: 'lower' },
    { label: 'Still in flight', values: [a.inFlight, b.inFlight] },
  ];
}

function laneSentence(lane: SecLane): string {
  const t = laneTotals(lane);
  return `${lane.label}: ${t.allowed} allowed, ${t.rejected} rejected, ${t.wronglyAllowed} wrongly allowed, ${t.wronglyRejected} wrongly rejected`;
}

const CHART_TITLE = 'Wrongly allowed, running total';

export default function SecurityWidget({
  scenarios = ['ownership', 'expired', 'plainHttp', 'repoKey'],
  initial,
  title = 'Same requests, two sets of defenses',
  instructions = 'Pick a scenario, then press Play. Both lanes replay the exact same requests through the same three checkpoints. The first lane is missing one defense, and the second has all of them.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<SecScenarioId>(initial ?? scenarios[0] ?? 'ownership');
  const duelRef = useRef<SecDuel | null>(null);
  if (!duelRef.current) duelRef.current = new SecDuel(secScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const rows = useMemo(() => trackRows(duel.requests), [duel]);

  const restart = (id: SecScenarioId) => {
    duelRef.current = new SecDuel(secScenarios[id]);
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
  const chooseScenario = (id: SecScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const seconds = duel.ticks * duel.tickSeconds;
  const summary = `${seconds.toFixed(1)} s of ${SEC_SECONDS} s. ${laneSentence(first)}. ${laneSentence(second)}.`;
  const latestHarm = (lane: SecLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${CHART_TITLE}. ${first.label} ${latestHarm(first)}, ${second.label.toLowerCase()} ${latestHarm(second)}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${SEC_SECONDS} s` } as const);

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
          caption="Whole run so far, same requests for both. Every arrived request is allowed, rejected, or still in flight."
          columns={[first.label, second.label]}
          rows={compareRows(duel)}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: secScenarios[id].label,
          diff: secScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-duel__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane key={lane.label} duel={duel} lane={lane} variant={variants[index] ?? 'a'} rows={rows} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-sec__legend" aria-label="How to read the tracks">
        <li>
          <SecIcon name="lock" /> TLS: is the channel private?
        </li>
        <li>
          <SecIcon name="badge" /> Sign-in: who is calling?
        </li>
        <li>
          <SecIcon name="shield" /> Access: may this caller delete this link?
        </li>
        <li>
          <span className="sdv-sec__token" data-legit="true" aria-hidden="true">
            Ana
          </span>
          Solid outline: should be allowed (owner, admin, or job)
        </li>
        <li>
          <span className="sdv-sec__token" data-legit="false" aria-hidden="true">
            Anon
          </span>
          Dashed outline: should be stopped
        </li>
        <li>
          <span
            className="sdv-sec__token"
            data-legit="false"
            data-verdict="wronglyAllowed"
            aria-hidden="true"
          >
            <span className="sdv-sec__mark">✓</span>Chen→Ben
          </span>
          Hatched: wrongly allowed. Chen→Ben means Chen tries to delete Ben's link
        </li>
        <li>
          <span
            className="sdv-sec__token"
            data-legit="true"
            data-verdict="wronglyRejected"
            aria-hidden="true"
          >
            <span className="sdv-sec__mark">✕</span>Job
          </span>
          Double outline: wrongly rejected
        </li>
        <li>✓ reached the end and deleted the link. ✕ stopped at that gate. Gap marks a missing defense.</li>
      </ul>
      <TraceChart
        title={CHART_TITLE}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={5}
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
