import { m } from 'motion/react';
import { useState } from 'react';
import {
  type Budgets,
  budgetLabels,
  candidates,
  checkBudgets,
  DEFAULT_BUDGETS,
  finishedSummaries,
  joinNames,
} from '../../lib/models/evalBudget';
import { Slider, Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import type { StatRow } from '../sim/StatTable';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { WidgetFrame } from '../sim/WidgetFrame';
import { DiagramScroll } from '../viz/DiagramScroll';
import './BudgetGateWidget.css';

type PresetId = 'default' | 'tight' | 'lowered' | 'generous' | 'custom';

const presets: Record<Exclude<PresetId, 'custom'>, { label: string; diff: string; budgets: Budgets }> = {
  default: {
    label: 'Default budgets',
    diff: 'pass ≥ 85%, declines required, p95 ≤ 2.0 s, cost ≤ 6,000',
    budgets: DEFAULT_BUDGETS,
  },
  tight: {
    label: 'Tighter latency',
    diff: 'p95 ≤ 1.2 s, the rest as default',
    budgets: { ...DEFAULT_BUDGETS, maxP95Seconds: 1.2 },
  },
  lowered: {
    label: 'Lowered bar',
    diff: 'pass ≥ 70%, declines not checked, the rest as default',
    budgets: { ...DEFAULT_BUDGETS, minPassRate: 0.7, requireDeclines: false },
  },
  generous: {
    label: 'Generous spend',
    diff: 'p95 ≤ 4.0 s, cost ≤ 20,000, the rest as default',
    budgets: { ...DEFAULT_BUDGETS, maxP95Seconds: 4, maxCostPer1k: 20000 },
  },
};
const presetIds = ['default', 'tight', 'lowered', 'generous'] as const;

const summaries = finishedSummaries('full');

const W = 640;
const H = 300;
const LEFT = 64;
const RIGHT = 610;
const TOP = 24;
const BOTTOM = 250;
const X_MAX = 4;
const Y_MIN = 0.6;
const xFor = (s: number) => LEFT + (Math.min(s, X_MAX) / X_MAX) * (RIGHT - LEFT);
const yFor = (rate: number) => BOTTOM - ((Math.max(rate, Y_MIN) - Y_MIN) / (1 - Y_MIN)) * (BOTTOM - TOP);

const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
const secs = (value: number) => `${value.toFixed(2)} s`;
const units = (value: number) => Math.round(value).toLocaleString('en-US');

export default function BudgetGateWidget({
  title = 'Set the budgets, then see who fits',
  instructions = 'Pick a preset or drag a budget. The shaded box covers the quality and latency budgets; the table also checks cost and must decline cases.',
}: {
  title?: string;
  instructions?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [preset, setPreset] = useState<PresetId>('default');
  const [budgets, setBudgets] = useState<Budgets>(DEFAULT_BUDGETS);

  const update = (patch: Partial<Budgets>) => {
    setBudgets((current) => ({ ...current, ...patch }));
    setPreset('custom');
  };
  const choosePreset = (id: PresetId) => {
    if (id === 'custom') return;
    setPreset(id);
    setBudgets(presets[id].budgets);
  };

  const checked = summaries.map((summary) => ({ summary, verdict: checkBudgets(summary, budgets) }));
  const fitting = checked.filter((item) => item.verdict.fits);
  const cheapest = [...fitting].sort((a, b) => a.summary.costPer1k - b.summary.costPer1k)[0];
  const names = (list: typeof checked) =>
    joinNames(list.map((item) => candidates[item.summary.candidate].label));

  const status = cheapest
    ? ({ tone: 'ok', text: `${fitting.length} of 3 fit` } as const)
    : ({ tone: 'bad', text: 'No candidate fits' } as const);

  const summary =
    `${cheapest ? `${names(fitting)} ${fitting.length === 1 ? 'fits' : 'fit'}. Cheapest that fits: ${candidates[cheapest.summary.candidate].label}.` : 'No candidate fits every budget.'} ${checked
      .filter((item) => !item.verdict.fits)
      .map(
        (item) =>
          `${candidates[item.summary.candidate].label} misses ${joinNames(item.verdict.failed.map((check) => budgetLabels[check]))}`,
      )
      .join('. ')}`.trim();

  const stats: StatRow[] = [
    ...checked.map(
      ({ summary: s, verdict }): StatRow => ({
        label: candidates[s.candidate].label,
        value: verdict.fits
          ? 'Fits'
          : `Misses ${joinNames(verdict.failed.map((check) => budgetLabels[check]))}`,
        tone: verdict.fits ? 'ok' : 'bad',
        detail: `${pct(s.passRate)} pass, ${s.declinesHandled} of ${s.declineCases} declines, p95 ${secs(s.p95Seconds)}, ${units(s.costPer1k)} units per 1,000`,
      }),
    ),
    cheapest
      ? {
          label: 'Ship',
          value: candidates[cheapest.summary.candidate].label,
          tone: 'ok',
          detail: 'cheapest candidate that meets every budget',
        }
      : {
          label: 'Ship',
          value: 'Nothing yet',
          tone: 'bad',
          detail: 'change the design (retrieval, caching, a cascade, streaming) or renegotiate a budget',
        },
  ];

  const move = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 140, damping: 20 };
  const boxRight = xFor(budgets.maxP95Seconds);
  const boxBottom = yFor(budgets.minPassRate);

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      status={status}
      stats={stats}
      statsCaption="Every candidate on the full eval set (24 questions) against the budgets you set. Grades are fixtures; latency and cost are illustrative."
      controls={
        <>
          <Slider
            label="Quality floor (pass rate)"
            value={Math.round(budgets.minPassRate * 100)}
            min={70}
            max={100}
            step={1}
            format={(v) => `≥ ${v}%`}
            onChange={(v) => update({ minPassRate: v / 100 })}
          />
          <Slider
            label="p95 latency ceiling"
            value={budgets.maxP95Seconds}
            min={0.5}
            max={4}
            step={0.1}
            format={(v) => `≤ ${v.toFixed(1)} s`}
            onChange={(v) => update({ maxP95Seconds: Math.round(v * 10) / 10 })}
          />
          <Slider
            label="Cost ceiling per 1,000 questions"
            value={budgets.maxCostPer1k}
            min={500}
            max={20000}
            step={500}
            format={(v) => `≤ ${units(v)} units`}
            onChange={(v) => update({ maxCostPer1k: v })}
            hint="Units are illustrative. Small costs about 1,000 per 1,000 questions."
          />
          <Toggle
            label="Every must decline case must be declined"
            checked={budgets.requireDeclines}
            onChange={(on) => update({ requireDeclines: on })}
          />
        </>
      }
    >
      <ScenarioChips
        label="Budget preset"
        value={preset}
        options={presetIds.map((id) => ({ value: id, label: presets[id].label, diff: presets[id].diff }))}
        onChange={choosePreset}
      />
      <MotionRoot>
        <DiagramScroll label="Budget chart, scrollable">
          <svg
            className="sdv-gate__chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Pass rate against p95 latency for three candidates. The budget box covers pass rate ${pct(budgets.minPassRate)} or more and p95 ${budgets.maxP95Seconds.toFixed(1)} s or less. ${summary}`}
          >
            <m.rect
              className="sdv-gate__box"
              x={LEFT}
              y={TOP}
              initial={false}
              animate={{ width: Math.max(0, boxRight - LEFT), height: Math.max(0, boxBottom - TOP) }}
              transition={move}
            />
            <m.text
              className="sdv-gate__box-label"
              initial={false}
              animate={{ x: LEFT + 8, y: TOP + 16 }}
              transition={move}
            >
              Budget box: quality and latency
            </m.text>
            <g className="sdv-axis">
              <line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} />
              <line x1={LEFT} x2={LEFT} y1={TOP} y2={BOTTOM} />
              {[0, 1, 2, 3, 4].map((tick) => (
                <g key={`x${tick}`}>
                  <line x1={xFor(tick)} x2={xFor(tick)} y1={BOTTOM} y2={BOTTOM + 5} />
                  <text x={xFor(tick)} y={BOTTOM + 18} textAnchor="middle">
                    {tick} s
                  </text>
                </g>
              ))}
              {[0.6, 0.7, 0.8, 0.9, 1].map((tick) => (
                <g key={`y${tick}`}>
                  <line x1={LEFT - 5} x2={LEFT} y1={yFor(tick)} y2={yFor(tick)} />
                  <text x={LEFT - 8} y={yFor(tick) + 4} textAnchor="end">
                    {Math.round(tick * 100)}%
                  </text>
                </g>
              ))}
              <text x={(LEFT + RIGHT) / 2} y={H - 8} textAnchor="middle">
                p95 latency (lower is better)
              </text>
            </g>
            {checked.map(({ summary: s, verdict }) => {
              const x = xFor(s.p95Seconds);
              const y = yFor(s.passRate);
              const flip = x > 420;
              const anchor = flip ? 'end' : 'start';
              const tx = flip ? x - 14 : x + 14;
              const tone = verdict.fits ? 'ok' : 'bad';
              return (
                <g key={s.candidate} className={`sdv-gate__point sdv-gate__point--${tone}`}>
                  <circle cx={x} cy={y} r={10} />
                  {verdict.fits ? (
                    <path className="sdv-gate__mark" d={`M${x - 5} ${y}l3.5 4l6.5 -8`} />
                  ) : (
                    <path className="sdv-gate__mark" d={`M${x - 4} ${y - 4}l8 8m0 -8l-8 8`} />
                  )}
                  <text className="sdv-gate__name" x={tx} y={y - 3} textAnchor={anchor}>
                    {candidates[s.candidate].label}: {verdict.fits ? 'fits' : 'misses'}
                  </text>
                  <text className="sdv-gate__detail" x={tx} y={y - 3} dy="1.25em" textAnchor={anchor}>
                    {units(s.costPer1k)} units, declines {s.declinesHandled}/{s.declineCases}
                  </text>
                </g>
              );
            })}
          </svg>
        </DiagramScroll>
      </MotionRoot>
      <p className="sdv-gate__note">
        The box shows two of the four budgets. A point inside the box can still miss on cost or on a must
        decline case, so the table below checks all four.
      </p>
    </WidgetFrame>
  );
}
