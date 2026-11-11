import { useMemo, useState } from 'react';
import {
  depthOf,
  type ExemplarId,
  findExemplars,
  type IncidentResult,
  logsDuring,
  type Span,
  selfTime,
  simulateIncident,
  slowestSelfSpan,
  type Trace,
} from '../../lib/models/observability';
import { Toggle } from '../sim/controls';
import { ScenarioChips } from '../sim/ScenarioChips';
import type { StatRow, Tone } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { WidgetFrame } from '../sim/WidgetFrame';
import './TraceHuntWidget.css';

interface Props {
  exemplars?: ExemplarId[];
  initial?: ExemplarId;
  title?: string;
  instructions?: string;
  showLogs?: boolean;
}

let cached: IncidentResult | null = null;
const incident = () => {
  cached ??= simulateIncident();
  return cached;
};

const ms = (value: number) => `${Math.round(value).toLocaleString('en-US')} ms`;

function isAncestor(trace: Trace, maybe: Span, of: Span): boolean {
  let parent = of.parent;
  while (parent) {
    if (parent === maybe.id) return true;
    parent = trace.spans.find((span) => span.id === parent)?.parent ?? null;
  }
  return false;
}

function verdict(trace: Trace, picked: Span | null): { tone: Tone; text: string } | null {
  if (!picked) return null;
  const answer = slowestSelfSpan(trace);
  const own = selfTime(trace, picked);
  if (picked.id === answer.id) {
    return {
      tone: 'ok',
      text: `Found it. ${picked.name} spent ${ms(own)} doing its own work, the most of any span in this trace.`,
    };
  }
  if (isAncestor(trace, picked, answer)) {
    return {
      tone: 'warn',
      text: `Closer. ${picked.name} lasts ${ms(picked.duration)}, yet only ${ms(own)} of that is its own work. Its children hold the rest, so look one level deeper.`,
    };
  }
  return {
    tone: 'bad',
    text: `${picked.name} spent ${ms(own)} on its own work. Another span spent ${ms(selfTime(trace, answer))}. Compare the "own" times.`,
  };
}

export default function TraceHuntWidget({
  exemplars = ['typical', 'slowCheckout', 'slowBrowse', 'failedBrowse'],
  initial,
  title = 'Find the slow span',
  instructions = 'Pick a trace, then select the span you blame for the delay. Each bar starts when that step started and spans its whole duration, children included.',
  showLogs = true,
}: Props) {
  const hydrated = useHydrated();
  const result = incident();
  const all = useMemo(() => findExemplars(result), [result]);
  const [exemplarId, setExemplarId] = useState<ExemplarId>(initial ?? exemplars[0] ?? 'typical');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [onlyThisTrace, setOnlyThisTrace] = useState(false);

  const trace = all[exemplarId].trace;
  const picked = trace.spans.find((span) => span.id === pickedId) ?? null;
  const feedback = verdict(trace, picked);
  const logs = useMemo(() => logsDuring(result, trace), [result, trace]);
  const shownLogs = onlyThisTrace ? logs.filter((line) => line.traceId === trace.id) : logs;
  const otherTraces = new Set(logs.map((line) => line.traceId)).size - 1;

  const choose = (id: ExemplarId) => {
    setExemplarId(id);
    setPickedId(null);
  };

  const stats: StatRow[] = [
    { label: 'Trace ID (the correlation ID)', value: trace.id },
    {
      label: 'Request',
      value: `GET /${trace.route} at ${(trace.start / 1000).toFixed(1)} s`,
    },
    {
      label: 'Result',
      value: `${trace.status} in ${ms(trace.duration)}`,
      tone: trace.status === 503 ? 'bad' : trace.duration > 500 ? 'warn' : 'ok',
      note: trace.status === 503 ? 'Failed' : trace.duration > 500 ? 'Slow' : 'Fine',
    },
    picked && feedback
      ? {
          label: 'Your pick',
          value: `${picked.name}, own work ${ms(selfTime(trace, picked))}`,
          tone: feedback.tone,
          note:
            feedback.tone === 'ok' ? 'Correct' : feedback.tone === 'warn' ? 'Look deeper' : 'Not this one',
        }
      : { label: 'Your pick', value: 'Select a span' },
  ];

  const summary = feedback
    ? feedback.text
    : `Trace ${trace.id}: GET /${trace.route}, ${trace.status} in ${ms(trace.duration)}, ${trace.spans.length} spans. Select the span you blame.`;

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      stats={stats}
      statsCaption="This trace"
      status={
        feedback
          ? { tone: feedback.tone, text: feedback.tone === 'ok' ? 'Found' : 'Keep looking' }
          : undefined
      }
    >
      <ScenarioChips
        label="Trace"
        value={exemplarId}
        options={exemplars.map((id) => ({ value: id, label: all[id].label, diff: all[id].diff }))}
        onChange={choose}
      />
      <div className="sdv-hunt__head" aria-hidden="true">
        <span>Span (service)</span>
        <span>Timeline, 0 to {ms(trace.duration)}</span>
        <span>Total / own</span>
      </div>
      <ol className="sdv-waterfall sdv-hunt" aria-label={`Spans in trace ${trace.id}`}>
        {trace.spans.map((span) => {
          const own = selfTime(trace, span);
          const selected = span.id === pickedId;
          const depth = depthOf(trace, span);
          return (
            <li
              key={span.id}
              className="sdv-waterfall__row"
              data-state={selected ? 'running' : 'done'}
              data-error={span.error ? 'true' : undefined}
            >
              <button
                type="button"
                className="sdv-hunt__pick"
                aria-pressed={selected}
                disabled={!hydrated}
                style={{ paddingInlineStart: `${0.4 + depth * 0.85}rem` }}
                onClick={() => setPickedId(span.id)}
              >
                <span className="sdv-hunt__name">
                  {selected && <span aria-hidden="true">{'\u2713\u00a0'}</span>}
                  {span.name}
                </span>
                <span className="sdv-hunt__service">
                  {span.service}
                  {span.error ? `, error: ${span.error}` : ''}
                </span>
              </button>
              <span className="sdv-waterfall__track" aria-hidden="true">
                <span
                  className="sdv-waterfall__bar"
                  style={{
                    left: `${(span.start / Math.max(trace.duration, 1)) * 100}%`,
                    width: `${Math.max(0.8, (span.duration / Math.max(trace.duration, 1)) * 100)}%`,
                  }}
                >
                  <span className="sdv-waterfall__fill" />
                </span>
              </span>
              <span className="sdv-waterfall__time">
                {ms(span.duration)}
                <span className="sdv-hunt__own">own {ms(own)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {feedback && (
        <p className={`sdv-hunt__feedback sdv-hunt__feedback--${feedback.tone}`} aria-live="polite">
          {feedback.text}
        </p>
      )}
      {showLogs && (
        <div className="sdv-hunt__logs">
          <div className="sdv-hunt__logs-head">
            <p className="sdv-hunt__logs-title">
              Logs written while this request ran ({shownLogs.length} lines
              {onlyThisTrace ? '' : `, from this request and ${otherTraces} others`})
            </p>
            <Toggle
              label="Show only this correlation ID"
              checked={onlyThisTrace}
              onChange={setOnlyThisTrace}
            />
          </div>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll the log list */}
          <ol className="sdv-hunt__loglist" aria-label="Log lines" tabIndex={0}>
            {shownLogs.map((line) => {
              const mine = line.traceId === trace.id;
              return (
                <li
                  key={`${line.traceId}-${line.at}-${line.service}-${line.message}`}
                  data-mine={mine ? 'true' : undefined}
                  data-level={line.level}
                >
                  <span className="sdv-hunt__at">+{Math.round(line.at - trace.start)} ms</span>
                  <span className="sdv-hunt__level">{line.level.toUpperCase()}</span>
                  <span className="sdv-hunt__svc">{line.service}</span>
                  <span className="sdv-hunt__id">
                    {mine ? <strong>{line.traceId}</strong> : line.traceId}
                  </span>
                  <span className="sdv-hunt__msg">{line.message}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </WidgetFrame>
  );
}
