import { useReducer, useRef, useState } from 'react';
import {
  ClockDuel,
  type ClockLane,
  type ClockScenario,
  CONSUMER_CAPACITY,
  clockScenarios,
  SPIKE_ALERT,
  STREAM_SECONDS,
  windowName,
} from '../../lib/models/windowing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { type Badge, NodeChip, NodeChips, Verdicts } from './NodeChip';
import { WindowBars, WindowBarsLegend, WindowTable } from './WindowBars';
import './TimeDuelWidget.css';

/** A full bar stands for this many clicks in one window. The tallest count in any scenario is 98. */
const SCALE = 100;
/** Waiting counts above this mark the topic as backed up. */
const BACKED_UP = 20;

const scenarios: ClockScenario[] = ['restart', 'outage', 'steady'];
const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

interface Props {
  title?: string;
  instructions?: string;
}

const pathText: Record<ClockLane['clock'], string> = {
  processing: 'Files each click under the window of the moment the job reads it.',
  event: 'Files each click under the window of the moment it happened, stamped by the redirect server.',
};

function biggestGap(lane: ClockLane): { window: number; counted: number; happened: number } | null {
  const counts = lane.model.windowCounts;
  const truth = lane.model.truth;
  let best: { window: number; counted: number; happened: number } | null = null;
  counts.forEach((counted, window) => {
    const happened = truth[window] ?? 0;
    const gap = Math.abs(counted - happened);
    if (gap > 0 && (!best || gap > Math.abs(best.counted - best.happened)))
      best = { window, counted, happened };
  });
  return best;
}

function gapText(lane: ClockLane): string {
  if (lane.model.ticks === 0) return 'No clicks yet.';
  const gap = biggestGap(lane);
  if (!gap) return 'Every window holds exactly the clicks that happened in it so far.';
  return `Biggest gap now: ${windowName(gap.window)} counted ${gap.counted} where ${gap.happened} happened.`;
}

function barsLabel(lane: ClockLane): string {
  const counts = lane.model.windowCounts;
  const truth = lane.model.truth;
  const shown = counts
    .map((count, window) => ({ count, happened: truth[window] ?? 0, window }))
    .filter((entry) => entry.count > 0 || entry.happened > 0)
    .map((entry) => `${windowName(entry.window)} counted ${entry.count} of ${entry.happened}`);
  if (shown.length === 0) return `${lane.label}: no clicks counted yet.`;
  return `${lane.label}, counted against happened per 2 s window: ${shown.join('; ')}.`;
}

function verdicts(lane: ClockLane): Badge[] {
  const t = lane.model.totals;
  if (lane.model.ticks === 0) return [];
  const list: Badge[] = [];
  if (t.wrongWindow > 0)
    list.push({ tone: 'bad', text: `${t.wrongWindow} clicks counted in the wrong window` });
  else list.push({ tone: 'ok', text: 'Every click counted in the window it happened' });
  if (t.alerts > 0) {
    list.push({
      tone: 'bad',
      text: `${t.alerts} spike ${t.alerts === 1 ? 'alert' : 'alerts'} paged on-call`,
    });
  }
  if (t.afterEnd > 0) {
    list.push({ tone: 'warn', text: `${t.afterEnd} clicks reached their window after it ended` });
  }
  return list;
}

function LanePane({ lane, variant }: { lane: ClockLane; variant: SeriesVariant }) {
  const { model } = lane;
  const truth = model.truth;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-tduel__path">{pathText[lane.clock]}</p>
      <WindowBars
        label={barsLabel(lane)}
        windows={model.windowCounts.map((count, window) => ({
          parts: [{ kind: 'counted', value: count }],
          truth: truth[window] ?? 0,
        }))}
        scaleMax={SCALE}
        variant={variant}
        alert={SPIKE_ALERT}
        now={model.ticks}
        length={STREAM_SECONDS * 10}
        seconds={STREAM_SECONDS}
      />
      <p className="sdv-tduel__gap">{gapText(lane)}</p>
      <Verdicts badges={verdicts(lane)} />
    </section>
  );
}

/** The same clicks read by the same job, filed into windows by processing time and by event time. */
export default function TimeDuelWidget({
  title = 'Processing time versus event time',
  instructions = 'Press Play. One stream job reads the same clicks from the topic for both lanes. Only the clock that picks each click’s window differs. Pick a scenario to change what goes wrong.',
}: Props) {
  const hydrated = useHydrated();
  const [scenario, setScenario] = useState<ClockScenario>('restart');
  const duelRef = useRef<ClockDuel | null>(null);
  if (!duelRef.current) duelRef.current = new ClockDuel(scenario);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (next: ClockScenario) => {
    duelRef.current = new ClockDuel(next);
    rerender();
  };
  const chooseScenario = (next: ClockScenario) => {
    setScenario(next);
    restart(next);
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };

  const [processing, event] = duel.lanes;
  const a = processing.model.totals;
  const b = event.model.totals;
  const seconds = duel.ticks * duel.tickSeconds;
  const reading = processing.model.reading;
  const held = processing.model.heldNow;
  const truth = duel.truth;
  const gapNow = (lane: ClockLane) => lane.model.worstGap;

  const rows: CompareRow[] = [
    { label: 'Clicks read (same for both)', values: [a.read, b.read] },
    { label: 'Counted in the wrong window', values: [a.wrongWindow, b.wrongWindow], better: 'lower' },
    { label: 'Spike alerts that paged on-call', values: [a.alerts, b.alerts], better: 'lower' },
    { label: 'Biggest window error now', values: [gapNow(processing), gapNow(event)], better: 'lower' },
    { label: 'Added to a window after it ended', values: [a.afterEnd, b.afterEnd] },
  ];

  const summary = `${seconds.toFixed(1)} s of ${STREAM_SECONDS} s. Counted in the wrong window: processing time ${a.wrongWindow}, event time ${b.wrongWindow}. Spike alerts: processing time ${a.alerts}, event time ${b.alerts}.`;
  const markerEvents = duel.events.filter((entry) => entry.marker);
  const notes = duel.events.filter((entry) => !entry.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : !reading
        ? ({ tone: 'warn', text: `Job stopped at ${seconds.toFixed(1)} s` } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${STREAM_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenario)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={scenario}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same clicks and same reads for both"
          columns={[processing.label, event.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="What happens to the click stream"
        value={scenario}
        options={scenarios.map((id) => ({
          value: id,
          label: clockScenarios[id].label,
          diff: clockScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <NodeChips label="Shared pipeline">
        <NodeChip
          kind="server"
          name="Redirect servers"
          tone={held > 0 ? 'warn' : 'ok'}
          text={held > 0 ? `${held} clicks buffered at the edge` : 'Stamping and sending clicks'}
        />
        <NodeChip
          kind="queue"
          name="Clicks topic"
          tone={a.waiting > BACKED_UP ? 'warn' : 'ok'}
          text={`${a.waiting} waiting`}
        />
        <NodeChip
          kind="server"
          name="Stream job"
          tone={reading ? 'ok' : 'bad'}
          text={reading ? `Reading up to ${CONSUMER_CAPACITY} per 0.1 s` : 'Stopped for a deploy'}
          stuck={!reading}
        />
        <NodeChip kind="database" name="Counts table" tone="neutral" text={`${a.read} clicks counted`} />
      </NodeChips>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.clock} lane={lane} variant={variants[index] ?? 'a'} />
        ))}
      </div>
      <WindowBarsLegend
        keys={['counted', 'truth', 'alert', 'now']}
        labels={{ alert: `Spike alert: more than ${SPIKE_ALERT} clicks in a window pages on-call` }}
      />
      <WindowTable
        summary="Show every window as a table"
        caption="Clicks per 2 s window: happened so far, and counted by each lane"
        columns={['Happened', processing.label, event.label]}
        rows={truth.map((happened, window) => ({
          window: windowName(window),
          values: [
            String(happened),
            ...duel.lanes.map((lane) => {
              const count = lane.model.windowCounts[window] ?? 0;
              return count > SPIKE_ALERT ? `${count} (alert)` : String(count);
            }),
          ],
        }))}
      />
      <TraceChart
        title="Biggest window error (clicks)"
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((entry, index) => ({ tick: entry.tick, number: index + 1 }))}
        minMax={20}
        summary={`Biggest gap between a window's count and the clicks that happened in it. ${processing.label} ${gapNow(processing)}, ${event.label.toLowerCase()} ${gapNow(event)}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            Restarts, reconnects, and spike alerts appear here, numbered to match the chart.
          </p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: both lanes can log in the same tick
              <li key={`${entry.tick}-${index}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(entry.tick * duel.tickSeconds).toFixed(1)} s</time> {entry.text}
              </li>
            ))}
          </ol>
        )}
        {notes.map((entry) => (
          <p key={`${entry.tick}-${entry.text}`} className="sdv-trace__note">
            {entry.text}
          </p>
        ))}
      </div>
      {!hydrated && <p className="sdv-trace__empty">The simulation starts once the page finishes loading.</p>}
    </SimulationShell>
  );
}
