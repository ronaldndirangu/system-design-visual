import { m } from 'motion/react';
import { useState } from 'react';
import {
  btreeLevels,
  formatCount,
  formatDuration,
  type IxIndexId,
  insertCost,
  ixIndexes,
  redundantIndexes,
  WRITE_PAGE_US,
  WRITE_ROWS,
} from '../../lib/models/indexes';
import { Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import { KindIcon } from '../viz/icons';
import './IndexesWidget.css';

interface Props {
  initial?: IxIndexId[];
  title?: string;
  instructions?: string;
}

function DbIcon() {
  return (
    <svg className="sdv-node sdv-node--database sdv-ix__icon" viewBox="0 0 24 24" aria-hidden="true">
      <KindIcon kind="database" size={24} />
    </svg>
  );
}

export default function IndexWriteCostWidget({
  initial = ['code'],
  title = 'What one INSERT writes',
  instructions = `Turn indexes on and off for a links table of ${formatCount(WRITE_ROWS)} rows. Every index is its own B-tree, and every new link must update each one. Page counts and times are illustrative.`,
}: Props) {
  const [enabled, setEnabled] = useState<IxIndexId[]>(initial);
  const active = ixIndexes.filter((index) => enabled.includes(index.id));
  const cost = insertCost(active.length);
  const levels = btreeLevels(WRITE_ROWS);
  const redundant = redundantIndexes(enabled);
  const extraShare = Math.round((cost.indexPagesTotal / cost.tablePages) * 100);
  const hasCode = enabled.includes('code');

  const toggle = (id: IxIndexId, on: boolean) =>
    setEnabled((current) => (on ? [...current, id] : current.filter((item) => item !== id)));

  const status: { tone: Tone; text: string } = !hasCode
    ? { tone: 'warn', text: 'Redirects scan the table' }
    : redundant.length > 0
      ? { tone: 'warn', text: 'One index is redundant' }
      : { tone: 'neutral', text: `${cost.pagesWritten} pages per insert` };

  const warnings = [
    hasCode ? '' : ' Without the code index, every redirect reads the whole table.',
    redundant.length > 0 ? ' The (user_id) index is redundant next to (user_id, created_at).' : '',
  ].join('');
  const summary = `${active.length} of ${ixIndexes.length} indexes on. Each insert writes ${cost.pagesWritten} pages and reads ${cost.pagesVisited} on the way down, about ${formatDuration(cost.writeUs)} (illustrative). The indexes add ${formatCount(cost.indexPagesTotal)} pages, ${extraShare}% of the table.${warnings}`;

  return (
    <WidgetFrame
      title={title}
      instructions={instructions}
      summary={summary}
      status={status}
      statsCaption="Cost of one INSERT (illustrative)"
      stats={[
        {
          label: 'B-trees to update',
          value: String(active.length),
          detail: 'plus the table itself',
        },
        {
          label: 'Pages written per insert',
          value: String(cost.pagesWritten),
          detail: 'one table page, plus one leaf page per index',
        },
        {
          label: 'Pages read on the way down',
          value: String(cost.pagesVisited),
          detail: `the table page, plus ${levels} per index from root to leaf`,
        },
        {
          label: 'Write time per insert',
          value: formatDuration(cost.writeUs),
          detail: `${WRITE_PAGE_US} µs per page written`,
        },
        {
          label: 'Extra storage',
          value: `${formatCount(cost.indexPagesTotal)} pages`,
          detail: `${extraShare}% on top of the ${formatCount(cost.tablePages)} table pages`,
          tone: extraShare >= 50 ? 'warn' : undefined,
          note: extraShare >= 50 ? 'Large' : undefined,
        },
        {
          label: 'Redundant indexes',
          value: redundant.length > 0 ? '(user_id)' : 'None',
          detail: redundant.length > 0 ? '(user_id, created_at) already finds rows by user_id' : undefined,
          tone: redundant.length > 0 ? 'warn' : undefined,
          note: redundant.length > 0 ? 'Drop it' : undefined,
        },
      ]}
      controls={
        <div className="sdv-ix__toggles">
          {ixIndexes.map((index) => (
            <Toggle
              key={index.id}
              label={
                <>
                  Index on <code>{index.columns}</code>
                </>
              }
              checked={enabled.includes(index.id)}
              onChange={(on) => toggle(index.id, on)}
            />
          ))}
        </div>
      }
    >
      <code className="sdv-ix__statement">
        INSERT INTO links (code, user_id, long_url, created_at) VALUES (?, ?, ?, ?)
      </code>
      <MotionRoot>
        <ul className="sdv-ix__writes" aria-label="Structures this insert changes">
          <li className="sdv-ix__row">
            <DbIcon />
            <div className="sdv-ix__row-body">
              <p className="sdv-ix__label">links table</p>
              <p className="sdv-ix__value">1 table page written</p>
              <p className="sdv-ix__muted">Holds the row itself.</p>
            </div>
          </li>
          {active.map((index) => {
            const isRedundant = redundant.includes(index.id);
            return (
              <m.li
                key={index.id}
                className="sdv-ix__row"
                data-state={isRedundant ? 'redundant' : undefined}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <DbIcon />
                <div className="sdv-ix__row-body">
                  <p className="sdv-ix__label">
                    B-tree index <code>{index.columns}</code>
                  </p>
                  <p className="sdv-ix__value">1 leaf page written, {levels} pages read from root to leaf</p>
                  <p className="sdv-ix__muted">
                    {isRedundant ? 'Redundant: (user_id, created_at) already starts with user_id. ' : ''}
                    {index.serves}
                  </p>
                </div>
              </m.li>
            );
          })}
        </ul>
      </MotionRoot>
      {!hasCode && (
        <p className="sdv-ix__muted">
          No index on code: the insert gets cheaper, and every redirect goes back to reading every page.
        </p>
      )}
    </WidgetFrame>
  );
}
