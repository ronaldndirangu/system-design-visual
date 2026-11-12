import { useEffect, useState } from 'react';
import { isComplete, lessonProgress, readProgress, recordQuiz, setComplete } from '../../lib/progress';
import { ToneBadge } from '../sim/StatTable';
import { UiIcon } from '../viz/icons';
import { ChoiceError, ChoiceList, useChoiceCard } from './ChoiceCard';
import { useProgress } from './useProgress';

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

interface LessonContext {
  id: string;
  /** Question ids missed on the previous full attempt, read once so the tags stay put during this one. */
  missedBefore: ReadonlySet<string>;
}

/** The lesson page marks itself with `data-lesson-id`; quizzes elsewhere save nothing. */
function readLessonContext(): LessonContext | null {
  const id = document.querySelector<HTMLElement>('span[data-lesson-id]')?.dataset.lessonId;
  if (!id) return null;
  return { id, missedBefore: new Set(lessonProgress(readProgress(), id).missed) };
}

export default function Quiz({
  questions,
  title = 'Check your understanding',
  record = true,
}: {
  questions: QuizQuestion[];
  title?: string;
  /** Save the score and missed questions to lesson progress. Recall quizzes set this to false. */
  record?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [lesson, setLesson] = useState<LessonContext | null>(null);
  const progress = useProgress();
  const answered = questions.filter((question) => question.id in answers).length;
  const score = questions.filter((question) => {
    const answer = answers[question.id];
    return answer !== undefined && question.options[answer]?.correct;
  }).length;
  const finished = answered === questions.length;
  const done = lesson !== null && progress !== null && isComplete(progress, lesson.id);

  useEffect(() => {
    if (record) setLesson(readLessonContext());
  }, [record]);

  useEffect(() => {
    if (!lesson || answered !== questions.length) return;
    const missed = questions
      .filter((question) => !question.options[answers[question.id] ?? -1]?.correct)
      .map((question) => question.id);
    recordQuiz(lesson.id, questions.length - missed.length, questions.length, missed);
  }, [lesson, answers, answered, questions]);

  return (
    <section className="sdv-quiz not-content" aria-label={title}>
      <header className="sdv-quiz__header">
        <h3 className="sdv-quiz__title">{title}</h3>
        <p aria-live="polite">
          {finished
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
              missedBefore={lesson?.missedBefore.has(question.id) ?? false}
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
      {finished && lesson && (
        <div className="sdv-quiz__done">
          <p>
            {score} of {questions.length}.{' '}
            {done ? 'This lesson is marked complete.' : 'Mark the lesson complete?'}
          </p>
          <button
            type="button"
            className={`sdv-button${done ? '' : ' sdv-button--primary'}`}
            aria-pressed={done}
            onClick={() => setComplete(lesson.id, !done)}
          >
            <UiIcon name="check" />
            {done ? 'Completed' : 'Mark complete'}
          </button>
        </div>
      )}
    </section>
  );
}

export function QuizItem({
  question,
  number,
  missedBefore,
  onAnswer,
  onReset,
}: {
  question: QuizQuestion;
  number: number;
  missedBefore: boolean;
  onAnswer: (option: number) => void;
  onReset: () => void;
}) {
  const card = useChoiceCard(question.id, question.options.length, question.ordered);
  const picked = card.choice === null ? undefined : question.options[card.choice];
  const describedBy = card.error ? card.errorId : undefined;

  return (
    <div className="sdv-quiz__item">
      <fieldset aria-describedby={describedBy}>
        <legend className="sdv-quiz__prompt">
          <span className="sdv-visually-hidden">Question {number}: </span>
          {question.prompt}
          {missedBefore && (
            <>
              {' '}
              <ToneBadge tone="warn">Missed last time</ToneBadge>
            </>
          )}
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
