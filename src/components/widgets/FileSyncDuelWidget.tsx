import { useReducer, useRef, useState } from 'react';
import {
  type FileSyncDuelId,
  FileSyncRun,
  type FileSyncTotals,
  fileSyncScenarios,
} from '../../lib/models/fileSync';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { chartMarkers, RunTranscript } from './RunTranscript';

interface Props {
  scenarios?: FileSyncDuelId[];
  initial?: FileSyncDuelId;
  title?: string;
  instructions?: string;
}

const variants: SeriesVariant[] = ['a', 'b'];
const chartTitle = 'Upload progress, MB of the file';

const count = (value: number) => value.toLocaleString('en-US');

function LanePane({
  totals,
  fileMb,
  label,
  variant,
}: {
  totals: FileSyncTotals;
  fileMb: number;
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
        label={`${label}: upload state`}
        flagFull={false}
        bars={[
          {
            id: 'progress',
            label: 'File uploaded or already on the server',
            fill: totals.progressMb / fileMb,
            value: `${count(totals.progressMb)} of ${count(fileMb)} MB`,
          },
          {
            id: 'wasted',
            label: 'Sent bytes lost to link drops',
            fill: totals.sentMb > 0 ? totals.wastedMb / totals.sentMb : 0,
            value: `${count(totals.wastedMb)} of ${count(totals.sentMb)} MB`,
          },
        ]}
      />
      <p className="sdv-sim__note">
        Requests: {count(totals.requests)}. Link drops while uploading: {count(totals.drops)}. Skipped because
        the server already had it: {count(totals.skippedMb)} MB
      </p>
    </section>
  );
}

export default function FileSyncDuelWidget({
  scenarios = ['flaky', 'edit', 'tiny'],
  initial,
  title = 'Whole-file upload against hashed blocks',
  instructions = 'Pick a scenario, then press Play. Both clients upload the same file over the same link, and the link drops at the same moments for both. One sends the file in a single request. The other hashes it into 4 MB blocks, asks the server which blocks it lacks, and sends only those.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<FileSyncDuelId>(initial ?? scenarios[0] ?? 'flaky');
  const runRef = useRef<FileSyncRun | null>(null);
  runRef.current ??= new FileSyncRun(fileSyncScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((ticks: number) => ticks + 1, 0);

  const restart = (id: FileSyncDuelId) => {
    runRef.current = new FileSyncRun(fileSyncScenarios[id]);
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
  const chooseScenario = (id: FileSyncDuelId) => {
    setScenarioId(id);
    restart(id);
  };

  const scenario = run.scenario;
  const names = run.labels;
  const totals = run.totals();
  const seconds = run.ticks * run.tickSeconds;
  const finishLabel = (column: number) => {
    const at = totals[column]?.finishedAt;
    if (at != null) return `${at.toFixed(1)} s`;
    return run.done ? 'Not finished' : 'Still uploading';
  };

  const baseRows: CompareRow[] = [
    {
      label: 'Upload finished after',
      values: totals.map((t) => t.finishedAt ?? seconds),
      format: (_value, column) => finishLabel(column),
      better: 'lower',
    },
    { label: 'MB sent over the link', values: totals.map((t) => t.sentMb), better: 'lower' },
    { label: 'MB lost to link drops', values: totals.map((t) => t.wastedMb), better: 'lower' },
    { label: 'MB the server already had', values: totals.map((t) => t.skippedMb), better: 'higher' },
    { label: 'Requests', values: totals.map((t) => t.requests), better: 'lower' },
    { label: 'Link drops while uploading', values: totals.map((t) => t.drops) },
  ];
  const rows = baseRows.map((row) => ({ format: count, ...row }));

  const chartSummary = `${chartTitle}. ${names
    .map((name, index) => `${name} now ${run.series[index as 0 | 1].at(-1) ?? 0} MB`)
    .join('. ')}.`;

  const [a, b] = totals;
  const summary = `${seconds.toFixed(1)} s. ${names[0]}: ${count(a.progressMb)} of ${scenario.fileMb} MB, ${count(a.sentMb)} MB sent. ${names[1]}: ${count(b.progressMb)} of ${scenario.fileMb} MB, ${count(b.sentMb)} MB sent.`;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s` } as const);

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
        <CompareTable caption="Whole run so far, same file and link for both" columns={names} rows={rows} />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: fileSyncScenarios[id].label,
          diff: fileSyncScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {totals.map((lane, index) => (
          <LanePane
            key={names[index]}
            totals={lane}
            fileMb={scenario.fileMb}
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
        minMax={scenario.fileMb}
        summary={chartSummary}
      />
      <RunTranscript events={run.events} tickSeconds={run.tickSeconds} />
    </SimulationShell>
  );
}
