import { isComplete, lessonProgress, readProgress, setComplete } from '../../lib/progress';
import { UiIcon } from '../viz/icons';
import { useProgress, useProgressPersistent } from './useProgress';

interface Props {
  lessonId: string;
  title: string;
  nextHref?: string;
  nextTitle?: string;
}

export default function LessonComplete({ lessonId, title, nextHref, nextTitle }: Props) {
  const progress = useProgress();
  const persistent = useProgressPersistent();
  const done = progress ? isComplete(progress, lessonId) : false;
  const quizBest = progress ? lessonProgress(progress, lessonId).quizBest : undefined;
  const loading = progress === null;

  return (
    <section
      className="sdv-complete not-content"
      aria-labelledby="sdv-complete-title"
      data-complete={done || undefined}
    >
      <h2 id="sdv-complete-title" className="sdv-complete__title">
        {done ? `You finished “${title}”` : 'Finished the lesson?'}
      </h2>
      <p className="sdv-complete__text">
        {done
          ? 'Nice work. This lesson shows a check mark on the course map.'
          : 'Mark it complete to track your progress on the course map.'}
        {quizBest &&
          (quizBest.set
            ? ` Quiz best: ${quizBest.score} of ${quizBest.total}.`
            : ` Earlier quiz result: ${quizBest.score} of ${quizBest.total}.`)}{' '}
        {loading
          ? 'Loading your progress.'
          : persistent
            ? 'Progress saves on this device only.'
            : 'Saved for this tab only, because your browser blocked storage.'}
      </p>
      <div className="sdv-complete__actions">
        <button
          type="button"
          className={`sdv-button${done ? '' : ' sdv-button--primary'}`}
          aria-pressed={done}
          aria-busy={loading || undefined}
          onClick={() => setComplete(lessonId, !isComplete(readProgress(), lessonId))}
        >
          <UiIcon name="check" />
          {done ? 'Completed' : 'Mark lesson complete'}
        </button>
        {nextHref && nextTitle && (
          <a className="sdv-button" href={nextHref}>
            Next: {nextTitle}
          </a>
        )}
      </div>
    </section>
  );
}
