import { useState } from 'react';
import { countOutcomes, DEFAULT_THRESHOLD, type EvalRow, evaluate } from '../../lib/models/retrieval';
import { TENANTS } from '../../lib/models/retrievalCorpus';
import { Slider } from '../sim/controls';
import type { StatRow, Tone } from '../sim/StatTable';
import { StatTable, ToneBadge } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import { DiagramScroll } from '../viz/DiagramScroll';
import './RetrievalShared.css';
import './RetrievalAbstainWidget.css';

interface Props {
  initialThreshold?: number;
  title?: string;
  instructions?: string;
}

const MIN = 0.5;
const MAX = 0.95;
const STEP = 0.05;

function outcomeBadge(row: EvalRow): { tone: Tone; text: string } {
  if (row.outcome === 'correct') return { tone: 'ok', text: 'Correct' };
  if (row.outcome === 'wrong') return { tone: 'bad', text: 'Wrong answer' };
  return row.question.expected === null
    ? { tone: 'ok', text: 'Right to abstain' }
    : { tone: 'warn', text: 'Abstained, answer existed' };
}

export default function RetrievalAbstainWidget({
  initialThreshold = DEFAULT_THRESHOLD,
  title = 'Set the evidence bar',
  instructions = 'Move the threshold. Below it, the assistant abstains and offers a person. Watch which of the 12 fixture questions flip.',
}: Props) {
  const [threshold, setThreshold] = useState(initialThreshold);
  const rows = evaluate(threshold);
  const counts = countOutcomes(rows);
  const total = rows.length;
  const shouldAbstain = rows.filter((r) => r.question.expected === null).length;
  const answerable = total - shouldAbstain;
  const handedOff = counts.abstained - counts.rightToAbstain;

  const status: { tone: Tone; text: string } =
    counts.wrong > 0
      ? {
          tone: 'warn',
          text: `${counts.wrong} wrong answer${counts.wrong === 1 ? '' : 's'} at ${threshold.toFixed(2)}`,
        }
      : { tone: 'ok', text: `No wrong answers at ${threshold.toFixed(2)}` };

  const stats: StatRow[] = [
    { label: 'Correct answers', value: `${counts.correct} of ${total}`, tone: 'ok', note: 'Grounded' },
    {
      label: 'Wrong answers',
      value: `${counts.wrong} of ${total}`,
      tone: counts.wrong > 0 ? 'bad' : 'ok',
      note: counts.wrong > 0 ? 'Misleading' : 'None',
    },
    {
      label: 'Abstentions',
      value: `${counts.abstained} of ${total}`,
      detail: `${counts.rightToAbstain} of ${shouldAbstain} questions with no policy answer`,
    },
    {
      label: 'Answerable handed off',
      value: `${handedOff} of ${answerable}`,
      tone: handedOff > 0 ? 'warn' : 'ok',
      note: handedOff > 0 ? 'Safe, costs a person' : 'None',
      detail: 'Abstained although the policy has the answer',
    },
  ];

  const summary = `At threshold ${threshold.toFixed(2)}, the fixture eval gives ${counts.correct} correct, ${counts.wrong} wrong, and ${counts.abstained} abstentions out of ${total}. ${counts.rightToAbstain} of the abstentions are questions the policies cannot answer, and ${handedOff} of the ${answerable} answerable questions are handed off.`;

  // The frame renders children before its controls and stats, so the slider and readout live here to keep
  // them ahead of the per-question evidence.
  return (
    <WidgetFrame title={title} instructions={instructions} summary={summary} stats={[]} status={status}>
      <div className="sdv-rag">
        <div className="sdv-sim__controls">
          <Slider
            label="Evidence threshold"
            value={threshold}
            min={MIN}
            max={MAX}
            step={STEP}
            onChange={(value) => setThreshold(Math.round(value * 100) / 100)}
            format={(value) => value.toFixed(2)}
            hint="Support is the best of cosine similarity and the share of query words the chunk covers."
          />
        </div>
        <StatTable
          rows={stats}
          caption={`Fixture eval, ${total} questions across two stores. Illustrative.`}
        />
        <details className="sdv-sim__more sdv-rag-abstain__details">
          <summary>Inspect all {total} questions</summary>
          <p className="sdv-rag-meta">
            Each question runs pre-filtered hybrid search. The best supported chunk answers only when its
            support meets the threshold. Fixture answers, illustrative.
          </p>
          <DiagramScroll label="Fixture eval questions and outcomes, scrollable">
            <table className="sdv-stats sdv-rag-eval">
              <caption>Fixture eval questions and outcomes</caption>
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Support</th>
                  <th scope="col">Best chunk</th>
                  <th scope="col">Right chunk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badge = outcomeBadge(row);
                  const below = row.support < threshold;
                  return (
                    <tr key={row.question.id}>
                      <th scope="row">
                        <span className="sdv-rag-eval__id">{row.question.id}</span> {row.question.query.text}
                        <span className="sdv-rag-eval__store">
                          {TENANTS[row.question.query.tenant].short} store
                        </span>
                      </th>
                      <td>
                        <ToneBadge tone={badge.tone}>{badge.text}</ToneBadge>
                      </td>
                      <td className="sdv-rag-eval__support" data-below={below ? 'true' : undefined}>
                        {row.support.toFixed(3)}
                        <span className="sdv-rag-meta">{below ? ' below bar' : ' meets bar'}</span>
                      </td>
                      <td className="sdv-rag-eval__chunk">{row.top ?? 'None'}</td>
                      <td className="sdv-rag-eval__chunk">
                        {row.question.expected ?? 'None, should abstain'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DiagramScroll>
          <ul className="sdv-legend" aria-label="How to read the eval">
            <li>
              Right to abstain means the store has no policy for the question, so a handoff is the right
              answer.
            </li>
            <li>
              Abstained, answer existed means the policy has an answer but the evidence fell below the bar: a
              cost, but a safe one.
            </li>
            <li>Wrong answer means the assistant cited a chunk that does not answer the question.</li>
            <li>
              Toy embeddings are hand-assigned for teaching; real systems compute embeddings with an embedding
              model.
            </li>
          </ul>
        </details>
      </div>
    </WidgetFrame>
  );
}
