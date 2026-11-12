import { useId } from 'react';

export interface ScenarioOption<T extends string> {
  value: T;
  label: string;
  /** What this scenario changes, in plain words, so a choice never hides its parameters. */
  diff: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: ScenarioOption<T>[];
  onChange: (value: T) => void;
}

/** Preset scenarios as radio chips. A single scenario renders as a plain note. */
export function ScenarioChips<T extends string>({ label, value, options, onChange }: Props<T>) {
  const name = useId();
  const only = options.length === 1 ? options[0] : undefined;
  if (only) {
    return (
      <p className="sdv-chips__single">
        <strong>{only.label}.</strong> {only.diff}
      </p>
    );
  }
  return (
    <fieldset className="sdv-chips">
      <legend>{label}</legend>
      <div className="sdv-chips__options">
        {options.map((option) => (
          <label key={option.value} className="sdv-chips__chip">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className="sdv-chips__body">
              <span className="sdv-chips__label">{option.label}</span>
              <span className="sdv-chips__diff">{option.diff}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
