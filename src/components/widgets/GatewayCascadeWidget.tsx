import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import { DEFAULT_BUDGETS, joinNames } from '../../lib/models/evalBudget';
import {
  budgetNames,
  CascadeDuel,
  type CascadeResult,
  type CascadeSummary,
  type MixId,
  mediumRequest,
  missedBudgets,
  mixes,
  mixOrder,
  summarizeCascadeLane,
  summarizeResults,
  type TierId,
} from '../../lib/models/gatewayCascade';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots } from '../viz/FlowDots';
import { link, type Vec } from '../viz/geometry';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';
import './GatewayWidgets.css';

interface Props {
  initial?: MixId;
  title?: string;
  instructions?: string;
}

const tierNames: Record<TierId, string> = { small: 'Small', medium: 'Medium' };

const ROUTE = {
  entry: [20, 90] as Vec,
  classifier: { x: 170, y: 90 },
  small: { x: 440, y: 50 },
  medium: { x: 440, y: 130 },
};
const CASCADE = {
  entry: [20, 250] as Vec,
  small: { x: 170, y: 250 },
  checker: { x: 360, y: 250 },
  medium: { x: 550, y: 250 },
};
const center = (node: { x: number; y: number }): Vec => [node.x, node.y];
const entryEnd = (node: { x: number; y: number }): Vec => [node.x - 62, node.y];

const seconds = (value: number) => `${value.toFixed(2)} s`;
const units = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function pathText(result: CascadeResult): string {
  return result.tiers.map((tier) => tierNames[tier]).join(' then ');
}

function verdictText(summary: CascadeSummary): string {
  const misses = missedBudgets(summary);
  return misses.length === 0
    ? 'Fits every budget'
    : `Misses ${joinNames(misses.map((budget) => budgetNames[budget]))}`;
}

function routingNote(result: CascadeResult): string {
  return result.misrouted ? ', misrouted' : '';
}

function cascadeNote(result: CascadeResult): string {
  if (result.falseAlarm) return ', escalated on a false alarm';
  if (result.escalated) return ', escalated';
  if (result.missedBad) return ', checker missed a bad answer';
  return ', accepted';
}

function laneLine(strategy: 'routing' | 'cascade', summary: CascadeSummary | undefined): string {
  if (!summary || summary.handled === 0) return 'Waiting for the first request';
  const extra =
    strategy === 'routing' ? `${summary.misroutes} misroutes` : `${summary.escalations} escalations`;
  return `${summary.passed} of ${summary.handled} passed, ${extra}`;
}

function summaryLine(label: string, summary: CascadeSummary, extra: string): string {
  return `${label}: ${summary.passed} passed, p95 ${seconds(summary.p95Seconds)}, ${units(
    summary.costPer1k,
  )} units per 1,000${extra}, ${verdictText(summary).toLowerCase()}`;
}

export default function GatewayCascadeWidget({
  initial = 'easy',
  title = 'Routing versus a cascade on the same questions',
  instructions = 'Pick a question mix, then press Play or Step. Each step sends the same question through routing and through a cascade.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const baseId = safeId(useId(), 'gw-cascade');
  const arrow = `${baseId}-arrow`;
  const [mixId, setMixId] = useState<MixId>(initial);
  const runRef = useRef<CascadeDuel | null>(null);
  const generation = useRef(0);
  runRef.current ??= new CascadeDuel(mixId);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: MixId) => {
    runRef.current = new CascadeDuel(id);
    generation.current += 1;
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
  const chooseMix = (id: MixId) => {
    setMixId(id);
    restart(id);
  };

  const [routingLane, cascadeLane] = run.lanes;
  const routingSummary = routingLane ? summarizeCascadeLane(routingLane) : undefined;
  const cascadeSummary = cascadeLane ? summarizeCascadeLane(cascadeLane) : undefined;
  const mediumSummary = summarizeResults('medium', run.workload.slice(0, run.ticks).map(mediumRequest));
  const columns = [
    { key: 'routing', label: 'Routing', summary: routingSummary },
    { key: 'cascade', label: 'Cascade', summary: cascadeSummary },
    { key: 'medium', label: 'Medium alone', summary: mediumSummary },
  ];
  const current = run.current;
  const routed = routingLane?.results.at(-1);
  const cascaded = cascadeLane?.results.at(-1);
  const started = run.ticks > 0;

  const summary =
    started && routingSummary && cascadeSummary
      ? `${run.ticks} of ${run.length} requests. ${summaryLine(
          'Routing',
          routingSummary,
          `, ${routingSummary.misroutes} misroutes`,
        )}. ${summaryLine('Cascade', cascadeSummary, `, ${cascadeSummary.escalations} escalations`)}. ${summaryLine(
          'Medium alone',
          mediumSummary,
          '',
        )}.`
      : `No requests yet. This mix has ${run.length} questions: ${run.mix.diff}.`;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete: compare the budget row' } as const)
    : started
      ? ({ tone: 'neutral', text: `Request ${run.ticks} of ${run.length}` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  const nowText =
    current && routed && cascaded
      ? `Request ${current.id} is ${current.difficulty}. Routing sent it to ${pathText(routed)}${routingNote(
          routed,
        )} and it ${routed.pass ? 'passed' : 'failed'}. The cascade called ${pathText(cascaded)}${cascadeNote(
          cascaded,
        )}, and it ${cascaded.pass ? 'passed' : 'failed'}.`
      : 'No request yet.';

  const flows: Flow[] = [];
  if (current && routed && cascaded) {
    const routedTier = routed.tiers[0] === 'small' ? ROUTE.small : ROUTE.medium;
    flows.push({
      id: `${generation.current}-routing-${current.id}`,
      points: [ROUTE.entry, center(ROUTE.classifier), center(routedTier)],
      tone: routed.pass ? 'hit' : 'bad',
      duration: 0.3,
    });
    flows.push({
      id: `${generation.current}-cascade-${current.id}`,
      points: [
        CASCADE.entry,
        center(CASCADE.small),
        center(CASCADE.checker),
        ...(cascaded.escalated ? [center(CASCADE.medium)] : []),
      ],
      tone: cascaded.pass ? 'hit' : 'bad',
      duration: 0.3,
    });
  }

  const routedTier = routed?.tiers[0];
  const toSmall = link(ROUTE.classifier, ROUTE.small);
  const toMedium = link(ROUTE.classifier, ROUTE.medium);
  const toChecker = link(CASCADE.small, CASCADE.checker);
  const escalate = link(CASCADE.checker, CASCADE.medium);

  const rows: { label: string; cells: string[] }[] = [
    { label: 'Requests handled', cells: columns.map((c) => String(c.summary?.handled ?? 0)) },
    {
      label: 'Passed the rubric',
      cells: columns.map((c) =>
        c.summary && c.summary.handled > 0
          ? `${c.summary.passed} (${percent(c.summary.passRate)})`
          : 'none yet',
      ),
    },
    {
      label: 'p95 latency',
      cells: columns.map((c) =>
        c.summary && c.summary.handled > 0 ? seconds(c.summary.p95Seconds) : 'none yet',
      ),
    },
    {
      label: 'Cost per 1,000 requests (units)',
      cells: columns.map((c) =>
        c.summary && c.summary.handled > 0 ? c.summary.costPer1k.toLocaleString('en-US') : 'none yet',
      ),
    },
    {
      label: 'Escalations (paid twice)',
      cells: columns.map((c) =>
        c.key === 'cascade' ? String(c.summary?.escalations ?? 0) : 'does not apply',
      ),
    },
    {
      label: 'Misroutes',
      cells: columns.map((c) => (c.key === 'routing' ? String(c.summary?.misroutes ?? 0) : 'does not apply')),
    },
  ];

  const markerEvents = run.events.filter((event) => event.marker);
  const notes = run.events.filter((event) => !event.marker);

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(mixId)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={mixId}
      ticksPerSecond={3}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <DiagramScroll label="Results so far, scrollable">
          <table className="sdv-stats sdv-compare sdv-gw-table">
            <caption>
              Results so far on the same requests. Lesson 1 budgets: pass {DEFAULT_BUDGETS.minPassRate * 100}%
              or more, p95 at most {DEFAULT_BUDGETS.maxP95Seconds} s, at most{' '}
              {DEFAULT_BUDGETS.maxCostPer1k.toLocaleString('en-US')} units per 1,000 requests.
            </caption>
            <thead>
              <tr>
                <td />
                {columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => (
                    <td key={columns[index]?.key}>
                      <span className="sdv-stats__value">{cell}</span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">Lesson 1 budgets</th>
                {columns.map((column) => (
                  <td key={column.key} className="sdv-gw-pin">
                    {started && column.summary ? (
                      <ToneBadge tone={missedBudgets(column.summary).length === 0 ? 'ok' : 'bad'}>
                        {verdictText(column.summary)}
                      </ToneBadge>
                    ) : (
                      <span className="sdv-stats__value">none yet</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </DiagramScroll>
      }
    >
      <ScenarioChips
        label="Question mix"
        value={mixId}
        options={mixOrder.map((id) => ({ value: id, label: mixes[id].label, diff: mixes[id].diff }))}
        onChange={chooseMix}
      />
      <MotionRoot>
        <div className="sdv-gw-now">
          <p className="sdv-gw-title">Now handling</p>
          {current && routed && cascaded ? (
            <m.div
              key={`${generation.current}-${current.id}`}
              className="sdv-gw-now-body"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <p className="sdv-gw-line">
                <span className="sdv-gw-id">Request {current.id}</span>
                <span className="sdv-gw-pill">
                  {current.difficulty === 'easy' ? 'Easy' : 'Hard'} question
                </span>
                <span className="sdv-gw-pill" data-emphasis={current.predicted !== current.difficulty}>
                  {`Classifier guess: ${current.predicted}${current.predicted !== current.difficulty ? ' (wrong)' : ''}`}
                </span>
              </p>
              <ul className="sdv-gw-badges" aria-label="What each lane did with this request">
                <li>
                  <ToneBadge tone={routed.pass ? 'ok' : 'bad'}>
                    {`Routing: ${pathText(routed)}${routingNote(routed)}, ${routed.pass ? 'pass' : 'fail'}, ${seconds(
                      routed.latencySeconds,
                    )}, ${units(routed.cost)} units`}
                  </ToneBadge>
                </li>
                <li>
                  <ToneBadge tone={cascaded.pass ? 'ok' : 'bad'}>
                    {`Cascade: ${pathText(cascaded)}${cascadeNote(cascaded)}, ${
                      cascaded.pass ? 'pass' : 'fail'
                    }, ${seconds(cascaded.latencySeconds)}, ${units(cascaded.cost)} units`}
                  </ToneBadge>
                </li>
              </ul>
            </m.div>
          ) : (
            <p className="sdv-trace__empty">
              Press Play or Step to send the first request through both lanes.
            </p>
          )}
        </div>
        <DiagramScroll label="Routing and cascade paths, scrollable">
          <svg
            className="sdv-gw-diagram"
            viewBox="0 0 640 310"
            role="img"
            aria-label={`Two gateway lanes. Routing: a classifier picks Small or Medium before the call. Cascade: Small answers first, and a checker accepts the answer or escalates to Medium. ${nowText}`}
          >
            <ArrowDefs id={arrow} />
            <text className="sdv-gw-svg-title" x={12} y={22}>
              Routing
            </text>
            <text className="sdv-chart__label" x={20} y={80}>
              question
            </text>
            <Edge
              from={ROUTE.entry}
              to={entryEnd(ROUTE.classifier)}
              marker={arrow}
              active={Boolean(routed)}
            />
            <Edge from={toSmall.from} to={toSmall.to} marker={arrow} active={routedTier === 'small'} />
            <Edge from={toMedium.from} to={toMedium.to} marker={arrow} active={routedTier === 'medium'} />
            <text className="sdv-chart__label" x={300} y={52} textAnchor="middle">
              guess: easy
            </text>
            <text className="sdv-chart__label" x={300} y={140} textAnchor="middle">
              guess: hard
            </text>
            <SystemNode
              kind="loadBalancer"
              x={ROUTE.classifier.x}
              y={ROUTE.classifier.y}
              label="Classifier"
              sublabel="guesses difficulty"
              highlight={Boolean(routed)}
            />
            <SystemNode
              kind="model"
              x={ROUTE.small.x}
              y={ROUTE.small.y}
              label="Small"
              highlight={routedTier === 'small'}
              dim={Boolean(routed) && routedTier !== 'small'}
            />
            <SystemNode
              kind="model"
              x={ROUTE.medium.x}
              y={ROUTE.medium.y}
              label="Medium"
              highlight={routedTier === 'medium'}
              dim={Boolean(routed) && routedTier !== 'medium'}
            />
            <line className="sdv-gw-divider" x1={0} x2={640} y1={180} y2={180} />
            <text className="sdv-gw-svg-title" x={12} y={204}>
              Cascade
            </text>
            <text className="sdv-chart__label" x={20} y={240}>
              question
            </text>
            <Edge
              from={CASCADE.entry}
              to={entryEnd(CASCADE.small)}
              marker={arrow}
              active={Boolean(cascaded)}
            />
            <Edge from={toChecker.from} to={toChecker.to} marker={arrow} active={Boolean(cascaded)} />
            <Edge
              from={escalate.from}
              to={escalate.to}
              marker={arrow}
              active={cascaded?.escalated ?? false}
              dashed
            />
            <text className="sdv-chart__label" x={455} y={238} textAnchor="middle">
              rejected
            </text>
            <SystemNode
              kind="model"
              x={CASCADE.small.x}
              y={CASCADE.small.y}
              label="Small"
              highlight={Boolean(cascaded)}
            />
            <SystemNode
              kind="server"
              x={CASCADE.checker.x}
              y={CASCADE.checker.y}
              label="Checker"
              sublabel="accept or escalate"
              highlight={Boolean(cascaded)}
            />
            <SystemNode
              kind="model"
              x={CASCADE.medium.x}
              y={CASCADE.medium.y}
              label="Medium"
              highlight={cascaded?.escalated ?? false}
              dim={Boolean(cascaded) && !cascaded?.escalated}
            />
            <FlowDots flows={flows} />
          </svg>
        </DiagramScroll>
        <div className="sdv-duel__lanes">
          {run.lanes.map((lane) => {
            const stripId = `${baseId}-${lane.strategy}`;
            const laneSummary = lane.strategy === 'routing' ? routingSummary : cascadeSummary;
            return (
              <section key={lane.strategy} className="sdv-duel__lane" aria-label={lane.label}>
                <h4 className="sdv-duel__lane-title">{lane.label}</h4>
                <div className="sdv-strip">
                  <p className="sdv-strip__label" id={stripId}>
                    Results, in order
                  </p>
                  <ol className="sdv-strip__items" aria-labelledby={stripId}>
                    {lane.results.map((result) => {
                      const flagged = lane.strategy === 'routing' ? result.misrouted : result.escalated;
                      const note = lane.strategy === 'routing' ? routingNote(result) : cascadeNote(result);
                      const text = `Request ${result.requestId}: ${pathText(result)}${note}, ${
                        result.pass ? 'pass' : 'fail'
                      }`;
                      const classes = [result.pass ? 'sdv-strip__hit' : 'sdv-strip__bad'];
                      if (flagged) classes.push('sdv-gw-flag');
                      return (
                        <li key={result.requestId} className={classes.join(' ')} title={text}>
                          <span className="sdv-visually-hidden">{text}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <p className="sdv-gw-meta">{laneLine(lane.strategy, laneSummary)}</p>
              </section>
            );
          })}
        </div>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the results">
        <li>
          <span className="sdv-strip__hit" aria-hidden="true" /> Pass: the answer meets the rubric
        </li>
        <li>
          <span className="sdv-strip__bad" aria-hidden="true" /> Fail: it does not
        </li>
        <li>
          <span className="sdv-strip__hit sdv-gw-flag" aria-hidden="true" /> Ring: routing misrouted it, or
          the cascade escalated it and paid for two calls
        </li>
        <li>
          Pass chances, the classifier, and the checker are toy numbers. Latency and cost are illustrative
          units.
        </li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">The first misroute, escalation, and checker mistake appear here.</p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>Request {event.tick}</time> {event.text}
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
