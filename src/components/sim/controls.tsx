import { type ReactNode, useId } from 'react';
import { useHydrated } from './useHydrated';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
}

export function Slider({ label, value, min, max, step = 1, onChange, format = String, hint }: SliderProps) {
  const id = useId();
  const hydrated = useHydrated();
  const hintId = `${id}-hint`;
  return (
    <div className="sdv-control">
      <div className="sdv-control__row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!hydrated}
        aria-valuetext={format(value)}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {hint && (
        <p id={hintId} className="sdv-control__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  const hydrated = useHydrated();
  return (
    <fieldset className="sdv-control sdv-segmented" disabled={!hydrated}>
      <legend>{label}</legend>
      <div className="sdv-segmented__options">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  const hydrated = useHydrated();
  return (
    <label className="sdv-control sdv-toggle">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={!hydrated}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="sdv-toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
