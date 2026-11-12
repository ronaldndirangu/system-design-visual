import { useReducer, useRef, useState } from 'react';
import {
  KV_N,
  KV_R,
  KV_W,
  type KvStoreDuelId,
  KvStoreRun,
  type KvStoreTotals,
  kvStoreScenarios,
} from '../../lib/models/kvStore';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { chartMarkers, RunTranscript } from './RunTranscript';

interface Props {
  scenarios?: KvStoreDuelId[];
  initial?: KvStoreDuelId;
  title?: string;
  instructions?: string;
}

const variants: SeriesVariant[] = ['a', 'b'];
const chartTitle = 'Requests refused or answered stale, per second';

const count = (value: number) => value.toLocaleString('en-US');

function LanePane({
  totals,
  label,
  variant,
}: {
  totals: KvStoreTotals;
  label: string;
  variant: SeriesVariant;
}) {
  return (
    <section className="sdv-duel__lane" aria-label={label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {label}
      </h4>
      <LoadBars
        label={`${label}: home keys each node holds an old copy of`}
        flagFull={false}
        bars={totals.nodes.map((node) => ({
          id: node.id,
          label: `Node ${node.label}${node.down ? ' (down)' : ''}`,
          fill: node.owned > 0 ? node.behind / node.owned : 0,
          value: `${count(node.behind)} of ${count(node.owned)} behind`,
          down: node.down,
        }))}
      />
      <p className="sdv-sim__note">
        Hints waiting: {count(totals.hintsPending)}. Hints replayed: {count(totals.hintsDelivered)}. Read
        repairs: {count(totals.readRepairs)}
      </p>
    </section>
  );
}

export default function KvStoreDuelWidget({
  scenarios = ['two-down', 'one-down', 'slow-handoff'],
  initial,
  title = 'Strict quorum against sloppy quorum with hinted handoff',
  instructions = `Pick a scenario, then press Play. Five nodes share 300 keys, each stored on ${KV_N} home nodes, and every write needs ${KV_W} acknowledgements and every read ${KV_R} answers. Both clusters take the same requests and lose the same nodes. The strict lane counts only home nodes. The sloppy lane borrows the next healthy node on the ring and replays a hint when the home node returns.`,
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<KvStoreDuelId>(initial ?? scenarios[0] ?? 'two-down');
  const runRef = useRef<KvStoreRun | null>(null);
  runRef.current ??= new KvStoreRun(kvStoreScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((ticks: number) => ticks + 1, 0);

  const restart = (id: KvStoreDuelId) => {
    runRef.current = new KvStoreRun(kvStoreScenarios[id]);
    rerender();
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    rerender();
  };
  const chooseScenario = (id: KvStoreDuelId) => {
    setScenarioId(id);
    restart(id);
  };

  const names = run.labels;
  const totals = run.totals();
  const seconds = run.ticks * run.tickSeconds;

  const baseRows: CompareRow[] = [
    { label: 'Writes accepted', values: totals.map((t) => t.writes), better: 'higher' },
    { label: 'Writes refused', values: totals.map((t) => t.writesRefused), better: 'lower' },
    { label: 'Reads refused', values: totals.map((t) => t.readsRefused), better: 'lower' },
    { label: 'Stale reads', values: totals.map((t) => t.staleReads), better: 'lower' },
    { label: 'Stale reads after the return', values: totals.map((t) => t.staleAfterReturn), better: 'lower' },
    { label: 'Hints still waiting', values: totals.map((t) => t.hintsPending), better: 'lower' },
    { label: 'Read repairs', values: totals.map((t) => t.readRepairs) },
  ];
  const rows = baseRows.map((row) => ({ format: count, ...row }));

  const chartSummary = `${chartTitle}. ${names
    .map((name, index) => `${name} now ${run.series[index as 0 | 1].at(-1) ?? 0}`)
    .join('. ')}.`;

  const [a, b] = totals;
  const failed = (t: KvStoreTotals) => t.writesRefused + t.readsRefused;
  const summary = `${seconds} s. ${names[0]}: ${count(failed(a))} refused, ${count(a.staleReads)} stale. ${names[1]}: ${count(failed(b))} refused, ${count(b.staleReads)} stale.`;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={scenarioId}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same requests and outage for both"
          columns={names}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: kvStoreScenarios[id].label,
          diff: kvStoreScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {totals.map((lane, index) => (
          <LanePane
            key={names[index]}
            totals={lane}
            label={names[index as 0 | 1]}
            variant={variants[index] ?? 'a'}
          />
        ))}
      </div>
      <TraceChart
        title={chartTitle}
        series={names.map((name, index) => ({
          label: name,
          values: run.series[index as 0 | 1],
          variant: variants[index] ?? 'a',
        }))}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={chartMarkers(run.events)}
        minMax={30}
        summary={chartSummary}
      />
      <RunTranscript events={run.events} tickSeconds={run.tickSeconds} />
    </SimulationShell>
  );
}
