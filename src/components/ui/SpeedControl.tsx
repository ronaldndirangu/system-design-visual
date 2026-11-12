import { useId } from 'react';
import { useHydrated } from '../sim/useHydrated';
import { Segmented } from './Segmented';

export const speeds = ['0.5', '1', '2', '4'] as const;
export type Speed = (typeof speeds)[number];

const options = speeds.map((value) => ({ value, label: `${value}×` }));

/** Playback speed: radios in a wide toolbar, a select in a narrow one. */
export function SpeedControl({ value, onChange }: { value: Speed; onChange: (value: Speed) => void }) {
  const id = useId();
  const hydrated = useHydrated();
  return (
    <div className="sdv-speed">
      <Segmented
        label="Speed"
        hideLabel
        fallback="none"
        value={value}
        options={options}
        onChange={onChange}
      />
      <div className="sdv-speed__select">
        <label htmlFor={id} className="sdv-visually-hidden">
          Speed
        </label>
        <select
          id={id}
          className="sdv-select"
          value={value}
          disabled={!hydrated}
          onChange={(event) => onChange(event.currentTarget.value as Speed)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {`Speed: ${option.label}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
