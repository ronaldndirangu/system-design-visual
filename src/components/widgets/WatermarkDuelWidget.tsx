import { useReducer, useRef, useState } from 'react';
import {
  ALLOWED_LATENESS_SECONDS,
  type LatePolicy,
  latePolicies,
  STREAM_SECONDS,
  WatermarkDuel,
  type WatermarkLane,
  type WindowResult,
  windowName,
} from '../../lib/models/windowing';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { type Badge, NodeChip, NodeChips, Verdicts } from './NodeChip';
import { type BarKey, type BarWindow, WindowBars, WindowBarsLegend, WindowTable } from './WindowBars';
import './WatermarkDuelWidget.css';

/** A full bar stands for this many clicks. The busiest window holds 58. */
const SCALE = 60;

const policies: LatePolicy[] = ['drop', 'update', 'side'];
const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const lateKey: Record<LatePolicy, BarKey> = { drop: 'dropped', update: 'corrected', side: 'side' };

interface Props {
  title?: string;
  instructions?: string;
}

const seconds = (ticks: number) => (ticks / 10).toFixed(1);

function lateValue(window: WindowResult, policy: LatePolicy): number {
  if (policy === 'update') return window.corrected;
  if (policy === 'side') return window.side;
  return window.dropped;
}

function bar(window: WindowResult, truth: number): BarWindow {
  if (window.publishedAt === null) return { parts: [{ kind: 'open', value: window.ontime }], truth };
  return {
    parts: [
      { kind: 'counted', value: window.ontime },
      { kind: 'corrected', value: window.corrected },
      { kind: 'side', value: window.side },
      { kind: 'dropped', value: window.dropped },
    ],
    truth,
  };
}

/** Clicks that happened in published windows and are missing from the counts the dashboard shows. */
function missing(lane: WatermarkLane): number {
  const truth = lane.model.truth;
  return lane.model.windows.reduce((sum, window, index) => {
    if (window.publishedAt === null) return sum;
    return sum + Math.max(0, (truth[index] ?? 0) - window.ontime - window.corrected);
  }, 0);
}

function cellText(window: WindowResult, policy: LatePolicy): string {
  if (window.publishedAt === null) return window.ontime > 0 ? `open, ${window.ontime} so far` : 'open';
  const late = lateValue(window, policy);
  if (late === 0) return String(window.ontime);
  if (policy === 'update') return `${window.ontime} + ${late} late`;
  if (policy === 'side') return `${window.ontime}, ${late} in side table`;
  return `${window.ontime}, ${late} dropped`;
}

function barsLabel(lane: WatermarkLane): string {
  const { model } = lane;
  const watermark = model.watermark;
  const truth = model.truth;
  const shown = model.windows
    .map((window, index) => ({ window, index, happened: truth[index] ?? 0 }))
    .filter((entry) => entry.happened > 0)
    .map(
      (entry) =>
        `${windowName(entry.index)} ${cellText(entry.window, lane.model.config.policy)} of ${entry.happened}`,
    );
  const mark = watermark === null ? 'no watermark yet' : `watermark at ${seconds(Math.max(0, watermark))} s`;
  if (shown.length === 0) return `${lane.label}: no clicks yet.`;
  return `${lane.label}, ${mark}. Per 2 s window, counted against happened: ${shown.join('; ')}.`;
}

function watermarkText(lane: WatermarkLane): string {
  const watermark = lane.model.watermark;
  if (watermark === null) return 'No clicks yet, so no watermark.';
  const held = lane.model.held;
  return `Watermark at ${seconds(Math.max(0, watermark))} s. The job holds ${held} ${held === 1 ? 'window' : 'windows'} in memory.`;
}

function verdicts(lane: WatermarkLane, policy: LatePolicy): Badge[] {
  const t = lane.model.totals;
  if (lane.model.ticks === 0) return [];
  const list: Badge[] = [];
  if (t.late === 0) list.push({ tone: 'ok', text: 'No late clicks yet' });
  else if (policy === 'drop') list.push({ tone: 'bad', text: `${t.dropped} late clicks dropped for good` });
  else if (policy === 'update') {
    list.push({
      tone: 'warn',
      text: `${t.corrected} late clicks added in ${t.corrections} updated results`,
    });
    if (t.dropped > 0) list.push({ tone: 'bad', text: `${t.dropped} dropped after the lateness limit` });
  } else list.push({ tone: 'warn', text: `${t.side} late clicks wait in the side table for the batch job` });
  const delay = lane.model.meanPublishDelay;
  if (delay !== null) {
    list.push({ tone: 'neutral', text: `First results ${delay.toFixed(1)} s after a window ends` });
  }
  return list;
}

function LanePane({
  lane,
  variant,
  policy,
}: {
  lane: WatermarkLane;
  variant: SeriesVariant;
  policy: LatePolicy;
}) {
  const { model } = lane;
  const t = model.totals;
  const truth = model.truth;
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-wduel__path">
        Watermark = newest click time seen minus {lane.waitSeconds} s. A window publishes once the watermark
        passes its end.
      </p>
      <NodeChips label={`${lane.label}: components`}>
        <NodeChip
          kind="server"
          name="Stream job"
          tone={model.held > 3 ? 'warn' : 'ok'}
          text={`${model.held} ${model.held === 1 ? 'window' : 'windows'} in memory`}
        />
        <NodeChip
          kind="database"
          name="Counts table"
          tone="neutral"
          text={`${t.published} windows published`}
        />
        {policy === 'side' && (
          <NodeChip
            kind="database"
            name="Side table"
            tone={t.side > 0 ? 'warn' : 'neutral'}
            text={`${t.side} late clicks`}
          />
        )}
      </NodeChips>
      <WindowBars
        label={barsLabel(lane)}
        windows={model.windows.map((window, index) => bar(window, truth[index] ?? 0))}
        scaleMax={SCALE}
        variant={variant}
        now={model.ticks}
        length={STREAM_SECONDS * 10}
        seconds={STREAM_SECONDS}
        watermark={model.watermark}
      />
      <p className="sdv-wduel__mark">{watermarkText(lane)}</p>
      <Verdicts badges={verdicts(lane, policy)} />
    </section>
  );
}

/** The same clicks through a job that waits 0.5 s for stragglers and one that waits 3 s. */
export default function WatermarkDuelWidget({
  title = 'Watermarks and late clicks',
  instructions = 'Press Play. Both jobs count the same clicks by event time. The left job waits 0.5 s past the newest click before it closes a window, the right job waits 3 s. Pick what happens to a click that arrives after its window closed.',
}: Props) {
  const hydrated = useHydrated();
  const [policy, setPolicy] = useState<LatePolicy>('drop');
  const duelRef = useRef<WatermarkDuel | null>(null);
  if (!duelRef.current) duelRef.current = new WatermarkDuel(policy);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (next: LatePolicy) => {
    duelRef.current = new WatermarkDuel(next);
    rerender();
  };
  const choosePolicy = (next: LatePolicy) => {
    setPolicy(next);
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

  const [fast, slow] = duel.lanes;
  const a = fast.model.totals;
  const b = slow.model.totals;
  const now = duel.ticks * duel.tickSeconds;
  const held = duel.heldNow;
  const delays = [fast.model.meanPublishDelay, slow.model.meanPublishDelay] as const;
  const bothDelays = delays[0] !== null && delays[1] !== null;

  const policyRow: CompareRow =
    policy === 'update'
      ? { label: 'Updated results sent downstream', values: [a.corrections, b.corrections], better: 'lower' }
      : policy === 'side'
        ? { label: 'Late clicks in the side table', values: [a.side, b.side], better: 'lower' }
        : { label: 'Late clicks dropped for good', values: [a.dropped, b.dropped], better: 'lower' };

  const rows: CompareRow[] = [
    { label: 'Clicks read (same for both)', values: [a.read, b.read] },
    { label: 'Counted in a first result', values: [a.ontime, b.ontime], better: 'higher' },
    { label: 'Late clicks', values: [a.late, b.late], better: 'lower' },
    policyRow,
    {
      label: 'Mean wait for a first result',
      values: [delays[0] ?? 0, delays[1] ?? 0],
      format: (value, column) => (delays[column] === null ? 'none yet' : `${value.toFixed(1)} s`),
      better: bothDelays ? 'lower' : undefined,
    },
    { label: 'Windows published', values: [a.published, b.published] },
    { label: 'Windows held in memory now', values: [fast.model.held, slow.model.held], better: 'lower' },
    {
      label: 'Clicks missing from published counts',
      values: [missing(fast), missing(slow)],
      better: 'lower',
    },
  ];

  const summary = `${now.toFixed(1)} s of ${STREAM_SECONDS} s with ${latePolicies[policy].label.toLowerCase()}. Late clicks: ${fast.label} ${a.late}, ${slow.label} ${b.late}. Windows published: ${a.published} and ${b.published}.`;
  const markerEvents = duel.events.filter((entry) => entry.marker);
  const notes = duel.events.filter((entry) => !entry.marker);
  const truth = duel.truth;

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${now.toFixed(1)} s of ${STREAM_SECONDS} s` } as const);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(policy)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={policy}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same clicks for both"
          columns={[fast.label, slow.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="What a late click does"
        value={policy}
        options={policies.map((id) => ({
          value: id,
          label: latePolicies[id].label,
          diff: latePolicies[id].diff,
        }))}
        onChange={choosePolicy}
      />
      <NodeChips label="Shared input">
        <NodeChip
          kind="server"
          name="Redirect servers"
          tone={held > 0 ? 'warn' : 'ok'}
          text={held > 0 ? `${held} clicks buffered at the edge` : 'Sending, 1 in 10 late after a retry'}
        />
        <NodeChip kind="queue" name="Clicks topic" tone="neutral" text={`${a.read} clicks read`} />
      </NodeChips>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.label} lane={lane} variant={variants[index] ?? 'a'} policy={policy} />
        ))}
      </div>
      <WindowBarsLegend
        keys={['counted', 'open', lateKey[policy], 'truth', 'watermark', 'now']}
        labels={{
          counted: 'Counted in the first result (solid, in the lane color)',
          ...(policy === 'update'
            ? {
                corrected: `Late clicks added in an update, up to ${ALLOWED_LATENESS_SECONDS} s late (striped)`,
              }
            : {}),
        }}
      />
      <WindowTable
        summary="Show every window as a table"
        caption="Clicks per 2 s window: happened so far, and the result each lane shows"
        columns={['Happened', fast.label, slow.label]}
        rows={truth.map((happened, window) => ({
          window: windowName(window),
          values: [
            String(happened),
            ...duel.lanes.map((lane) => {
              const result = lane.model.windows[window];
              return result ? cellText(result, policy) : 'open';
            }),
          ],
        }))}
      />
      <TraceChart
        title="Late clicks so far"
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((entry, index) => ({ tick: entry.tick, number: index + 1 }))}
        minMax={10}
        summary={`Clicks that arrived after their window was published. ${fast.label} ${a.late}, ${slow.label} ${b.late}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            First results, late clicks, and the reconnect appear here, numbered to match the chart.
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
