import { type CSSProperties, useId } from 'react';
import { useHydrated } from '../sim/useHydrated';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  /** Shows the formatted minimum and maximum under the track. */
  showRange?: boolean;
}

/** Native range input with the label and current value on one line above the track. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
  hint,
  showRange = false,
}: SliderProps) {
  const id = useId();
  const hydrated = useHydrated();
  const hintId = `${id}-hint`;
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const style = { '--sdv-range-frac': `${fraction * 100}%` } as CSSProperties;
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
        style={style}
        disabled={!hydrated}
        aria-valuetext={format(value)}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {showRange && (
        <div className="sdv-control__range" aria-hidden="true">
          <span>{format(min)}</span>
          <span>{format(max)}</span>
        </div>
      )}
      {hint && (
        <p id={hintId} className="sdv-control__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
