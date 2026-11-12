import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { withBase } from '../../lib/paths';
import { dueCards, nextDue, readReview, recordAnswer, syncSeeds } from '../../lib/review';
import type { QuizQuestion } from '../lesson/Quiz';
import { QuizItem } from '../lesson/Quiz';
import { useProgress } from '../lesson/useProgress';
import { UiIcon } from '../viz/icons';
import { useReview } from './useReview';

/** The shape `/question-bank.json` serves: every lesson quiz and checkpoint by page id. */
export type QuestionBank = Record<string, { title: string; href: string; questions: QuizQuestion[] }>;

interface BankEntry {
  question: QuizQuestion;
  title: string;
  href: string;
}

const SESSION_SIZE = 20;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function ReviewQueue() {
  const [bank, setBank] = useState<QuestionBank | null>(null);
  const [failed, setFailed] = useState(false);
  const [session, setSession] = useState<string[] | null>(null);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const progress = useProgress();
  const review = useReview();

  const entries = useMemo(() => {
    const byId = new Map<string, BankEntry>();
    for (const page of Object.values(bank ?? {})) {
      for (const question of page.questions)
        byId.set(question.id, { question, title: page.title, href: page.href });
    }
    return byId;
  }, [bank]);

  useEffect(() => {
    let active = true;
    fetch(withBase('/question-bank.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<QuestionBank>;
      })
      .then((data) => {
        if (active) setBank(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!bank || !progress || session) return;
    syncSeeds(progress, bank);
    setSession(
      dueCards(readReview(), new Date())
        .filter((id) => entries.has(id))
        .slice(0, SESSION_SIZE),
    );
  }, [bank, progress, session, entries]);

  const title = 'Due for review';
  const answered = Object.keys(results).length;
  const correct = Object.values(results).filter(Boolean).length;

  let body: ReactNode;
  if (failed) {
    body = <p>The question bank did not load. Refresh the page to try again.</p>;
  } else if (!session || !review) {
    body = <p>Loading your review queue…</p>;
  } else if (session.length === 0) {
    const next = nextDue(review, new Date());
    body = (
      <p>
        {next
          ? `You are all caught up. The next question comes due on ${formatDay(next)}.`
          : 'Nothing to review yet. Finish a lesson quiz or a checkpoint and its questions show up here.'}
      </p>
    );
  } else {
    body = (
      <ol className="sdv-quiz__list">
        {session.map((id, index) => {
          const entry = entries.get(id);
          return entry ? (
            <li key={id}>
              <QuizItem
                question={entry.question}
                number={index + 1}
                missedBefore={false}
                onAnswer={(option) => {
                  if (id in results) return;
                  const right = entry.question.options[option]?.correct === true;
                  recordAnswer(id, right);
                  setResults((current) => ({ ...current, [id]: right }));
                }}
                onReset={() => {}}
              />
              <p>
                From <a href={entry.href}>{entry.title}</a>
              </p>
            </li>
          ) : null;
        })}
      </ol>
    );
  }

  const finished = session !== null && session.length > 0 && answered === session.length;

  return (
    <section className="sdv-quiz not-content" aria-label={title}>
      <header className="sdv-quiz__header">
        <h3 className="sdv-quiz__title">{title}</h3>
        {session && session.length > 0 && (
          <p aria-live="polite">
            {finished ? `${correct} of ${session.length} right` : `${answered} of ${session.length} answered`}
          </p>
        )}
      </header>
      {body}
      {finished && (
        <div className="sdv-quiz__done">
          <p>Right answers wait longer before they come back. Missed questions return tomorrow.</p>
          <button
            type="button"
            className="sdv-button sdv-button--primary"
            onClick={() => {
              setResults({});
              setSession(null);
            }}
          >
            <UiIcon name="reset" />
            Check for more
          </button>
        </div>
      )}
    </section>
  );
}
