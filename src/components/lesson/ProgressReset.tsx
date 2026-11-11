import { useState } from 'react';
import { readyLessons } from '../../data/curriculum';
import { resetProgress } from '../../lib/progress';
import { useProgress } from './useProgress';

export default function ProgressReset() {
  const progress = useProgress();
  const [confirming, setConfirming] = useState(false);
  const count = progress ? readyLessons.filter((lesson) => progress.completed[lesson.id]).length : 0;

  return (
    <div className="sdv-reset not-content">
      <p aria-live="polite">
        {progress === null
          ? 'Loading your progress.'
          : `${count} of ${readyLessons.length} available lessons complete. Saved on this device only.`}
      </p>
      {confirming ? (
        // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section
        <div className="sdv-reset__confirm" role="group" aria-label="Confirm reset">
          <span>Clear all progress on this device?</span>
          <button
            type="button"
            className="sdv-button"
            onClick={() => {
              resetProgress();
              setConfirming(false);
            }}
          >
            Yes, reset
          </button>
          <button type="button" className="sdv-button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="sdv-button"
          disabled={count === 0}
          onClick={() => setConfirming(true)}
        >
          Reset progress
        </button>
      )}
    </div>
  );
}
