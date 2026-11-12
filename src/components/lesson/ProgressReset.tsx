import { useEffect, useId, useRef, useState } from 'react';
import { allLessons } from '../../data/curriculum';
import {
  applyImport,
  completedCount,
  exportProgress,
  type ImportMode,
  type ProgressData,
  type ProgressSummary,
  parseImport,
  readProgress,
  resetProgress,
  summarizeProgress,
} from '../../lib/progress';
import { useProgress, useProgressPersistent } from './useProgress';

const lessonIds = allLessons.map((lesson) => lesson.id);

interface PendingImport {
  fileName: string;
  data: ProgressData;
}

function summaryText({ completed, quizScores }: ProgressSummary): string {
  return `${completed} ${completed === 1 ? 'lesson' : 'lessons'} complete, ${quizScores} quiz ${
    quizScores === 1 ? 'score' : 'scores'
  }`;
}

export default function ProgressReset() {
  const progress = useProgress();
  const persistent = useProgressPersistent();
  const [message, setMessage] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const importDialogRef = useRef<HTMLDialogElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const importTitleId = useId();
  const modeName = useId();
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [confirming, setConfirming] = useState(false);
  const loading = progress === null;
  const count = progress ? completedCount(progress, lessonIds) : 0;
  const hasData =
    progress !== null && (Object.keys(progress.lessons).length > 0 || progress.last !== undefined);

  useEffect(() => {
    if (confirming) backRef.current?.focus();
  }, [confirming]);

  function download(fileName = 'sdv-progress.json') {
    const url = URL.createObjectURL(new Blob([exportProgress()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(`Downloaded ${fileName}.`);
  }

  async function upload(file: File) {
    const parsed = parseImport(await file.text());
    if (!parsed.ok) {
      setMessage(parsed.error);
      return;
    }
    setMessage('');
    setMode('merge');
    setConfirming(false);
    setPending({ fileName: file.name, data: parsed.data });
    importDialogRef.current?.showModal();
  }

  function closeImport() {
    importDialogRef.current?.close();
  }

  function apply(chosen: ImportMode) {
    if (!pending) return;
    const lessons = applyImport(pending.data, chosen);
    const noun = lessons === 1 ? 'lesson' : 'lessons';
    closeImport();
    exportRef.current?.focus();
    setMessage(
      chosen === 'merge'
        ? `Merged the file into your progress: ${lessons} ${noun} saved.`
        : `Replaced your progress with the file: ${lessons} ${noun} saved.`,
    );
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
        {loading
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
          aria-busy={loading || undefined}
          onClick={() => download()}
        >
          Export progress
        </button>
        <button
          type="button"
          className="sdv-button"
          aria-busy={loading || undefined}
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
          aria-busy={loading || undefined}
          disabled={!loading && !hasData}
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
      <dialog
        ref={importDialogRef}
        className="sdv-reset__dialog"
        aria-labelledby={importTitleId}
        onClose={() => setPending(null)}
      >
        {pending && !confirming && (
          <>
            <h2 id={importTitleId} className="sdv-reset__dialog-title">
              Import {pending.fileName}?
            </h2>
            <ul className="sdv-reset__summary">
              <li>In the file: {summaryText(summarizeProgress(pending.data))}.</li>
              <li>In this browser: {summaryText(summarizeProgress(readProgress()))}.</li>
            </ul>
            <fieldset className="sdv-reset__modes">
              <legend>How to import</legend>
              <label>
                <input
                  type="radio"
                  name={modeName}
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                />{' '}
                Merge: keep every completed lesson and the better quiz score for each lesson.
              </label>
              <label>
                <input
                  type="radio"
                  name={modeName}
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />{' '}
                Replace: discard the progress in this browser and use the file.
              </label>
            </fieldset>
            <div className="sdv-reset__actions">
              {/* biome-ignore lint/a11y/noAutofocus: the safe choice takes focus when the import dialog opens */}
              <button type="button" className="sdv-button" autoFocus onClick={closeImport}>
                Cancel
              </button>
              <button
                type="button"
                className="sdv-button"
                onClick={() => download('sdv-progress-backup.json')}
              >
                Download backup
              </button>
              <button
                type="button"
                className="sdv-button sdv-button--primary"
                onClick={() => (mode === 'merge' ? apply('merge') : setConfirming(true))}
              >
                {mode === 'merge' ? 'Merge progress' : 'Continue'}
              </button>
            </div>
          </>
        )}
        {pending && confirming && (
          <>
            <h2 id={importTitleId} className="sdv-reset__dialog-title">
              Replace all progress?
            </h2>
            <p>
              The file replaces {summaryText(summarizeProgress(readProgress()))} in this browser. Download a
              backup first to keep a copy.
            </p>
            <div className="sdv-reset__actions">
              <button ref={backRef} type="button" className="sdv-button" onClick={() => setConfirming(false)}>
                Back
              </button>
              <button
                type="button"
                className="sdv-button"
                onClick={() => download('sdv-progress-backup.json')}
              >
                Download backup
              </button>
              <button type="button" className="sdv-button" data-tone="bad" onClick={() => apply('replace')}>
                Replace progress
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
