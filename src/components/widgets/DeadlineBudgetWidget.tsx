import { useState } from 'react';
import {
  type BudgetHop,
  type BudgetMode,
  CLIENT_DEADLINE_MS,
  FIXED_TIMEOUTS_MS,
  planDeadline,
} from '../../lib/models/timeouts';
import { Segmented, Slider } from '../sim/controls';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './DeadlineBudgetWidget.css';

interface Props {
  initialQueryMs?: number;
  initialMode?: BudgetMode;
}

const outcomeWords: Record<BudgetHop['outcome'], string> = {
  answered: 'Answered',
  'timed-out': 'Timed out',
  cancelled: 'Cancelled',
};

const modeOptions: { value: BudgetMode; label: string }[] = [
  { value: 'fixed', label: 'Fixed timeout per hop' },
  { value: 'propagate', label: 'Pass the deadline along' },
];

function allowanceText(hop: BudgetHop, mode: BudgetMode): string {
  if (hop.id === 'database') {
    return mode === 'fixed' ? 'No timeout of its own' : `Deadline leaves ${hop.allowanceMs} ms`;
  }
  if (mode === 'fixed') return `Own timeout ${FIXED_TIMEOUTS_MS[hop.id]} ms`;
  return hop.id === 'client' ? `Deadline ${hop.allowanceMs} ms` : `Deadline leaves ${hop.allowanceMs} ms`;
}

const pct = (ms: number, scaleMs: number) => `${(ms / scaleMs) * 100}%`;

/** One redirect crossing four hops, with and without passing the client's deadline along. */
export default function DeadlineBudgetWidget({ initialQueryMs = 2500, initialMode = 'fixed' }: Props) {
  const [queryMs, setQueryMs] = useState(initialQueryMs);
  const [mode, setMode] = useState<BudgetMode>(initialMode);
  const plan = planDeadline(queryMs, mode);
  const scaleMs = Math.ceil((Math.max(plan.lastStopMs, CLIENT_DEADLINE_MS) * 1.08) / 500) * 500;
  const giveUp = plan.clientAnswered ? undefined : plan.clientDoneMs;
  const database = plan.hops.find((hop) => hop.id === 'database');

  const status: { tone: Tone; text: string } = plan.clientAnswered
    ? { tone: 'ok', text: `Redirect in ${plan.clientDoneMs} ms` }
    : plan.lateMs > 0
      ? { tone: 'bad', text: `${plan.lateMs} ms of work for nobody` }
      : { tone: 'warn', text: 'Gave up, and everything stopped' };

  const summary = plan.clientAnswered
    ? `The database answers in ${queryMs} ms, so the client gets its redirect after ${plan.clientDoneMs} ms. No hop needs a timer.`
    : `The client gives up at ${plan.clientDoneMs} ms. ${
        plan.lateMs > 0
          ? `${plan.lateHops} hops keep working for another ${plan.lateMs} ms, until ${plan.lastStopMs} ms, for an answer nobody will read.`
          : 'Every hop stops at the same moment, because each one knows the deadline.'
      }`;

  return (
    <WidgetFrame
      title="One deadline, four hops"
      instructions="Slow the database query past 1 second, then switch between fixed timeouts and passing the deadline along. Watch what keeps running after the client gives up."
      summary={summary}
      status={status}
      statsCaption="This request"
      stats={[
        {
          label: 'Client result',
          value: plan.clientAnswered
            ? `Redirect at ${plan.clientDoneMs} ms`
            : `504 at ${plan.clientDoneMs} ms`,
          tone: plan.clientAnswered ? 'ok' : 'warn',
        },
        {
          label: 'Last hop stops at',
          value: `${plan.lastStopMs} ms`,
          detail: database ? `database query ${outcomeWords[database.outcome].toLowerCase()}` : undefined,
        },
        {
          label: 'Work after the client gave up',
          value: plan.lateMs > 0 ? `${plan.lateMs} ms` : 'None',
          tone: plan.lateMs > 0 ? 'bad' : 'ok',
          detail: plan.lateMs > 0 ? `${plan.lateHops} hops still busy` : undefined,
        },
      ]}
      controls={
        <>
          <Slider
            label="Database query time"
            value={queryMs}
            min={50}
            max={4000}
            step={10}
            onChange={setQueryMs}
            format={(value) => `${value} ms`}
            hint="Normal lookups take about 30 ms. A struggling replica can take seconds."
          />
          <Segmented label="Timeout style" value={mode} options={modeOptions} onChange={setMode} />
        </>
      }
    >
      <div className="sdv-budget">
        <ol className="sdv-waterfall" aria-label={`Timeline of the request, ${scaleMs} ms wide`}>
          {plan.hops.map((hop) => {
            const before = giveUp === undefined ? hop.endMs : Math.min(hop.endMs, giveUp);
            const late = hop.afterGiveUpMs;
            const timerAt = hop.startMs + hop.allowanceMs;
            return (
              <li key={hop.id} className="sdv-waterfall__row" data-state="done" data-outcome={hop.outcome}>
                <span className="sdv-waterfall__label sdv-budget__label">
                  <span className="sdv-budget__name">{hop.label}</span>
                  <span className="sdv-budget__allowance">{allowanceText(hop, mode)}</span>
                </span>
                <span className="sdv-waterfall__track sdv-budget__track" aria-hidden="true">
                  <span
                    className="sdv-budget__span"
                    style={{
                      left: pct(hop.startMs, scaleMs),
                      width: pct(Math.max(0, before - hop.startMs), scaleMs),
                    }}
                  />
                  {late > 0 && (
                    <span
                      className="sdv-budget__span sdv-budget__span--late"
                      style={{ left: pct(hop.endMs - late, scaleMs), width: pct(late, scaleMs) }}
                    />
                  )}
                  {Number.isFinite(timerAt) && timerAt <= scaleMs && timerAt !== CLIENT_DEADLINE_MS && (
                    <span className="sdv-budget__timer" style={{ left: pct(timerAt, scaleMs) }} />
                  )}
                  <span className="sdv-budget__deadline" style={{ left: pct(CLIENT_DEADLINE_MS, scaleMs) }} />
                </span>
                <span className="sdv-waterfall__time sdv-budget__time">
                  <span className="sdv-budget__outcome" data-outcome={hop.outcome}>
                    {outcomeWords[hop.outcome]}
                  </span>
                  <span>at {hop.endMs} ms</span>
                  {late > 0 && (
                    <span className="sdv-visually-hidden">, {late} ms after the client gave up</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="sdv-budget__axis" aria-hidden="true">
          <span>0 ms</span>
          <span>{scaleMs} ms</span>
        </p>
        <ul className="sdv-qtracks__legend" aria-label="How to read the timeline">
          <li>
            <span className="sdv-budget__key" aria-hidden="true" /> Working while the client still waits
          </li>
          <li>
            <span className="sdv-budget__key sdv-budget__key--late" aria-hidden="true" /> Working after the
            client gave up
          </li>
          <li>
            <span className="sdv-budget__key sdv-budget__key--deadline" aria-hidden="true" /> The client's 1 s
            deadline
          </li>
          <li>
            <span className="sdv-budget__key sdv-budget__key--timer" aria-hidden="true" /> When this hop's own
            timer fires
          </li>
        </ul>
        <p className="sdv-sim__note">
          Toy model: the gateway adds 10 ms, the server adds 30 ms, and answers travel back instantly.
        </p>
      </div>
    </WidgetFrame>
  );
}
