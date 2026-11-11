import { useReducer, useRef, useState } from 'react';
import {
  HOT_KEY_SECONDS,
  HOT_THRESHOLD,
  type HotKeyLane,
  HotKeyRun,
  type HotKeyScenarioId,
  hotKeyScenarios,
  NODE_CAPACITY,
  nodeRate,
  summarizeLane,
  TOP_LINK,
} from '../../lib/models/accessPatterns';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { type LoadBar, LoadBars } from '../sim/LoadBars';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './HotKeyWidget.css';

interface Props {
  scenarios?: HotKeyScenarioId[];
  initial?: HotKeyScenarioId;
  title?: string;
  instructions?: string;
}

const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];
const perSecond = (value: number) => `${Math.round(value)}/s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function nodeLabel(lane: HotKeyLane, id: number, topHome: number): string {
  const name = `Node ${id + 1}`;
  if (id === topHome) return `${name} (${TOP_LINK} home)`;
  if (lane.hot.has(0)) return `${name} (${TOP_LINK} copy)`;
  return name;
}

function LanePane({ lane, variant, topHome }: { lane: HotKeyLane; variant: SeriesVariant; topHome: number }) {
  const bars: LoadBar[] = lane.nodes.map((node) => {
    const rate = nodeRate(node);
    return {
      id: node.id,
      label: nodeLabel(lane, node.id, topHome),
      fill: rate / node.capacity,
      value: `${Math.round(rate)} req/s`,
    };
  });
  const rejected = lane.nodes.reduce((sum, node) => sum + node.rejected, 0);
  const copied = lane.hot.has(0);
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <LoadBars bars={bars} label={`${lane.label}: clicks each cache node received in the last second`} />
      <p className="sdv-hotkey__lane-note">
        {lane.strategy === 'hash'
          ? `${TOP_LINK} lives on Node ${topHome + 1} only, so every click on it goes there.`
          : copied
            ? `${TOP_LINK} sits on all ${lane.nodes.length} nodes, and its clicks take turns across them.`
            : `${TOP_LINK} lives on Node ${topHome + 1} until it passes ${HOT_THRESHOLD} req/s.`}
      </p>
      {rejected > 0 ? (
        <ToneBadge tone="bad">{`${rejected} clicks turned away`}</ToneBadge>
      ) : (
        <ToneBadge tone="ok">No clicks turned away</ToneBadge>
      )}
    </section>
  );
}

function PatternPanel({ run }: { run: HotKeyRun }) {
  const pattern = run.pattern(3);
  let reads = 0;
  let writes = 0;
  for (const tick of run.clicks.slice(0, run.ticks)) {
    for (const click of tick) {
      if (click.write) writes += 1;
      else reads += 1;
    }
  }
  const ratio = writes > 0 ? `${Math.round(reads / writes)} to 1` : 'no writes yet';
  const readTotal = pattern.readsPerSecond * pattern.seconds;
  const bars: LoadBar[] = pattern.top.map((link) => ({
    id: link.link,
    label: link.code,
    fill: readTotal > 0 ? link.count / readTotal : 0,
    value: `${perSecond(link.count / pattern.seconds)}, ${percent(readTotal > 0 ? link.count / readTotal : 0)}`,
  }));
  return (
    <section className="sdv-hotkey__pattern" aria-label="Access pattern">
      <h4 className="sdv-hotkey__heading">Who reads what, last second</h4>
      <dl className="sdv-hotkey__facts">
        <div>
          <dt>Reads</dt>
          <dd>{perSecond(pattern.readsPerSecond)}</dd>
        </div>
        <div>
          <dt>Writes (new links)</dt>
          <dd>{perSecond(pattern.writesPerSecond)}</dd>
        </div>
        <div>
          <dt>Reads per write, whole run</dt>
          <dd>{ratio}</dd>
        </div>
        <div>
          <dt>Share of reads on {TOP_LINK}</dt>
          <dd>{run.ticks > 0 ? percent(pattern.topShare) : 'none yet'}</dd>
        </div>
      </dl>
      {bars.length > 0 ? (
        <LoadBars bars={bars} label="Most clicked links in the last second" flagFull={false} />
      ) : (
        <p className="sdv-hotkey__empty">The most clicked links appear here once clicks arrive.</p>
      )}
    </section>
  );
}

const ms = (value: number) => `${Math.round(value)} ms`;

export default function HotKeyWidget({
  scenarios = ['busy', 'viral', 'viral-8'],
  initial,
  title = 'One viral link, two ways to route it',
  instructions = `Each toy cache node serves ${NODE_CAPACITY} req/s. Clicks start at 40 req/s with ${TOP_LINK} at 5%. Pick a scenario and press Play. Both lanes get the exact same clicks; only the routing differs.`,
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<HotKeyScenarioId>(initial ?? scenarios[0] ?? 'viral');
  const runRef = useRef<HotKeyRun | null>(null);
  if (!runRef.current) runRef.current = new HotKeyRun(hotKeyScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: HotKeyScenarioId) => {
    runRef.current = new HotKeyRun(hotKeyScenarios[id]);
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
  const chooseScenario = (id: HotKeyScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const [first, second] = run.lanes;
  const sums = [summarizeLane(first), summarizeLane(second)] as const;
  const seconds = run.ticks * run.tickSeconds;
  const wait = (value: number, column: number) => ((sums[column]?.served ?? 0) > 0 ? ms(value) : 'none yet');
  const bothServed = sums[0].served > 0 && sums[1].served > 0;

  const rows: CompareRow[] = [
    { label: 'Clicks in (same clicks)', values: [sums[0].arrived, sums[1].arrived] },
    { label: 'Served', values: [sums[0].served, sums[1].served], better: 'higher' },
    { label: 'Turned away (node full)', values: [sums[0].rejected, sums[1].rejected], better: 'lower' },
    {
      label: 'Busiest node, peak load',
      values: [sums[0].peakLoad, sums[1].peakLoad],
      format: (value) => `${value}%`,
      better: 'lower',
    },
    {
      label: 'p95 wait at the node, served clicks',
      values: [sums[0].p95Ms, sums[1].p95Ms],
      format: wait,
      better: bothServed ? 'lower' : undefined,
    },
    {
      label: 'Extra copies held',
      values: [sums[0].extraCopies, sums[1].extraCopies],
      better: 'lower',
    },
  ];

  const latest = (lane: HotKeyLane) => lane.series.at(-1) ?? 0;
  const laneText = (lane: HotKeyLane, index: 0 | 1) =>
    `${lane.label}: busiest node at ${latest(lane)}% of capacity, ${sums[index].rejected} clicks turned away`;
  const summary = `${seconds.toFixed(1)} s of ${HOT_KEY_SECONDS} s. ${laneText(first, 0)}. ${laneText(second, 1)}.`;
  const chartTitle = 'Busiest cache node, % of capacity over the last second';
  const chartSummary = `${chartTitle}. ${first.label} now ${latest(first)}%, peak ${first.peak.value}%. ${second.label} now ${latest(second)}%, peak ${second.peak.value}%.`;

  const markerEvents = run.events.filter((event) => event.marker);
  const notes = run.events.filter((event) => !event.marker);

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : run.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${HOT_KEY_SECONDS} s` } as const);

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
          caption="Whole run so far, same clicks for both"
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
          label: hotKeyScenarios[id].label,
          diff: hotKeyScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <PatternPanel run={run} />
      <div className="sdv-duel__lanes sdv-hotkey__lanes">
        {run.lanes.map((lane, index) => (
          <LanePane key={lane.strategy} lane={lane} variant={variants[index] ?? 'a'} topHome={run.topHome} />
        ))}
      </div>
      <ul className="sdv-legend sdv-hotkey__legend" aria-label="How to read the bars">
        <li>Bar length: clicks per second as a share of one node's {NODE_CAPACITY} req/s</li>
        <li>
          <span className="sdv-bars__track sdv-hotkey__sample" aria-hidden="true">
            <span className="sdv-bars__fill" data-full="true" />
          </span>
          Red stripes and "(full)": more clicks arrive than the node serves, so it queues and then turns
          clicks away
        </li>
      </ul>
      <TraceChart
        title={chartTitle}
        series={run.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={100}
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
                <time>{(event.tick * run.tickSeconds).toFixed(1)} s</time> {event.text}
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
