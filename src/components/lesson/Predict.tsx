import type { ReactNode } from 'react';
import { ToneBadge } from '../sim/StatTable';
import { ChoiceError, ChoiceList, useChoiceCard } from './ChoiceCard';

interface Props {
  /** Stable and unique site-wide, for example "scaling/caching/predict-1". Never change it once published. */
  id: string;
  question: string;
  options: string[];
  /** Index of the option that matches what really happens. */
  answer: number;
  /** Options form a scale (1, 10, 100). Keep their sequence instead of shuffling. */
  ordered?: boolean;
  /** One line per option on why it is right or wrong. The reveal shows the line for the learner's guess. */
  why?: string[];
  /** A diagram or chart the question refers to. Pass it from MDX as `<div slot="figure">`. */
  figure?: ReactNode;
  /** The reveal, shown after the learner commits to a guess. */
  children?: ReactNode;
}

/** Ask for a guess before showing the answer. Committing first makes the answer stick. */
export default function Predict({ id, question, options, answer, ordered, why, figure, children }: Props) {
  const card = useChoiceCard(id, options.length, ordered);
  const correct = card.submitted && card.choice === answer;
  const describedBy = card.error ? card.errorId : undefined;
  const reason = card.choice === null ? undefined : why?.[card.choice];

  return (
    <section className="sdv-predict not-content" aria-label="Make a prediction">
      <p className="sdv-predict__eyebrow">Predict first</p>
      {figure && <div className="sdv-predict__figure">{figure}</div>}
      <fieldset aria-describedby={describedBy}>
        <legend className="sdv-predict__question">{question}</legend>
        <ChoiceList card={card} labels={options} answer={answer} pickedLabel="Your guess" />
      </fieldset>
      <ChoiceError card={card} />
      {card.submitted ? (
        <div className="sdv-predict__reveal">
          <h3 className="sdv-result" tabIndex={-1} ref={card.resultRef}>
            <ToneBadge tone={correct ? 'ok' : 'warn'}>{correct ? 'You called it' : 'Surprise'}</ToneBadge>
          </h3>
          {reason && <p className="sdv-predict__why">{reason}</p>}
          <div className="sdv-predict__body">{children}</div>
        </div>
      ) : (
        <button
          type="button"
          className="sdv-button sdv-button--primary"
          aria-describedby={describedBy}
          onClick={() => card.submit()}
        >
          Lock in my guess
        </button>
      )}
    </section>
  );
}
