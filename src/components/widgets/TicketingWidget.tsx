import { useReducer, useRef, useState } from 'react';
import {
  countSeats,
  duelScenarioIds,
  phaseCounts,
  SEATS,
  type SeatView,
  seatView,
  summarize,
  TicketDuel,
  type TicketDuelId,
  type TicketLane,
  type TicketScenarioId,
  ticketScenarios,
} from '../../lib/models/ticketing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './TicketingWidget.css';

interface Props {
  duel: TicketDuelId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const seatIds = Array.from({ length: SEATS }, (_, seat) => seat);

const copy: Record<TicketDuelId, { title: string; instructions: string; chart: string }> = {
  oversell: {
    title: 'Same rush, two ways to claim a seat',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same buyers, who reach for the same seats in the same order. Only the database write differs.',
    chart: 'Seats promised to two or more buyers',
  },
  holds: {
    title: 'Same crowd, two hold rules',
    instructions:
      'Pick a scenario, then press Play. Both lanes get the same buyers, who pay or walk away at the same moments. Only the hold rules differ.',
    chart: 'Tickets sold, running total',
  },
};

function SeatGrid({ lane }: { lane: TicketLane }) {
  return (
    <div className="sdv-seats" aria-hidden="true">
      <div className="sdv-seats__stage">Stage</div>
      <div className="sdv-seats__grid">
        {seatIds.map((seat) => {
          const { view, holders } = seatView(lane, seat);
          return (
            <span key={seat} className="sdv-seat" data-view={view}>
              {view === 'sold' ? '✓' : view === 'doubled' ? holders : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LanePane({
  lane,
  variant,
  waitingRoom,
  holdsDuel,
}: {
  lane: TicketLane;
  variant: SeriesVariant;
  waitingRoom: boolean;
  holdsDuel: boolean;
}) {
  const seats = (view: SeatView) => countSeats(lane, view);
  const people = phaseCounts(lane);
  const seatParts = [`${seats('free')} free`, `${seats('held')} held by a buyer paying now`];
  if (holdsDuel) seatParts.push(`${seats('left')} held for a buyer who left`);
  seatParts.push(`${seats('sold')} sold`);
  if (!holdsDuel) seatParts.push(`${seats('doubled')} promised to 2+ buyers`);
  const peopleParts = [];
  if (waitingRoom) peopleParts.push(`${people.queued} in the waiting room`);
  peopleParts.push(
    `${people.choosing} picking a seat`,
    `${people.checkout} paying`,
    `${people.ticketed} with a ticket`,
  );
  if (holdsDuel) peopleParts.push(`${people.abandoned} walked away`, `${people.lost} lost their hold`);
  peopleParts.push(`${people.soldOut} told sold out`);
  return (
    <section className="sdv-duel__lane" aria-label={lane.config.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.config.label}
      </h4>
      <SeatGrid lane={lane} />
      <div className="sdv-seats__tally">
        <p>Seats: {seatParts.join(', ')}.</p>
        <p>Buyers: {peopleParts.join(', ')}.</p>
      </div>
    </section>
  );
}

export default function TicketingWidget({ duel: duelId, title, instructions }: Props) {
  const hydrated = useHydrated();
  const scenarios = duelScenarioIds[duelId];
  const [scenarioId, setScenarioId] = useState<TicketScenarioId>(scenarios[0] ?? 'rush');
  const duelRef = useRef<TicketDuel | null>(null);
  if (!duelRef.current) duelRef.current = new TicketDuel(ticketScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: TicketScenarioId) => {
    duelRef.current = new TicketDuel(ticketScenarios[id]);
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
  const chooseScenario = (id: TicketScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const holdsDuel = duelId === 'holds';
  const bankDelay = duel.scenario.workload.paymentSeconds !== undefined;
  const [first, second] = duel.lanes;
  const sums = [summarize(first), summarize(second)] as const;
  const seconds = duel.ticks * duel.tickSeconds;
  const runSeconds = duel.scenario.seconds;
  const text = copy[duelId];

  const rows: CompareRow[] = holdsDuel
    ? [
        { label: 'Buyers (same crowd)', values: [sums[0].arrived, sums[1].arrived] },
        { label: 'Tickets sold', values: [sums[0].ticketed, sums[1].ticketed], better: 'higher' },
        {
          label: 'Seats held for buyers who left',
          values: [sums[0].stuck, sums[1].stuck],
          better: 'lower',
        },
        { label: 'Holds released by expiry', values: [sums[0].released, sums[1].released] },
        ...(bankDelay
          ? [
              {
                label: 'Approved payments voided',
                values: [sums[0].voided, sums[1].voided],
                better: 'lower',
              } satisfies CompareRow,
            ]
          : []),
        { label: 'Buyers who walked away at checkout', values: [sums[0].abandoned, sums[1].abandoned] },
        { label: 'Buyers told sold out', values: [sums[0].soldOut, sums[1].soldOut], better: 'lower' },
      ]
    : [
        { label: 'Buyers (same crowd)', values: [sums[0].arrived, sums[1].arrived] },
        { label: `Tickets issued for ${SEATS} seats`, values: [sums[0].ticketed, sums[1].ticketed] },
        {
          label: 'Seats promised to two or more buyers',
          values: [sums[0].doubledSeats, sums[1].doubledSeats],
          better: 'lower',
        },
        { label: 'Writes rejected, then reread', values: [sums[0].rejected, sums[1].rejected] },
        {
          label: 'Peak database queries per second',
          values: [sums[0].peakQueries, sums[1].peakQueries],
          better: 'lower',
        },
        { label: 'Buyers told sold out', values: [sums[0].soldOut, sums[1].soldOut] },
      ];

  const describeLane = (lane: TicketLane, index: 0 | 1) => {
    const sum = sums[index];
    return holdsDuel
      ? bankDelay
        ? `${lane.config.label}: ${sum.ticketed} tickets sold, ${sum.voided} approved payments voided`
        : `${lane.config.label}: ${sum.ticketed} tickets sold, ${sum.stuck} seats held for buyers who left`
      : `${lane.config.label}: ${sum.ticketed} tickets for ${SEATS} seats, ${sum.doubledSeats} seats promised to 2+ buyers`;
  };
  const summary = `${seconds.toFixed(1)} s of ${runSeconds} s. ${describeLane(first, 0)}. ${describeLane(second, 1)}.`;
  const latest = (lane: TicketLane) => lane.state.series.at(-1) ?? 0;
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
          caption="Whole run so far, same buyers for both"
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
          label: ticketScenarios[id].label,
          diff: ticketScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane
            key={lane.config.label}
            lane={lane}
            variant={variants[index] ?? 'a'}
            waitingRoom={duel.scenario.admitPerSecond !== null}
            holdsDuel={holdsDuel}
          />
        ))}
      </div>
      <ul className="sdv-qtracks__legend sdv-seats__legend" aria-label="How to read the seat maps">
        <li>
          <span className="sdv-seat" data-view="free" aria-hidden="true" /> Free
        </li>
        <li>
          <span className="sdv-seat" data-view="held" aria-hidden="true" /> Held, buyer paying
        </li>
        {holdsDuel && (
          <li>
            <span className="sdv-seat" data-view="left" aria-hidden="true" /> Held, buyer left
          </li>
        )}
        <li>
          <span className="sdv-seat" data-view="sold" aria-hidden="true">
            ✓
          </span>{' '}
          Sold
        </li>
        {!holdsDuel && (
          <li>
            <span className="sdv-seat" data-view="doubled" aria-hidden="true">
              2
            </span>{' '}
            Promised to this many buyers
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
        minMax={holdsDuel ? SEATS : 10}
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
