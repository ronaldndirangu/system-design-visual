import { m } from 'motion/react';
import { type ReactNode, useId, useMemo, useReducer, useRef, useState } from 'react';
import {
  inFlightText,
  laneTotals,
  TX_ALIASES,
  TX_SECONDS,
  TxDuel,
  type TxKind,
  type TxLane,
  type TxOutcome,
  type TxRequest,
  type TxScenarioId,
  timelineRows,
  txScenarios,
} from '../../lib/models/transactions';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useElementWidth } from '../sim/useElementWidth';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import { safeId } from '../viz/SystemNode';
import './TransactionsWidget.css';

/** The handler timeline shows this many ticks (6 s) and scrolls as the run plays. */
const WINDOW_TICKS = 60;
const ROW_HEIGHT = 12;
const ROW_GAP = 4;
const IN_FLIGHT_SHOWN = 4;

interface Props {
  scenarios?: TxScenarioId[];
  initial?: TxScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const outcomeTone: Record<TxOutcome, Tone> = {
  ok: 'ok',
  stale: 'bad',
  duplicate: 'bad',
  rejected: 'warn',
  taken: 'warn',
};

const outcomeLabel: Record<TxKind, Record<TxOutcome, string>> = {
  counter: {
    ok: 'Written',
    stale: 'Lost a click',
    duplicate: 'Duplicate',
    rejected: 'Rejected',
    taken: 'Taken',
  },
  edit: {
    ok: 'Saved',
    stale: 'Erased an edit',
    duplicate: 'Duplicate',
    rejected: 'Rejected',
    taken: 'Taken',
  },
  alias: { ok: 'Created', stale: 'Stale', duplicate: 'Duplicate', rejected: '409 Conflict', taken: 'Taken' },
};

type BarState = 'flight' | 'ok' | 'harm' | 'rejected';

function barState(outcome: TxOutcome | undefined): BarState {
  if (!outcome) return 'flight';
  if (outcome === 'ok') return 'ok';
  if (outcome === 'stale' || outcome === 'duplicate') return 'harm';
  return 'rejected';
}

function StoredRow({ lane, kind }: { lane: TxLane; kind: TxKind }) {
  let body: ReactNode;
  if (kind === 'counter') {
    body = (
      <p className="sdv-tx__value">
        clicks ={' '}
        <m.strong
          key={lane.version}
          initial={{ scale: 1.25, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {lane.stored}
        </m.strong>
      </p>
    );
  } else if (kind === 'edit') {
    body = (
      <p className="sdv-tx__value">
        destination ={' '}
        <m.strong
          key={lane.version}
          initial={{ scale: 1.15, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {lane.stored === 0 ? 'original' : `edit ${lane.stored} by ${lane.editor}`}
        </m.strong>
        , version {lane.version}
      </p>
    );
  } else {
    const claimed = TX_ALIASES.filter((alias) => lane.rows.some((row) => row.alias === alias));
    body =
      claimed.length === 0 ? (
        <p className="sdv-tx__value">No rows yet</p>
      ) : (
        <ul className="sdv-tx__aliases">
          {claimed.map((alias) => {
            const owners = lane.rows.filter((row) => row.alias === alias).map((row) => row.owner);
            return (
              <li key={alias} data-duplicate={owners.length > 1 ? '' : undefined}>
                <code>{alias}</code>
                <span>{owners.join(', ')}</span>
                {owners.length > 1 && <ToneBadge tone="warn">{`${owners.length} rows`}</ToneBadge>}
              </li>
            );
          })}
        </ul>
      );
  }
  const key =
    kind === 'alias'
      ? `links table, ${lane.rows.length} ${lane.rows.length === 1 ? 'row' : 'rows'}`
      : 'links row for sho.rt/launch';
  return (
    <div className="sdv-tx__row">
      <svg className="sdv-node sdv-node--database sdv-tx__row-icon" viewBox="0 0 24 24" aria-hidden="true">
        <KindIcon kind="database" size={24} />
      </svg>
      <div className="sdv-tx__row-body">
        <p className="sdv-tx__row-key">{key}</p>
        {body}
      </div>
    </div>
  );
}

function Timeline({
  lane,
  requests,
  rows,
  now,
}: {
  lane: TxLane;
  requests: readonly TxRequest[];
  rows: readonly number[];
  now: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frameRef, 240);
  const hatchId = safeId(useId(), 'sdv-tx-hatch');
  const rowCount = Math.max(1, ...rows.map((row) => row + 1));
  const height = rowCount * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
  const start = Math.max(0, now - WINDOW_TICKS);
  const x = (tick: number) => ((tick - start) / WINDOW_TICKS) * width;

  const bars = requests.flatMap((request) => {
    const index = request.id - 1;
    if (!lane.reads[index]) return [];
    const result = lane.results[index];
    const end = (result ? result.tick : now - 1) + 1;
    if (end < start) return [];
    const left = x(Math.max(request.readAt, start));
    return [
      {
        id: request.id,
        left,
        width: Math.max(4, x(end) - left),
        y: ROW_GAP + (rows[index] ?? 0) * (ROW_HEIGHT + ROW_GAP),
        state: barState(result?.outcome),
      },
    ];
  });

  return (
    <div ref={frameRef} className="sdv-tx__timeline">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs>
          <pattern
            id={hatchId}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect className="sdv-tx__hatch-bg" width="6" height="6" />
            <line className="sdv-tx__hatch-line" x1="0" y1="0" x2="0" y2="6" />
          </pattern>
        </defs>
        {bars.map((bar) => (
          <rect
            key={bar.id}
            className="sdv-tx__bar"
            data-state={bar.state}
            x={bar.left + 1}
            y={bar.y}
            width={Math.max(2, bar.width - 2)}
            height={ROW_HEIGHT}
            rx="3"
            style={bar.state === 'harm' ? { fill: `url(#${hatchId})` } : undefined}
          />
        ))}
        {now > 0 && <line className="sdv-tx__now" x1={x(now)} x2={x(now)} y1={0} y2={height} />}
      </svg>
    </div>
  );
}

function LanePane({
  duel,
  lane,
  variant,
  rows,
}: {
  duel: TxDuel;
  lane: TxLane;
  variant: SeriesVariant;
  rows: readonly number[];
}) {
  const kind = duel.scenario.kind;
  const flying = duel.inFlight(lane);
  const latestId = lane.finished.at(-1);
  const latest = latestId ? lane.results[latestId - 1] : null;
  return (
    <section className="sdv-duel__lane sdv-tx__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <code className="sdv-tx__statement">{lane.statement}</code>
      <StoredRow lane={lane} kind={kind} />
      <Timeline lane={lane} requests={duel.requests} rows={rows} now={duel.ticks} />
      <div className="sdv-tx__latest">
        <p className="sdv-tx__label">Latest write</p>
        {latest ? (
          <p className="sdv-tx__latest-text">
            <ToneBadge tone={outcomeTone[latest.outcome]}>{outcomeLabel[kind][latest.outcome]}</ToneBadge>{' '}
            {latest.text}
          </p>
        ) : (
          <p className="sdv-tx__muted">None yet</p>
        )}
      </div>
      <div className="sdv-tx__flight">
        <p className="sdv-tx__label">In flight ({flying.length})</p>
        {flying.length === 0 ? (
          <p className="sdv-tx__muted">Nothing in flight</p>
        ) : (
          <ul>
            {flying.slice(0, IN_FLIGHT_SHOWN).map((request) => (
              <li key={request.id}>{inFlightText(duel.scenario, lane, request)}</li>
            ))}
            {flying.length > IN_FLIGHT_SHOWN && <li>+{flying.length - IN_FLIGHT_SHOWN} more</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

function compareRows(duel: TxDuel): CompareRow[] {
  const kind = duel.scenario.kind;
  const [first, second] = duel.lanes;
  const a = laneTotals(first, kind);
  const b = laneTotals(second, kind);
  if (kind === 'counter') {
    return [
      { label: 'Clicks so far (same for both)', values: [a.arrived, b.arrived] },
      { label: 'Clicks stored in the row', values: [first.stored, second.stored], better: 'higher' },
      { label: 'Clicks lost', values: [a.harm, b.harm], better: 'lower' },
    ];
  }
  if (kind === 'edit') {
    return [
      { label: 'Saves started (same for both)', values: [a.arrived, b.arrived] },
      { label: 'Told "Saved"', values: [a.ok + a.stale, b.ok + b.stale] },
      { label: 'Edits erased without warning', values: [a.stale, b.stale], better: 'lower' },
      { label: 'Rejected, then reloaded', values: [a.rejected, b.rejected] },
    ];
  }
  return [
    { label: 'Claims so far (same for both)', values: [a.arrived, b.arrived] },
    { label: 'Rows in the links table', values: [first.rows.length, second.rows.length] },
    { label: 'Duplicate alias rows', values: [a.duplicate, b.duplicate], better: 'lower' },
    { label: 'Told 409 Conflict', values: [a.rejected, b.rejected] },
    { label: 'Told "taken" at the check', values: [a.taken, b.taken] },
  ];
}

const chartTitles: Record<TxKind, string> = {
  counter: 'Clicks lost, running total',
  edit: 'Edits erased without warning, running total',
  alias: 'Duplicate alias rows, running total',
};

function laneSentence(lane: TxLane, kind: TxKind): string {
  const totals = laneTotals(lane, kind);
  if (kind === 'counter') return `${lane.label}: row holds ${lane.stored}, ${totals.harm} clicks lost`;
  if (kind === 'edit') {
    return `${lane.label}: version ${lane.version}, ${totals.stale} edits erased, ${totals.rejected} rejected`;
  }
  return `${lane.label}: ${lane.rows.length} rows, ${totals.duplicate} duplicates, ${totals.rejected} told 409`;
}

export default function TransactionsWidget({
  scenarios = ['counter', 'editors', 'alias', 'quiet'],
  initial,
  title = 'Same requests, two ways to write',
  instructions = 'Pick a scenario, then press Play. Both lanes replay the exact same requests against their own copy of the row; only the write statement differs.',
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<TxScenarioId>(initial ?? scenarios[0] ?? 'counter');
  const duelRef = useRef<TxDuel | null>(null);
  if (!duelRef.current) duelRef.current = new TxDuel(txScenarios[scenarioId]);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const rows = useMemo(() => timelineRows(duel.scenario.kind, duel.requests), [duel]);

  const restart = (id: TxScenarioId) => {
    duelRef.current = new TxDuel(txScenarios[id]);
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
  const chooseScenario = (id: TxScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const kind = duel.scenario.kind;
  const [first, second] = duel.lanes;
  const seconds = duel.ticks * duel.tickSeconds;
  const summary = `${seconds.toFixed(1)} s of ${TX_SECONDS} s. ${laneSentence(first, kind)}. ${laneSentence(second, kind)}.`;
  const chartTitle = chartTitles[kind];
  const latestHarm = (lane: TxLane) => lane.series.at(-1) ?? 0;
  const chartSummary = `${chartTitle}. ${first.label} ${latestHarm(first)}, ${second.label.toLowerCase()} ${latestHarm(second)}.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${TX_SECONDS} s` } as const);

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
          caption="Whole run so far, same requests for both"
          columns={[first.label, second.label]}
          rows={compareRows(duel)}
        />
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: txScenarios[id].label,
          diff: txScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-duel__lanes">
          {duel.lanes.map((lane, index) => (
            <LanePane key={lane.label} duel={duel} lane={lane} variant={variants[index] ?? 'a'} rows={rows} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-tx__legend" aria-label="How to read the handler timelines">
        <li>
          <span className="sdv-tx__key" data-state="flight" aria-hidden="true" /> In flight: read done, write
          not sent yet
        </li>
        <li>
          <span className="sdv-tx__key" data-state="ok" aria-hidden="true" /> Wrote safely
        </li>
        <li>
          <span className="sdv-tx__key" data-state="harm" aria-hidden="true" /> Wrote over newer data or added
          a duplicate
        </li>
        <li>
          <span className="sdv-tx__key" data-state="rejected" aria-hidden="true" /> Refused; the user retries
        </li>
        <li>Each timeline shows the last 6 s, one row per handler at a time</li>
      </ul>
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
        minMax={5}
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
