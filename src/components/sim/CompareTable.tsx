import { betterIndices } from '../../lib/compare';
import { DiagramScroll } from '../viz/DiagramScroll';
import { ToneBadge } from './StatTable';
import { SeriesSwatch, seriesVariants } from './TraceChart';

export interface CompareRow {
  label: string;
  /** One value per column. */
  values: readonly number[];
  format?: (value: number, column: number) => string;
  /** Which direction wins. Omit for rows that should match, such as shared input. */
  better?: 'lower' | 'higher';
}

interface Props {
  caption: string;
  /** Two or three configurations, matching the trace chart's series styles. */
  columns: readonly string[];
  rows: CompareRow[];
}

/**
 * Configurations side by side, with a text badge on each clearly better value. Long column names
 * can outgrow a phone screen, so the table scrolls sideways inside its own box.
 */
export function CompareTable({ caption, columns, rows }: Props) {
  return (
    <DiagramScroll label={`${caption}, scrolls sideways`}>
      <table className="sdv-stats sdv-compare">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((column, index) => (
              <th key={column} scope="col">
                <span className="sdv-compare__head">
                  <SeriesSwatch variant={seriesVariants[index] ?? 'a'} />
                  {column}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const format = row.format ?? ((value: number) => String(value));
            const shown = row.values.map((value, index) => format(value, index));
            const winners = betterIndices(row.values, row.better, shown);
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {shown.map((text, index) => (
                  <td key={columns[index]}>
                    <div className="sdv-stats__cell">
                      <span className="sdv-stats__value">{text}</span>
                      {winners.includes(index) && <ToneBadge tone="ok">Better</ToneBadge>}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DiagramScroll>
  );
}
