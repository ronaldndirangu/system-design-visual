import { useReducer, useRef, useState } from 'react';
import {
  type DuelId,
  duelScenarios,
  type LaneSummary,
  LimiterRun,
  type RateLimitModel,
  type ReadoutKey,
  summarize,
} from '../../lib/models/rateLimit';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { chartMarkers, RunTranscript } from './RunTranscript';
import './RateLimitDuelWidget.css';

interface Props {
  scenarios?: DuelId[];
  initial?: DuelId;
  title?: string;
  instructions?: string;
}

const variants: SeriesVariant[] = ['a', 'b'];

const chartTitles = {
  politeTrouble: 'Polite requests that failed or got 429, per second',
  serverLoad: 'Requests admitted to the server, per second',
  rejections: '429 responses, per second',
  allowance: 'Tokens in the bucket',
} as const;

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : 'none yet';
const count = (value: number) => value.toLocaleString('en-US');

function readoutRow(key: ReadoutKey, sums: LaneSummary[]): CompareRow {
  const values = (pick: (s: LaneSummary) => number) => sums.map(pick);
  switch (key) {
    case 'politeServed':
      return {
        label: 'Polite clients served',
        values: values((s) => s.politeServed),
        format: (value, column) => `${count(value)} (${pct(value, sums[column]?.politeArrived ?? 0)})`,
        better: 'higher',
      };
    case 'politeFailed':
      return {
        label: 'Polite requests shed with 503',
        values: values((s) => s.politeFailed),
        better: 'lower',
      };
    case 'politeWait':
      return {
        label: 'Average queue wait, polite clients',
        values: values((s) => s.politeWait * 1000),
        format: (value) => `${Math.round(value)} ms`,
        better: 'lower',
      };
    case 'noisyLimited':
      return { label: 'Client A requests that got 429', values: values((s) => s.noisyLimited) };
    case 'peakLoad':
      return {
        label: 'Busiest second at the server (capacity 300)',
        values: values((s) => s.peakLoad),
        better: 'lower',
      };
    case 'served':
      return { label: 'Served', values: values((s) => s.served), better: 'higher' };
    case 'gaveUp':
      return {
        label: 'Gave up after 3 retries',
        values: values((s) => s.limited),
        better: 'lower',
      };
    case 'rejections':
      return { label: '429 responses sent', values: values((s) => s.rejections), better: 'lower' };
    case 'attempts':
      return {
        label: 'Attempts, counting retries',
        values: values((s) => s.attempts),
        better: 'lower',
      };
    case 'limited':
      return { label: 'Got 429 in the end', values: values((s) => s.limited), better: 'lower' };
  }
}

function LanePane({
  model,
  label,
  variant,
}: {
  model: RateLimitModel;
  label: string;
  variant: SeriesVariant;
}) {
  const clients = model.config.clients;
  const totals = model.clientTotals();
  return (
    <section className="sdv-duel__lane" aria-label={label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {label}
      </h4>
      <LoadBars
        label={`${label}: share of each client\u2019s requests served`}
        flagFull={false}
        bars={clients.map((client, index) => {
          const t = totals[index];
          const arrived = t?.arrived ?? 0;
          const served = t?.served ?? 0;
          const trouble = (t?.failed ?? 0) + (t?.limited ?? 0);
          return {
            id: client.id,
            label: `Client ${client.label}${client.polite ? '' : ' (the noisy one)'}, now ${model.rateOf(index)} req/s`,
            fill: arrived > 0 ? served / arrived : 0,
            value:
              arrived > 0
                ? `${pct(served, arrived)} served${trouble > 0 ? `, ${trouble} turned away` : ''}`
                : 'Waiting',
            down: client.polite && (t?.failed ?? 0) > 0,
          };
        })}
      />
      <p className="sdv-ratelimit__load">Waiting now, in the server queue or to retry: {model.inFlight()}</p>
    </section>
  );
}

export default function RateLimitDuelWidget({
  scenarios = ['noisy', 'calm'],
  initial,
  title = 'Same traffic, two policies',
  instructions = 'Pick a scenario, then press Play. Both sides replay the exact same requests; only the limiter differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<DuelId>(initial ?? scenarios[0] ?? 'noisy');
  const runRef = useRef<LimiterRun | null>(null);
  runRef.current ??= new LimiterRun(duelScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: DuelId) => {
    runRef.current = new LimiterRun(duelScenarios[id]);
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
  const chooseScenario = (id: DuelId) => {
    setScenarioId(id);
    restart(id);
  };

  const scenario = run.scenario;
  const names = scenario.lanes.map((lane) => lane.label);
  const sums = run.lanes.map(summarize);
  const seconds = run.ticks * run.tickSeconds;

  const rows: CompareRow[] = [
    { label: 'Requests in (same traffic)', values: sums.map((s) => s.arrived) },
    ...scenario.readout.map((key) => readoutRow(key, sums)),
  ].map((row) => ({ format: count, ...row }));

  const chartTitle = chartTitles[scenario.chart];
  const chartSummary = `${chartTitle}. ${names
    .map((name, index) => {
      const values = run.series[index] ?? [];
      return `${name} now ${values.at(-1) ?? 0}, peak ${values.length ? Math.max(...values) : 0}`;
    })
    .join('. ')}.`;

  const first = rows[1];
  const laneLine = (index: number) => {
    const value = first?.values[index] ?? 0;
    return `${names[index]}: ${first?.label.toLowerCase()} ${first?.format ? first.format(value, index) : value}`;
  };
  const summary = `${seconds.toFixed(1)} s of ${scenario.seconds} s. ${names.map((_, index) => laneLine(index)).join('. ')}.`;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${scenario.seconds} s` } as const);

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
          label: duelScenarios[id].label,
          diff: duelScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-duel__lanes">
        {run.lanes.map((model, index) => (
          <LanePane
            key={names[index]}
            model={model}
            label={names[index] ?? ''}
            variant={variants[index] ?? 'a'}
          />
        ))}
      </div>
      <TraceChart
        title={chartTitle}
        series={run.lanes.map((_, index) => ({
          label: names[index] ?? '',
          values: run.series[index] ?? [],
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
