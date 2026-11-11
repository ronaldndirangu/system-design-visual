import { m } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import {
  formatSeconds,
  makeRun,
  RT_DURATION_MS,
  RT_TICK_MS,
  RT_TICKS,
  RT_TRANSPORTS,
  type RtClick,
  type RtPlan,
  type RtScenarioId,
  type RtTransportId,
  rtScenarios,
  rtTransportLabels,
  rtTransportShort,
  totalsAt,
} from '../../lib/models/realTime';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { useElementWidth } from '../sim/useElementWidth';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import './RealTimeWidget.css';

const PAD = 8;
const LANE_HEIGHT = 30;
const BAR_Y = 5;
const BAR_HEIGHT = 12;
const LAG_Y = 24;
const CLICK_ROW_HEIGHT = 16;
const AXIS_HEIGHT = 18;

interface Props {
  scenarios?: RtScenarioId[];
  initial?: RtScenarioId;
  title?: string;
  instructions?: string;
}

type Scale = (ms: number) => number;

function diamond(x: number, y: number, size: number): string {
  return `M${x} ${y - size}L${x + size} ${y}L${x} ${y + size}L${x - size} ${y}Z`;
}

function NowLine({ x, now, height }: { x: Scale; now: number; height: number }) {
  if (now <= 0 || now >= RT_DURATION_MS) return null;
  return <line className="sdv-rt__now" x1={x(now)} x2={x(now)} y1={0} y2={height} />;
}

function ClickRow({ clicks, now, width, x }: { clicks: RtClick[]; now: number; width: number; x: Scale }) {
  const seen = clicks.filter((click) => click.at <= now);
  return (
    <svg
      width={width}
      height={CLICK_ROW_HEIGHT}
      viewBox={`0 0 ${width} ${CLICK_ROW_HEIGHT}`}
      aria-hidden="true"
    >
      <line
        className="sdv-rt__track"
        x1={x(0)}
        x2={x(RT_DURATION_MS)}
        y1={CLICK_ROW_HEIGHT - 1}
        y2={CLICK_ROW_HEIGHT - 1}
      />
      {seen.map((click) => (
        <m.path
          key={click.id}
          className="sdv-rt__click"
          d={`M${x(click.at) - 4} 3L${x(click.at) + 4} 3L${x(click.at)} ${CLICK_ROW_HEIGHT - 3}Z`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      ))}
      <NowLine x={x} now={now} height={CLICK_ROW_HEIGHT} />
    </svg>
  );
}

function LaneTrack({ plan, now, width, x }: { plan: RtPlan; now: number; width: number; x: Scale }) {
  const started = plan.exchanges.filter((exchange) => exchange.start < now);
  const bars = started.map((exchange) => {
    const left = x(exchange.start);
    const right = x(Math.min(exchange.end, now));
    return { key: exchange.start, left, width: Math.max(2, right - left - 1), stream: exchange.stream };
  });
  const answers = plan.exchanges
    .filter((exchange) => !exchange.stream && exchange.end <= now)
    .map((exchange) => ({ key: exchange.start, at: exchange.end, data: exchange.clickIds.length > 0 }));
  const pushes = plan.exchanges.some((exchange) => exchange.stream)
    ? plan.deliveries
        .filter((delivery) => delivery.deliveredAt <= now)
        .map((delivery) => ({ key: delivery.clickId, at: delivery.deliveredAt }))
    : [];
  const lags = plan.deliveries
    .filter((delivery) => delivery.at <= now)
    .map((delivery) => ({
      key: delivery.clickId,
      from: x(delivery.at),
      to: x(Math.min(delivery.deliveredAt, now)),
      shown: delivery.deliveredAt <= now,
    }));

  return (
    <svg width={width} height={LANE_HEIGHT} viewBox={`0 0 ${width} ${LANE_HEIGHT}`} aria-hidden="true">
      <line
        className="sdv-rt__track"
        x1={x(0)}
        x2={x(RT_DURATION_MS)}
        y1={BAR_Y + BAR_HEIGHT / 2}
        y2={BAR_Y + BAR_HEIGHT / 2}
      />
      {bars.map((bar) => (
        <rect
          key={bar.key}
          className="sdv-rt__bar"
          data-stream={bar.stream ? '' : undefined}
          x={bar.left}
          y={BAR_Y}
          width={bar.width}
          height={BAR_HEIGHT}
          rx="3"
        />
      ))}
      {lags.map((lag) => (
        <line
          key={lag.key}
          className="sdv-rt__lag"
          data-state={lag.shown ? 'shown' : 'waiting'}
          x1={lag.from}
          x2={Math.max(lag.to, lag.from + 1)}
          y1={LAG_Y}
          y2={LAG_Y}
        />
      ))}
      {answers.map((answer) => (
        <m.path
          key={answer.key}
          className="sdv-rt__answer"
          data-state={answer.data ? 'data' : 'empty'}
          d={diamond(x(answer.at), BAR_Y + BAR_HEIGHT / 2, 4.5)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      ))}
      {pushes.map((push) => (
        <m.path
          key={push.key}
          className="sdv-rt__answer"
          data-state="data"
          d={diamond(x(push.at), BAR_Y + BAR_HEIGHT / 2, 4.5)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      ))}
      <NowLine x={x} now={now} height={LANE_HEIGHT} />
    </svg>
  );
}

function Axis({ width, x }: { width: number; x: Scale }) {
  const ticks = [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000];
  return (
    <svg width={width} height={AXIS_HEIGHT} viewBox={`0 0 ${width} ${AXIS_HEIGHT}`} aria-hidden="true">
      {ticks.map((at, index) => (
        <g key={at}>
          <line className="sdv-rt__axis-tick" x1={x(at)} x2={x(at)} y1={0} y2={4} />
          <text
            className="sdv-rt__axis-label"
            x={x(at)}
            y={AXIS_HEIGHT - 2}
            textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
          >
            {at / 1000} s
          </text>
        </g>
      ))}
    </svg>
  );
}

function lagText(ms: number | null): string {
  return ms === null ? 'None' : formatSeconds(ms);
}

function ReadoutTable({ totals }: { totals: Record<RtTransportId, ReturnType<typeof totalsAt>> }) {
  const rows: { label: string; value: (id: RtTransportId) => string }[] = [
    { label: 'Requests sent', value: (id) => String(totals[id].requests) },
    { label: 'Empty answers', value: (id) => String(totals[id].emptyResponses) },
    { label: 'Clicks shown', value: (id) => String(totals[id].delivered) },
    { label: 'Clicks waiting', value: (id) => String(totals[id].waiting) },
    { label: 'Average lag', value: (id) => lagText(totals[id].meanDelayMs) },
    { label: 'Worst lag', value: (id) => lagText(totals[id].maxDelayMs) },
    { label: 'Connection held open', value: (id) => formatSeconds(totals[id].heldMs) },
  ];
  return (
    <table className="sdv-stats sdv-rt__table">
      <caption>Same clicks for all four, totals so far</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="sdv-visually-hidden">Measure</span>
          </th>
          {RT_TRANSPORTS.map((id) => (
            <th key={id} scope="col">
              {id === 'websocket' ? (
                <>
                  Web
                  <wbr />
                  Socket
                </>
              ) : (
                rtTransportShort[id]
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {RT_TRANSPORTS.map((id) => (
              <td key={id}>
                <span className="sdv-stats__value">{row.value(id)}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function clickLine(click: RtClick, plans: Record<RtTransportId, RtPlan>, now: number): string {
  const parts = RT_TRANSPORTS.map((id) => {
    const delivery = plans[id].deliveries.find((candidate) => candidate.clickId === click.id);
    const lag =
      delivery && delivery.deliveredAt <= now
        ? formatSeconds(delivery.deliveredAt - delivery.at)
        : 'still waiting';
    return `${rtTransportShort[id]} ${lag}`;
  });
  return `Click ${click.id}. Lag: ${parts.join(', ')}.`;
}

export default function RealTimeWidget({
  scenarios = ['quiet', 'steady', 'burst'],
  initial,
  title = 'One minute of clicks, four ways to hear about them',
  instructions = 'Pick a scenario, then press Play. All four lanes replay the exact same clicks on sho.rt/launch; only the way the dashboard hears about them differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<RtScenarioId>(initial ?? scenarios[0] ?? 'quiet');
  const [ticks, setTicks] = useState(0);
  const run = useMemo(() => makeRun(scenarioId), [scenarioId]);
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef, 280);
  const x: Scale = (ms) => PAD + (ms / RT_DURATION_MS) * Math.max(1, width - PAD * 2);

  const now = ticks * RT_TICK_MS;
  const done = ticks >= RT_TICKS;
  const totals = Object.fromEntries(
    RT_TRANSPORTS.map((id) => [id, totalsAt(run.plans[id], run.clicks, now)]),
  ) as Record<RtTransportId, ReturnType<typeof totalsAt>>;
  const happened = run.clicks.filter((click) => click.at <= now);

  const onTick = () => setTicks((value) => Math.min(RT_TICKS, value + 1));
  const restart = () => setTicks(0);
  const chooseScenario = (id: RtScenarioId) => {
    setScenarioId(id);
    setTicks(0);
  };

  const waitingText = RT_TRANSPORTS.map((id) => `${rtTransportLabels[id]} ${totals[id].waiting}`).join(', ');
  const summary = `${formatSeconds(now)} of 60 s. ${happened.length} of ${run.clicks.length} clicks so far. Clicks still waiting: ${waitingText}.`;
  const status = done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${formatSeconds(now)} of 60 s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={restart}
      summary={summary}
      status={status}
      finished={done}
      resetKey={scenarioId}
      controls={
        <div className="sdv-duel__extra">
          <button
            type="button"
            className="sdv-button"
            onClick={() => setTicks(RT_TICKS)}
            disabled={!hydrated || done}
          >
            Skip to the end
          </button>
        </div>
      }
      readout={<ReadoutTable totals={totals} />}
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: rtScenarios[id].label,
          diff: rtScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-rt">
          <div className="sdv-rt__ends">
            <span className="sdv-rt__end">
              <svg className="sdv-node sdv-node--client sdv-rt__icon" viewBox="0 0 24 24" aria-hidden="true">
                <KindIcon kind="client" size={24} />
              </svg>
              Dashboard
            </span>
            <span className="sdv-rt__end">
              <svg className="sdv-node sdv-node--server sdv-rt__icon" viewBox="0 0 24 24" aria-hidden="true">
                <KindIcon kind="server" size={24} />
              </svg>
              Shortener server
            </span>
          </div>
          <div className="sdv-rt__tracks" ref={frameRef}>
            <div className="sdv-rt__lane">
              <p className="sdv-rt__lane-head">
                <span className="sdv-rt__lane-name">Clicks on sho.rt/launch</span>
                <span className="sdv-rt__lane-meta">
                  {happened.length} of {run.clicks.length} so far
                </span>
              </p>
              <ClickRow clicks={run.clicks} now={now} width={width} x={x} />
            </div>
            {RT_TRANSPORTS.map((id) => {
              const lane = totals[id];
              return (
                <div key={id} className="sdv-rt__lane" data-transport={id}>
                  <p className="sdv-rt__lane-head">
                    <span className="sdv-rt__lane-name">{rtTransportLabels[id]}</span>
                    <span className="sdv-rt__lane-meta">
                      {lane.requests} {lane.requests === 1 ? 'request' : 'requests'}, dashboard shows{' '}
                      <m.strong
                        key={lane.delivered}
                        initial={{ scale: 1.3, opacity: 0.5 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.25 }}
                      >
                        {lane.delivered}
                      </m.strong>
                    </span>
                    {lane.waiting > 0 && <ToneBadge tone="warn">{`${lane.waiting} waiting`}</ToneBadge>}
                  </p>
                  <LaneTrack plan={run.plans[id]} now={now} width={width} x={x} />
                </div>
              );
            })}
            <Axis width={width} x={x} />
          </div>
        </div>
      </MotionRoot>
      <ul className="sdv-rt__legend" aria-label="How to read the timeline">
        <li>
          <span className="sdv-rt__key" data-key="click" aria-hidden="true" /> A visitor clicks the short link
        </li>
        <li>
          <span className="sdv-rt__key" data-key="bar" aria-hidden="true" /> A request or stream is open
        </li>
        <li>
          <span className="sdv-rt__key" data-key="data" aria-hidden="true" /> A message carries new clicks
        </li>
        <li>
          <span className="sdv-rt__key" data-key="empty" aria-hidden="true" /> An answer with nothing new
        </li>
        <li>
          <span className="sdv-rt__key" data-key="waiting" aria-hidden="true" /> Lag: the click happened, the
          dashboard has not seen it
        </li>
        <li>
          <span className="sdv-rt__key" data-key="shown" aria-hidden="true" /> Lag, once the dashboard shows
          it
        </li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {happened.length === 0 ? (
          <p className="sdv-trace__empty">
            Each click appears here with how long every transport took to show it.
          </p>
        ) : (
          <ol>
            {happened.map((click) => (
              <li key={click.id}>
                <time>{formatSeconds(click.at)}</time> {clickLine(click, run.plans, now)}
              </li>
            ))}
          </ol>
        )}
        {done && (
          <p className="sdv-trace__note">
            Polling sent {totals.polling.requests} requests and {totals.polling.emptyResponses} came back
            empty. Long polling sent {totals.longPolling.requests}. Each stream sent 1 and kept it open for
            the whole minute.
          </p>
        )}
      </div>
    </SimulationShell>
  );
}
