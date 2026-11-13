import { m } from 'motion/react';
import { type ReactNode, useReducer, useRef, useState } from 'react';
import {
  buildDataset,
  DM_QUERY_IDS,
  DM_SHAPES,
  type DmAccess,
  type DmPane,
  type DmQueryId,
  DmRun,
  type DmStore,
  dmQueries,
  fitTable,
  formatKb,
  formatLoad,
  formatMs,
  GRID_CELLS,
  MS_PER_TICK,
} from '../../lib/models/dataModeling';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import './DataModelingWidget.css';

const DATA = buildDataset();
const FIT = fitTable(DATA);
const USERS = DATA.owned.length.toLocaleString('en-US');
const LINKS = DATA.links.length.toLocaleString('en-US');

interface Props {
  queries?: DmQueryId[];
  initial?: DmQueryId;
  title?: string;
  instructions?: string;
}

const accessTone: Record<DmAccess, Tone> = { key: 'ok', index: 'ok', scan: 'bad' };

function counted(value: number, [one, many]: readonly [string, string]): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
}

/** The squares a region covers, as "squares 1 to 3" or "squares 1 to 3 and 9". */
function squareRuns(cellRegions: readonly number[], region: number): string {
  const runs: [number, number][] = [];
  cellRegions.forEach((value, cell) => {
    if (value !== region) return;
    const last = runs.at(-1);
    if (last && last[1] === cell - 1) last[1] = cell;
    else runs.push([cell, cell]);
  });
  const parts = runs.map(([start, end]) => (start === end ? `${start + 1}` : `${start + 1} to ${end + 1}`));
  const single = runs.length === 1 && runs[0]?.[0] === runs[0]?.[1];
  return `${single ? 'square' : 'squares'} ${parts.join(' and ')}`;
}

function ShapePane({ pane, store, started }: { pane: DmPane; store: DmStore; started: boolean }) {
  const { shape, plan } = pane;
  const lit = pane.lit.filter(Boolean).length;
  const squareKb = formatKb(store.totalKb / GRID_CELLS);
  return (
    <section className="sdv-duel__lane sdv-dm__pane" aria-label={shape.label}>
      <h4 className="sdv-duel__lane-title sdv-dm__pane-title">
        <svg className="sdv-node sdv-node--database" viewBox="0 0 24 24" aria-hidden="true">
          <KindIcon kind="database" size={24} />
        </svg>
        {shape.label}
      </h4>
      <p className="sdv-dm__layout">{shape.layout}</p>
      <div
        className="sdv-dm__grid"
        role="img"
        aria-label={`${shape.label} storage, ${formatKb(store.totalKb)} KB drawn as ${GRID_CELLS} squares of about ${squareKb} KB. The query has touched ${lit} of them.`}
      >
        {pane.lit.map((touched, cell) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid of squares
            key={cell}
            className="sdv-dm__cell"
            data-region={store.cellRegions[cell] ?? 0}
            data-lit={touched ? '' : undefined}
          >
            {touched && (
              <m.span
                className="sdv-dm__hit"
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.25 }}
              />
            )}
          </span>
        ))}
      </div>
      <ul className="sdv-dm__regions" aria-label={`What the ${shape.label} squares hold`}>
        {store.regions.map((region, index) => (
          <li key={region}>
            <span className="sdv-dm__swatch" data-region={index} aria-hidden="true" />
            {region}, {squareRuns(store.cellRegions, index)}
          </li>
        ))}
      </ul>
      <p className="sdv-dm__progress">
        {pane.done.toLocaleString('en-US')} of {counted(plan.records, shape.unit)} read or written
      </p>
      {pane.finished ? (
        <p className="sdv-dm__verdict">
          <ToneBadge tone={accessTone[plan.access]}>{plan.accessLabel}</ToneBadge> {plan.note}
        </p>
      ) : (
        <p className="sdv-dm__muted">
          {started ? 'Working through the data' : 'Press Play to run the query'}
        </p>
      )}
    </section>
  );
}

interface ReadoutRow {
  label: string;
  /** Live rows update during the run; the rest wait until their shape finishes. */
  live?: boolean;
  cell: (pane: DmPane) => ReactNode;
}

function Readout({ run }: { run: DmRun }) {
  const panes = run.panes;
  const pending = run.ticks === 0 ? 'Not run yet' : 'Running';
  const rows: ReadoutRow[] = [
    {
      label: 'Access path',
      cell: (pane) => <ToneBadge tone={accessTone[pane.plan.access]}>{pane.plan.accessLabel}</ToneBadge>,
    },
    {
      label: 'Records read or written',
      live: true,
      cell: (pane) => (
        <span className="sdv-stats__value">
          {pane.finished
            ? counted(pane.plan.records, pane.shape.unit)
            : `${pane.done.toLocaleString('en-US')} so far`}
        </span>
      ),
    },
    {
      label: 'Index entries touched',
      cell: (pane) => (
        <span className="sdv-stats__value">{pane.plan.indexEntries.toLocaleString('en-US')}</span>
      ),
    },
    {
      label: 'Data touched',
      cell: (pane) => <span className="sdv-stats__value">{formatKb(pane.plan.kb)} KB</span>,
    },
    {
      label: 'Round trips',
      cell: (pane) => <span className="sdv-stats__value">{pane.plan.roundTrips}</span>,
    },
    {
      label: 'Toy latency',
      cell: (pane) => (
        <>
          <span className="sdv-stats__value">{formatMs(pane.plan.costMs)} ms</span>
          {pane.best && <ToneBadge tone="ok">Best</ToneBadge>}
        </>
      ),
    },
    {
      label: `Data moved at ${run.query.rateText}`,
      cell: (pane) => <span className="sdv-stats__value">{formatLoad(pane.plan.kb, run.query)}</span>,
    },
  ];
  return (
    <table className="sdv-stats sdv-compare sdv-dm__table">
      <caption>{`${run.query.label}, same data in three shapes (toy numbers)`}</caption>
      <thead>
        <tr>
          <td />
          {DM_SHAPES.map((shape) => (
            <th key={shape.id} scope="col">
              {shape.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {panes.map((pane) => (
              <td key={pane.shape.id}>
                <div className="sdv-stats__cell">
                  {pane.finished || row.live ? (
                    row.cell(pane)
                  ) : (
                    <span className="sdv-dm__muted">{pending}</span>
                  )}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FitTable({ ran, current }: { ran: ReadonlySet<DmQueryId>; current: DmQueryId }) {
  return (
    <table className="sdv-stats sdv-compare sdv-dm__table sdv-dm__fit">
      <caption>Which shape fits which query (toy ms; a row fills in when its run ends)</caption>
      <thead>
        <tr>
          <td />
          {DM_SHAPES.map((shape) => (
            <th key={shape.id} scope="col">
              {shape.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {FIT.map((row) => (
          <tr key={row.query} data-current={row.query === current ? '' : undefined}>
            <th scope="row">
              <span className="sdv-dm__fit-label">
                {row.label}
                {row.query === current && <ToneBadge tone="neutral">Selected</ToneBadge>}
              </span>
            </th>
            {row.cells.map((cell) => (
              <td key={cell.shape}>
                {ran.has(row.query) ? (
                  <div className="sdv-stats__cell">
                    <span className="sdv-stats__value">{formatMs(cell.costMs)} ms</span>
                    {cell.best && <ToneBadge tone="ok">Best</ToneBadge>}
                    <span className="sdv-stats__detail">{cell.accessLabel}</span>
                  </div>
                ) : (
                  <span className="sdv-dm__muted">Not run yet</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function paneSentence(pane: DmPane): string {
  const { shape, plan } = pane;
  if (pane.finished) {
    return `${shape.label} done: ${counted(plan.records, shape.unit)} in ${formatMs(plan.costMs)} toy ms, ${plan.accessLabel.toLowerCase()}`;
  }
  return `${shape.label}: ${pane.done.toLocaleString('en-US')} of ${counted(plan.records, shape.unit)}`;
}

export default function DataModelingWidget({
  queries = [...DM_QUERY_IDS],
  initial,
  title = 'Same queries, three storage shapes',
  instructions = `Pick a query, then press Play. All three panes hold the same ${USERS} users and ${LINKS} links. Each square stands for 1% of the data a shape stores, and a marked square means the query read or wrote data there.`,
}: Props) {
  const hydrated = useHydrated();
  const [queryId, setQueryId] = useState<DmQueryId>(initial ?? queries[0] ?? 'redirect');
  const [ran, setRan] = useState<ReadonlySet<DmQueryId>>(() => new Set());
  const runRef = useRef<DmRun | null>(null);
  if (!runRef.current) runRef.current = new DmRun(queryId, DATA);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const markRan = (id: DmQueryId) =>
    setRan((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
  const restart = (id: DmQueryId) => {
    runRef.current = new DmRun(id, DATA);
    rerender();
  };
  const advance = (toEnd: boolean) => {
    const active = runRef.current;
    if (!active) return;
    do active.step();
    while (toEnd && !active.done);
    if (active.done) markRan(active.query.id);
    rerender();
  };
  const chooseQuery = (id: DmQueryId) => {
    setQueryId(id);
    restart(id);
  };

  const panes = run.panes;
  const elapsed = run.elapsedMs;
  const slowest = Math.max(...run.plans.map((plan) => plan.costMs));
  const summary = `${run.query.label}, ${elapsed.toFixed(1)} toy ms. ${panes.map(paneSentence).join('. ')}.`;
  const finishes = run.events.filter((event) => !event.wrapUp);
  const notes = run.events.filter((event) => event.wrapUp);

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${elapsed.toFixed(1)} of ${formatMs(slowest)} toy ms` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={() => advance(false)}
      onReset={() => restart(queryId)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={queryId}
      controls={
        <div className="sdv-duel__extra">
          <button
            type="button"
            className="sdv-button"
            onClick={() => advance(true)}
            disabled={!hydrated || run.done}
          >
            Skip to the end
          </button>
        </div>
      }
      readout={<Readout run={run} />}
    >
      <ScenarioChips
        label="Query"
        value={queryId}
        options={queries.map((id) => ({ value: id, label: dmQueries[id].label, diff: dmQueries[id].diff }))}
        onChange={chooseQuery}
      />
      <MotionRoot>
        <div className="sdv-dm__stage">
          <div className="sdv-duel__lanes sdv-dm__panes">
            {panes.map((pane) => (
              <ShapePane
                key={pane.shape.id}
                pane={pane}
                store={DATA.stores[pane.shape.id]}
                started={run.ticks > 0}
              />
            ))}
          </div>
        </div>
      </MotionRoot>
      <ul className="sdv-dm__legend" aria-label="How to read the storage grids">
        <li>
          <span className="sdv-dm__swatch" data-region="0" aria-hidden="true">
            <span className="sdv-dm__hit" />
          </span>{' '}
          Marked square: the query read or wrote data there
        </li>
        <li>Playback stretches each toy millisecond to 0.2 s; all costs are illustrative</li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {run.events.length === 0 && (
          <p className="sdv-trace__empty">Each shape reports here, in toy ms, as it finishes the query.</p>
        )}
        {finishes.length > 0 && (
          <ol>
            {finishes.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(event.tick * MS_PER_TICK).toFixed(1)} ms</time> {event.text}
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
      <FitTable ran={ran} current={queryId} />
    </SimulationShell>
  );
}
