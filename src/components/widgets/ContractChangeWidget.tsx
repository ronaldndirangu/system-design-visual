import { m } from 'motion/react';
import { useState } from 'react';
import {
  type CcChangeId,
  type CcMode,
  type CcOutcome,
  ccChanges,
  ccSummary,
  evaluateChange,
} from '../../lib/models/apis';
import { Segmented, Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { WidgetFrame } from '../sim/WidgetFrame';
import './ContractChangeWidget.css';

interface Props {
  changes?: CcChangeId[];
  initial?: CcChangeId;
  title?: string;
  instructions?: string;
}

const outcomeBadge: Record<CcOutcome, { tone: Tone; text: string }> = {
  ok: { tone: 'ok', text: 'Keeps working' },
  migrate: { tone: 'warn', text: 'Must migrate later' },
  breaks: { tone: 'bad', text: 'Breaks on deploy' },
  silent: { tone: 'warn', text: 'Silently wrong' },
};

const modeOptions: { value: CcMode; label: string }[] = [
  { value: 'inPlace', label: 'Change in place' },
  { value: 'expand', label: 'Expand, then contract' },
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export default function ContractChangeWidget({
  changes = ['addOptional', 'rename', 'typeChange', 'remove', 'requiredParam', 'default'],
  initial,
  title = 'One change, three clients',
  instructions = 'Pick a change to the links API, then choose how you ship it. Each client reads and sends the fields listed on its card.',
}: Props) {
  const hydrated = useHydrated();
  const [changeId, setChangeId] = useState<CcChangeId>(initial ?? changes[0] ?? 'rename');
  const [mode, setMode] = useState<CcMode>('inPlace');
  const [strict, setStrict] = useState(false);

  const verdicts = evaluateChange(changeId, mode, strict);
  const totals = ccSummary(changeId, mode, strict);
  const change = ccChanges[changeId];
  const modeLabel = modeOptions.find((option) => option.value === mode)?.label ?? '';

  const status =
    totals.broken > 0
      ? ({ tone: 'bad', text: `${plural(totals.broken, 'client')} broken` } as const)
      : totals.silent > 0
        ? ({ tone: 'warn', text: 'Wrong without an error' } as const)
        : ({ tone: 'ok', text: 'No client breaks' } as const);

  const verdictText = verdicts.map(
    (verdict) => `${verdict.client.name}: ${outcomeBadge[verdict.outcome].text}.`,
  );
  const summary = `${change.label}, ${modeLabel.toLowerCase()}${strict ? ', strict partner parser' : ''}. ${verdictText.join(' ')} ${plural(totals.versions, 'API version')} to run.`;

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      status={status}
      statsCaption="What this rollout costs"
      stats={[
        {
          label: 'Broken on deploy',
          value: String(totals.broken),
          detail: 'errors the moment the server changes',
          tone: totals.broken > 0 ? 'bad' : 'ok',
          note: totals.broken > 0 ? 'Outage' : 'None',
        },
        {
          label: 'Silently wrong',
          value: String(totals.silent),
          detail: 'no error, wrong behavior',
          tone: totals.silent > 0 ? 'warn' : undefined,
          note: totals.silent > 0 ? 'Hard to spot' : undefined,
        },
        {
          label: 'Must migrate later',
          value: String(totals.migrate),
          detail: 'work today, need a release before the old shape goes away',
        },
        {
          label: 'API versions to run',
          value: String(totals.versions),
          detail: totals.versions > 1 ? '/v1 and /v2 side by side until /v1 traffic ends' : 'just /v1',
        },
      ]}
      controls={
        <div className="sdv-cc__controls">
          <Segmented label="How you ship it" value={mode} options={modeOptions} onChange={setMode} />
          <Toggle
            label="Partner uses a strict parser that rejects unknown fields"
            checked={strict}
            onChange={setStrict}
          />
        </div>
      }
    >
      <ScenarioChips
        label="Change to the links API"
        value={changeId}
        options={changes.map((id) => ({ value: id, label: ccChanges[id].label, diff: ccChanges[id].diff }))}
        onChange={setChangeId}
      />
      <MotionRoot>
        <ul className="sdv-cc__clients" aria-label="What each client sees">
          {verdicts.map((verdict) => {
            const badge = outcomeBadge[verdict.outcome];
            return (
              <li key={verdict.client.id} className="sdv-cc__client" data-outcome={verdict.outcome}>
                <div className="sdv-cc__head">
                  <p className="sdv-cc__name">{verdict.client.name}</p>
                  <m.span
                    key={`${changeId}:${mode}:${strict}:${verdict.outcome}`}
                    className="sdv-cc__badge"
                    initial={hydrated ? { opacity: 0, scale: 0.85 } : false}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    <ToneBadge tone={badge.tone}>{badge.text}</ToneBadge>
                  </m.span>
                </div>
                <p className="sdv-cc__detail">{verdict.client.detail}</p>
                <p className="sdv-cc__fields">
                  Reads{' '}
                  {verdict.client.reads.map((field) => (
                    <code key={field}>{field}</code>
                  ))}{' '}
                  Sends{' '}
                  {verdict.client.sends.map((field) => (
                    <code key={field}>{field}</code>
                  ))}
                </p>
                <p className="sdv-cc__reason">{verdict.reason}</p>
              </li>
            );
          })}
        </ul>
      </MotionRoot>
      <div className="sdv-cc__plan">
        <p className="sdv-cc__plan-title">Rollout: {modeLabel.toLowerCase()}</p>
        <ol className="sdv-cc__steps">
          {totals.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </WidgetFrame>
  );
}
