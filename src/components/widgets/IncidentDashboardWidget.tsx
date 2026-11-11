import { useReducer, useRef, useState } from 'react';
import {
  type IncidentId,
  IncidentRun,
  incidentScenarios,
  type TickPoint,
} from '../../lib/models/observability';
import { Segmented } from '../sim/controls';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import type { StatRow } from '../sim/StatTable';
import { TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { chartMarkers, RunTranscript } from './RunTranscript';
import './IncidentDashboardWidget.css';

type View = 'red' | 'use';

interface Props {
  scenarios?: IncidentId[];
  initial?: IncidentId;
  initialView?: View;
  title?: string;
  instructions?: string;
}

const ms = (value: number) => `${Math.round(value).toLocaleString('en-US')} ms`;

function redRows(point: TickPoint | null): StatRow[] {
  const p = point;
  const durationTone = (value: number) => (value > 1000 ? 'bad' : value > 500 ? 'warn' : 'ok');
  const durationNote = (value: number) =>
    value > 1000 ? 'Over 1 s' : value > 500 ? 'Over 500 ms' : 'Healthy';
  const errors = (p?.browseErrors ?? 0) + (p?.checkoutErrors ?? 0);
  return [
    {
      label: 'Rate: browse, checkout',
      value: `${p?.browseRate ?? 0} and ${p?.checkoutRate ?? 0} req/s`,
    },
    {
      label: 'Errors: 503s in the last second',
      value: `${p?.browseErrors ?? 0} browse, ${p?.checkoutErrors ?? 0} checkout`,
      tone: errors > 0 ? 'bad' : 'ok',
      note: errors > 0 ? 'Failing' : 'None',
    },
    {
      label: 'Duration: browse p99',
      value: ms(p?.browseP99 ?? 0),
      tone: durationTone(p?.browseP99 ?? 0),
      note: durationNote(p?.browseP99 ?? 0),
    },
    {
      label: 'Duration: checkout p99',
      value: ms(p?.checkoutP99 ?? 0),
      tone: durationTone(p?.checkoutP99 ?? 0),
      note: durationNote(p?.checkoutP99 ?? 0),
    },
  ];
}

function utilizationRows(point: TickPoint | null, poolSize: number): StatRow[] {
  const busy = point?.busy ?? 0;
  const waiters = point?.waiters ?? 0;
  const errors = (point?.browseErrors ?? 0) + (point?.checkoutErrors ?? 0);
  const full = busy >= poolSize;
  return [
    {
      label: 'Utilization: connections busy',
      value: `${busy} of ${poolSize} (${Math.round((busy / poolSize) * 100)}%)`,
      tone: full ? 'warn' : 'ok',
      note: full ? 'Full' : 'Has room',
    },
    {
      label: 'Saturation: requests waiting for one',
      value: `${waiters}`,
      tone: waiters > 0 ? 'bad' : 'ok',
      note: waiters > 0 ? 'Queueing' : 'No queue',
    },
    {
      label: 'Errors: pool timeouts in the last second',
      value: `${errors}`,
      tone: errors > 0 ? 'bad' : 'ok',
      note: errors > 0 ? 'Timing out' : 'None',
    },
  ];
}

const slotIds = (prefix: string, length: number) =>
  Array.from({ length }, (_, slot) => `${prefix}${slot + 1}`);

function PoolStrip({ point, poolSize }: { point: TickPoint | null; poolSize: number }) {
  const busy = point?.busy ?? 0;
  const waiters = point?.waiters ?? 0;
  const shownWaiters = Math.min(waiters, 24);
  return (
    <div className="sdv-pool">
      <p className="sdv-pool__title">
        Database connection pool: {busy} of {poolSize} busy, {waiters} waiting
      </p>
      <div className="sdv-pool__row" aria-hidden="true">
        <span className="sdv-pool__queue">
          {slotIds('w', shownWaiters).map((id) => (
            <span key={id} className="sdv-pool__waiter" />
          ))}
          {waiters > shownWaiters && <span className="sdv-pool__more">+{waiters - shownWaiters}</span>}
        </span>
        <span className="sdv-pool__slots">
          {slotIds('c', poolSize).map((id, slot) => (
            <span key={id} className="sdv-pool__slot" data-busy={slot < busy} />
          ))}
        </span>
      </div>
      <p className="sdv-pool__legend">
        <span className="sdv-pool__slot" data-busy="true" aria-hidden="true" /> Busy connection (filled green
        square) <span className="sdv-pool__slot" aria-hidden="true" /> Free connection (empty square){' '}
        <span className="sdv-pool__waiter" aria-hidden="true" /> Request waiting (amber dot)
      </p>
    </div>
  );
}

export default function IncidentDashboardWidget({
  scenarios = ['deploy', 'noDeploy', 'biggerPool'],
  initial,
  initialView = 'red',
  title = 'Incident dashboard',
  instructions = 'Pick a scenario, then press Play. Switch between the RED view of requests and the USE view of the database pool while it runs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<IncidentId>(initial ?? scenarios[0] ?? 'deploy');
  const [view, setView] = useState<View>(initialView);
  const runRef = useRef<IncidentRun | null>(null);
  runRef.current ??= new IncidentRun(incidentScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: IncidentId) => {
    runRef.current = new IncidentRun(incidentScenarios[id]);
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
  const chooseScenario = (id: IncidentId) => {
    setScenarioId(id);
    restart(id);
  };

  const point = run.current;
  const poolSize = run.result.config.poolSize;
  const seconds = run.ticks * run.tickSeconds;
  const total = run.result.config.seconds;
  const stats = view === 'red' ? redRows(point) : utilizationRows(point, poolSize);

  const chart =
    view === 'red'
      ? {
          title: 'p99 latency over the last second (ms)',
          series: [
            { label: 'Browse p99', values: run.series((p) => p.browseP99), variant: 'a' as const },
            { label: 'Checkout p99', values: run.series((p) => p.checkoutP99), variant: 'b' as const },
          ],
          minMax: 300,
        }
      : {
          title: `Database pool: connections busy (of ${poolSize}) and requests waiting`,
          series: [
            { label: 'Busy connections', values: run.series((p) => p.busy), variant: 'a' as const },
            { label: 'Requests waiting', values: run.series((p) => p.waiters), variant: 'b' as const },
          ],
          minMax: poolSize,
        };
  const chartSummary = `${chart.title}. ${chart.series
    .map(
      (line) =>
        `${line.label} now ${line.values.at(-1) ?? 0}, peak ${line.values.length ? Math.max(...line.values) : 0}`,
    )
    .join('. ')}.`;

  const summary =
    view === 'red'
      ? `${seconds.toFixed(1)} s of ${total} s. Browse p99 ${ms(point?.browseP99 ?? 0)}, checkout p99 ${ms(point?.checkoutP99 ?? 0)}, ${point?.failed ?? 0} requests failed so far.`
      : `${seconds.toFixed(1)} s of ${total} s. ${point?.busy ?? 0} of ${poolSize} connections busy, ${point?.waiters ?? 0} requests waiting, ${point?.failed ?? 0} failed so far.`;

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
      stats={stats}
      finished={run.done}
      resetKey={scenarioId}
      controls={
        <>
          <Segmented
            label="Dashboard view"
            value={view}
            options={[
              { value: 'red', label: 'RED: requests' },
              { value: 'use', label: 'USE: database pool' },
            ]}
            onChange={setView}
          />
          <div className="sdv-duel__extra">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
              Skip to the end
            </button>
          </div>
        </>
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: incidentScenarios[id].label,
          diff: incidentScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <PoolStrip point={point} poolSize={poolSize} />
      <TraceChart
        title={chart.title}
        series={chart.series}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={chartMarkers(run.events)}
        minMax={chart.minMax}
        summary={chartSummary}
      />
      <RunTranscript events={run.events} tickSeconds={run.tickSeconds} />
    </SimulationShell>
  );
}
