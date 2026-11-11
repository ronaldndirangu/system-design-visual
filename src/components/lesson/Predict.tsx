import { type ReactNode, useId, useState } from 'react';
import { ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';

interface Props {
  question: string;
  options: string[];
  /** Index of the option that matches what really happens. */
  answer: number;
  /** The reveal, shown after the learner commits to a guess. */
  children?: ReactNode;
}

/** Ask for a guess before showing the answer. Committing first makes the answer stick. */
export default function Predict({ question, options, answer, children }: Props) {
  const name = useId();
  const hydrated = useHydrated();
  const [choice, setChoice] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const correct = locked && choice === answer;

  return (
    <section className="sdv-predict not-content" aria-label="Make a prediction">
      <p className="sdv-predict__eyebrow">Predict first</p>
      <fieldset disabled={locked || !hydrated}>
        <legend className="sdv-predict__question">{question}</legend>
        <div className="sdv-choices">
          {options.map((option, index) => (
            <label
              key={option}
              className="sdv-choice"
              data-state={
                locked ? (index === answer ? 'correct' : index === choice ? 'wrong' : undefined) : undefined
              }
            >
              <input type="radio" name={name} checked={choice === index} onChange={() => setChoice(index)} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {!locked ? (
        <button
          type="button"
          className="sdv-button sdv-button--primary"
          disabled={choice === null}
          onClick={() => setLocked(true)}
        >
          Lock in my guess
        </button>
      ) : null}
      <div aria-live="polite">
        {locked && (
          <div className="sdv-predict__reveal">
            <ToneBadge tone={correct ? 'ok' : 'warn'}>{correct ? 'You called it' : 'Surprise'}</ToneBadge>
            <div className="sdv-predict__body">{children}</div>
          </div>
        )}
      </div>
    </section>
  );
}
