import { useState } from 'react';
import { ToneBadge } from '../sim/StatTable';
import { ChoiceError, ChoiceList, useChoiceCard } from './ChoiceCard';

export interface QuizOption {
  text: string;
  correct?: boolean;
  /** Why this option is right or wrong. Every option gets one. */
  why: string;
}

export interface QuizQuestion {
  /** Stable and unique site-wide, for example "scaling/caching/q1". Never change it once published. */
  id: string;
  prompt: string;
  options: QuizOption[];
  /** Options form a scale (1, 10, 100). Keep their sequence instead of shuffling. */
  ordered?: boolean;
}

export default function Quiz({
  questions,
  title = 'Check your understanding',
}: {
  questions: QuizQuestion[];
  title?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const answered = questions.filter((question) => question.id in answers).length;
  const score = questions.filter((question) => {
    const answer = answers[question.id];
    return answer !== undefined && question.options[answer]?.correct;
  }).length;

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
          <li key={question.id}>
            <QuizItem
              question={question}
              number={index + 1}
              onAnswer={(option) => setAnswers((current) => ({ ...current, [question.id]: option }))}
              onReset={() =>
                setAnswers((current) => {
                  const next = { ...current };
                  delete next[question.id];
                  return next;
                })
              }
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
  onReset,
}: {
  question: QuizQuestion;
  number: number;
  onAnswer: (option: number) => void;
  onReset: () => void;
}) {
  const card = useChoiceCard(question.id, question.options.length, question.ordered);
  const picked = card.choice === null ? undefined : question.options[card.choice];
  const describedBy = card.error ? card.errorId : undefined;

  return (
    <div className="sdv-quiz__item">
      <fieldset disabled={!card.hydrated} aria-describedby={describedBy}>
        <legend className="sdv-quiz__prompt">
          <span className="sdv-visually-hidden">Question {number}: </span>
          {question.prompt}
        </legend>
        <ChoiceList
          card={card}
          labels={question.options.map((option) => option.text)}
          answer={question.options.findIndex((option) => option.correct)}
          pickedLabel="Your answer"
        />
      </fieldset>
      <ChoiceError card={card} />
      {card.submitted && picked ? (
        <div className="sdv-quiz__feedback">
          <h4 className="sdv-result" tabIndex={-1} ref={card.resultRef}>
            <ToneBadge tone={picked.correct ? 'ok' : 'bad'}>
              {picked.correct ? 'Correct' : 'Not quite'}
            </ToneBadge>
          </h4>
          <p>{picked.why}</p>
          <details>
            <summary>Why each option is right or wrong</summary>
            <ul>
              {card.order.map((index) => {
                const option = question.options[index];
                return option ? (
                  <li key={index}>
                    <strong>
                      {option.correct ? 'Right: ' : 'Wrong: '}
                      {option.text}.
                    </strong>{' '}
                    {option.why}
                  </li>
                ) : null;
              })}
            </ul>
          </details>
          <button
            type="button"
            className="sdv-button"
            onClick={() => {
              card.retry();
              onReset();
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="sdv-button"
          disabled={!card.hydrated}
          aria-describedby={describedBy}
          onClick={() => {
            const option = card.submit();
            if (option !== null) onAnswer(option);
          }}
        >
          Check answer
        </button>
      )}
    </div>
  );
}
