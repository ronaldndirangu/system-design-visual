import {
  type ConceptMetadata,
  journeyById,
  journeyIncludes,
  journeyProgress,
  journeys,
  stagePages,
} from '../../data/journeys';
import { lessonHref } from '../../lib/paths';
import { useProgress } from '../lesson/useProgress';

export default function JourneyContext({
  pageId,
  compact = false,
  metadata,
}: {
  pageId: string;
  compact?: boolean;
  metadata: ConceptMetadata;
}) {
  const progress = useProgress();
  const active = journeyById(progress?.journey);
  const related = journeys.filter((journey) => journeyIncludes(journey, pageId));
  if (progress && active && journeyIncludes(active, pageId)) {
    const status = journeyProgress(active, progress, metadata);
    const stage = active.stages.findIndex(
      (item) => stagePages(item).includes(pageId) || item.deeper === pageId,
    );
    return (
      <aside className="sdv-guidance not-content" aria-label="Learning path guidance">
        <p>
          <a href={lessonHref(`journeys/${active.id}`)}>{active.title}</a>
          {' · '}
          {status.next ? `Stage ${stage + 1} of ${active.stages.length}` : 'Path complete'}
          {' · '}
          {status.completed}/{status.total} complete
        </p>
        {!compact &&
          (status.next?.id === pageId ? (
            <p>
              {pageId.startsWith('concepts/')
                ? 'Master this concept with the quick check above to continue.'
                : 'Finish the exercise and mark this lesson complete below.'}
            </p>
          ) : (
            <a
              className="sdv-button"
              href={lessonHref(status.next?.id ?? 'journeys', status.next ? active.id : undefined)}
            >
              {status.next ? `Next in your path: ${status.next.title}` : 'Choose another system'}
            </a>
          ))}
      </aside>
    );
  }
  if (compact || related.length === 0) return null;
  return (
    <aside className="sdv-guidance not-content" aria-label="Apply this idea">
      <p>
        <strong>Use this concept in a learning path</strong>
      </p>
      <ul>
        {related.map((journey) => (
          <li key={journey.id}>
            <a href={lessonHref(`journeys/${journey.id}`)}>{journey.title}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
