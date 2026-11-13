import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { allLessons } from '../../data/curriculum';
import { readPractice, subscribePractice } from '../../lib/practiceProgress';
import { completedCount, type ImportMode } from '../../lib/progress';
import {
  applyStudyImport,
  exportStudyData,
  hasStudyData,
  parseStudyImport,
  readStudyData,
  resetStudyData,
  type StudyData,
  type StudySummary,
  summarizeStudy,
} from '../../lib/studyData';
import { useReview } from '../review/useReview';
import { useProgress, useProgressPersistent } from './useProgress';

const lessonIds = allLessons.map((lesson) => lesson.id);

interface PendingImport {
  fileName: string;
  data: StudyData;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function summaryText({ completed, quizScores, cards, checkpoints, rounds }: StudySummary): string {
  return [
    `${plural(completed, 'lesson', 'lessons')} complete`,
    plural(quizScores, 'quiz score', 'quiz scores'),
    plural(cards, 'review card', 'review cards'),
    plural(checkpoints, 'checkpoint score', 'checkpoint scores'),
    plural(rounds, 'practice round', 'practice rounds'),
  ].join(', ');
}

export default function ProgressReset() {
  const progress = useProgress();
  const review = useReview();
  const practice = useSyncExternalStore(subscribePractice, readPractice, () => null);
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
  const loading = progress === null || review === null || practice === null;
  const count = progress ? completedCount(progress, lessonIds) : 0;
  const hasData = !loading && hasStudyData({ progress, review, practice });

  useEffect(() => {
    if (confirming) backRef.current?.focus();
  }, [confirming]);

  function download(fileName = 'sdv-progress.json') {
    const url = URL.createObjectURL(new Blob([exportStudyData()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(`Downloaded ${fileName}.`);
  }

  async function upload(file: File) {
    const parsed = parseStudyImport(await file.text());
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
    applyStudyImport(pending.data, chosen);
    const saved = summaryText(summarizeStudy(readStudyData()));
    closeImport();
    exportRef.current?.focus();
    setMessage(
      chosen === 'merge'
        ? `Merged the file into your progress: ${saved}.`
        : `Replaced your progress with the file: ${saved}.`,
    );
  }

  function reset() {
    resetStudyData();
    dialogRef.current?.close();
    exportRef.current?.focus();
    setMessage('All study data cleared.');
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
          Clear all study data?
        </h2>
        <p>
          This removes completed lessons, quiz scores, your place in the course, review schedules, checkpoint
          scores, and practice rounds from this browser. Export first to keep a copy.
        </p>
        <div className="sdv-reset__actions">
          {/* biome-ignore lint/a11y/noAutofocus: the safe choice takes focus when the confirm dialog opens */}
          <button type="button" className="sdv-button" autoFocus onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="button" className="sdv-button" data-tone="bad" onClick={reset}>
            Clear all study data
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
              <li>In the file: {summaryText(summarizeStudy(pending.data))}.</li>
              <li>In this browser: {summaryText(summarizeStudy(readStudyData()))}.</li>
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
                Merge: keep every completed lesson, the better quiz and checkpoint scores, your current review
                schedule, and the newest practice rounds.
              </label>
              <label>
                <input
                  type="radio"
                  name={modeName}
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />{' '}
                Replace: use the file for each kind of study data it holds, and discard that data in this
                browser.
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
              The file replaces the matching study data in this browser, which holds{' '}
              {summaryText(summarizeStudy(readStudyData()))}. Download a backup first to keep a copy.
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
