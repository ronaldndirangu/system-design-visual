import { useId, useReducer, useRef, useState } from 'react';
import {
  type CellStatus,
  INITIAL_STOCK,
  type LaneState,
  type NodeId,
  type Order,
  type Outcome,
  orderCells,
  SagaDuel,
  type SagaScenarioId,
  type SagaStyle,
  STEPS,
  sagaScenarioOrder,
  sagaScenarios,
  styleLabels,
  summarizeLane,
  whereIs,
} from '../../lib/models/saga';
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
import type { ComponentKind } from '../viz/kinds';
import { Edge, SystemNode } from '../viz/SystemNode';
import './SagaWidget.css';

interface Props {
  scenarios?: readonly SagaScenarioId[];
  initial?: SagaScenarioId;
  title?: string;
  instructions?: string;
}

type Slot = 'top' | 'hub' | 'inventory' | 'payments' | 'shipping';

const SLOT_POS: Record<Slot, { x: number; y: number }> = {
  top: { x: 200, y: 45 },
  hub: { x: 200, y: 150 },
  inventory: { x: 70, y: 255 },
  payments: { x: 200, y: 255 },
  shipping: { x: 330, y: 255 },
};

const SERVICE_SLOTS = ['inventory', 'payments', 'shipping'] as const;

/** Keeps the diagram readable when several orders overlap. */
const MAX_DOTS = 8;

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const centerNodes: Record<SagaStyle, Record<'top' | 'hub', { kind: ComponentKind; label: string }>> = {
  orchestration: {
    top: { kind: 'database', label: 'Saga log' },
    hub: { kind: 'server', label: 'Orchestrator' },
  },
  choreography: {
    top: { kind: 'server', label: 'Orders' },
    hub: { kind: 'queue', label: 'Event bus' },
  },
};

const laneIntro: Record<SagaStyle, string> = {
  orchestration:
    'An orchestrator sends each command, waits for the reply, and writes every step to its saga log.',
  choreography:
    'Each service publishes an event on the bus, and the next service reacts to it. No one service holds the whole saga.',
};

const diagramLabel: Record<SagaStyle, string> = {
  orchestration:
    'Orchestration diagram: the orchestrator sends commands to Inventory, Payments, and Shipping, hears each reply, and records every step in its saga log.',
  choreography:
    'Choreography diagram: each service publishes an event to the event bus, and the bus delivers it to the next service. Orders listens for the outcome.',
};

const stateHome: Record<SagaStyle, string> = {
  orchestration:
    'Saga state lives in one place: the saga log. The dashed line is the orchestrator writing to it.',
  choreography: 'Saga state is spread across Orders, Inventory, Payments, and Shipping.',
};

const cellIcon: Partial<Record<CellStatus, 'ok' | 'bad' | 'warn' | 'reset' | 'step'>> = {
  done: 'ok',
  failed: 'bad',
  doubled: 'warn',
  undone: 'reset',
  active: 'step',
};

const outcomeText: Record<Outcome, string> = {
  waiting: 'Not started',
  running: 'Running',
  completed: 'Completed',
  compensated: 'Compensated',
};

function slotOf(style: SagaStyle, node: NodeId): Slot {
  if (node === 'inventory' || node === 'payments' || node === 'shipping') return node;
  if (style === 'orchestration') return node === 'orders' ? 'hub' : 'top';
  return node === 'bus' ? 'hub' : 'top';
}

function laneFlows(lane: LaneState, tick: number): Flow[] {
  return lane.inFlight.slice(0, MAX_DOTS).map((msg) => {
    const segment = link(SLOT_POS[slotOf(lane.style, msg.from)], SLOT_POS[slotOf(lane.style, msg.to)]);
    const end = msg.lost ? lerp(segment.from, segment.to, 0.5) : segment.to;
    return {
      id: `${lane.style}-${tick}-${msg.id}`,
      points: [segment.from, end],
      tone: msg.lost ? 'bad' : msg.retry ? 'miss' : 'request',
      duration: 0.4,
    };
  });
}

function LaneDiagram({ lane, tick }: { lane: LaneState; tick: number }) {
  const busy = new Set<Slot>();
  for (const msg of lane.inFlight) {
    busy.add(slotOf(lane.style, msg.from));
    busy.add(slotOf(lane.style, msg.to));
  }
  const failing = new Set(lane.failing.map((node) => slotOf(lane.style, node)));
  const center = centerNodes[lane.style];
  const hubToTop = link(SLOT_POS.hub, SLOT_POS.top);
  const moving = lane.inFlight.length;
  return (
    <DiagramScroll label={`${styleLabels[lane.style]} diagram, scrolls sideways`}>
      <svg
        className="sdv-saga__svg"
        viewBox="0 0 400 300"
        role="img"
        aria-label={`${diagramLabel[lane.style]} ${moving} ${moving === 1 ? 'message' : 'messages'} in flight.`}
      >
        <Edge
          from={hubToTop.from}
          to={hubToTop.to}
          dashed={lane.style === 'orchestration'}
          active={lane.style === 'choreography' && busy.has('top')}
        />
        {SERVICE_SLOTS.map((slot) => {
          const edge = link(SLOT_POS.hub, SLOT_POS[slot]);
          return <Edge key={slot} from={edge.from} to={edge.to} active={busy.has(slot)} />;
        })}
        {(['top', 'hub'] as const).map((slot) => (
          <SystemNode
            key={slot}
            kind={center[slot].kind}
            x={SLOT_POS[slot].x}
            y={SLOT_POS[slot].y}
            label={center[slot].label}
            status={failing.has(slot) ? 'bad' : undefined}
          />
        ))}
        {STEPS.map((step) => {
          const slot = slotOf(lane.style, step.service);
          return (
            <SystemNode
              key={step.id}
              kind="server"
              x={SLOT_POS[slot].x}
              y={SLOT_POS[slot].y}
              width={100}
              label={step.serviceLabel}
              status={failing.has(slot) ? 'bad' : undefined}
            />
          );
        })}
        <FlowDots flows={laneFlows(lane, tick)} />
      </svg>
    </DiagramScroll>
  );
}

function OrderGrid({
  lane,
  workload,
  focusOrder,
}: {
  lane: LaneState;
  workload: readonly Order[];
  focusOrder: number;
}) {
  const titleId = useId();
  return (
    <>
      <p className="sdv-saga__grid-title" id={titleId}>
        What each service has recorded for every order
      </p>
      <DiagramScroll label={`${styleLabels[lane.style]} order table, scrolls sideways`}>
        <table className="sdv-saga__grid" aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">Order</th>
              {STEPS.map((step) => (
                <th key={step.id} scope="col">
                  {step.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workload.map((order) => {
              const outcome = lane.orders[order.id - 1]?.outcome ?? 'waiting';
              const focused = order.id === focusOrder;
              return (
                <tr key={order.id} data-focus={focused ? '' : undefined}>
                  <th scope="row">
                    <span className="sdv-saga__order">
                      Order {order.id}
                      {focused && <span className="sdv-saga__watch">Watch</span>}
                    </span>
                    <span className="sdv-saga__outcome" data-outcome={outcome}>
                      {outcomeText[outcome]}
                    </span>
                  </th>
                  {orderCells(lane, order).map((cell) => {
                    const icon = cellIcon[cell.status];
                    return (
                      <td key={cell.step}>
                        <span className="sdv-saga__cell" data-status={cell.status}>
                          {icon && <UiIcon name={icon} />}
                          {cell.text}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </DiagramScroll>
    </>
  );
}

function WhereIs({ lane, order }: { lane: LaneState; order: Order }) {
  const answers = whereIs(lane, order);
  return (
    <div className="sdv-saga__where">
      <p className="sdv-saga__where-title">Where is order {order.id}?</p>
      <dl className="sdv-saga__where-list">
        {answers.map((answer) => (
          <div key={answer.place}>
            <dt>{answer.place}</dt>
            <dd>{answer.answer}</dd>
          </div>
        ))}
      </dl>
      <p className="sdv-saga__note">
        {answers.length === 1
          ? 'One lookup in the saga log answers it.'
          : `You ask ${answers.length} services and piece the answer together yourself.`}
      </p>
    </div>
  );
}

function LanePane({
  lane,
  variant,
  tick,
  workload,
  focusOrder,
}: {
  lane: LaneState;
  variant: SeriesVariant;
  tick: number;
  workload: readonly Order[];
  focusOrder: number;
}) {
  const label = styleLabels[lane.style];
  const focus = workload.find((order) => order.id === focusOrder) ?? workload[0];
  return (
    <section className="sdv-duel__lane sdv-saga__lane" aria-label={label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {label}
      </h4>
      <p className="sdv-saga__intro">{laneIntro[lane.style]}</p>
      <LaneDiagram lane={lane} tick={tick} />
      <p className="sdv-saga__note">
        {stateHome[lane.style]} Messages sent so far: {lane.sent}.
      </p>
      <OrderGrid lane={lane} workload={workload} focusOrder={focusOrder} />
      {focus && <WhereIs lane={lane} order={focus} />}
    </section>
  );
}

const money = (value: number) => `$${value}`;

export default function SagaWidget({
  scenarios = sagaScenarioOrder,
  initial,
  title = 'One checkout, two ways to coordinate',
  instructions = 'Pick a scenario, then press Play. Both lanes check out the same six carts and hit the same fault; only the coordination differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<SagaScenarioId>(initial ?? scenarios[0] ?? 'happy');
  const duelRef = useRef<SagaDuel | null>(null);
  if (!duelRef.current) duelRef.current = new SagaDuel(scenarioId);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: SagaScenarioId) => {
    duelRef.current = new SagaDuel(id);
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
  const chooseScenario = (id: SagaScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeLane(first, duel.workload), summarizeLane(second, duel.workload)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const totalSeconds = duel.length * duel.tickSeconds;
  const bothFinished = sums[0].slowestMs > 0 && sums[1].slowestMs > 0;
  const slowest = (value: number) => (value > 0 ? `${value} ms` : 'none yet');

  const rows: CompareRow[] = [
    { label: 'Orders checked out (same carts)', values: [sums[0].started, sums[1].started] },
    { label: 'Completed', values: [sums[0].completed, sums[1].completed] },
    { label: 'Compensated (cancelled and undone)', values: [sums[0].compensated, sums[1].compensated] },
    { label: 'Messages sent', values: [sums[0].messages, sums[1].messages], better: 'lower' },
    { label: 'Charged', values: [sums[0].charged, sums[1].charged], format: money },
    { label: 'Refunded', values: [sums[0].refunded, sums[1].refunded], format: money },
    {
      label: 'Charged twice by mistake',
      values: [sums[0].overcharged, sums[1].overcharged],
      format: money,
      better: 'lower',
    },
    { label: 'Stock other shoppers can buy', values: [sums[0].stock, sums[1].stock] },
    {
      label: 'Places to ask about one order',
      values: [sums[0].placesToAsk, sums[1].placesToAsk],
      better: 'lower',
    },
    {
      label: 'Slowest finished checkout',
      values: [sums[0].slowestMs, sums[1].slowestMs],
      format: slowest,
      better: bothFinished ? 'lower' : undefined,
    },
  ];

  const laneSummary = (index: 0 | 1) => {
    const sum = sums[index];
    const label = styleLabels[duel.lanes[index].style];
    return `${label}: ${sum.completed} completed, ${sum.compensated} compensated, ${sum.messages} messages, charged ${money(sum.charged)}, refunded ${money(sum.refunded)}`;
  };
  const summary = `${seconds.toFixed(1)} s of ${totalSeconds.toFixed(1)} s. ${laneSummary(0)}. ${laneSummary(1)}.`;

  const chartTitle = 'Stock other shoppers can buy (items)';
  const latest = (lane: LaneState) => lane.stockSeries.at(-1) ?? INITIAL_STOCK;
  const chartSummary = `${chartTitle}. Orchestration now ${latest(first)}, choreography now ${latest(second)}, out of ${INITIAL_STOCK}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const markerNumber = new Map(markerEvents.map((event, index) => [event, index + 1]));
  const focusOrder = duel.scenario.focusOrder;

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
        ticksPerSecond={2}
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
            caption="Same six orders and the same fault for both"
            columns={[styleLabels[first.style], styleLabels[second.style]]}
            rows={rows}
          />
        }
      >
        <ScenarioChips
          label="Scenario"
          value={scenarioId}
          options={scenarios.map((id) => ({
            value: id,
            label: sagaScenarios[id].label,
            diff: sagaScenarios[id].diff,
          }))}
          onChange={chooseScenario}
        />
        <div className="sdv-duel__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane
              key={lane.style}
              lane={lane}
              variant={variants[index] ?? 'a'}
              tick={duel.ticks}
              workload={duel.workload}
              focusOrder={focusOrder}
            />
          ))}
        </div>
        <ul className="sdv-saga__legend" aria-label="How to read the order table">
          <li>
            <span className="sdv-saga__cell" data-status="done">
              <UiIcon name="ok" />
              Done
            </span>
            The step succeeded
          </li>
          <li>
            <span className="sdv-saga__cell" data-status="active">
              <UiIcon name="step" />
              In progress
            </span>
            A message is on its way
          </li>
          <li>
            <span className="sdv-saga__cell" data-status="failed">
              <UiIcon name="bad" />
              Failed
            </span>
            The service said no
          </li>
          <li>
            <span className="sdv-saga__cell" data-status="undone">
              <UiIcon name="reset" />
              Compensated
            </span>
            A new action undid the effect
          </li>
          <li>
            <span className="sdv-saga__cell" data-status="doubled">
              <UiIcon name="warn" />
              Twice
            </span>
            A retry ran the step again
          </li>
          <li>A dot that stops halfway is a lost message</li>
        </ul>
        <TraceChart
          title={chartTitle}
          series={duel.lanes.map((lane, index) => ({
            label: styleLabels[lane.style],
            values: lane.stockSeries,
            variant: variants[index] ?? 'a',
          }))}
          length={duel.length}
          tickSeconds={duel.tickSeconds}
          markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
          minMax={INITIAL_STOCK}
          summary={chartSummary}
        />
        <div className="sdv-trace__log">
          <p className="sdv-trace__log-title">Failures, compensations, and retries</p>
          {markerEvents.length === 0 && (
            <p className="sdv-trace__empty">
              {duel.done
                ? 'No step failed, so nothing needed compensating.'
                : 'Failures, compensations, and retries appear here, numbered to match the chart, as the run plays.'}
            </p>
          )}
          {markerEvents.length > 0 && (
            <ol>
              {markerEvents.map((event, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: events only append, so an index stays stable
                <li key={index}>
                  <span className="sdv-trace__num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time> {event.text}
                </li>
              ))}
            </ol>
          )}
        </div>
        <details className="sdv-saga__transcript">
          <summary>Full transcript ({duel.events.length} events so far)</summary>
          {duel.events.length === 0 ? (
            <p className="sdv-trace__empty">Press Play or Step to start the run.</p>
          ) : (
            <ol>
              {duel.events.map((event, index) => {
                const number = markerNumber.get(event);
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: events only append, so an index stays stable
                  <li key={index}>
                    <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time>
                    <span>
                      {event.text}
                      {number !== undefined && (
                        <span className="sdv-saga__mark"> (chart marker {number})</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </details>
      </SimulationShell>
    </MotionRoot>
  );
}
