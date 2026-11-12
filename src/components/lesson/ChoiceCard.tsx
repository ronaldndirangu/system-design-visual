import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { choiceOrder } from '../../lib/choiceOrder';
import { UiIcon } from '../viz/icons';

/**
 * Shared state for a multiple-choice card: seeded display order, the pick,
 * the inline "choose first" error and focus hand-off after submit or retry.
 */
export function useChoiceCard(id: string, count: number, ordered = false) {
  const name = useId();
  const errorId = useId();
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const order = useMemo(() => choiceOrder(id, attempt, count, ordered), [id, attempt, count, ordered]);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<'result' | 'choices' | null>(null);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'result') resultRef.current?.focus();
    if (target === 'choices') choicesRef.current?.querySelector('input')?.focus();
  });

  return {
    name,
    errorId,
    order,
    choice,
    submitted,
    error,
    resultRef,
    choicesRef,
    pick(option: number) {
      if (submitted) return;
      setChoice(option);
      setError(false);
    },
    /** Returns the picked option, or null after showing the inline error. */
    submit(): number | null {
      if (choice === null) {
        setError(true);
        return null;
      }
      focusTarget.current = 'result';
      setSubmitted(true);
      return choice;
    },
    retry() {
      focusTarget.current = 'choices';
      setAttempt((current) => current + 1);
      setChoice(null);
      setSubmitted(false);
      setError(false);
    },
  };
}

export type ChoiceCard = ReturnType<typeof useChoiceCard>;

/** Radio cards in display order. After submit they stay focusable and show a glyph plus a word. */
export function ChoiceList({
  card,
  labels,
  answer,
  pickedLabel,
}: {
  card: ChoiceCard;
  labels: string[];
  answer: number;
  pickedLabel: string;
}) {
  return (
    <div className="sdv-choices" ref={card.choicesRef}>
      {card.order.map((option, position) => {
        const state = !card.submitted
          ? undefined
          : option === answer
            ? 'correct'
            : option === card.choice
              ? 'wrong'
              : undefined;
        return (
          <label key={option} className="sdv-choice" data-state={state}>
            <input
              type="radio"
              name={card.name}
              checked={card.choice === option}
              aria-disabled={card.submitted || undefined}
              onChange={() => card.pick(option)}
            />
            <span className="sdv-choice__key" aria-hidden="true">
              {String.fromCharCode(65 + position)}
            </span>
            <span className="sdv-choice__text">{labels[option]}</span>
            {state && (
              <span className="sdv-choice__status">
                <UiIcon name={state === 'correct' ? 'ok' : 'bad'} />
                {state === 'correct' ? 'Correct answer' : pickedLabel}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Always-present live region, so the error is announced when it appears. */
export function ChoiceError({ card }: { card: ChoiceCard }) {
  return (
    <p id={card.errorId} className="sdv-choice-error" aria-live="polite">
      {card.error ? 'Choose an answer first' : ''}
    </p>
  );
}
