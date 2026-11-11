import { useReducer, useRef, useState } from 'react';
import {
  type Answer,
  CapDuel,
  type CapLane,
  type CapScenarioId,
  type CapStrategy,
  capScenarioOrder,
  capScenarios,
  cartAt,
  type Device,
  describeRequest,
  deviceLabels,
  homeSide,
  type LinkCut,
  lastAnswer,
  linkDownAt,
  type Side,
  sideLabels,
  strategyLabels,
  summarize,
  TICK_MS,
  TIMEOUT_MS,
} from '../../lib/models/capPacelc';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots } from '../viz/FlowDots';
import { lerp, link } from '../viz/geometry';
import { UiIcon } from '../viz/icons';
import { Edge, SystemNode } from '../viz/SystemNode';
import './CapWidget.css';

interface Props {
  scenarios?: readonly CapScenarioId[];
  initial?: CapScenarioId;
  title?: string;
  instructions?: string;
}

const POS = {
  phone: { x: 90, y: 50 },
  laptop: { x: 310, y: 50 },
  west: { x: 90, y: 195 },
  east: { x: 310, y: 195 },
} as const;

const DEVICES = ['phone', 'laptop'] as const;
const SIDES = ['west', 'east'] as const;

/** Keeps the diagram readable when taps and syncs overlap. */
const MAX_DOTS = 8;

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const laneIntro: Record<CapStrategy, string> = {
  refuse: `East keeps the only copy of the cart. West passes each phone tap to East and refuses it after ${TIMEOUT_MS} ms without an answer.`,
  accept:
    'East and West each keep a copy, answer at once, and send every change across the link. Versions that missed each other are kept side by side and merged.',
};

function laneFlows(lane: CapLane, workload: readonly { at: number; device: Device }[], now: number): Flow[] {
  const from = now - TICK_MS;
  const flows: Flow[] = [];
  workload.forEach((request, index) => {
    if (request.at < from || request.at >= now) return;
    const segment = link(POS[request.device], POS[homeSide[request.device]]);
    flows.push({
      id: `${lane.strategy}-tap-${index}`,
      points: [segment.from, segment.to],
      tone: 'request',
      duration: 0.25,
    });
  });
  lane.messages.forEach((message, index) => {
    if (message.sentAt < from || message.sentAt >= now) return;
    const segment = link(POS[message.from], POS[message.to]);
    flows.push({
      id: `${lane.strategy}-msg-${index}`,
      points: [segment.from, message.lost ? lerp(segment.from, segment.to, 0.5) : segment.to],
      tone: message.lost ? 'bad' : 'request',
      duration: 0.25,
    });
  });
  return flows.slice(0, MAX_DOTS);
}

function sameCart(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function nodeSublabel(lane: CapLane, side: Side, now: number): string {
  const cart = cartAt(lane, side, now);
  if (!cart) return 'No copy, forwards';
  const items = `${cart.cart.length} ${cart.cart.length === 1 ? 'item' : 'items'}`;
  if (lane.strategy === 'refuse') return `Only copy, ${items}`;
  return cart.versions > 1 ? `${items}, ${cart.versions} versions` : items;
}

function LaneDiagram({
  lane,
  workload,
  now,
  cut,
}: {
  lane: CapLane;
  workload: readonly { at: number; device: Device }[];
  now: number;
  cut: LinkCut | null;
}) {
  const down = linkDownAt(cut, now - 1);
  const across = link(POS.west, POS.east);
  const middle = lerp(across.from, across.to, 0.5);
  const flows = laneFlows(lane, workload, now);
  const crossing = lane.messages.filter(
    (message) => message.sentAt < now && message.arriveAt >= now - TICK_MS,
  );
  const east = cartAt(lane, 'east', now)?.cart;
  const west = cartAt(lane, 'west', now)?.cart;
  const differ = lane.strategy === 'accept' && !sameCart(east, west);
  const statusOf = (side: Side) => {
    if (lane.strategy === 'refuse') return side === 'west' && down ? 'warn' : undefined;
    return differ ? 'warn' : undefined;
  };
  const linkText = down ? 'The link between East and West is cut.' : 'The link between East and West is up.';
  const copiesText =
    lane.strategy === 'refuse'
      ? 'East holds the only copy.'
      : differ
        ? 'The two copies differ right now.'
        : 'The two copies match.';
  return (
    <DiagramScroll label={`${lane.label} diagram, scrolls sideways`}>
      <svg
        className="sdv-cap__svg"
        viewBox="0 0 400 300"
        role="img"
        aria-label={`${lane.label} diagram: the phone talks to West and the laptop talks to East. ${linkText} ${copiesText} ${crossing.length} ${crossing.length === 1 ? 'message' : 'messages'} on the link this moment.`}
      >
        {DEVICES.map((device) => {
          const edge = link(POS[device], POS[homeSide[device]]);
          const busy = workload.some(
            (request) => request.device === device && request.at >= now - TICK_MS && request.at < now,
          );
          return <Edge key={device} from={edge.from} to={edge.to} active={busy} />;
        })}
        <Edge from={across.from} to={across.to} dashed={down} active={!down && crossing.length > 0} />
        {down && (
          <g className="sdv-cap__cut" transform={`translate(${middle[0]} ${middle[1]})`}>
            <path d="M-9 -13L9 13M9 -13L-9 13" />
            <text y={32} textAnchor="middle">
              Link cut
            </text>
          </g>
        )}
        {DEVICES.map((device) => (
          <SystemNode
            key={device}
            kind="client"
            x={POS[device].x}
            y={POS[device].y}
            label={deviceLabels[device]}
            sublabel={`near ${sideLabels[homeSide[device]]}`}
          />
        ))}
        {SIDES.map((side) => (
          <SystemNode
            key={side}
            kind="database"
            x={POS[side].x}
            y={POS[side].y}
            label={sideLabels[side]}
            sublabel={nodeSublabel(lane, side, now)}
            status={statusOf(side)}
            dim={lane.strategy === 'refuse' && side === 'west'}
          />
        ))}
        <FlowDots flows={flows} />
      </svg>
    </DiagramScroll>
  );
}

function CartLine({ lane, side, now }: { lane: CapLane; side: Side; now: number }) {
  const cart = cartAt(lane, side, now);
  const label = `${sideLabels[side]} copy`;
  if (!cart) {
    return (
      <div>
        <dt>{label}</dt>
        <dd className="sdv-cap__muted">None. West forwards every phone tap to East.</dd>
      </div>
    );
  }
  const returned = new Set(
    lane.comebacks
      .filter((comeback) => comeback.side === side && comeback.at < now)
      .map((comeback) => comeback.item),
  );
  return (
    <div>
      <dt>
        {label}
        {cart.versions > 1 && <span className="sdv-cap__versions">{cart.versions} versions merged</span>}
      </dt>
      <dd>
        {cart.cart.length === 0 ? (
          <span className="sdv-cap__muted">Empty</span>
        ) : (
          <ul className="sdv-cap__items">
            {cart.cart.map((item) => (
              <li key={item} className="sdv-cap__item" data-back={returned.has(item) ? '' : undefined}>
                {returned.has(item) && <UiIcon name="warn" />}
                {item}
                {returned.has(item) && <span className="sdv-cap__back"> came back</span>}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function answerView(answer: Answer | null): { status: 'ok' | 'bad' | 'warn' | 'none'; text: string } {
  if (!answer) return { status: 'none', text: 'No answer yet' };
  const wait = answer.replyAt - answer.request.at;
  const what = describeRequest(answer.request);
  if (!answer.ok) return { status: 'bad', text: `Refused "${what}" after ${wait} ms` };
  if (answer.request.action !== 'view')
    return { status: 'ok', text: `${capitalize(what)}: done in ${wait} ms` };
  const count = answer.seen?.length ?? 0;
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  const miss = answer.missed[0];
  if (!miss) return { status: 'ok', text: `Viewed the cart in ${wait} ms: ${items}, up to date` };
  const more = answer.missed.length > 1 ? ` and ${answer.missed.length - 1} more` : '';
  return {
    status: 'warn',
    text: `Viewed the cart in ${wait} ms: ${items}, out of date (missing the ${deviceLabels[miss.device].toLowerCase()}'s "${describeRequest(miss)}"${more})`,
  };
}

function LastAnswers({ lane, now }: { lane: CapLane; now: number }) {
  return (
    <ul className="sdv-cap__answers" aria-label={`${lane.label}: last answer each device heard`}>
      {DEVICES.map((device) => {
        const view = answerView(lastAnswer(lane, device, now));
        return (
          <li key={device}>
            <span className="sdv-cap__device">{deviceLabels[device]}</span>
            <span className="sdv-cap__answer" data-status={view.status}>
              {view.status !== 'none' && <UiIcon name={view.status} />}
              {view.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LanePane({
  lane,
  variant,
  workload,
  now,
  cut,
}: {
  lane: CapLane;
  variant: SeriesVariant;
  workload: readonly { at: number; device: Device }[];
  now: number;
  cut: LinkCut | null;
}) {
  return (
    <section className="sdv-duel__lane sdv-cap__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-cap__intro">{laneIntro[lane.strategy]}</p>
      <LaneDiagram lane={lane} workload={workload} now={now} cut={cut} />
      <dl className="sdv-cap__carts">
        <CartLine lane={lane} side="east" now={now} />
        <CartLine lane={lane} side="west" now={now} />
      </dl>
      <LastAnswers lane={lane} now={now} />
    </section>
  );
}

const ms = (value: number) => `${Math.round(value)} ms`;

export default function CapWidget({
  scenarios = capScenarioOrder,
  initial,
  title = 'One cart, two datacenters, one cut link',
  instructions = 'Pick a scenario, then press Play. Both lanes replay the same taps from the same laptop and phone; only the rule the datacenters follow differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<CapScenarioId>(initial ?? scenarios[0] ?? 'partition');
  const duelRef = useRef<CapDuel | null>(null);
  if (!duelRef.current) duelRef.current = new CapDuel(capScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: CapScenarioId) => {
    duelRef.current = new CapDuel(capScenarios[id]);
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
  const chooseScenario = (id: CapScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const now = duel.now;
  const [refuse, accept] = duel.lanes;
  const sums = [summarize(refuse, now), summarize(accept, now)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const totalSeconds = duel.length * duel.tickSeconds;
  const anyDone = sums.every((sum) => sum.answered + sum.refused > 0);

  const rows: CompareRow[] = [
    { label: 'Taps so far (same taps)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Answered', values: [sums[0].answered, sums[1].answered], better: 'higher' },
    { label: 'Refused', values: [sums[0].refused, sums[1].refused], better: 'lower' },
    { label: 'Still waiting for an answer', values: [sums[0].inFlight, sums[1].inFlight] },
    { label: 'Out-of-date reads', values: [sums[0].outOfDate, sums[1].outOfDate], better: 'lower' },
    {
      label: 'Removed items that came back',
      values: [sums[0].comebacks, sums[1].comebacks],
      better: 'lower',
    },
    {
      label: 'Average wait',
      values: [sums[0].averageWaitMs, sums[1].averageWaitMs],
      format: ms,
      better: anyDone ? 'lower' : undefined,
    },
    {
      label: 'Longest wait',
      values: [sums[0].longestWaitMs, sums[1].longestWaitMs],
      format: ms,
      better: anyDone ? 'lower' : undefined,
    },
  ];

  const laneSummary = (index: 0 | 1) => {
    const sum = sums[index];
    return `${duel.lanes[index].label}: ${sum.answered} answered, ${sum.refused} refused, ${sum.outOfDate} out of date, ${sum.comebacks} came back, average wait ${Math.round(sum.averageWaitMs)} ms`;
  };
  const summary = `${seconds.toFixed(1)} s of ${totalSeconds.toFixed(1)} s. ${laneSummary(0)}. ${laneSummary(1)}.`;

  const problems = duel.scenario.metric === 'problems';
  const chartTitle = problems
    ? 'Taps refused or read out of date, running total'
    : 'Average wait so far (ms)';
  const latest = (lane: CapLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${chartTitle}. Refuse lane now ${latest(refuse)}, accept lane now ${latest(accept)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${totalSeconds.toFixed(1)} s` } as const);

  return (
    <MotionRoot>
      <SimulationShell
        title={title}
        instructions={instructions}
        onTick={onTick}
        onReset={() => restart(scenarioId)}
        summary={summary}
        status={status}
        finished={duel.done}
        resetKey={scenarioId}
        ticksPerSecond={4}
        controls={
          <div className="sdv-duel__extra">
            <button
              type="button"
              className="sdv-button"
              onClick={skipToEnd}
              disabled={!hydrated || duel.done}
            >
              Skip to the end
            </button>
          </div>
        }
        readout={
          <CompareTable
            caption="Same taps from the same two devices for both"
            columns={[strategyLabels[refuse.strategy], strategyLabels[accept.strategy]]}
            rows={rows}
          />
        }
      >
        <ScenarioChips
          label="Scenario"
          value={scenarioId}
          options={scenarios.map((id) => ({
            value: id,
            label: capScenarios[id].label,
            diff: capScenarios[id].diff,
          }))}
          onChange={chooseScenario}
        />
        <div className="sdv-duel__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane
              key={lane.strategy}
              lane={lane}
              variant={variants[index] ?? 'a'}
              workload={duel.workload}
              now={now}
              cut={duel.scenario.cut}
            />
          ))}
        </div>
        <ul className="sdv-cap__legend" aria-label="How to read the lanes">
          <li>
            <span className="sdv-cap__answer" data-status="ok">
              <UiIcon name="ok" />
              Done
            </span>
            Answered with every confirmed change
          </li>
          <li>
            <span className="sdv-cap__answer" data-status="bad">
              <UiIcon name="bad" />
              Refused
            </span>
            The tap failed and the shopper sees an error
          </li>
          <li>
            <span className="sdv-cap__answer" data-status="warn">
              <UiIcon name="warn" />
              Out of date
            </span>
            Answered, but missing a change already confirmed
          </li>
          <li>A dot that stops halfway is a message the cut swallowed</li>
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
          minMax={problems ? 10 : 100}
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
        <details className="sdv-cap__transcript">
          <summary>Every tap and answer ({sums[0].arrived} taps so far)</summary>
          {sums[0].arrived === 0 ? (
            <p className="sdv-trace__empty">Press Play or Step to start the run.</p>
          ) : (
            <TapTranscript lanes={duel.lanes} now={now} />
          )}
        </details>
      </SimulationShell>
    </MotionRoot>
  );
}

function outcome(answer: Answer, now: number): string {
  if (answer.replyAt >= now) return 'Waiting';
  return answerView(answer).text;
}

function TapTranscript({ lanes, now }: { lanes: readonly [CapLane, CapLane]; now: number }) {
  const [refuse, accept] = lanes;
  return (
    <DiagramScroll label="Tap transcript table, scrolls sideways">
      <table className="sdv-cap__table">
        <caption className="sdv-cap__caption">Each tap and what each lane answered</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Tap</th>
            <th scope="col">{refuse.label}</th>
            <th scope="col">{accept.label}</th>
          </tr>
        </thead>
        <tbody>
          {refuse.answers
            .filter((answer) => answer.request.at < now)
            .map((answer) => {
              const other = accept.answers[answer.request.id] as Answer;
              return (
                <tr key={answer.request.id}>
                  <td>
                    <time>{(answer.request.at / 1000).toFixed(2)} s</time>
                  </td>
                  <th scope="row">
                    {deviceLabels[answer.request.device]}: {describeRequest(answer.request)}
                  </th>
                  <td>{outcome(answer, now)}</td>
                  <td>{outcome(other, now)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </DiagramScroll>
  );
}
