import { UiIcon } from '../viz/icons';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface StatRow {
  label: string;
  value: string;
  tone?: Tone;
  /** Words that repeat the tone, so color is never the only cue. */
  note?: string;
  /** Small print under the value, such as the formula behind it. */
  detail?: string;
}

export function ToneBadge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`sdv-badge sdv-badge--${tone}`}>
      {tone !== 'neutral' && <UiIcon name={tone} />}
      {children}
    </span>
  );
}

export function StatTable({ rows, caption = 'Live readout' }: { rows: StatRow[]; caption?: string }) {
  return (
    <table className="sdv-stats">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>
              <div className="sdv-stats__cell">
                <span className="sdv-stats__value">{row.value}</span>
                {row.tone && row.note && <ToneBadge tone={row.tone}>{row.note}</ToneBadge>}
                {row.detail && <span className="sdv-stats__detail">{row.detail}</span>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
