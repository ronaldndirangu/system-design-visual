import type { ReactNode } from 'react';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { KindIcon } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import './NodeChip.css';

export interface Badge {
  tone: Tone;
  text: string;
}

/** A row of component chips, read as a list. */
export function NodeChips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="sdv-chips" aria-label={label}>
      {children}
    </ul>
  );
}

/** One component in the fixed visual language: its kind color and icon, its name, and a status badge. */
export function NodeChip({
  kind,
  name,
  tone,
  text,
  stuck = false,
}: {
  kind: ComponentKind;
  name: string;
  tone: Tone;
  text: string;
  /** Hatches the chip and dashes its border, so a stopped or stuck component reads without color. */
  stuck?: boolean;
}) {
  return (
    <li className={`sdv-chip sdv-node sdv-node--${kind}`} data-status={stuck ? 'stuck' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="sdv-chip__icon">
        <KindIcon kind={kind} size={24} />
      </svg>
      <span className="sdv-chip__name">{name}</span>
      <ToneBadge tone={tone}>{text}</ToneBadge>
    </li>
  );
}

/** Verdict badges for a lane, each with an icon and text so the tone reads without color. */
export function Verdicts({ badges }: { badges: Badge[] }) {
  return (
    <div className="sdv-verdicts">
      {badges.map((badge) => (
        <ToneBadge key={badge.text} tone={badge.tone}>
          {badge.text}
        </ToneBadge>
      ))}
    </div>
  );
}
