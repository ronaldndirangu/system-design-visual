import { useReducer, useRef, useState } from 'react';
import {
  BACKUP_SENDS_PER_TICK,
  BREAKER_THRESHOLD,
  CODES,
  DEADLINE_SECONDS,
  duelScenarioIds,
  GRID_COLS,
  NotifDuel,
  type NotifDuelId,
  type NotifLane,
  type NotifScenarioId,
  type NotifSummary,
  notifScenarios,
  oldestWaitSeconds,
  PROBE_SECONDS,
  queueView,
  summarize,
  type TileView,
  tileView,
} from '../../lib/models/notifications';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './NotificationsWidget.css';

interface Props {
  duel: NotifDuelId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const codeIds = Array.from({ length: CODES }, (_, id) => id);
const HEAD_SLOTS = 10;
const headSlots = Array.from({ length: HEAD_SLOTS }, (_, slot) => slot);
const secondsText = (value: number) => `${value.toFixed(1)} s`;

const glyphs: Record<TileView, string> = {
  future: '',
  waiting: '',
  overdue: '!',
  retrying: '↻',
  onTime: '✓',
  backup: 'B',
  late: '!',
  expired: '✕',
};

const copy: Record<NotifDuelId, { title: string; instructions: string; chart: string }> = {
  deadline: {
    title: 'Same codes, two ways to queue them',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same 60 login code requests and the same marketing campaign, and both send through the same SMS provider at the same rate. Only the queue differs: one sends everything in arrival order, the other sends any waiting code before any marketing message.',
    chart: 'Codes past their 5 s deadline',
  },
  outage: {
    title: 'Same outage, two ways to retry',
    instructions: `Pick a scenario, then press Play. Both lanes get the same 60 login code requests and the same provider outage. Both retry with backoff and drop a code at its deadline. Only one has a circuit breaker: after ${BREAKER_THRESHOLD} failed sends in a row it routes codes to a backup provider that accepts ${BACKUP_SENDS_PER_TICK * 10} sends per second.`,
    chart: 'Codes past their 5 s deadline',
  },
};

type Link = { tone: 'ok' | 'warn' | 'bad'; icon: string; text: string };

/** The shared situation both lanes face after the last tick that ran. */
function sharedState(duel: NotifDuel, deadlineDuel: boolean): Link {
  const tick = duel.ticks - 1;
  if (deadlineDuel) {
    if (duel.campaignTick < 0) {
      return {
        tone: 'ok',
        icon: '✓',
        text: 'No campaign. The provider has room for every code as it arrives.',
      };
    }
    if (tick < duel.campaignTick) {
      return {
        tone: 'ok',
        icon: '✓',
        text: 'Quiet queue. The provider has room for every code as it arrives.',
      };
    }
    const queued = duel.lanes.some((lane) => lane.state.queue.some((entry) => entry < 0));
    if (!queued) {
      return { tone: 'ok', icon: '✓', text: 'The campaign has drained from both lanes.' };
    }
    const rate = Math.round(duel.scenario.sendsPerTick / duel.tickSeconds);
    const drain = duel.campaignSize / rate;
    return {
      tone: 'warn',
      icon: '≡',
      text: `${duel.campaignSize} marketing messages fill the queue. At ${rate} sends per second they take about ${drain.toFixed(1)} s to drain.`,
    };
  }
  if (duel.downTick < 0) {
    return { tone: 'ok', icon: '✓', text: 'The primary SMS provider stays healthy for the whole run.' };
  }
  if (tick < duel.downTick) return { tone: 'ok', icon: '✓', text: 'The primary SMS provider is healthy.' };
  if (duel.primaryDown(tick)) {
    return { tone: 'bad', icon: '✕', text: 'The primary SMS provider is down and rejects every send.' };
  }
  return { tone: 'ok', icon: '✓', text: 'The primary SMS provider has recovered.' };
}

function CodeGrid({ lane }: { lane: NotifLane }) {
  return (
    <div
      className="sdv-notifgrid"
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
    >
      {codeIds.map((id) => {
        const view = tileView(lane, id);
        return (
          <span key={id} className="sdv-notiftile" data-view={view}>
            {glyphs[view]}
          </span>
        );
      })}
    </div>
  );
}

function QueueLine({ lane }: { lane: NotifLane }) {
  const queue = queueView(lane, HEAD_SLOTS);
  let text = 'Queue empty.';
  if (queue.codes + queue.marketing > 0) {
    text = `Queued: ${queue.codes} ${queue.codes === 1 ? 'code' : 'codes'} and ${queue.marketing} marketing ${queue.marketing === 1 ? 'message' : 'messages'}.`;
    if (queue.codes > 0) {
      text +=
        queue.nextCodePlace === 1
          ? ' A code goes out next.'
          : ` The next code is number ${queue.nextCodePlace} in line.`;
    }
  }
  return (
    <div className="sdv-notifq">
      <p className="sdv-notifq__title">Next out of the queue</p>
      <ol className="sdv-notifq__head" aria-hidden="true">
        {headSlots.map((slot) => {
          const kind = queue.head[slot];
          return (
            <li key={slot} className="sdv-notifq__item" data-kind={kind ?? 'empty'}>
              {kind === 'code' ? 'C' : kind === 'marketing' ? 'M' : ''}
            </li>
          );
        })}
      </ol>
      <p className="sdv-notifq__text">{text}</p>
    </div>
  );
}

function RouteLine({ duel, lane }: { duel: NotifDuel; lane: NotifLane }) {
  const tick = duel.ticks - 1;
  const down = duel.primaryDown(tick);
  const open = lane.state.breakerOpen;
  const backoff = lane.state.phase.filter((phase) => phase === 'retrying').length;
  let text = 'Codes go to the primary provider.';
  if (open) {
    text = `The breaker is open, so codes go to the backup. A health check probes the primary every ${PROBE_SECONDS} s.`;
  } else if (down) {
    text = 'Codes go to the primary, which rejects them. Each failed code waits out its backoff.';
  }
  return (
    <div className="sdv-notifroute">
      <div className="sdv-notifroute__providers">
        <span
          className="sdv-notifroute__provider"
          data-active={!open || undefined}
          data-down={down || undefined}
        >
          <span aria-hidden="true">{down ? '✕' : '✓'}</span> Primary: {down ? 'down' : 'up'}
          {open ? ', idle' : ', in use'}
        </span>
        {lane.config.failover && (
          <span className="sdv-notifroute__provider" data-active={open || undefined}>
            <span aria-hidden="true">✓</span> Backup: {open ? 'in use' : 'standby'}
          </span>
        )}
      </div>
      <p className="sdv-notifroute__text">
        {text} In backoff now: {backoff} {backoff === 1 ? 'code' : 'codes'}.
      </p>
    </div>
  );
}

function WaitMeter({ seconds }: { seconds: number }) {
  const tone = seconds >= DEADLINE_SECONDS ? 'bad' : seconds >= DEADLINE_SECONDS / 2 ? 'warn' : 'ok';
  const share = Math.min(1, seconds / DEADLINE_SECONDS);
  const text =
    seconds === 0
      ? 'No code waiting.'
      : `Oldest unsent code: ${secondsText(seconds)} of its ${DEADLINE_SECONDS} s${seconds >= DEADLINE_SECONDS ? ', already useless' : ''}.`;
  return (
    <div className="sdv-notifwait" data-tone={tone}>
      <p className="sdv-notifwait__text">
        {tone === 'bad' && <span aria-hidden="true">! </span>}
        {text}
      </p>
      <span className="sdv-notifwait__track" aria-hidden="true">
        <span className="sdv-notifwait__fill" style={{ width: `${share * 100}%` }} />
      </span>
    </div>
  );
}

function LanePane({
  duel,
  lane,
  sum,
  variant,
  deadlineDuel,
}: {
  duel: NotifDuel;
  lane: NotifLane;
  sum: NotifSummary;
  variant: SeriesVariant;
  deadlineDuel: boolean;
}) {
  const parts = [
    lane.config.failover
      ? `${sum.onTime} on time (${sum.viaBackup} through the backup)`
      : `${sum.onTime} on time`,
  ];
  if (!lane.config.dropExpired) parts.push(`${sum.late} sent late`);
  if (lane.config.dropExpired) parts.push(`${sum.expired} dropped`);
  parts.push(`${sum.pending} not sent yet`);
  return (
    <section className="sdv-duel__lane" aria-label={lane.config.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.config.label}
      </h4>
      <CodeGrid lane={lane} />
      <div className="sdv-notif__tally">
        <p>Codes: {parts.join(', ')}.</p>
        <p>
          Missed the {DEADLINE_SECONDS} s deadline: {sum.missed}.
        </p>
      </div>
      {deadlineDuel ? <QueueLine lane={lane} /> : <RouteLine duel={duel} lane={lane} />}
      <WaitMeter seconds={oldestWaitSeconds(lane, duel.codes, duel.ticks)} />
    </section>
  );
}

function LegendTile({ view, text }: { view: TileView; text: string }) {
  return (
    <li>
      <span className="sdv-notiftile" data-view={view} aria-hidden="true">
        {glyphs[view]}
      </span>{' '}
      {text}
    </li>
  );
}

export default function NotificationsWidget({ duel: duelId, title, instructions }: Props) {
  const hydrated = useHydrated();
  const scenarios = duelScenarioIds[duelId];
  const [scenarioId, setScenarioId] = useState<NotifScenarioId>(scenarios[0] ?? 'campaign');
  const duelRef = useRef<NotifDuel | null>(null);
  if (!duelRef.current) duelRef.current = new NotifDuel(notifScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: NotifScenarioId) => {
    duelRef.current = new NotifDuel(notifScenarios[id]);
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
  const chooseScenario = (id: NotifScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const deadlineDuel = duelId === 'deadline';
  const [first, second] = duel.lanes;
  const sums = [summarize(first, duel.codes), summarize(second, duel.codes)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const runSeconds = duel.scenario.seconds;
  const text = copy[duelId];
  const shared = sharedState(duel, deadlineDuel);
  const pair = (pick: (sum: NotifSummary) => number): [number, number] => [pick(sums[0]), pick(sums[1])];

  const campaignText = (value: number) =>
    value < 0 ? (duel.campaignSize > 0 ? 'Not yet' : 'No campaign') : secondsText(value);
  const rows: CompareRow[] = deadlineDuel
    ? [
        { label: 'Login codes requested (same for both)', values: pair((sum) => sum.requested) },
        { label: 'Sent within 5 s', values: pair((sum) => sum.onTime), better: 'higher' },
        { label: 'Missed the 5 s deadline', values: pair((sum) => sum.missed), better: 'lower' },
        {
          label: 'Average wait, request to send',
          values: pair((sum) => sum.averageWaitSeconds),
          format: secondsText,
          better: 'lower',
        },
        { label: 'Marketing messages sent', values: pair((sum) => sum.marketingSent), better: 'higher' },
        {
          label: 'Last campaign message sent at',
          values: pair((sum) => sum.campaignDoneSeconds),
          format: campaignText,
        },
      ]
    : [
        { label: 'Login codes requested (same for both)', values: pair((sum) => sum.requested) },
        { label: 'Sent within 5 s', values: pair((sum) => sum.onTime), better: 'higher' },
        { label: 'Dropped at the deadline', values: pair((sum) => sum.expired), better: 'lower' },
        { label: 'Sent through the backup', values: pair((sum) => sum.viaBackup) },
        { label: 'Failed sends to the primary', values: pair((sum) => sum.failedSends), better: 'lower' },
        {
          label: 'Average wait, request to send',
          values: pair((sum) => sum.averageWaitSeconds),
          format: secondsText,
          better: 'lower',
        },
      ];

  const laneText = (lane: NotifLane, index: 0 | 1) =>
    `${lane.config.label}: ${sums[index].onTime} on time, ${sums[index].missed} missed`;
  const summary = `${seconds.toFixed(1)} s of ${runSeconds} s. ${shared.text} ${laneText(first, 0)}. ${laneText(second, 1)}.`;
  const latest = (lane: NotifLane) => lane.state.series.at(-1) ?? 0;
  const chartSummary = `${text.chart}. ${first.config.label} ${latest(first)}, ${second.config.label} ${latest(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);
  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${runSeconds} s` } as const);

  return (
    <SimulationShell
      title={title ?? text.title}
      instructions={instructions ?? text.instructions}
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
          caption="Whole run so far, same codes and providers for both"
          columns={[first.config.label, second.config.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: notifScenarios[id].label,
          diff: notifScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <p className="sdv-notiflink" data-tone={shared.tone}>
        <span className="sdv-notiflink__icon" aria-hidden="true">
          {shared.icon}
        </span>
        {shared.text}
      </p>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.config.label}
            duel={duel}
            lane={lane}
            sum={sums[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
            deadlineDuel={deadlineDuel}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend sdv-notifgrid__legend" aria-label="How to read the code grids">
        <LegendTile view="waiting" text="Waiting to send, inside its 5 s" />
        {deadlineDuel ? (
          <>
            <LegendTile view="onTime" text="Sent within 5 s" />
            <LegendTile view="overdue" text="Past 5 s and still queued" />
            <LegendTile view="late" text="Sent after 5 s, too late to use" />
          </>
        ) : (
          <>
            <LegendTile view="retrying" text="Failed, waiting out its backoff" />
            <LegendTile view="onTime" text="Sent within 5 s by the primary" />
            <LegendTile view="backup" text="Sent within 5 s by the backup" />
            <LegendTile view="expired" text="Dropped at 5 s, never sent" />
          </>
        )}
      </ul>
      {deadlineDuel && (
        <ul className="sdv-qtracks__legend sdv-notifq__legend" aria-label="How to read the queue strips">
          <li>
            <span className="sdv-notifq__item" data-kind="code" aria-hidden="true">
              C
            </span>{' '}
            Login code
          </li>
          <li>
            <span className="sdv-notifq__item" data-kind="marketing" aria-hidden="true">
              M
            </span>{' '}
            Marketing message
          </li>
        </ul>
      )}
      <TraceChart
        title={text.chart}
        series={duel.lanes.map((lane, index) => ({
          label: lane.config.label,
          values: lane.state.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={10}
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
