import type { ReactNode } from 'react';
import { useHydrated } from '../sim/useHydrated';

interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** On and off switch. The whole label toggles it. */
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
