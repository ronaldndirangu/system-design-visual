import { useId, useMemo, useState } from 'react';
import {
  buildTrie,
  countTrieNodes,
  scanLog,
  TYPEAHEAD_K,
  typeaheadLog,
  walkTrie,
} from '../../lib/models/search';
import type { Tone } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { WidgetFrame } from '../sim/WidgetFrame';
import './TypeaheadTrieWidget.css';

const presets = ['s', 'st', 'sto', 'storm', 'tr', 'w', 'stx'];
const MAX_PREFIX = 16;

const searches = (count: number) => `${count.toLocaleString('en-US')} searches`;
const nodes = (count: number) => `${count} ${count === 1 ? 'node' : 'nodes'}`;

function Completion({ query, typed }: { query: string; typed: string }) {
  return (
    <>
      <strong>{query.slice(0, typed.length)}</strong>
      {query.slice(typed.length)}
    </>
  );
}

interface Props {
  initialPrefix?: string;
}

/** Walk a trie whose nodes store their top completions, and compare it with scanning the whole query log. */
export default function TypeaheadTrieWidget({ initialPrefix = 'sto' }: Props) {
  const hydrated = useHydrated();
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [prefix, setPrefix] = useState(initialPrefix);
  const trie = useMemo(() => buildTrie(typeaheadLog), []);
  const nodeCount = useMemo(() => countTrieNodes(trie), [trie]);
  const typed = prefix.toLowerCase();
  const walk = walkTrie(trie, typed);
  const scan = scanLog(typeaheadLog, typed);
  const last = walk.path[walk.path.length - 1];
  const stoppedAt = last?.prefix ?? '';
  const suggestions = walk.top.map((entry) => entry.query).join(', ');

  const status: { tone: Tone; text: string } =
    typed.length === 0
      ? { tone: 'neutral', text: 'Root: most searched overall' }
      : walk.found
        ? { tone: 'ok', text: `${walk.top.length} ${walk.top.length === 1 ? 'suggestion' : 'suggestions'}` }
        : { tone: 'warn', text: 'No logged query starts here' };

  const shownPrefix = typed.length === 0 ? 'Empty prefix' : `Prefix "${typed}"`;
  const summary = walk.found
    ? `${shownPrefix}: walked ${nodes(walk.nodesVisited)} of the trie and returned the stored suggestions ${suggestions || 'none'}. A scan reads all ${scan.scanned} logged queries to find the same answer.`
    : `${shownPrefix}: the walk stops after ${nodes(walk.nodesVisited)} because no logged query starts with it. A scan still reads all ${scan.scanned} logged queries.`;

  return (
    <WidgetFrame
      title="Typeahead from a trie of precomputed completions"
      instructions={`Type a prefix or pick one below. The toy log holds ${typeaheadLog.length} queries, and each trie node already stores the most searched completions under it, so the answer costs one step per typed character.`}
      summary={summary}
      status={status}
      stats={[
        {
          label: 'Trie nodes visited',
          value: String(walk.nodesVisited),
          detail: walk.found
            ? 'the root plus one node per typed character'
            : 'the walk stops at the first character with no child node',
          tone: 'ok',
        },
        {
          label: 'Logged queries scanned without the trie',
          value: String(scan.scanned),
          detail: 'every query on every keystroke; real logs hold millions',
          tone: 'warn',
        },
        {
          label: 'Suggestions',
          value: suggestions || 'none',
        },
        {
          label: 'Trie size',
          value: `${nodeCount} nodes`,
          detail: `each stores its top ${TYPEAHEAD_K}, rebuilt offline from the query log`,
        },
      ]}
      actions={presets.map((preset) => (
        <button
          key={preset}
          type="button"
          className="sdv-button sdv-trie__preset"
          aria-pressed={typed === preset}
          disabled={!hydrated}
          onClick={() => setPrefix(preset)}
        >
          Type "{preset}"
        </button>
      ))}
      controls={
        <div className="sdv-control">
          <div className="sdv-control__row">
            <label htmlFor={inputId}>Prefix typed so far</label>
          </div>
          <input
            id={inputId}
            className="sdv-trie__input"
            type="text"
            value={prefix}
            maxLength={MAX_PREFIX}
            autoComplete="off"
            spellCheck={false}
            disabled={!hydrated}
            aria-describedby={hintId}
            onChange={(event) => setPrefix(event.currentTarget.value)}
          />
          <p id={hintId} className="sdv-control__hint">
            Letters and spaces, up to {MAX_PREFIX} characters. Clear it to see the root.
          </p>
        </div>
      }
    >
      <div className="sdv-trie">
        <section className="sdv-trie__panel" aria-label="Trie walk">
          <h4 className="sdv-trie__heading">Walk the trie: {nodes(walk.nodesVisited)}</h4>
          <ol className="sdv-trie__path">
            {walk.path.map((node, index) => (
              <li key={node.prefix} data-current={node === last ? 'true' : undefined}>
                {index > 0 && <span aria-hidden="true">→</span>}
                <span className="sdv-trie__node">
                  {node.prefix === '' ? 'root' : <code>{node.prefix}</code>}
                </span>
              </li>
            ))}
            {!walk.found && (
              <li className="sdv-trie__missing">
                <span aria-hidden="true">→</span>
                <span className="sdv-trie__node">
                  no child for <code>{typed.slice(stoppedAt.length, stoppedAt.length + 1)}</code>
                </span>
              </li>
            )}
          </ol>
          {walk.found ? (
            <>
              <p className="sdv-trie__line">
                Stored at {stoppedAt === '' ? 'the root' : <code>{stoppedAt}</code>}, ready to return:
              </p>
              <ol className="sdv-trie__top">
                {walk.top.map((entry) => (
                  <li key={entry.query}>
                    <span>
                      <Completion query={entry.query} typed={typed} />
                    </span>
                    <span className="sdv-trie__count">{searches(entry.count)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="sdv-trie__line">
              The walk stops after <code>{stoppedAt || 'root'}</code> and returns nothing, without reading the
              log.
            </p>
          )}
        </section>
        <section className="sdv-trie__panel" aria-label="Log scan">
          <h4 className="sdv-trie__heading">Scan the log instead: {scan.scanned} queries</h4>
          <ul className="sdv-trie__log">
            {typeaheadLog.map((entry) => {
              const match = typed.length > 0 && entry.query.startsWith(typed);
              return (
                <li key={entry.query} data-match={match ? 'true' : undefined}>
                  {match ? '✓ ' : ''}
                  {entry.query}
                </li>
              );
            })}
          </ul>
          <p className="sdv-control__hint">
            ✓ marks a query that starts with the prefix. The scan reads every row, then sorts the matches by
            count.
          </p>
        </section>
      </div>
    </WidgetFrame>
  );
}
