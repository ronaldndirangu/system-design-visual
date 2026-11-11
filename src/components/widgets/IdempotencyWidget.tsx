import { useReducer, useRef, useState } from 'react';
import {
  type CheckoutSnapshot,
  type CheckoutSummary,
  CLIENT_TIMEOUT_MS,
  IDEM_RUN_SECONDS,
  IdemDuel,
  type IdemLane,
  type IdemScenarioId,
  idemScenarios,
  MAX_ATTEMPTS,
  summarizeCheckout,
} from '../../lib/models/idempotency';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './IdempotencyWidget.css';

interface Props {
  scenarios?: IdemScenarioId[];
  initial?: IdemScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

function OrderGrid({ snap }: { snap: CheckoutSnapshot }) {
  return (
    <span className="sdv-idem__cells" aria-hidden="true">
      {snap.cells.map((cell, order) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: an order's position is its identity
          key={order}
          className="sdv-idem__cell"
          data-state={cell}
          data-charges={snap.charges[order] ?? 0}
        />
      ))}
    </span>
  );
}

function laneHealth(sum: CheckoutSummary, started: boolean): { tone: Tone; text: string } {
  if (!started) return { tone: 'neutral', text: 'Not started' };
  if (sum.doubleCharged > 0) {
    return {
      tone: 'bad',
      text: `${sum.doubleCharged} ${sum.doubleCharged === 1 ? 'order' : 'orders'} charged twice`,
    };
  }
  if (sum.gaveUp > 0) {
    return { tone: 'warn', text: `${sum.gaveUp} ${sum.gaveUp === 1 ? 'customer' : 'customers'} unsure` };
  }
  return { tone: 'ok', text: 'No double charges' };
}

function LanePane({
  lane,
  sum,
  variant,
  started,
}: {
  lane: IdemLane;
  sum: CheckoutSummary;
  variant: SeriesVariant;
  started: boolean;
}) {
  const snap = lane.checkout.snapshot();
  const health = laneHealth(sum, started);
  return (
    <section className="sdv-duel__lane sdv-idem__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <ToneBadge tone={health.tone}>{health.text}</ToneBadge>
      <div className="sdv-idem__grid">
        <p className="sdv-idem__grid-name">Purchases, one square each</p>
        <OrderGrid snap={snap} />
        <p className="sdv-qtracks__meta">
          <span>
            {sum.charges} card {sum.charges === 1 ? 'charge' : 'charges'} for {sum.orders}{' '}
            {sum.orders === 1 ? 'purchase' : 'purchases'}
          </span>
          <span>
            {snap.running} {snap.running === 1 ? 'payment' : 'payments'} running, {snap.open} waiting
          </span>
          {lane.policy === 'none' ? (
            <span>No key store</span>
          ) : (
            <span>
              Key store: {snap.claimedKeys} claimed, {snap.savedKeys} saved
            </span>
          )}
        </p>
      </div>
    </section>
  );
}

const formatDollars = (value: number) => `$${value}`;

export default function IdempotencyWidget({
  scenarios = ['lossy', 'calm', 'slow'],
  initial,
  title = 'Same customers, two checkout servers',
  instructions = 'Pick a scenario, then press Play. Both servers get the exact same purchases, lost responses, and payment times; only the key handling differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<IdemScenarioId>(initial ?? scenarios[0] ?? 'lossy');
  const duelRef = useRef<IdemDuel | null>(null);
  if (!duelRef.current) duelRef.current = new IdemDuel(idemScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: IdemScenarioId) => {
    duelRef.current = new IdemDuel(idemScenarios[id]);
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
  const chooseScenario = (id: IdemScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const sums = [summarizeCheckout(first), summarizeCheckout(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const started = duel.ticks > 0;

  const rows: CompareRow[] = [
    { label: 'Purchases (same customers)', values: [sums[0].orders, sums[1].orders] },
    { label: 'Attempts sent, retries included', values: [sums[0].attempts, sums[1].attempts] },
    { label: 'Confirmed with a receipt', values: [sums[0].confirmed, sums[1].confirmed], better: 'higher' },
    { label: 'Card charges', values: [sums[0].charges, sums[1].charges], better: 'lower' },
    {
      label: 'Orders charged twice',
      values: [sums[0].doubleCharged, sums[1].doubleCharged],
      better: 'lower',
    },
    {
      label: 'Money taken by mistake',
      values: [sums[0].extraDollars, sums[1].extraDollars],
      format: formatDollars,
      better: 'lower',
    },
    { label: 'Retries answered with the saved receipt', values: [sums[0].replays, sums[1].replays] },
    { label: 'Retries answered 409, still running', values: [sums[0].conflicts, sums[1].conflicts] },
    {
      label: `Gave up after ${MAX_ATTEMPTS} attempts`,
      values: [sums[0].gaveUp, sums[1].gaveUp],
      better: 'lower',
    },
  ];

  const describeLane = (lane: IdemLane, index: 0 | 1) => {
    const sum = sums[index];
    return `${lane.label}: ${sum.charges} charges for ${sum.orders} purchases, ${sum.doubleCharged} charged twice, $${sum.extraDollars} taken by mistake`;
  };
  const summary = `${seconds.toFixed(1)} s of ${IDEM_RUN_SECONDS} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;

  const chartTitle = 'Orders charged twice so far, sampled every 0.1 s';
  const latest = (lane: IdemLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${chartTitle}. ${first.label}: ${latest(first)}. ${second.label}: ${latest(second)}.`;

  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${IDEM_RUN_SECONDS} s` } as const)
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
          caption="Whole run so far, same customers for both"
          columns={[first.label, second.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: idemScenarios[id].label,
          diff: idemScenarios[id].diff,
        }))}
        onChange={chooseScenario}
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
      <ul className="sdv-qtracks__legend" aria-label="How to read the purchases">
        <li>
          <span className="sdv-idem__cell" data-state="future" aria-hidden="true" /> Not placed yet
        </li>
        <li>
          <span className="sdv-idem__cell" data-state="open" aria-hidden="true" /> Waiting for a receipt
        </li>
        <li>
          <span className="sdv-idem__cell" data-state="paid" aria-hidden="true" /> Charged once, receipt read
        </li>
        <li>
          <span className="sdv-idem__cell" data-state="double" data-charges="2" aria-hidden="true" /> Charged
          twice or more
        </li>
        <li>
          <span className="sdv-idem__cell" data-state="unsure" aria-hidden="true" /> Gave up without a
          receipt, so the customer cannot tell
        </li>
      </ul>
      <p className="sdv-sim__note">
        Toy model, illustrative numbers. A client waits {CLIENT_TIMEOUT_MS / 1000} s for a receipt, then sends
        the same purchase again, up to {MAX_ATTEMPTS} attempts.
      </p>
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
        minMax={10}
        summary={chartSummary}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            The first time each thing happens in a lane, it appears here, numbered to match the chart.
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
