import { m } from 'motion/react';
import { useState } from 'react';
import { chunkPolicy, policyWordCount } from '../../lib/models/retrieval';
import { POLICY_DOC } from '../../lib/models/retrievalCorpus';
import { Slider } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import type { StatRow } from '../sim/StatTable';
import { ToneBadge } from '../sim/StatTable';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { WidgetFrame } from '../sim/WidgetFrame';
import './RetrievalShared.css';
import './ChunkingWidget.css';

interface Props {
  initialSize?: number;
  initialOverlap?: number;
  title?: string;
  instructions?: string;
}

type PresetId = 's16o0' | 's16o8' | 's24o0' | 's8o0' | 'custom';

const presets: {
  value: Exclude<PresetId, 'custom'>;
  label: string;
  diff: string;
  size: number;
  overlap: number;
}[] = [
  { value: 's16o0', label: '16 words, no overlap', diff: 'A common fixed window', size: 16, overlap: 0 },
  { value: 's16o8', label: '16 words, overlap 8', diff: 'Same window, half repeated', size: 16, overlap: 8 },
  {
    value: 's24o0',
    label: '24 words, no overlap',
    diff: 'Bigger window, fewer chunks',
    size: 24,
    overlap: 0,
  },
  { value: 's8o0', label: '8 words, no overlap', diff: 'Tiny window, many chunks', size: 8, overlap: 0 },
];

const SIZE_MIN = 8;
const SIZE_MAX = 32;
const STEP = 4;
const OVERLAP_MAX = 12;

const maxOverlapFor = (size: number) => Math.min(OVERLAP_MAX, size - STEP);

function wordRole(index: number): 'rule' | 'exception' | null {
  if (index >= POLICY_DOC.rule.start && index < POLICY_DOC.rule.end) return 'rule';
  if (index >= POLICY_DOC.exception.start && index < POLICY_DOC.exception.end) return 'exception';
  return null;
}

export default function ChunkingWidget({
  initialSize = 16,
  initialOverlap = 0,
  title = 'Where does the exception land?',
  instructions = 'Change the chunk size and overlap. Retrieval sends the one chunk that best matches "Can I return a sale item?" Watch whether the sale exception rides along with the 30-day rule.',
}: Props) {
  const reduced = usePrefersReducedMotion();
  const [size, setSize] = useState(initialSize);
  const [overlap, setOverlap] = useState(Math.min(initialOverlap, maxOverlapFor(initialSize)));
  const result = chunkPolicy(size, overlap);
  const words = policyWordCount();
  const stored = result.chunks.reduce((sum, c) => sum + c.words.length, 0);
  const preset: PresetId = presets.find((p) => p.size === size && p.overlap === overlap)?.value ?? 'custom';

  const choosePreset = (id: PresetId) => {
    const p = presets.find((option) => option.value === id);
    if (!p) return;
    setSize(p.size);
    setOverlap(p.overlap);
  };
  const changeSize = (next: number) => {
    setSize(next);
    setOverlap((current) => Math.min(current, maxOverlapFor(next)));
  };

  const verdict = result.correct
    ? ({ tone: 'ok', text: 'Exception is in the sent chunk' } as const)
    : ({ tone: 'bad', text: 'Exception missing from the sent chunk' } as const);

  const stats: StatRow[] = [
    { label: 'Chunks', value: String(result.chunks.length), detail: `${words} words in the policy` },
    {
      label: 'Words stored',
      value: String(stored),
      detail: stored > words ? `${stored - words} repeated by overlap` : 'No repeats',
    },
    {
      label: 'Sent chunk',
      value: result.sent.id,
      detail: `words ${result.sent.start + 1} to ${result.sent.end}`,
    },
    {
      label: 'Fixture answer',
      value: result.correct ? 'Correct' : 'Wrong',
      tone: verdict.tone,
      note: result.correct ? 'Grounded' : 'Misleading',
    },
  ];

  const summary = `${size}-word chunks with ${overlap} words of overlap make ${result.chunks.length} chunks. Retrieval sends ${result.sent.id}. ${verdict.text}, so the fixture answer is ${result.correct ? 'correct' : 'wrong'}: ${result.answer}`;

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      stats={stats}
      statsCaption="One policy, one query. Illustrative."
      status={verdict}
      controls={
        <>
          <Slider
            label="Chunk size (words)"
            value={size}
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={STEP}
            onChange={changeSize}
          />
          <Slider
            label="Overlap (words)"
            value={overlap}
            min={0}
            max={maxOverlapFor(size)}
            step={STEP}
            onChange={setOverlap}
            hint="Overlap stays below the chunk size."
          />
        </>
      }
    >
      <div className="sdv-rag">
        <ScenarioChips
          label="Preset"
          value={preset}
          options={[
            ...presets.map(({ value, label, diff }) => ({ value, label, diff })),
            { value: 'custom' as const, label: 'Custom', diff: 'Set by the sliders' },
          ]}
          onChange={choosePreset}
        />
        <MotionRoot>
          <ol className="sdv-rag-chunks" aria-label="Chunks of the Harbor Bikes return policy">
            {result.chunks.map((chunk) => {
              const sent = chunk.id === result.sent.id;
              return (
                <m.li
                  key={`${size}-${overlap}-${chunk.id}`}
                  className="sdv-rag-chunk"
                  data-sent={sent ? 'true' : undefined}
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="sdv-rag-chunk__head">
                    <span className="sdv-rag-chunk__id">{chunk.id}</span>
                    {sent && <ToneBadge tone="neutral">Sent to the model</ToneBadge>}
                    {chunk.hasRule && (
                      <span className="sdv-rag-tag sdv-rag-tag--rule">Has the 30-day rule</span>
                    )}
                    {chunk.hasException && (
                      <span className="sdv-rag-tag sdv-rag-tag--exception">Has the sale exception</span>
                    )}
                  </div>
                  <p className="sdv-rag-chunk__text">
                    {chunk.words.map((word, i) => {
                      const index = chunk.start + i;
                      const role = wordRole(index);
                      return (
                        <span key={index}>
                          {role ? (
                            <mark className={`sdv-rag-word sdv-rag-word--${role}`}>{word}</mark>
                          ) : (
                            word
                          )}{' '}
                        </span>
                      );
                    })}
                  </p>
                </m.li>
              );
            })}
          </ol>
          <section className="sdv-rag-panel sdv-rag-answer" aria-label="Fixture answer">
            <p className="sdv-rag-title">Fixture answer to: Can I return a sale item?</p>
            <p className="sdv-rag-answer__text">
              {result.answer} <span className="sdv-rag-cite">[{result.sent.id}]</span>
            </p>
            <ToneBadge tone={verdict.tone}>{verdict.text}</ToneBadge>
          </section>
        </MotionRoot>
        <ul className="sdv-legend" aria-label="How to read the chunks">
          <li>
            <mark className="sdv-rag-word sdv-rag-word--rule">Solid underline</mark> marks the 30-day rule.
          </li>
          <li>
            <mark className="sdv-rag-word sdv-rag-word--exception">Dashed box</mark> marks the final sale
            exception.
          </li>
          <li>
            A thick border and the Sent to the model badge mark the chunk retrieval sends: the one holding the
            most of the rule, preferring one that also holds the exception. Fixture logic, illustrative.
          </li>
        </ul>
      </div>
    </WidgetFrame>
  );
}
