import { betterIndex } from '../../lib/compare';
import { ToneBadge } from './StatTable';
import { SeriesSwatch } from './TraceChart';

export interface CompareRow {
  label: string;
  values: [number, number];
  format?: (value: number, column: number) => string;
  /** Which direction wins. Omit for rows that should match, such as shared input. */
  better?: 'lower' | 'higher';
}

interface Props {
  caption: string;
  columns: [string, string];
  rows: CompareRow[];
}

/** Two configurations side by side, with a text badge on a clearly better value. */
export function CompareTable({ caption, columns, rows }: Props) {
  return (
    <table className="sdv-stats sdv-compare">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <td />
          {columns.map((column, index) => (
            <th key={column} scope="col">
              <span className="sdv-compare__head">
                <SeriesSwatch variant={index === 0 ? 'a' : 'b'} />
                {column}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const format = row.format ?? ((value: number) => String(value));
          const shown = [format(row.values[0], 0), format(row.values[1], 1)] as const;
          const winner = betterIndex(row.values, row.better, shown);
          return (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {shown.map((text, index) => (
                <td key={columns[index]}>
                  <div className="sdv-stats__cell">
                    <span className="sdv-stats__value">{text}</span>
                    {winner === index && <ToneBadge tone="ok">Better</ToneBadge>}
                  </div>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
