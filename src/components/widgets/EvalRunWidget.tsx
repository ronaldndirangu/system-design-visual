import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import {
  type BudgetVerdict,
  budgetLabels,
  candidates,
  checkBudgets,
  DEFAULT_BUDGETS,
  EvalRun,
  type EvalScenarioId,
  evalScenarios,
  joinNames,
  type LaneSummary,
  summarizeLane,
} from '../../lib/models/evalBudget';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { safeId } from '../viz/SystemNode';
import './EvalRunWidget.css';

interface Props {
  initial?: EvalScenarioId;
  title?: string;
  instructions?: string;
}

const scenarioIds: EvalScenarioId[] = ['demo', 'full'];
const categoryLabels = {
  refund: 'Refund',
  shipping: 'Shipping',
  account: 'Account',
  decline: 'Must decline',
} as const;

const AXIS_MAX = 4;
const PLOT_LEFT = 92;
const PLOT_RIGHT = 620;
const ROW_Y = [40, 88, 136] as const;
const AXIS_Y = 166;
const xFor = (seconds: number) =>
  PLOT_LEFT + (Math.min(seconds, AXIS_MAX) / AXIS_MAX) * (PLOT_RIGHT - PLOT_LEFT);

const seconds = (value: number) => `${value.toFixed(2)} s`;
const units = (value: number) => value.toLocaleString('en-US');
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function verdictText(verdict: BudgetVerdict): string {
  return verdict.fits
    ? 'Fits every budget'
    : `Misses ${joinNames(verdict.failed.map((check) => budgetLabels[check]))}`;
}

function LatencyTrack({ run, summaries }: { run: EvalRun; summaries: LaneSummary[] }) {
  const reduced = usePrefersReducedMotion();
  const move = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 140, damping: 20 };
  const budgetX = xFor(DEFAULT_BUDGETS.maxP95Seconds);
  return (
    <DiagramScroll label="Latency of every graded answer, scrollable">
      <svg
        className="sdv-eval__track"
        viewBox="0 0 640 196"
        role="img"
        aria-label={`Latency of each graded answer per candidate, 0 to ${AXIS_MAX} seconds, with the p95 budget line at ${DEFAULT_BUDGETS.maxP95Seconds} s. The readout table below lists the same numbers.`}
      >
        <line className="sdv-eval__budget" x1={budgetX} x2={budgetX} y1={16} y2={AXIS_Y} />
        <text className="sdv-eval__budget-label" x={budgetX + 4} y={14}>
          p95 budget {DEFAULT_BUDGETS.maxP95Seconds} s
        </text>
        {run.lanes.map((lane, row) => {
          const y = ROW_Y[row] ?? 0;
          const summary = summaries[row];
          const p95X = xFor(summary?.p95Seconds ?? 0);
          const graded = (summary?.graded ?? 0) > 0;
          return (
            <g key={lane.candidate.id}>
              <text className="sdv-eval__row-label" x={8} y={y + 4}>
                {lane.candidate.label}
              </text>
              <line className="sdv-eval__row-rule" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
              {lane.results.map((result, index) => {
                const x = xFor(result.latencySeconds);
                const dy = ((index % 3) - 1) * 7;
                return result.pass ? (
                  <m.circle
                    key={result.caseId}
                    className="sdv-eval__dot"
                    cx={x}
                    cy={y + dy}
                    r={4.5}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.3 }}
                  />
                ) : (
                  <m.path
                    key={result.caseId}
                    className="sdv-eval__fail"
                    d={`M${x - 5} ${y + dy - 5}L${x + 5} ${y + dy + 5}M${x + 5} ${y + dy - 5}L${x - 5} ${y + dy + 5}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.3 }}
                  />
                );
              })}
              {graded && (
                <m.g initial={false} animate={{ x: p95X }} transition={move}>
                  <line className="sdv-eval__p95" x1={0} x2={0} y1={y - 16} y2={y + 16} />
                  <text className="sdv-eval__p95-label" x={4} y={y - 12}>
                    p95
                  </text>
                </m.g>
              )}
            </g>
          );
        })}
        <g className="sdv-axis">
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={AXIS_Y} y2={AXIS_Y} />
          {[0, 1, 2, 3, 4].map((tick) => (
            <g key={tick}>
              <line x1={xFor(tick)} x2={xFor(tick)} y1={AXIS_Y} y2={AXIS_Y + 5} />
              <text x={xFor(tick)} y={AXIS_Y + 18} textAnchor="middle">
                {tick} s
              </text>
            </g>
          ))}
        </g>
      </svg>
    </DiagramScroll>
  );
}

export default function EvalRunWidget({
  initial = 'demo',
  title = 'Grade three candidates on the same questions',
  instructions = 'Pick a question set, predict the result, then press Play. Each step grades one question with all three candidates.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const baseId = safeId(useId(), 'eval');
  const [scenarioId, setScenarioId] = useState<EvalScenarioId>(initial);
  const runRef = useRef<EvalRun | null>(null);
  runRef.current ??= new EvalRun(scenarioId);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: EvalScenarioId) => {
    runRef.current = new EvalRun(id);
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
  const chooseScenario = (id: EvalScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const summaries = run.lanes.map(summarizeLane);
  const verdicts = summaries.map((summary) => checkBudgets(summary, DEFAULT_BUDGETS));
  const current = run.current;
  const started = run.ticks > 0;

  const summary = started
    ? `${run.ticks} of ${run.length} questions graded. ${summaries
        .map(
          (s) =>
            `${candidates[s.candidate].label}: ${s.passed} passed, p95 ${seconds(s.p95Seconds)}, ${verdictText(
              checkBudgets(s, DEFAULT_BUDGETS),
            ).toLowerCase()}`,
        )
        .join('. ')}.`
    : `No questions graded yet. ${run.length} questions in this set.`;

  const status = run.done
    ? scenarioId === 'demo'
      ? ({ tone: 'warn', text: 'Run complete: every candidate passed every demo question' } as const)
      : ({ tone: 'ok', text: 'Run complete' } as const)
    : started
      ? ({ tone: 'neutral', text: `Question ${run.ticks} of ${run.length}` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  const markerEvents = run.events.filter((event) => event.marker);
  const notes = run.events.filter((event) => !event.marker);
  const anyDeclines = summaries.some((s) => s.declineCases > 0);

  const rows: { label: string; cells: string[] }[] = [
    { label: 'Questions graded', cells: summaries.map((s) => String(s.graded)) },
    {
      label: 'Passed the rubric',
      cells: summaries.map((s) => (s.graded > 0 ? `${s.passed} (${percent(s.passRate)})` : 'none yet')),
    },
    {
      label: 'Must decline cases declined',
      cells: summaries.map((s) =>
        s.declineCases > 0
          ? `${s.declinesHandled} of ${s.declineCases}`
          : anyDeclines
            ? '0 of 0'
            : 'none in this set',
      ),
    },
    {
      label: 'p95 latency',
      cells: summaries.map((s) => (s.graded > 0 ? seconds(s.p95Seconds) : 'none yet')),
    },
    {
      label: 'Cost per 1,000 questions (units)',
      cells: summaries.map((s) => (s.graded > 0 ? units(s.costPer1k) : 'none yet')),
    },
  ];

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
      ticksPerSecond={2}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <DiagramScroll label="Grades so far, scrollable">
          <table className="sdv-stats sdv-compare sdv-eval__table">
            <caption>
              Grades so far. Default budgets: pass {DEFAULT_BUDGETS.minPassRate * 100}% or more, decline every
              must decline case, p95 at most {DEFAULT_BUDGETS.maxP95Seconds} s, at most{' '}
              {units(DEFAULT_BUDGETS.maxCostPer1k)} units per 1,000 questions.
            </caption>
            <thead>
              <tr>
                <td />
                {run.lanes.map((lane) => (
                  <th key={lane.candidate.id} scope="col">
                    {lane.candidate.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => (
                    <td key={run.lanes[index]?.candidate.id}>
                      <span className="sdv-stats__value">{cell}</span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">Default budgets</th>
                {verdicts.map((verdict, index) => (
                  <td key={run.lanes[index]?.candidate.id}>
                    {started ? (
                      <ToneBadge tone={verdict.fits ? 'ok' : 'bad'}>{verdictText(verdict)}</ToneBadge>
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
        label="Question set"
        value={scenarioId}
        options={scenarioIds.map((id) => ({
          value: id,
          label: evalScenarios[id].label,
          diff: evalScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-eval__now">
          <p className="sdv-eval__now-title">Now grading</p>
          {current ? (
            <m.div
              key={current.id}
              className="sdv-eval__now-body"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <p className="sdv-eval__question">
                <span className="sdv-eval__qid">{current.id.toUpperCase()}</span>
                <span className="sdv-eval__category" data-category={current.category}>
                  {categoryLabels[current.category]}
                </span>
                <q>{current.text}</q>
              </p>
              <ul className="sdv-eval__grades" aria-label="Fixture grades for this question">
                {run.lanes.map((lane) => {
                  const result = lane.results.at(-1);
                  if (!result) return null;
                  return (
                    <li key={lane.candidate.id}>
                      <ToneBadge tone={result.pass ? 'ok' : 'bad'}>
                        {`${lane.candidate.label}: ${result.pass ? 'pass' : 'fail'}, ${seconds(result.latencySeconds)}`}
                      </ToneBadge>
                    </li>
                  );
                })}
              </ul>
            </m.div>
          ) : (
            <p className="sdv-trace__empty">Press Play or Step to grade the first question.</p>
          )}
        </div>
        <div className="sdv-duel__lanes sdv-eval__lanes">
          {run.lanes.map((lane, index) => {
            const s = summaries[index];
            const stripId = `${baseId}-${lane.candidate.id}`;
            return (
              <section key={lane.candidate.id} className="sdv-duel__lane" aria-label={lane.candidate.label}>
                <h4 className="sdv-duel__lane-title">{lane.candidate.label}</h4>
                <div className="sdv-strip">
                  <p className="sdv-strip__label" id={stripId}>
                    Grades, in order
                  </p>
                  <ol className="sdv-strip__items" aria-labelledby={stripId}>
                    {lane.results.map((result) => (
                      <li
                        key={result.caseId}
                        className={result.pass ? 'sdv-strip__hit' : 'sdv-strip__bad'}
                        title={`${result.caseId.toUpperCase()}: ${result.pass ? 'pass' : 'fail'}`}
                      >
                        <span className="sdv-visually-hidden">
                          {`${result.caseId.toUpperCase()} ${result.pass ? 'pass' : 'fail'}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                <p className="sdv-eval__lane-meta">
                  {s && s.graded > 0
                    ? `${s.passed} of ${s.graded} passed, p95 ${seconds(s.p95Seconds)}`
                    : 'Waiting for the first question'}
                </p>
              </section>
            );
          })}
        </div>
        <LatencyTrack run={run} summaries={summaries} />
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the grades">
        <li>
          <span className="sdv-strip__hit" aria-hidden="true" /> Pass: the fixture answer meets the rubric
        </li>
        <li>
          <span className="sdv-strip__bad" aria-hidden="true" /> Fail: it breaks the rubric or misses a
          decline
        </li>
        <li>
          <span className="sdv-eval__legend-p95" aria-hidden="true" /> p95: 95% of answers came back at or
          under this time
        </li>
        <li>Grades are fixtures written for this lesson. Latency and cost are illustrative.</li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">Failed answers appear here as the run grades them.</p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>Question {event.tick}</time> {event.text}
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
