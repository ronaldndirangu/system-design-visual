import { useReducer, useRef, useState } from 'react';
import {
  type SamplingDuelId,
  SamplingRun,
  type SamplingTotals,
  samplingScenarios,
} from '../../lib/models/observability';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { chartMarkers, RunTranscript } from './RunTranscript';

interface Props {
  scenarios?: SamplingDuelId[];
  initial?: SamplingDuelId;
  title?: string;
  instructions?: string;
}

const variants: SeriesVariant[] = ['a', 'b'];

const chartTitles = {
  errorsKept: 'Failed requests with a stored trace you can open',
  kept: 'Traces stored',
} as const;

const count = (value: number) => value.toLocaleString('en-US');
const share = (part: number, whole: number) => (whole > 0 ? `${count(part)} of ${count(whole)}` : 'none yet');

function LanePane({
  totals,
  peak,
  label,
  variant,
}: {
  totals: SamplingTotals;
  peak: number;
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
        label={`${label}: what you can still open later`}
        flagFull={false}
        bars={[
          {
            id: 'errors',
            label: 'Failed requests with a trace',
            fill: totals.errors > 0 ? totals.errorsKept / totals.errors : 0,
            value: share(totals.errorsKept, totals.errors),
          },
          {
            id: 'slow',
            label: 'Slow requests (over 1 s) with a trace',
            fill: totals.slow > 0 ? totals.slowKept / totals.slow : 0,
            value: share(totals.slowKept, totals.slow),
          },
          {
            id: 'all',
            label: 'All finished requests with a trace',
            fill: totals.completed > 0 ? totals.kept / totals.completed : 0,
            value: share(totals.kept, totals.completed),
          },
        ]}
      />
      <p className="sdv-sim__note">
        Failed or slow requests dropped: {count(totals.missed)}. Finished requests awaiting a decision:{' '}
        {count(totals.pending)}. Spans held in memory: {count(totals.buffered)} now, {count(peak)} at the peak
      </p>
    </section>
  );
}

export default function SamplingDuelWidget({
  scenarios = ['incident', 'quiet', 'budget'],
  initial,
  title = 'Head sampling against tail sampling',
  instructions = 'Pick a scenario, then press Play. Both samplers watch the exact same requests and may store the same share of them. Head sampling flips a coin when a request starts; tail sampling waits for the request to finish, then fills its quota with failures first.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<SamplingDuelId>(initial ?? scenarios[0] ?? 'incident');
  const runRef = useRef<SamplingRun | null>(null);
  runRef.current ??= new SamplingRun(samplingScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((ticks: number) => ticks + 1, 0);

  const restart = (id: SamplingDuelId) => {
    runRef.current = new SamplingRun(samplingScenarios[id]);
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
  const chooseScenario = (id: SamplingDuelId) => {
    setScenarioId(id);
    restart(id);
  };

  const scenario = run.scenario;
  const names = run.labels;
  const totals = run.totals();
  const seconds = run.ticks * run.tickSeconds;
  const total = run.result.config.seconds;

  const baseRows: CompareRow[] = [
    { label: 'Requests finished (same traffic)', values: totals.map((t) => t.completed) },
    { label: 'Traces stored', values: totals.map((t) => t.kept) },
    {
      label: 'Share of decided requests stored',
      values: totals.map((t) => (t.kept + t.dropped > 0 ? t.kept / (t.kept + t.dropped) : 0)),
      format: (value) => `${(value * 100).toFixed(1)}%`,
    },
    { label: 'Failed requests you can open', values: totals.map((t) => t.errorsKept), better: 'higher' },
    { label: 'Slow requests you can open', values: totals.map((t) => t.slowKept), better: 'higher' },
    { label: 'Failed or slow requests dropped', values: totals.map((t) => t.missed), better: 'lower' },
    { label: 'Spans written to storage', values: totals.map((t) => t.spansStored), better: 'lower' },
    {
      label: 'Peak spans held awaiting a decision',
      values: [run.peaks[0], run.peaks[1]],
      better: 'lower',
    },
  ];
  const rows = baseRows.map((row) => ({ format: count, ...row }));

  const chartTitle = chartTitles[scenario.chart];
  const chartSummary = `${chartTitle}. ${names
    .map((name, index) => {
      const values = run.series[index as 0 | 1];
      return `${name} now ${values.at(-1) ?? 0}`;
    })
    .join('. ')}.`;

  const [a, b] = totals;
  const summary = `${seconds.toFixed(1)} s of ${total} s. ${names[0]}: kept ${count(a.kept)} traces, ${share(a.errorsKept, a.errors)} failures. ${names[1]}: kept ${count(b.kept)} traces, ${share(b.errorsKept, b.errors)} failures.`;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${total} s` } as const);

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
        <CompareTable caption="Whole run so far, same requests for both" columns={names} rows={rows} />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: samplingScenarios[id].label,
          diff: samplingScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {totals.map((lane, index) => (
          <LanePane
            key={names[index]}
            totals={lane}
            peak={run.peaks[index as 0 | 1]}
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
        minMax={10}
        summary={chartSummary}
      />
      <RunTranscript events={run.events} tickSeconds={run.tickSeconds} />
    </SimulationShell>
  );
}
