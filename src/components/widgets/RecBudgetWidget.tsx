import { m } from 'motion/react';
import { useState } from 'react';
import {
  budgetCrossing,
  CURVE_CANDIDATES,
  type CurvePoint,
  candidateCurve,
  count,
  formatMs,
  REC_BUDGET_MS,
  RELEVANT_TOTAL,
  SHOWN,
  splitBudget,
} from '../../lib/models/recFunnel';
import { Slider } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { type StatRow, ToneBadge } from '../sim/StatTable';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { WidgetFrame } from '../sim/WidgetFrame';
import { DiagramScroll } from '../viz/DiagramScroll';
import './RecBudgetWidget.css';

const curve = candidateCurve();
const crossing = budgetCrossing(curve);
const crossingLabel = crossing === undefined ? undefined : count(Math.round(crossing / 100) * 100);
const DEFAULT_INDEX = CURVE_CANDIDATES.indexOf(500);

const W = 640;
const H = 340;
const LEFT = 70;
const RIGHT = 610;
const RECALL_TOP = 28;
const RECALL_BOTTOM = 130;
const LAT_TOP = 170;
const LAT_BOTTOM = 280;
const LAT_MAX = 200;
const LOG_MIN = 1;
const LOG_MAX = Math.log10(20000);
const FLIP_X = 480;

const xFor = (candidates: number) =>
  LEFT + ((Math.log10(candidates) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (RIGHT - LEFT);
const recallY = (recall: number) => RECALL_BOTTOM - recall * (RECALL_BOTTOM - RECALL_TOP);
const latY = (ms: number) => LAT_BOTTOM - (Math.min(ms, LAT_MAX) / LAT_MAX) * (LAT_BOTTOM - LAT_TOP);
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;
const knownGood = (point: CurvePoint) => Math.round(point.recall * RELEVANT_TOTAL);
const pathFor = (y: (point: CurvePoint) => number) =>
  curve.map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(point.candidates)} ${y(point)}`).join(' ');

const recallPath = pathFor((point) => recallY(point.recall));
const latencyPath = pathFor((point) => latY(point.totalMs));
const clamped = curve.filter((point) => point.totalMs > LAT_MAX);
const fallback: CurvePoint = {
  candidates: 0,
  unique: 0,
  recall: 0,
  candidateMs: 0,
  rankerMs: 0,
  totalMs: 0,
  goodShown: 0,
  bestShown: false,
  overBudget: false,
};

function splitText(candidates: number): string {
  const { embed = 0, together = 0, category = 0 } = splitBudget(candidates).sources;
  return `${count(embed)} embedding neighbors, ${count(together)} bought together, ${count(category)} popular in category`;
}

function verdict(point: CurvePoint): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (point.overBudget) return { tone: 'bad', text: `Over the ${REC_BUDGET_MS} ms budget` };
  if (!point.bestShown || point.goodShown < SHOWN)
    return { tone: 'warn', text: 'Fast, but misses good items' };
  return { tone: 'ok', text: `Within budget, top ${SHOWN} all good` };
}

export default function RecBudgetWidget({
  title = 'How many candidates should the ranker see?',
  instructions = 'Drag the slider. The top chart shows how many known good replacements reach the ranker; the bottom chart shows the total time for one request against the budget.',
}: {
  title?: string;
  instructions?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(DEFAULT_INDEX);
  const point = curve[index] ?? fallback;
  const status = verdict(point);
  const good = knownGood(point);

  const summary = `${count(point.candidates)} candidates: ${count(point.unique)} unique items reach the ranker, including ${good} of ${RELEVANT_TOTAL} known good replacements. The best replacement is ${point.bestShown ? 'shown' : 'missed'}, and ${point.goodShown} of the top ${SHOWN} are good. Total ${formatMs(point.totalMs)}, ${point.overBudget ? 'over' : 'within'} the ${REC_BUDGET_MS} ms budget.`;

  const stats: StatRow[] = [
    { label: 'Candidates requested', value: count(point.candidates), detail: splitText(point.candidates) },
    {
      label: 'Unique after merge',
      value: count(point.unique),
      detail: `${count(point.candidates - point.unique)} duplicates removed`,
    },
    {
      label: 'Known good reaching the ranker',
      value: `${good} of ${RELEVANT_TOTAL}`,
      tone: point.recall >= 0.9 ? 'ok' : 'warn',
      detail: `candidate recall ${pct(point.recall)}`,
    },
    {
      label: 'Best replacement shown',
      value: point.bestShown ? 'Yes' : 'No',
      tone: point.bestShown ? 'ok' : 'bad',
      detail: point.bestShown ? '50 ft blue garden hose' : 'it never reached the ranker',
    },
    { label: 'Candidate time', value: formatMs(point.candidateMs), detail: 'all sources run in parallel' },
    {
      label: 'Ranker time',
      value: formatMs(point.rankerMs),
      detail: 'grows with every unique candidate',
    },
    {
      label: 'Total time',
      value: formatMs(point.totalMs),
      tone: point.overBudget ? 'bad' : 'ok',
      detail: `budget ${REC_BUDGET_MS} ms`,
    },
    {
      label: `Good in the top ${SHOWN}`,
      value: `${point.goodShown} of ${SHOWN}`,
      tone: point.goodShown === SHOWN ? 'ok' : 'warn',
    },
  ];

  const move = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 140, damping: 20 };
  const x = xFor(point.candidates);
  const flip = x > FLIP_X;
  const anchor = flip ? 'end' : 'start';
  const valueX = flip ? x - 8 : x + 8;
  const rY = recallY(point.recall);
  const lY = latY(point.totalMs);
  const labelX = Math.min(Math.max(x, LEFT + 50), RIGHT - 50);
  const crossX = crossing === undefined ? undefined : xFor(crossing);
  const budgetY = latY(REC_BUDGET_MS);

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      status={status}
      stats={stats}
      statsCaption="One request for a replacement 50 ft green garden hose at the selected candidate count. Items are fixtures; every time is illustrative."
      controls={
        <Slider
          label="Candidates sent to the ranker"
          value={index}
          min={0}
          max={CURVE_CANDIDATES.length - 1}
          onChange={setIndex}
          format={(i) => count(CURVE_CANDIDATES[i] ?? 0)}
          hint="Each step splits the total: 60% embedding neighbors, 25% bought together, 15% popular in category."
        />
      }
    >
      <MotionRoot>
        <DiagramScroll label="Recall and latency chart, scrollable">
          <svg
            className="sdv-rec-budget__chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Two charts that share a log scale of candidates from 10 to 20,000. Top: candidate recall climbs from ${pct(curve[0]?.recall ?? 0)} at 10 candidates to 90% at 500 and 100% at 2,000. Bottom: total time stays under the ${REC_BUDGET_MS} ms budget until about ${crossingLabel ?? 'the end'} candidates. ${summary}`}
          >
            <g className="sdv-axis">
              <line x1={LEFT} x2={RIGHT} y1={RECALL_BOTTOM} y2={RECALL_BOTTOM} />
              <line x1={LEFT} x2={LEFT} y1={RECALL_TOP} y2={RECALL_BOTTOM} />
              {[0, 0.5, 1].map((tick) => (
                <g key={`r${tick}`}>
                  <line x1={LEFT - 5} x2={LEFT} y1={recallY(tick)} y2={recallY(tick)} />
                  <text x={LEFT - 8} y={recallY(tick) + 4} textAnchor="end">
                    {pct(tick)}
                  </text>
                </g>
              ))}
              <line x1={LEFT} x2={RIGHT} y1={LAT_BOTTOM} y2={LAT_BOTTOM} />
              <line x1={LEFT} x2={LEFT} y1={LAT_TOP} y2={LAT_BOTTOM} />
              {[0, 100, 200].map((tick) => (
                <g key={`l${tick}`}>
                  <line x1={LEFT - 5} x2={LEFT} y1={latY(tick)} y2={latY(tick)} />
                  <text x={LEFT - 8} y={latY(tick) + 4} textAnchor="end">
                    {tick} ms
                  </text>
                </g>
              ))}
              {[10, 100, 1000, 10000, 20000].map((tick) => (
                <g key={`x${tick}`}>
                  <line x1={xFor(tick)} x2={xFor(tick)} y1={LAT_BOTTOM} y2={LAT_BOTTOM + 5} />
                  <text x={xFor(tick)} y={LAT_BOTTOM + 18} textAnchor="middle">
                    {count(tick)}
                  </text>
                </g>
              ))}
              <text x={(LEFT + RIGHT) / 2} y={H - 14} textAnchor="middle">
                Candidates sent to the ranker (log scale)
              </text>
              <text
                transform={`rotate(-90) translate(${-(RECALL_TOP + RECALL_BOTTOM) / 2} 16)`}
                textAnchor="middle"
              >
                Recall
              </text>
              <text
                transform={`rotate(-90) translate(${-(LAT_TOP + LAT_BOTTOM) / 2} 16)`}
                textAnchor="middle"
              >
                Total time
              </text>
            </g>

            <line className="sdv-rec-budget__budget" x1={LEFT} x2={RIGHT} y1={budgetY} y2={budgetY} />
            <text className="sdv-rec-budget__note" x={LEFT + 6} y={budgetY - 6}>
              {REC_BUDGET_MS} ms budget
            </text>
            {crossX !== undefined && (
              <g>
                <line
                  className="sdv-rec-budget__cross"
                  x1={crossX}
                  x2={crossX}
                  y1={LAT_TOP}
                  y2={LAT_BOTTOM}
                />
                <text className="sdv-rec-budget__note" x={crossX - 6} y={LAT_TOP + 16} textAnchor="end">
                  crosses {REC_BUDGET_MS} ms near {crossingLabel}
                </text>
              </g>
            )}
            <text className="sdv-rec-budget__note" x={RIGHT} y={RECALL_BOTTOM - 10} textAnchor="end">
              Recall gains slow after a few hundred
            </text>

            <path className="sdv-rec-budget__line sdv-rec-budget__line--recall" d={recallPath} />
            <path className="sdv-rec-budget__line sdv-rec-budget__line--latency" d={latencyPath} />
            {curve.map((p) => (
              <g key={p.candidates}>
                <circle
                  className="sdv-rec-budget__point sdv-rec-budget__point--recall"
                  cx={xFor(p.candidates)}
                  cy={recallY(p.recall)}
                  r={3.5}
                />
                <rect
                  className={`sdv-rec-budget__point sdv-rec-budget__point--latency${p.overBudget ? ' sdv-rec-budget__point--over' : ''}`}
                  x={xFor(p.candidates) - 3.5}
                  y={latY(p.totalMs) - 3.5}
                  width={7}
                  height={7}
                />
              </g>
            ))}
            {clamped.map((p) => (
              <g key={`clamp${p.candidates}`}>
                <path
                  className="sdv-rec-budget__chevron"
                  d={`M${xFor(p.candidates) - 5} ${LAT_TOP - 6}l5 -6l5 6`}
                />
                <text
                  className="sdv-rec-budget__note"
                  x={xFor(p.candidates) - 10}
                  y={LAT_TOP - 8}
                  textAnchor="end"
                >
                  off the scale at {count(p.candidates)}: {formatMs(Math.round(p.totalMs))}
                </text>
              </g>
            ))}

            <m.line
              className="sdv-rec-budget__selected"
              y1={RECALL_TOP - 4}
              y2={LAT_BOTTOM}
              initial={false}
              animate={{ x1: x, x2: x }}
              transition={move}
            />
            <m.text
              className="sdv-rec-budget__selected-label"
              y={RECALL_TOP - 12}
              textAnchor="middle"
              initial={false}
              animate={{ x: labelX }}
              transition={move}
            >
              {count(point.candidates)} candidates
            </m.text>
            <m.circle
              className="sdv-rec-budget__ring sdv-rec-budget__ring--recall"
              r={7}
              initial={false}
              animate={{ cx: x, cy: rY }}
              transition={move}
            />
            <m.text
              className="sdv-rec-budget__value"
              textAnchor={anchor}
              initial={false}
              animate={{ x: valueX, y: rY + 18 }}
              transition={move}
            >
              {good} of {RELEVANT_TOTAL} good ({pct(point.recall)})
            </m.text>
            <m.circle
              className="sdv-rec-budget__ring sdv-rec-budget__ring--latency"
              r={7}
              initial={false}
              animate={{ cx: x, cy: lY }}
              transition={move}
            />
            {point.totalMs <= LAT_MAX && (
              <m.text
                className="sdv-rec-budget__value"
                textAnchor={anchor}
                initial={false}
                animate={{ x: valueX, y: lY - 10 }}
                transition={move}
              >
                {formatMs(point.totalMs)}
              </m.text>
            )}
          </svg>
        </DiagramScroll>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the chart">
        <li>
          <span className="sdv-rec-budget__key sdv-rec-budget__key--recall" aria-hidden="true" /> Solid line,
          circles: share of the {RELEVANT_TOTAL} known good items that reach the ranker
        </li>
        <li>
          <span className="sdv-rec-budget__key sdv-rec-budget__key--latency" aria-hidden="true" /> Dashed
          line, squares: total time for one request
        </li>
        <li>
          <span className="sdv-rec-budget__key sdv-rec-budget__key--budget" aria-hidden="true" /> Dotted line:
          the {REC_BUDGET_MS} ms budget
        </li>
        <li>Dash and dot line: where total time crosses the budget</li>
        <li>Ringed points and the vertical line: your selection</li>
      </ul>
      <p className="sdv-rec-budget__caveat">
        Toy request: the top {SHOWN} stops improving at 50 candidates here, while recall keeps climbing to 90%
        at 500 and 100% at 2,000. Real requests vary, so teams keep a few hundred candidates as headroom. They
        cost only a few milliseconds.
      </p>
      <details className="sdv-rec-budget__details">
        <summary>Every point as a table</summary>
        <DiagramScroll label="Candidate count table, scrollable">
          <table className="sdv-stats sdv-compare sdv-rec-budget__table">
            <caption>
              One request per candidate count. Recall counts the {RELEVANT_TOTAL} known good items that reach
              the ranker. Times are illustrative.
            </caption>
            <thead>
              <tr>
                <th scope="col">Candidates</th>
                <th scope="col">Unique</th>
                <th scope="col">Recall</th>
                <th scope="col">Candidate time</th>
                <th scope="col">Ranker time</th>
                <th scope="col">Total</th>
                <th scope="col">Good in top {SHOWN}</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((p) => {
                const selected = p.candidates === point.candidates;
                return (
                  <tr key={p.candidates} className={selected ? 'sdv-rec-budget__row--selected' : undefined}>
                    <th scope="row">
                      {count(p.candidates)}
                      {selected && <span className="sdv-rec-budget__here"> (selected)</span>}
                    </th>
                    <td>{count(p.unique)}</td>
                    <td>{pct(p.recall)}</td>
                    <td>{formatMs(p.candidateMs)}</td>
                    <td>{formatMs(p.rankerMs)}</td>
                    <td>
                      <ToneBadge tone={p.overBudget ? 'bad' : 'ok'}>
                        {`${formatMs(p.totalMs)}${p.overBudget ? ', over' : ''}`}
                      </ToneBadge>
                    </td>
                    <td>
                      {p.goodShown} of {SHOWN}
                      {p.bestShown ? '' : ', best missed'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DiagramScroll>
      </details>
    </WidgetFrame>
  );
}
