import { useId, useState } from 'react';
import { ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';

export interface QuizOption {
  text: string;
  correct?: boolean;
  /** Why this option is right or wrong. Every option gets one. */
  why: string;
}

export interface QuizQuestion {
  prompt: string;
  options: QuizOption[];
}

export default function Quiz({
  questions,
  title = 'Check your understanding',
}: {
  questions: QuizQuestion[];
  title?: string;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const answered = Object.keys(answers).length;
  const score = Object.entries(answers).filter(([q, o]) => questions[Number(q)]?.options[o]?.correct).length;

  return (
    <section className="sdv-quiz not-content" aria-label={title}>
      <header className="sdv-quiz__header">
        <h3 className="sdv-quiz__title">{title}</h3>
        <p aria-live="polite">
          {answered === questions.length
            ? `Score: ${score} of ${questions.length}`
            : `${answered} of ${questions.length} answered`}
        </p>
      </header>
      <ol className="sdv-quiz__list">
        {questions.map((question, index) => (
          <li key={question.prompt}>
            <QuizItem
              question={question}
              number={index + 1}
              onAnswer={(option) => setAnswers((current) => ({ ...current, [index]: option }))}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function QuizItem({
  question,
  number,
  onAnswer,
}: {
  question: QuizQuestion;
  number: number;
  onAnswer: (option: number) => void;
}) {
  const name = useId();
  const hydrated = useHydrated();
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const picked = choice === null ? undefined : question.options[choice];

  return (
    <div className="sdv-quiz__item">
      <fieldset disabled={checked || !hydrated}>
        <legend className="sdv-quiz__prompt">
          <span className="sdv-visually-hidden">Question {number}: </span>
          {question.prompt}
        </legend>
        <div className="sdv-choices">
          {question.options.map((option, index) => (
            <label
              key={option.text}
              className="sdv-choice"
              data-state={
                checked ? (option.correct ? 'correct' : index === choice ? 'wrong' : undefined) : undefined
              }
            >
              <input type="radio" name={name} checked={choice === index} onChange={() => setChoice(index)} />
              <span>{option.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {!checked && (
        <button
          type="button"
          className="sdv-button"
          disabled={choice === null}
          onClick={() => {
            if (choice === null) return;
            setChecked(true);
            onAnswer(choice);
          }}
        >
          Check answer
        </button>
      )}
      <div aria-live="polite">
        {checked && picked && (
          <div className="sdv-quiz__feedback">
            <p>
              <ToneBadge tone={picked.correct ? 'ok' : 'bad'}>
                {picked.correct ? 'Correct' : 'Not quite'}
              </ToneBadge>{' '}
              {picked.why}
            </p>
            <details>
              <summary>Why each option is right or wrong</summary>
              <ul>
                {question.options.map((option) => (
                  <li key={option.text}>
                    <strong>
                      {option.correct ? 'Right: ' : 'Wrong: '}
                      {option.text}.
                    </strong>{' '}
                    {option.why}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
