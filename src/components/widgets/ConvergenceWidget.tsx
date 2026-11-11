import { useReducer, useRef, useState } from 'react';
import {
  ConvergenceDuel,
  type ConvergenceScenarioId,
  type CopyName,
  convergenceScenarios,
  copyLabels,
  copyNames,
  type Tile,
} from '../../lib/models/collabEditor';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './ConvergenceWidget.css';

interface Props {
  scenarios?: ConvergenceScenarioId[];
  initial?: ConvergenceScenarioId;
  title?: string;
  instructions?: string;
}

type Lane = ConvergenceDuel['lanes'][number];

const variants: SeriesVariant[] = ['a', 'b'];

const quoted = (text: string) => (text === '' ? 'empty' : `"${text}"`);

function laneBadge(lane: Lane) {
  if (lane.matches) return <ToneBadge tone="ok">Copies match</ToneBadge>;
  if (lane.inFlightCount + lane.waiting > 0) return <ToneBadge tone="warn">Copies differ for now</ToneBadge>;
  return <ToneBadge tone="bad">Copies differ</ToneBadge>;
}

function laneState(lane: Lane): string {
  if (lane.matches) return 'copies match';
  return lane.inFlightCount + lane.waiting > 0 ? 'copies differ while ops travel' : 'copies differ';
}

function TileRow({ name, tiles, idCaption }: { name: CopyName; tiles: Tile[]; idCaption: string }) {
  return (
    <ol className="sdv-converge__tiles" aria-label={`${copyLabels[name]}'s characters with ${idCaption}`}>
      {tiles.map((tile) => (
        <li key={tile.key} className="sdv-converge__tile" data-deleted={tile.deleted ? '' : undefined}>
          <span className="sdv-converge__char">{tile.char}</span>
          <span className="sdv-converge__id">{tile.label}</span>
          {tile.deleted && <span className="sdv-converge__gone">deleted</span>}
        </li>
      ))}
    </ol>
  );
}

function CopyPane({ lane, name }: { lane: Lane; name: CopyName }) {
  const held = lane.waitingLabels(name);
  return (
    <div className="sdv-converge__copy">
      <p className="sdv-converge__copy-head">
        <strong>{copyLabels[name]}'s copy</strong> reads {quoted(lane.text(name))}
      </p>
      <TileRow
        name={name}
        tiles={lane.copies[name].tiles()}
        idCaption={lane.kind === 'crdt' ? 'their ids' : 'their positions'}
      />
      {held.length > 0 && (
        <ul className="sdv-converge__held" aria-label={`Held by ${copyLabels[name]}'s copy`}>
          {held.map((label) => (
            <li key={label}>Buffered: {label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Wire({ lane }: { lane: Lane }) {
  const toBen = lane.inFlight('ben');
  const toAda = lane.inFlight('ada');
  return (
    <div className="sdv-converge__wire">
      {toBen.length + toAda.length === 0 ? (
        <p className="sdv-converge__quiet">Nothing in flight</p>
      ) : (
        <ul aria-label={`Ops in flight in ${lane.label}`}>
          {toBen.map((message) => (
            <li key={`ben-${message.seq}`} className="sdv-converge__msg">
              <span className="sdv-converge__dir" aria-hidden="true">
                ↓
              </span>
              To Ben: {message.label}
            </li>
          ))}
          {toAda.map((message) => (
            <li key={`ada-${message.seq}`} className="sdv-converge__msg">
              <span className="sdv-converge__dir" aria-hidden="true">
                ↑
              </span>
              To Ada: {message.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LanePane({ lane, variant }: { lane: Lane; variant: SeriesVariant }) {
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <div className="sdv-converge__lane-head">
        <h4 className="sdv-duel__lane-title">
          <SeriesSwatch variant={variant} />
          {lane.label}
        </h4>
        {laneBadge(lane)}
      </div>
      <CopyPane lane={lane} name="ada" />
      <Wire lane={lane} />
      <CopyPane lane={lane} name="ben" />
    </section>
  );
}

export default function ConvergenceWidget({
  scenarios = ['same-spot', 'insert-delete', 'reordered'],
  initial,
  title = 'Two copies, two sync designs',
  instructions = 'Toy model: Ada and Ben edit one short word at the same moment. Pick a scenario, guess the final text, then press Play or Step. Both designs get the same edits and the same network; only the way an op names its spot differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<ConvergenceScenarioId>(initial ?? scenarios[0] ?? 'same-spot');
  const duelRef = useRef<ConvergenceDuel | null>(null);
  if (!duelRef.current) duelRef.current = new ConvergenceDuel(convergenceScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: ConvergenceScenarioId) => {
    duelRef.current = new ConvergenceDuel(convergenceScenarios[id]);
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
  const chooseScenario = (id: ConvergenceScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = duel.lanes;
  const both = <T,>(read: (lane: Lane) => T): [T, T] => [read(first), read(second)];
  const textRow = (name: CopyName): CompareRow => ({
    label: `${copyLabels[name]}'s copy reads`,
    values: [0, 0],
    format: (_value, column) => quoted((column === 0 ? first : second).text(name)),
  });

  const rows: CompareRow[] = [
    ...copyNames.map(textRow),
    {
      label: 'Copies match',
      values: both((lane) => (lane.matches ? 1 : 0)),
      format: (value) => (value === 1 ? 'Yes' : 'No'),
      better: duel.done ? 'higher' : undefined,
    },
    { label: 'Ops sent (same edits)', values: both((lane) => lane.sent) },
    { label: 'Ops applied by the other copy', values: both((lane) => lane.applied) },
    { label: 'Ops buffered, waiting for a missing op', values: both((lane) => lane.waiting) },
    { label: 'Ops still in flight', values: both((lane) => lane.inFlightCount) },
    { label: 'Tombstones kept, both copies', values: both((lane) => lane.tombstones) },
    {
      label: 'Characters that differ between copies',
      values: both((lane) => lane.differing),
      better: duel.done ? 'lower' : undefined,
    },
  ];

  const chartTitle = 'Characters that differ between Ada and Ben (one step per second at 1×)';
  const chartSummary = `${chartTitle}. ${first.label} now ${first.differing}. ${second.label} now ${second.differing}.`;

  const laneSentence = (lane: Lane) =>
    `${lane.label}: Ada ${quoted(lane.text('ada'))}, Ben ${quoted(lane.text('ben'))}, ${laneState(lane)}`;
  const summary = `Step ${duel.ticks} of ${duel.length}. ${laneSentence(first)}. ${laneSentence(second)}.`;

  const steps = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `Step ${duel.ticks} of ${duel.length}` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      ticksPerSecond={1}
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
          caption="Same edits, same network. Every op sent is applied, buffered, or still in flight."
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
          label: convergenceScenarios[id].label,
          diff: convergenceScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.kind} lane={lane} variant={variants[index] ?? 'a'} />
        ))}
      </div>
      <ul className="sdv-legend sdv-converge__legend" aria-label="How to read the copies">
        <li>
          <span className="sdv-converge__tile sdv-converge__tile--key" aria-hidden="true">
            <span className="sdv-converge__char">x</span>
            <span className="sdv-converge__id">a3</span>
          </span>
          A character over its position (Index positions) or its id (CRDT ids). a3 means site a (Ada), counter
          3; b ids come from Ben.
        </li>
        <li>
          <span className="sdv-converge__tile sdv-converge__tile--key" data-deleted="" aria-hidden="true">
            <span className="sdv-converge__char">x</span>
            <span className="sdv-converge__id">a3</span>
          </span>
          Hatched and struck through: deleted, kept as a tombstone so later ops can still find it
        </li>
        <li>
          <span className="sdv-converge__msg sdv-converge__msg--key" aria-hidden="true">
            ↓
          </span>
          An op in flight to the other copy
        </li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={1}
        markers={steps.map((event, index) => ({ tick: event.tick + 1, number: index + 1 }))}
        minMax={4}
        summary={chartSummary}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {steps.length === 0 && (
          <p className="sdv-trace__empty">
            Each edit and each delivery appears here, numbered to match the chart.
          </p>
        )}
        {steps.length > 0 && (
          <ol>
            {steps.map((event) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {event.tick + 1}
                </span>
                {event.text}
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
