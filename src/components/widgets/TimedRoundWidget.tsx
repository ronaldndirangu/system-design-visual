import { m } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { coreLessons } from '../../data/coursePath';
import { findModule, findModuleForLesson } from '../../data/curriculum';
import { checklistSteps, practicePrompts, rubricLevels } from '../../data/practicePrompts';
import {
  drawPromptIndex,
  finishRound,
  formatClock,
  initialRound,
  nextStep,
  PACES,
  type PaceId,
  paceConfig,
  pauseRound,
  previousStep,
  type RoundState,
  type RubricScore,
  resumeRound,
  revealOutline,
  roundTotals,
  rubricTotal,
  STEP_COUNT,
  type StepReport,
  scoreCriterion,
  startRound,
  stepReports,
  tickRound,
  totalBudgetMs,
  weakestSteps,
} from '../../lib/models/timedRound';
import {
  clearPractice,
  isPracticePersistent,
  readPractice,
  saveRound,
  subscribePractice,
} from '../../lib/practiceProgress';
import { isComplete, type ProgressData, readProgress, subscribeProgress } from '../../lib/progress';
import { Segmented, Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import type { StatRow, Tone } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { WidgetFrame } from '../sim/WidgetFrame';
import { UiIcon } from '../viz/icons';
import './TimedRoundWidget.css';

const TICK_MS = 250;
const ONE_MINUTE_MS = 60_000;
const paceIds: PaceId[] = ['drill', 'interview'];
type ScoreChoice = '' | '0' | '1' | '2';

function stepTitle(index: number): string {
  return checklistSteps[index]?.title ?? `Step ${index + 1}`;
}

function promptTitle(id: string): string {
  return practicePrompts.find((prompt) => prompt.id === id)?.title ?? id;
}

function moduleLabel(id: string): string {
  const module = findModule(id);
  return module ? `module ${module.number}, ${module.title}` : id;
}

function moduleNumber(id: string): number {
  return findModule(id)?.number ?? Number.POSITIVE_INFINITY;
}

function moduleDone(progress: ProgressData, id: string): boolean {
  const lessons = coreLessons.filter((lesson) => findModuleForLesson(lesson.id)?.id === id);
  return lessons.length > 0 && lessons.every((lesson) => isComplete(progress, lesson.id));
}

/** Prompts whose module is done, or the earliest module's prompts while none is done. */
function preferredPrompts(progress: ProgressData | null): number[] {
  const indexes = practicePrompts.map((_, index) => index);
  const ready = progress
    ? indexes.filter((index) => moduleDone(progress, practicePrompts[index]?.bestAfter ?? ''))
    : [];
  if (ready.length > 0) return ready;
  const earliest = Math.min(...practicePrompts.map((prompt) => moduleNumber(prompt.bestAfter)));
  return indexes.filter((index) => moduleNumber(practicePrompts[index]?.bestAfter ?? '') === earliest);
}

function reportLabel(report: StepReport): string {
  if (report.status === 'not-reached') return 'Not reached';
  if (report.status === 'current')
    return report.overMs > 0 ? `Now, over by ${formatClock(report.overMs, 'up')}` : 'Now';
  if (report.status === 'over') return `Over by ${formatClock(report.overMs, 'up')}`;
  return 'Within budget';
}

function reportIcon(report: StepReport) {
  if (report.status === 'not-reached') return null;
  if (report.overMs > 0) return <UiIcon name="warn" />;
  if (report.status === 'current') return <UiIcon name="step" />;
  return <UiIcon name="check" />;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'radio' && target.type !== 'checkbox';
}

export default function TimedRoundWidget() {
  const hydrated = useHydrated();
  const [round, setRound] = useState<RoundState>(initialRound);
  const [pace, setPace] = useState<PaceId>('drill');
  const [hardStop, setHardStop] = useState(true);
  const [promptIndex, setPromptIndex] = useState(0);
  const [drawSeed, setDrawSeed] = useState(1);
  const [notes, setNotes] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const practice = useSyncExternalStore(subscribePractice, readPractice, () => null);
  const persistent = useSyncExternalStore(subscribePractice, isPracticePersistent, () => true);
  const progress = useSyncExternalStore(subscribeProgress, readProgress, () => null);
  const preferred = useMemo(() => preferredPrompts(progress), [progress]);
  const savedWhere = persistent
    ? 'Saved on this device only.'
    : 'Saved for this tab only, because your browser blocked storage.';

  const rootRef = useRef<HTMLDivElement>(null);
  const setupRef = useRef<HTMLFieldSetElement>(null);
  const clockRef = useRef<HTMLButtonElement>(null);
  const reportRef = useRef<HTMLHeadingElement>(null);
  const outlineRef = useRef<HTMLHeadingElement>(null);
  const historyRef = useRef<HTMLHeadingElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const lastTick = useRef(0);
  const ids = useId();

  const config = useMemo(() => paceConfig(pace, hardStop), [pace, hardStop]);
  const prompt = practicePrompts[promptIndex] ?? practicePrompts[0];
  const reports = stepReports(round, config);
  const totals = roundTotals(round, config);
  const score = rubricTotal(round.scores);
  const savableTotal = score.scored === STEP_COUNT ? score.total : null;
  // Reads the stored copy so clearing history, here or in another tab, also clears the saved mark.
  const savedRecord =
    savedAt === null ? undefined : practice?.rounds.find((entry) => entry.finishedAt === savedAt);
  const savedUpToDate =
    savedRecord !== undefined &&
    savedRecord.rubricTotal === savableTotal &&
    round.scores.every((value, index) => savedRecord.scores?.[index] === value);
  const current = reports[round.step];
  const step = checklistSteps[round.step];
  const locked = round.phase !== 'ready';
  const active = round.phase === 'running' || round.phase === 'paused';
  const finished = round.phase === 'finished';
  const stepOver = (current?.overMs ?? 0) > 0;
  const roundOver = totals.overMs > 0;
  const lastMinute =
    round.phase === 'running' && totals.remainingMs > 0 && totals.remainingMs <= ONE_MINUTE_MS;

  useEffect(() => {
    if (round.phase !== 'running') return;
    lastTick.current = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick.current;
      lastTick.current = now;
      setRound((state) => tickRound(state, delta, config));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [round.phase, config]);

  /** Books the time since the last tick to the current step before the learner moves on. */
  function act(transition: (state: RoundState) => RoundState) {
    const now = Date.now();
    const delta = now - lastTick.current;
    lastTick.current = now;
    setRound((state) => transition(tickRound(state, delta, config)));
  }

  function toggleClock() {
    if (round.phase === 'ready') {
      // Starting collapses the setup, so focus inside it would fall out of the panel and its shortcuts.
      const focusInSetup = setupRef.current?.contains(document.activeElement) ?? false;
      setRound(startRound);
      if (focusInSetup) window.requestAnimationFrame(() => clockRef.current?.focus());
    } else if (round.phase === 'running') act(pauseRound);
    else if (round.phase === 'paused') setRound(resumeRound);
  }

  function finish() {
    if (!active) return;
    act(finishRound);
    window.requestAnimationFrame(() => reportRef.current?.focus());
  }

  function reset() {
    setRound(initialRound());
    setNotes('');
    setSavedAt(null);
  }

  function drawPrompt() {
    setPromptIndex((index) => drawPromptIndex(drawSeed, practicePrompts.length, index, preferred));
    setDrawSeed((seed) => seed + 1);
  }

  function save() {
    if (savedUpToDate) return;
    const finishedAt = savedAt ?? new Date().toISOString();
    saveRound({
      promptId: prompt?.id ?? '',
      pace,
      finishedAt,
      usedSeconds: round.usedMs.map((ms) => Math.round(ms / 1000)),
      budgetSeconds: Math.round(totalBudgetMs(config) / 1000),
      rubricTotal: savableTotal,
      rubricMax: score.max,
      scores: [...round.scores],
    });
    setSavedAt(finishedAt);
  }

  function showOutline() {
    setRound(revealOutline);
    // The button disappears once the outline shows, so focus moves to the outline itself.
    window.requestAnimationFrame(() => outlineRef.current?.focus());
  }

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'p') toggleClock();
    else if (key === 'n' && active) act(nextStep);
    else if (key === 'b' && active) act(previousStep);
    else return;
    event.preventDefault();
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }, []);

  let clockLabel = 'Start round';
  let clockIcon: 'play' | 'pause' = 'play';
  if (round.phase === 'running') {
    clockLabel = 'Pause';
    clockIcon = 'pause';
  } else if (round.phase === 'paused') clockLabel = 'Resume';
  else if (finished) clockLabel = 'Round over';

  let status: { tone: Tone; text: string } = { tone: 'neutral', text: 'Ready' };
  if (round.phase === 'running')
    status = stepOver ? { tone: 'warn', text: 'Step over budget' } : { tone: 'ok', text: 'Running' };
  else if (round.phase === 'paused') status = { tone: 'neutral', text: 'Paused' };
  else if (finished)
    status = round.endedBy === 'clock' ? { tone: 'warn', text: 'Time up' } : { tone: 'ok', text: 'Finished' };

  const stepName = `step ${round.step + 1} of ${STEP_COUNT}, ${stepTitle(round.step)}`;
  let summary = `Ready: ${prompt?.title}, ${PACES[pace].label}. Press Start round when your paper is ready.`;
  if (round.phase === 'running') {
    summary = `Running ${stepName}.`;
    if (stepOver) summary += ' This step is over its budget.';
    if (lastMinute) summary += ' Under one minute left in the round.';
    if (roundOver) summary += ' The round budget is spent; you are in overtime.';
  } else if (round.phase === 'paused') {
    summary = `Paused on ${stepName}.`;
  } else if (finished) {
    summary =
      round.endedBy === 'clock'
        ? `Time is up. The round ended on ${stepName}.`
        : `Round finished on ${stepName}.`;
    summary += ` Self-score ${score.total} of ${score.max}, ${score.scored} of ${STEP_COUNT} steps scored.`;
    if (round.outlineShown) summary += ' Reference outline shown.';
  }

  const stats: StatRow[] = [
    { label: 'Prompt', value: prompt?.title ?? '', note: prompt?.scale },
    { label: 'Step', value: `${round.step + 1} of ${STEP_COUNT}: ${stepTitle(round.step)}` },
    {
      label: 'Step time',
      value: `${formatClock(current?.usedMs ?? 0)} of ${formatClock(current?.budgetMs ?? 0)}`,
      tone: stepOver ? 'warn' : 'neutral',
      note: stepOver ? `Over by ${formatClock(current?.overMs ?? 0, 'up')}` : undefined,
    },
    {
      label: 'Round time',
      value: roundOver
        ? `${formatClock(totals.overMs, 'up')} over`
        : `${formatClock(totals.remainingMs, 'up')} left`,
      tone: roundOver ? 'bad' : lastMinute ? 'warn' : 'neutral',
      note: `${formatClock(totals.usedMs)} used of ${formatClock(totals.budgetMs)}`,
    },
    {
      label: 'Self-score',
      value: finished ? `${score.total} of ${score.max}` : 'After the round',
      note: finished ? `${score.scored} of ${STEP_COUNT} steps scored` : undefined,
    },
  ];

  const actions = (
    <>
      <button
        ref={clockRef}
        type="button"
        className="sdv-button sdv-button--primary"
        onClick={toggleClock}
        disabled={!hydrated}
        aria-disabled={finished}
        aria-keyshortcuts="P"
      >
        <UiIcon name={clockIcon} /> {clockLabel}
      </button>
      <button
        type="button"
        className="sdv-button"
        onClick={() => active && act(previousStep)}
        disabled={!hydrated}
        aria-disabled={!active || round.step === 0}
        aria-keyshortcuts="B"
      >
        Back
      </button>
      <button
        type="button"
        className="sdv-button"
        onClick={() => active && act(nextStep)}
        disabled={!hydrated}
        aria-disabled={!active || round.step === STEP_COUNT - 1}
        aria-keyshortcuts="N"
      >
        <UiIcon name="step" /> Next step
      </button>
      <button
        type="button"
        className="sdv-button"
        onClick={finish}
        disabled={!hydrated}
        aria-disabled={!active}
      >
        <UiIcon name="check" /> Finish round
      </button>
      <button type="button" className="sdv-button" onClick={reset} disabled={!hydrated}>
        <UiIcon name="reset" /> Reset
      </button>
    </>
  );

  const setup = locked ? (
    <p className="sdv-round__locked">
      <strong>Setup:</strong> {prompt?.title}, {PACES[pace].label},{' '}
      {hardStop ? 'stops when time runs out' : 'runs into overtime'}. The round locks the setup. Press Reset
      to change it.
    </p>
  ) : (
    <fieldset ref={setupRef} className="sdv-round__setup">
      <legend className="sdv-visually-hidden">Round setup</legend>
      <div className="sdv-round__setup-item">
        <ScenarioChips
          label="Prompt"
          value={prompt?.id ?? 'url-shortener'}
          options={practicePrompts.map((option, index) => ({
            value: option.id,
            label: option.title,
            diff: `${option.scale}. Best after ${moduleLabel(option.bestAfter)}${
              progress && !preferred.includes(index) ? '. Later on your path' : ''
            }`,
          }))}
          onChange={(id) =>
            setPromptIndex(
              Math.max(
                0,
                practicePrompts.findIndex((option) => option.id === id),
              ),
            )
          }
        />
        <button type="button" className="sdv-button" onClick={drawPrompt} disabled={!hydrated}>
          Draw a different prompt
        </button>
      </div>
      <div className="sdv-round__setup-item">
        <ScenarioChips
          label="Pace"
          value={pace}
          options={paceIds.map((id) => ({
            value: id,
            label: PACES[id].label,
            diff: `Minutes per step: ${PACES[id].minutes.join(', ')}`,
          }))}
          onChange={setPace}
        />
        <Toggle
          label={
            <>
              Stop when time runs out
              <span className="sdv-round__hint">Off lets the round run into overtime.</span>
            </>
          }
          checked={hardStop}
          onChange={setHardStop}
        />
      </div>
    </fieldset>
  );

  return (
    <div ref={rootRef} className="sdv-round-root">
      <MotionRoot>
        <WidgetFrame
          title="Timed design round"
          instructions="Pick a prompt and a pace, press Start round, and work through each step on paper. Keys inside this panel: P starts, pauses, or resumes; N moves to the next step; B goes back."
          summary={summary}
          stats={stats}
          status={status}
          statsCaption="Round readout"
        >
          <div className="sdv-round">
            {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section */}
            <div className="sdv-sim__toolbar sdv-round__toolbar" role="group" aria-label="Round controls">
              {actions}
            </div>
            {setup}

            <article className="sdv-round__prompt" aria-labelledby={`${ids}-prompt`}>
              <p className="sdv-round__eyebrow">Your prompt</p>
              <h4 id={`${ids}-prompt`}>{prompt?.title}</h4>
              <p className="sdv-round__scale">{prompt?.scale}</p>
              <p className="sdv-round__brief">{prompt?.brief}</p>
            </article>

            <div className="sdv-round__layout">
              {!finished && step && (
                <m.section
                  key={round.step}
                  className="sdv-round__panel"
                  aria-labelledby={`${ids}-step`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <p className="sdv-round__eyebrow">
                    Step {round.step + 1} of {STEP_COUNT}
                  </p>
                  <h4 id={`${ids}-step`}>
                    {step.title}: {step.question}
                  </h4>
                  <div className="sdv-round__clocks">
                    <p className="sdv-round__clock" data-over={stepOver}>
                      <span className="sdv-round__clock-label">Step</span>
                      <span role="timer" aria-label="Time on this step">
                        {formatClock(current?.usedMs ?? 0)}
                      </span>
                      <span className="sdv-round__clock-budget">
                        of {formatClock(current?.budgetMs ?? 0)}
                      </span>
                      {stepOver && (
                        <span className="sdv-round__state">
                          <UiIcon name="warn" /> Over budget
                        </span>
                      )}
                    </p>
                    <p className="sdv-round__clock" data-over={roundOver}>
                      <span className="sdv-round__clock-label">Round</span>
                      <span role="timer" aria-label="Round time left">
                        {roundOver
                          ? `+${formatClock(totals.overMs, 'up')}`
                          : formatClock(totals.remainingMs, 'up')}
                      </span>
                      <span className="sdv-round__clock-budget">{roundOver ? 'overtime' : 'left'}</span>
                    </p>
                  </div>
                  <p className="sdv-round__label">Ask yourself</p>
                  <ul className="sdv-round__guide">
                    {step.guide.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                  {round.phase === 'ready' && (
                    <p className="sdv-round__hint">The clock starts when you press Start round.</p>
                  )}
                  {round.phase === 'paused' && (
                    <p className="sdv-round__hint">
                      <UiIcon name="pause" /> Paused. Press Resume or P to carry on.
                    </p>
                  )}
                </m.section>
              )}

              {finished && (
                <section className="sdv-round__panel" aria-labelledby={`${ids}-report`}>
                  <h4 id={`${ids}-report`} ref={reportRef} tabIndex={-1}>
                    {round.endedBy === 'clock' ? 'Time is up' : 'Round finished'}
                  </h4>
                  <p>
                    You used {formatClock(totals.usedMs)} of {formatClock(totals.budgetMs)}
                    {totals.overMs > 0 ? `, ${formatClock(totals.overMs, 'up')} over budget` : ''}.{' '}
                    {reports.filter((report) => report.status === 'not-reached').length > 0
                      ? `You never reached ${reports
                          .filter((report) => report.status === 'not-reached')
                          .map((report) => stepTitle(report.index))
                          .join(', ')}.`
                      : 'You reached every step.'}
                  </p>
                  <p className="sdv-round__hint">
                    Score yourself first, then compare with the reference outline. Scores open only now, so
                    they cannot steer the design while you work.
                  </p>
                </section>
              )}

              <ol className="sdv-round__rail" aria-label="Checklist steps and time used">
                {reports.map((report) => {
                  const fill = report.budgetMs > 0 ? Math.min(1, report.usedMs / report.budgetMs) : 0;
                  return (
                    <li
                      key={report.index}
                      data-state={report.status}
                      data-over={report.overMs > 0}
                      aria-current={report.status === 'current' ? 'step' : undefined}
                    >
                      <span className="sdv-round__num" aria-hidden="true">
                        {report.index + 1}
                      </span>
                      <span className="sdv-round__head">
                        <span className="sdv-round__name">
                          <span className="sdv-visually-hidden">Step {report.index + 1}: </span>
                          {stepTitle(report.index)}
                        </span>
                        <span className="sdv-round__time">
                          {formatClock(report.usedMs)} / {formatClock(report.budgetMs)}
                        </span>
                      </span>
                      <span className="sdv-round__bar" aria-hidden="true">
                        <span className="sdv-round__fill" style={{ width: `${fill * 100}%` }} />
                      </span>
                      <span className="sdv-round__state">
                        {reportIcon(report)} {reportLabel(report)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="sdv-round__notes">
              <label htmlFor={`${ids}-notes`}>Scratch notes (this tab only, cleared on Reset)</label>
              <textarea
                id={`${ids}-notes`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                spellCheck
              />
            </div>

            {finished && (
              <>
                <table className="sdv-stats sdv-compare sdv-round__table">
                  <caption>Time per step</caption>
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Used</th>
                      <th scope="col">Budget</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.index}>
                        <th scope="row">
                          {report.index + 1}. {stepTitle(report.index)}
                        </th>
                        <td>{formatClock(report.usedMs)}</td>
                        <td>{formatClock(report.budgetMs)}</td>
                        <td>
                          <span className="sdv-round__state" data-over={report.overMs > 0}>
                            {reportIcon(report)} {reportLabel(report)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <section className="sdv-round__rubric" aria-labelledby={`${ids}-rubric`}>
                  <h4 id={`${ids}-rubric`}>Score yourself</h4>
                  <p className="sdv-round__hint">
                    Missing: you skipped it. Partial: you touched it but left gaps. Solid: it meets the line
                    below. Total {score.total} of {score.max}, {score.scored} of {STEP_COUNT} scored.
                  </p>
                  <div className="sdv-round__criteria">
                    {checklistSteps.map((item, index) => {
                      const value = round.scores[index];
                      return (
                        <div key={item.title} className="sdv-round__criterion">
                          <p>
                            <strong>
                              {index + 1}. {item.title}.
                            </strong>{' '}
                            {item.criterion}
                          </p>
                          <Segmented<ScoreChoice>
                            label={`Score for ${item.title}`}
                            value={
                              value === null || value === undefined ? '' : (String(value) as ScoreChoice)
                            }
                            options={rubricLevels.map((level) => ({
                              value: String(level.score) as ScoreChoice,
                              label: level.label,
                            }))}
                            placeholder="Not scored"
                            onChange={(choice) => {
                              if (choice === '') return;
                              setRound((state) =>
                                scoreCriterion(state, index, Number(choice) as RubricScore),
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="sdv-round__outline" aria-labelledby={`${ids}-outline`}>
                  <h4 id={`${ids}-outline`} ref={outlineRef} tabIndex={-1}>
                    Reference outline: {prompt?.title}
                  </h4>
                  {round.outlineShown ? (
                    <ol>
                      {checklistSteps.map((item, index) => (
                        <li key={item.title}>
                          <strong>{item.title}</strong>
                          <ul>
                            {(prompt?.outline[index] ?? []).map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <>
                      <p className="sdv-round__hint">
                        One sound answer among several. If yours differs, check that you can defend the
                        difference.
                      </p>
                      <button type="button" className="sdv-button" onClick={showOutline} disabled={!hydrated}>
                        Show reference outline
                      </button>
                    </>
                  )}
                </section>

                <div className="sdv-round__save">
                  <button
                    type="button"
                    className="sdv-button"
                    onClick={save}
                    disabled={!hydrated}
                    aria-disabled={savedUpToDate}
                  >
                    <UiIcon name={savedUpToDate ? 'check' : 'ok'} />{' '}
                    {savedUpToDate
                      ? 'Round saved'
                      : savedRecord
                        ? 'Update saved round'
                        : 'Save this round on this device'}
                  </button>
                  <p className="sdv-round__hint">
                    {score.scored === STEP_COUNT
                      ? 'Saves the prompt, time per step, and your score in this browser only.'
                      : 'Score all seven steps to save your score with the round. You can save now and update it later.'}
                  </p>
                </div>
              </>
            )}
          </div>
        </WidgetFrame>

        <section className="sdv-round__history not-content" aria-labelledby={`${ids}-history`}>
          <h4 id={`${ids}-history`} ref={historyRef} tabIndex={-1}>
            Saved rounds
          </h4>
          {practice !== null && practice.rounds.length > 0 && (
            <table className="sdv-stats sdv-compare sdv-round__table">
              <caption>
                {practice.rounds.length === 1
                  ? 'Your saved round'
                  : `Your last ${practice.rounds.length} saved rounds, newest first`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Prompt</th>
                  <th scope="col">Time used</th>
                  <th scope="col">Score</th>
                </tr>
              </thead>
              <tbody>
                {practice.rounds.map((entry) => {
                  const used = entry.usedSeconds.reduce((sum, seconds) => sum + seconds, 0);
                  return (
                    <tr key={`${entry.finishedAt}-${entry.promptId}`}>
                      <th scope="row">
                        {promptTitle(entry.promptId)}
                        <span className="sdv-round__sub">
                          {PACES[entry.pace].label},{' '}
                          {new Date(entry.finishedAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </th>
                      <td>
                        {formatClock(used * 1000)} of {formatClock(entry.budgetSeconds * 1000)}
                      </td>
                      <td>
                        {entry.rubricTotal === null
                          ? 'Not scored'
                          : `${entry.rubricTotal} of ${entry.rubricMax}`}
                        {entry.scores && weakestSteps(entry.scores).length > 0 && (
                          <span className="sdv-round__sub">
                            Work on {weakestSteps(entry.scores).map(stepTitle).join(', ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="sdv-reset not-content">
            <p aria-live="polite">
              {practice === null
                ? 'Loading saved rounds.'
                : practice.rounds.length === 0
                  ? persistent
                    ? 'No saved rounds yet. Rounds you save stay on this device only.'
                    : 'No saved rounds yet. Your browser blocked storage, so rounds you save last for this tab only.'
                  : `${practice.rounds.length} saved ${practice.rounds.length === 1 ? 'round' : 'rounds'}. ${savedWhere}`}
            </p>
            {confirmingClear ? (
              // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section
              <div className="sdv-reset__confirm" role="group" aria-label="Confirm clearing saved rounds">
                <span>Clear every saved round?</span>
                <button
                  type="button"
                  className="sdv-button"
                  data-tone="bad"
                  onClick={() => {
                    clearPractice();
                    setConfirmingClear(false);
                    window.requestAnimationFrame(() => historyRef.current?.focus());
                  }}
                >
                  Clear rounds
                </button>
                <button
                  type="button"
                  className="sdv-button"
                  ref={cancelClearRef}
                  onClick={() => {
                    setConfirmingClear(false);
                    window.requestAnimationFrame(() => clearRef.current?.focus());
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="sdv-button"
                ref={clearRef}
                onClick={() => {
                  setConfirmingClear(true);
                  window.requestAnimationFrame(() => cancelClearRef.current?.focus());
                }}
                disabled={!hydrated || practice === null || practice.rounds.length === 0}
              >
                Clear saved rounds
              </button>
            )}
          </div>
        </section>
      </MotionRoot>
    </div>
  );
}
