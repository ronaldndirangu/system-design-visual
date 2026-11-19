import { useEffect } from 'react';
import {
  type ConceptMetadata,
  journeyById,
  journeyProgress,
  learningDone,
  learningPage,
  learningStatus,
  stagePages,
} from '../../data/journeys';
import { lessonHref, withBase } from '../../lib/paths';
import { emptyProgress, recordGuidedVisit } from '../../lib/progress';
import { useProgress, useProgressPersistent } from '../lesson/useProgress';

export default function SystemJourney({ id, metadata }: { id: string; metadata: ConceptMetadata }) {
  const progress = useProgress();
  const persistent = useProgressPersistent();
  const journey = journeyById(id);
  useEffect(() => recordGuidedVisit(`journeys/${id}`, id), [id]);
  if (!journey) throw new Error(`Unknown journey: ${id}`);
  const data = progress ?? emptyProgress();
  const status = journeyProgress(journey, data, metadata);
  return (
    <div className="sdv-system-journey not-content">
      <p className="sdv-section-lead">{journey.outcome}</p>
      <section className="sdv-guidance sdv-path-next" aria-label="Your next step">
        <p>
          <strong>
            {status.next ? `Stage ${status.stage + 1} of ${journey.stages.length}` : 'Path complete'}
          </strong>
          {' · '}
          {status.completed} of {status.total} milestones complete
        </p>
        <progress value={status.completed} max={status.total} aria-label="Learning path progress" />
        <a
          className="sdv-button sdv-button--primary"
          href={status.next ? lessonHref(status.next.id, id) : withBase('/journeys/')}
        >
          {status.next ? `Next: ${status.next.title}` : 'Choose another system'}
        </a>
        <p className="sdv-system-meta">
          {persistent
            ? 'Progress stays in this browser.'
            : 'Progress lasts for this tab only because storage is blocked.'}{' '}
        </p>
      </section>
      <details className="sdv-path-about">
        <summary>How this path works</summary>
        <p>
          Start with the three prerequisite concepts in stage 1. Mastered concepts count across paths. A
          perfect concept check marks mastery; the final case study applies those ideas to a system. Mark it
          complete after its design exercise. Deeper lessons are optional, and you can explore any stage.
        </p>
      </details>
      <ol className="sdv-system-stages">
        {journey.stages.map((stage, index) => {
          const pages = stagePages(stage);
          const done = pages.every((page) => learningDone(data, page, metadata));
          return (
            <li
              className="sdv-path-stage"
              key={stage.title}
              data-status={done ? 'complete' : index === status.stage ? 'current' : 'upcoming'}
              aria-current={index === status.stage ? 'step' : undefined}
            >
              <span className="sdv-path-stage__number" aria-hidden="true">
                {index + 1}
              </span>
              <header className="sdv-path-stage__heading">
                <p className="sdv-overline">
                  {stage.scenario
                    ? 'Final case study'
                    : done
                      ? 'Complete'
                      : index === status.stage
                        ? 'Current stage'
                        : 'Upcoming stage'}
                </p>
                <h2>{stage.title.replace(/^\d+\.\s*/, '')}</h2>
                {stage.scenario && (
                  <span className="sdv-system-meta">{done ? 'Complete' : 'Apply what you learned'}</span>
                )}
              </header>
              <p className="sdv-path-stage__problem">{stage.problem}</p>
              <ul className="sdv-system-links">
                {pages.map((page) => {
                  const target = learningPage(page, metadata);
                  return (
                    <li key={page}>
                      <a href={lessonHref(page, id)}>
                        {target.format}: {target.title}
                      </a>
                      <span>{learningStatus(data, page, metadata)}</span>
                    </li>
                  );
                })}
              </ul>
              <details className="sdv-stage-details" open={index === status.stage}>
                <summary>Design decision and tradeoff</summary>
                <p>
                  <strong>Decision:</strong> {stage.decision}
                </p>
                <p>
                  <strong>Tradeoff:</strong> {stage.consequence}
                </p>
                {stage.deeper && (
                  <p>
                    <a href={lessonHref(stage.deeper, id)}>
                      Optional deeper lesson: {learningPage(stage.deeper, metadata).title}
                    </a>
                  </p>
                )}
              </details>
            </li>
          );
        })}
      </ol>
      <p>
        <a href={withBase('/journeys/')}>Switch system</a>
        {' · '}
        <a href={withBase('/concepts/')}>Browse all concepts</a>
        {' · '}
        <a href={withBase('/review/')}>Review queue</a>
      </p>
      <noscript>
        JavaScript is off. Follow these stages in order; automatic progress and quizzes need JavaScript. The
        explanations and diagrams remain available.
      </noscript>
    </div>
  );
}
