import { useEffect, useRef, useState } from 'react';
import { withBase } from '../../lib/paths';
import {
  CHECKPOINT_PASS,
  checkpointResult,
  formatReviewDay,
  nextDue,
  recordCheckpoint,
} from '../../lib/review';
import type { QuizQuestion } from '../lesson/Quiz';
import { QuizItem } from '../lesson/Quiz';
import { ToneBadge } from '../sim/StatTable';
import { UiIcon } from '../viz/icons';
import { useReview } from './useReview';

/**
 * A module checkpoint. The first answer to each question counts toward the score;
 * "Try again" still shows every explanation without changing the result.
 */
export default function Checkpoint({ moduleId, questions }: { moduleId: string; questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState(0);
  const recorded = useRef(-1);
  const review = useReview();
  const best = review ? checkpointResult(review, moduleId) : undefined;
  const answered = questions.filter((question) => question.id in answers).length;
  const missed = questions
    .filter((question) => !question.options[answers[question.id] ?? -1]?.correct)
    .map((question) => question.id);
  const score = questions.length - missed.length;
  const finished = answered === questions.length;
  const needed = Math.ceil(CHECKPOINT_PASS * questions.length);
  const title = 'Module checkpoint';

  useEffect(() => {
    if (!finished || recorded.current === attempt) return;
    recorded.current = attempt;
    recordCheckpoint(
      moduleId,
      score,
      questions.length,
      questions.map((question) => question.id),
      missed,
    );
  }, [finished, attempt, moduleId, score, questions, missed]);

  const next = finished && review ? nextDue(review, new Date()) : null;
  const reviewLink = <a href={withBase('/review/')}>review queue</a>;

  return (
    <section className="sdv-quiz not-content" aria-label={title}>
      <header className="sdv-quiz__header">
        <h3 className="sdv-quiz__title">{title}</h3>
        <p aria-live="polite">
          {finished
            ? `Score: ${score} of ${questions.length}`
            : `${answered} of ${questions.length} answered. Pass mark: ${needed}.`}
          {best && !finished ? ` Best so far: ${best.score} of ${best.total}.` : ''}
        </p>
      </header>
      <ol className="sdv-quiz__list" key={attempt}>
        {questions.map((question, index) => (
          <li key={question.id}>
            <QuizItem
              question={question}
              number={index + 1}
              missedBefore={false}
              onAnswer={(option) =>
                setAnswers((current) =>
                  question.id in current ? current : { ...current, [question.id]: option },
                )
              }
              onReset={() => {}}
            />
          </li>
        ))}
      </ol>
      {finished && (
        <div className="sdv-quiz__done">
          <p>
            <ToneBadge tone={score >= needed ? 'ok' : 'warn'}>
              {score >= needed ? 'Passed' : 'Not yet'}
            </ToneBadge>{' '}
            {score} of {questions.length} on first answers.{' '}
            {missed.length > 0 ? (
              <>
                The{' '}
                {missed.length === 1 ? 'question you missed is' : `${missed.length} questions you missed are`}{' '}
                due now in your {reviewLink}, and the questions you got right come back on later days.
              </>
            ) : (
              <>
                Every question right on the first try. These questions join your {reviewLink}
                {next ? `, and your next review comes due on ${formatReviewDay(next)}.` : '.'}
              </>
            )}
          </p>
          <button
            type="button"
            className="sdv-button sdv-button--primary"
            onClick={() => {
              setAnswers({});
              setAttempt((current) => current + 1);
            }}
          >
            <UiIcon name="reset" />
            Start over
          </button>
        </div>
      )}
    </section>
  );
}
