import { useId } from 'react';
import { useHydrated } from '../sim/useHydrated';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Keeps the label for screen readers only, for a control whose purpose the layout already shows. */
  hideLabel?: boolean;
  /**
   * `fit` (default) swaps the radios for a select when the container is too narrow for one row.
   * `none` leaves the swap to the caller, which renders its own select.
   */
  fallback?: 'fit' | 'none';
  /** Text for the select when no option is chosen yet. */
  placeholder?: string;
  className?: string;
}

const MIN_BUCKET = 8;
const MAX_BUCKET = 48;

/**
 * Rough rem width of one row of options at the control's text size. It errs wide, so the
 * select appears a little early rather than letting a row clip.
 */
export function segmentedWidthRem(labels: string[]): number {
  const options = labels.reduce((sum, label) => sum + Math.max(2.75, 1.5 + 0.525 * label.length), 0);
  return options + 0.625 + 0.25 * Math.max(0, labels.length - 1);
}

/** The container width, in rem, below which the radios become a select. Matches the CSS buckets. */
export function segmentedFitBucket(labels: string[]): string {
  const bucket = Math.ceil(segmentedWidthRem(labels) / 2) * 2;
  if (bucket > MAX_BUCKET) return 'max';
  return String(Math.max(MIN_BUCKET, bucket));
}

/** One row of radio buttons that never wraps. Arrow keys move the choice. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
  fallback = 'fit',
  placeholder = 'Choose one',
  className,
}: SegmentedProps<T>) {
  const id = useId();
  const hydrated = useHydrated();
  const legendId = `${id}-legend`;
  const selectId = `${id}-select`;
  const fit = fallback === 'fit' ? segmentedFitBucket(options.map((option) => option.label)) : undefined;
  const chosen = options.some((option) => option.value === value);
  return (
    <div className={['sdv-segmented', className].filter(Boolean).join(' ')} data-fit={fit}>
      <fieldset
        className="sdv-control sdv-segmented__group"
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML permits radiogroup on fieldset, which keeps the legend and the disabled cascade.
        role="radiogroup"
        aria-labelledby={legendId}
        disabled={!hydrated}
      >
        <legend id={legendId} className={hideLabel ? 'sdv-visually-hidden' : undefined}>
          {label}
        </legend>
        <div className="sdv-segmented__options">
          {options.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name={id}
                value={option.value}
                checked={option.value === value}
                onChange={() => onChange(option.value)}
              />
              <span data-label={option.label}>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {fit && (
        <div className="sdv-control sdv-segmented__select">
          <label htmlFor={selectId} className={hideLabel ? 'sdv-visually-hidden' : undefined}>
            {label}
          </label>
          <select
            id={selectId}
            className="sdv-select"
            value={value}
            disabled={!hydrated}
            onChange={(event) => onChange(event.currentTarget.value as T)}
          >
            {!chosen && (
              <option value={value} disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
