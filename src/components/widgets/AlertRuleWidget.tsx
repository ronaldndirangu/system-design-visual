import { useState } from 'react';
import {
  ALERT_ERROR_RATES,
  ALERT_EVERY_SECONDS,
  ALERT_INCIDENT_INDEX,
  ALERT_THRESHOLD,
  type AlertState,
  evaluateAlert,
} from '../../lib/models/metrics';
import { Segmented } from '../sim/controls';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './AlertRuleWidget.css';

type ForId = 'none' | 'one' | 'two' | 'five';

const FOR_CHOICES: Record<ForId, { label: string; seconds: number }> = {
  none: { label: 'None', seconds: 0 },
  one: { label: '1 min', seconds: 60 },
  two: { label: '2 min', seconds: 120 },
  five: { label: '5 min', seconds: 300 },
};

const FOR_OPTIONS = (Object.keys(FOR_CHOICES) as ForId[]).map((value) => ({
  value,
  label: FOR_CHOICES[value].label,
}));

const WIDTH = 560;
const LEFT = 44;
const RIGHT = 548;
const TOP = 22;
const BOTTOM = 150;
const Y_MAX = 0.3;
const STRIP_TOP = 160;
const STRIP_HEIGHT = 20;
const HEIGHT = 232;

const slot = (RIGHT - LEFT) / ALERT_ERROR_RATES.length;
const xOf = (index: number) => LEFT + index * slot;
const yOf = (rate: number) => BOTTOM - (Math.min(rate, Y_MAX) / Y_MAX) * (BOTTOM - TOP);
const percent = (rate: number) => `${Math.round(rate * 100)}%`;
const minutesAt = (index: number) => ((index * ALERT_EVERY_SECONDS) / 60).toLocaleString('en-US');

const STATE_LETTER: Record<AlertState, string> = { ok: 'O', pending: 'P', firing: 'F' };

function waitText(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds === 0) return 'at once';
  return `${seconds / 60} min later`;
}

function listMinutes(indexes: number[]): string {
  const times = indexes.map((index) => `${minutesAt(index)} min`);
  if (times.length < 2) return times.join('');
  return `${times.slice(0, -1).join(', ')} and ${times.at(-1)}`;
}

export default function AlertRuleWidget({ initial = 'none' }: { initial?: ForId }) {
  const [forId, setForId] = useState<ForId>(initial);
  const { label: choiceLabel, seconds: forSeconds } = FOR_CHOICES[forId];
  const run = evaluateAlert(forSeconds);
  const forLabel = forSeconds === 0 ? 'no for duration' : `for ${choiceLabel}`;

  const status: { tone: Tone; text: string } =
    run.falsePages > 0
      ? { tone: 'bad', text: 'Pages on noise' }
      : (run.detectSeconds ?? 0) >= 300
        ? { tone: 'warn', text: 'Quiet, but slow' }
        : { tone: 'ok', text: 'Pages only for the incident' };

  const summary = `With ${forLabel}, the rule pages ${run.pages.length} ${run.pages.length === 1 ? 'time' : 'times'}, ${run.falsePages} of them false, and pages for the real incident ${waitText(run.detectSeconds)}.`;

  const chartLabel = `Checkout error rate at ${ALERT_ERROR_RATES.length} evaluations, ${ALERT_EVERY_SECONDS} s apart, against a ${percent(ALERT_THRESHOLD)} threshold. A one evaluation spike at ${minutesAt(3)} min, a one minute blip from ${minutesAt(8)} min, and a real incident from ${minutesAt(ALERT_INCIDENT_INDEX)} min. With ${forLabel}, the alert pages at ${listMinutes(run.pages)}.`;

  return (
    <WidgetFrame
      title="When does the alert page someone"
      instructions={`The toy rule checks the checkout error rate every ${ALERT_EVERY_SECONDS} s and fires above ${percent(ALERT_THRESHOLD)}. Pick how long the rate must stay high before the alert fires. The error rates are made up.`}
      summary={summary}
      status={status}
      stats={[
        {
          label: 'Pages sent',
          value: run.pages.length.toString(),
          detail: run.pages.length > 0 ? `at ${listMinutes(run.pages)}` : undefined,
        },
        {
          label: 'False pages (no incident)',
          value: run.falsePages.toString(),
          tone: run.falsePages > 0 ? 'bad' : 'ok',
        },
        {
          label: 'Page after the incident starts',
          value: waitText(run.detectSeconds),
          tone: (run.detectSeconds ?? 0) >= 300 ? 'warn' : 'neutral',
          detail: `the incident starts at ${minutesAt(ALERT_INCIDENT_INDEX)} min`,
        },
      ]}
      controls={<Segmented label="for duration" value={forId} options={FOR_OPTIONS} onChange={setForId} />}
    >
      <div className="sdv-alert">
        <p className="sdv-alert__rule">
          <code>
            checkout errors / checkout requests &gt; {percent(ALERT_THRESHOLD)}
            {forSeconds > 0 ? ` for ${choiceLabel}` : ''}
          </code>
        </p>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chartLabel}>
          {[0, 0.1, 0.2, 0.3].map((tick) => (
            <g key={tick} className="sdv-alert__tick">
              <line x1={LEFT} x2={RIGHT} y1={yOf(tick)} y2={yOf(tick)} />
              <text x={LEFT - 6} y={yOf(tick) + 4} textAnchor="end">
                {percent(tick)}
              </text>
            </g>
          ))}
          {ALERT_ERROR_RATES.map((rate, index) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: the rates are a fixed list in time order
              key={index}
              className="sdv-alert__bar"
              x={xOf(index) + slot * 0.15}
              y={yOf(rate)}
              width={slot * 0.7}
              height={BOTTOM - yOf(rate)}
            />
          ))}
          <line
            className="sdv-alert__threshold"
            x1={LEFT}
            x2={RIGHT}
            y1={yOf(ALERT_THRESHOLD)}
            y2={yOf(ALERT_THRESHOLD)}
          />
          <line
            className="sdv-alert__incident"
            x1={xOf(ALERT_INCIDENT_INDEX)}
            x2={xOf(ALERT_INCIDENT_INDEX)}
            y1={TOP - 8}
            y2={STRIP_TOP + STRIP_HEIGHT}
          />
          <text className="sdv-alert__label" x={xOf(ALERT_INCIDENT_INDEX) + 4} y={TOP - 1}>
            incident starts
          </text>
          <text className="sdv-alert__label" x={LEFT - 6} y={STRIP_TOP + 14} textAnchor="end">
            state
          </text>
          {run.states.map((state, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one cell per evaluation, in time order
            <g key={index} className="sdv-alert__state" data-state={state}>
              <rect x={xOf(index) + 1} y={STRIP_TOP} width={slot - 2} height={STRIP_HEIGHT} rx={3} />
              <text x={xOf(index) + slot / 2} y={STRIP_TOP + 14} textAnchor="middle">
                {STATE_LETTER[state]}
              </text>
            </g>
          ))}
          {run.pages.map((index) => (
            <g key={index} className="sdv-alert__page">
              <path d={`M ${xOf(index) + slot / 2} ${STRIP_TOP + STRIP_HEIGHT + 3} l 6 9 h -12 z`} />
              <text x={xOf(index) + slot / 2} y={STRIP_TOP + STRIP_HEIGHT + 24} textAnchor="middle">
                page
              </text>
            </g>
          ))}
          {[0, 4, 8, 12, 16, 20, 24].map((index) => (
            <text
              key={index}
              className="sdv-alert__label"
              x={xOf(index) + slot / 2}
              y={HEIGHT - 4}
              textAnchor="middle"
            >
              {index === 0 ? '0 min' : minutesAt(index)}
            </text>
          ))}
        </svg>
        <ul className="sdv-qtracks__legend" aria-label="How to read the alert chart">
          <li>
            <span className="sdv-alert__swatch sdv-alert__swatch--threshold" aria-hidden="true" />
            Dashed line: {percent(ALERT_THRESHOLD)} threshold
          </li>
          {(['ok', 'pending', 'firing'] as const).map((state) => (
            <li key={state}>
              <svg className="sdv-alert__key" viewBox="0 0 20 20" aria-hidden="true">
                <g className="sdv-alert__state" data-state={state}>
                  <rect x={1} y={1} width={18} height={18} rx={3} />
                  <text x={10} y={14} textAnchor="middle">
                    {STATE_LETTER[state]}
                  </text>
                </g>
              </svg>
              {STATE_LETTER[state]}: {state}
            </li>
          ))}
          <li>
            <svg className="sdv-alert__key" viewBox="0 0 20 20" aria-hidden="true">
              <path className="sdv-alert__page" d="M 10 4 l 7 11 h -14 z" />
            </svg>
            Triangle: someone gets paged
          </li>
        </ul>
      </div>
    </WidgetFrame>
  );
}
