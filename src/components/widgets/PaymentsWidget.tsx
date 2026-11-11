import { useReducer, useRef, useState } from 'react';
import {
  duelScenarioIds,
  GRID_COLS,
  PAYMENTS,
  PayDuel,
  type PayDuelId,
  type PayLane,
  type PayScenarioId,
  type PaySummary,
  payScenarios,
  summarize,
  tileView,
} from '../../lib/models/payments';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './PaymentsWidget.css';

interface Props {
  duel: PayDuelId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const paymentIds = Array.from({ length: PAYMENTS }, (_, id) => id);
const dollars = (value: number) => `$${value.toLocaleString('en-US')}`;

const copy: Record<PayDuelId, { title: string; instructions: string; chart: string }> = {
  retries: {
    title: 'Same shoppers, two ways to retry',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same 120 payments and the same bank delays. Only the retry differs: one resends a fresh request, the other resends the same idempotency key.',
    chart: 'Shoppers charged more than once',
  },
  reconcile: {
    title: 'Same outage, two ways to settle the books',
    instructions:
      'Pick a scenario, then press Play. Both lanes retry with an idempotency key and give up after 3 attempts. Only one compares its ledger with the bank every 10 s.',
    chart: 'Payments with an unknown outcome',
  },
};

function CardGrid({ lane }: { lane: PayLane }) {
  return (
    <div
      className="sdv-paygrid"
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
    >
      {paymentIds.map((id) => {
        const { view, charges } = tileView(lane, id);
        return (
          <span key={id} className="sdv-paytile" data-view={view}>
            {view === 'paid'
              ? '✓'
              : view === 'doubled'
                ? `×${charges}`
                : view === 'unknown'
                  ? '?'
                  : view === 'failed'
                    ? '✕'
                    : ''}
          </span>
        );
      })}
    </div>
  );
}

function LanePane({
  lane,
  sum,
  variant,
  retriesDuel,
}: {
  lane: PayLane;
  sum: PaySummary;
  variant: SeriesVariant;
  retriesDuel: boolean;
}) {
  const parts = [
    `${sum.paid} paid`,
    `${sum.inFlight} in flight`,
    `${sum.unknown} unknown`,
    `${sum.failed} failed`,
  ];
  return (
    <section className="sdv-duel__lane" aria-label={lane.config.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.config.label}
      </h4>
      <CardGrid lane={lane} />
      <div className="sdv-paygrid__tally">
        <p>Ledger: {parts.join(', ')}.</p>
        {retriesDuel && (
          <p>
            Charged twice or more: {sum.doubled} {sum.doubled === 1 ? 'shopper' : 'shoppers'}.
          </p>
        )}
        <p>
          Bank took {dollars(sum.bankDollars)}, ledger recorded {dollars(sum.ledgerDollars)}.
        </p>
      </div>
    </section>
  );
}

export default function PaymentsWidget({ duel: duelId, title, instructions }: Props) {
  const hydrated = useHydrated();
  const scenarios = duelScenarioIds[duelId];
  const [scenarioId, setScenarioId] = useState<PayScenarioId>(scenarios[0] ?? 'slow-bank');
  const duelRef = useRef<PayDuel | null>(null);
  if (!duelRef.current) duelRef.current = new PayDuel(payScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: PayScenarioId) => {
    duelRef.current = new PayDuel(payScenarios[id]);
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
  const chooseScenario = (id: PayScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const retriesDuel = duelId === 'retries';
  const [first, second] = duel.lanes;
  const sums = [summarize(first, duel.payments), summarize(second, duel.payments)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const runSeconds = duel.scenario.seconds;
  const text = copy[duelId];
  const money = (value: number) => dollars(value);

  const rows: CompareRow[] = retriesDuel
    ? [
        { label: 'Payments (same shoppers)', values: [sums[0].arrived, sums[1].arrived] },
        { label: 'Paid, per the ledger', values: [sums[0].paid, sums[1].paid] },
        { label: 'Charges at the bank', values: [sums[0].bankCharges, sums[1].bankCharges], better: 'lower' },
        {
          label: 'Shoppers charged twice or more',
          values: [sums[0].doubled, sums[1].doubled],
          better: 'lower',
        },
        {
          label: 'Extra money taken',
          values: [sums[0].extraDollars, sums[1].extraDollars],
          format: money,
          better: 'lower',
        },
        { label: 'Retries sent', values: [sums[0].retries, sums[1].retries] },
        { label: 'Retries answered from the key store', values: [sums[0].deduped, sums[1].deduped] },
        { label: 'Unknown after 3 attempts', values: [sums[0].unknown, sums[1].unknown] },
        {
          label: 'Bank took more than the ledger shows',
          values: [sums[0].gapDollars, sums[1].gapDollars],
          format: money,
          better: 'lower',
        },
      ]
    : [
        { label: 'Payments (same shoppers)', values: [sums[0].arrived, sums[1].arrived] },
        { label: 'Paid, per the ledger', values: [sums[0].paid, sums[1].paid], better: 'higher' },
        { label: 'Unknown outcome now', values: [sums[0].unknown, sums[1].unknown], better: 'lower' },
        { label: 'Completed by reconciliation', values: [sums[0].recovered, sums[1].recovered] },
        { label: 'Confirmed failed, shopper can pay again', values: [sums[0].failed, sums[1].failed] },
        { label: 'Retries sent', values: [sums[0].retries, sums[1].retries] },
        {
          label: 'Bank took more than the ledger shows',
          values: [sums[0].gapDollars, sums[1].gapDollars],
          format: money,
          better: 'lower',
        },
      ];

  const describeLane = (lane: PayLane, index: 0 | 1) => {
    const sum = sums[index];
    return retriesDuel
      ? `${lane.config.label}: ${sum.paid} paid, ${sum.doubled} shoppers charged twice or more, ${dollars(sum.extraDollars)} extra taken`
      : `${lane.config.label}: ${sum.paid} paid, ${sum.unknown} unknown, bank took ${dollars(sum.gapDollars)} more than the ledger shows`;
  };
  const summary = `${seconds.toFixed(1)} s of ${runSeconds} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;
  const latest = (lane: PayLane) => lane.state.series.at(-1) ?? 0;
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
          caption="Whole run so far, same shoppers and bank for both"
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
          label: payScenarios[id].label,
          diff: payScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.config.label}
            lane={lane}
            sum={sums[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
            retriesDuel={retriesDuel}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend sdv-paygrid__legend" aria-label="How to read the payment grids">
        <li>
          <span className="sdv-paytile" data-view="pending" aria-hidden="true" /> Waiting on the bank or a
          retry
        </li>
        <li>
          <span className="sdv-paytile" data-view="paid" aria-hidden="true">
            ✓
          </span>{' '}
          Paid once
        </li>
        {retriesDuel && (
          <li>
            <span className="sdv-paytile" data-view="doubled" aria-hidden="true">
              ×2
            </span>{' '}
            Charged this many times
          </li>
        )}
        <li>
          <span className="sdv-paytile" data-view="unknown" aria-hidden="true">
            ?
          </span>{' '}
          Unknown: gave up after 3 attempts
        </li>
        {!retriesDuel && (
          <li>
            <span className="sdv-paytile" data-view="failed" aria-hidden="true">
              ✕
            </span>{' '}
            Failed, no charge at the bank
          </li>
        )}
      </ul>
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
