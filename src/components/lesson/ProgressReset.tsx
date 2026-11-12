import { useId, useRef, useState } from 'react';
import { allLessons } from '../../data/curriculum';
import { completedCount, exportProgress, importProgress, resetProgress } from '../../lib/progress';
import { useProgress, useProgressPersistent } from './useProgress';

const lessonIds = allLessons.map((lesson) => lesson.id);

export default function ProgressReset() {
  const progress = useProgress();
  const persistent = useProgressPersistent();
  const [message, setMessage] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const count = progress ? completedCount(progress, lessonIds) : 0;
  const hasData =
    progress !== null && (Object.keys(progress.lessons).length > 0 || progress.last !== undefined);

  function download() {
    const url = URL.createObjectURL(new Blob([exportProgress()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sdv-progress.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage('Downloaded sdv-progress.json.');
  }

  async function upload(file: File) {
    const result = importProgress(await file.text());
    const lessons = result.ok && result.lessons === 1 ? 'lesson' : 'lessons';
    setMessage(result.ok ? `Imported progress for ${result.lessons} ${lessons}.` : result.error);
  }

  function reset() {
    resetProgress();
    dialogRef.current?.close();
    exportRef.current?.focus();
    setMessage('Progress cleared.');
  }

  return (
    <div className="sdv-reset not-content">
      <p aria-live="polite">
        {progress === null
          ? 'Loading your progress.'
          : `${count} of ${lessonIds.length} lessons complete. ${
              persistent
                ? 'Saved on this device only.'
                : 'Saved for this tab only, because your browser blocked storage.'
            }`}
        {message && ` ${message}`}
      </p>
      <div className="sdv-reset__actions">
        <button
          ref={exportRef}
          type="button"
          className="sdv-button"
          disabled={progress === null}
          onClick={download}
        >
          Export progress
        </button>
        <button
          type="button"
          className="sdv-button"
          disabled={progress === null}
          onClick={() => fileRef.current?.click()}
        >
          Import progress
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          className="sdv-button"
          data-tone="bad"
          disabled={!hasData}
          onClick={() => dialogRef.current?.showModal()}
        >
          Reset progress
        </button>
      </div>
      <dialog ref={dialogRef} className="sdv-reset__dialog" aria-labelledby={titleId}>
        <h2 id={titleId} className="sdv-reset__dialog-title">
          Clear all progress?
        </h2>
        <p>
          This removes completed lessons, quiz scores, and your place in the course from this browser. Export
          first to keep a copy.
        </p>
        <div className="sdv-reset__actions">
          {/* biome-ignore lint/a11y/noAutofocus: the safe choice takes focus when the confirm dialog opens */}
          <button type="button" className="sdv-button" autoFocus onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="button" className="sdv-button" data-tone="bad" onClick={reset}>
            Clear progress
          </button>
        </div>
      </dialog>
    </div>
  );
}
