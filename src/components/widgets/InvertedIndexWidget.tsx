import { useMemo, useState } from 'react';
import {
  buildPostings,
  miniDocs,
  POPULARITY_WEIGHT,
  type Posting,
  searchMini,
} from '../../lib/models/search';
import { Segmented, Toggle } from '../sim/controls';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';
import './InvertedIndexWidget.css';

type Query = 'storm coast' | 'storm' | 'storm rates' | 'coast guard';

const queries: { value: Query; label: string }[] = [
  { value: 'storm coast', label: 'storm coast' },
  { value: 'storm', label: 'storm' },
  { value: 'storm rates', label: 'storm rates' },
  { value: 'coast guard', label: 'coast guard' },
];

/** A page that almost nobody clicks; it can only win on raw term counts. */
const LOW_QUALITY = 0.2;

const score = (value: number) => value.toFixed(2);

function postingText(posting: Posting): string {
  return posting.tf > 1 ? `${posting.doc}×${posting.tf}` : posting.doc;
}

interface Props {
  initialQuery?: Query;
  popularity?: boolean;
}

/** Six headlines, their posting lists, and a query that intersects the lists and then ranks the matches. */
export default function InvertedIndexWidget({ initialQuery = 'storm coast', popularity = false }: Props) {
  const [query, setQuery] = useState<Query>(initialQuery);
  const [usePopularity, setUsePopularity] = useState(popularity);
  const postings = useMemo(() => buildPostings(miniDocs), []);
  const search = searchMini(miniDocs, query, usePopularity, postings);
  const queryTerms = new Set(search.terms);
  const matched = new Set(search.matches);
  const top = search.results[0];
  const best = Math.max(...search.results.map((result) => result.final), 0.01);
  const lowQualityOnTop = top !== undefined && top.doc.popularity < LOW_QUALITY;
  const listSizes = search.lists.map((list) => `${list.term}: ${list.postings.length} docs`).join(', ');
  const ranking = usePopularity ? 'text match plus popularity' : 'text match only';

  const status: { tone: Tone; text: string } =
    top === undefined
      ? { tone: 'neutral', text: 'No document has every term' }
      : lowQualityOnTop
        ? { tone: 'warn', text: 'Keyword stuffing wins' }
        : { tone: 'ok', text: `${top.doc.id} on top` };

  const summary =
    top === undefined
      ? `Query "${query}" reads ${search.lists.length} posting lists (${listSizes}). No document contains every term.`
      : `Query "${query}" reads ${search.lists.length} posting ${search.lists.length === 1 ? 'list' : 'lists'} (${listSizes}). ${search.matches.length} of ${miniDocs.length} documents contain every term. Ranked by ${ranking}, ${top.doc.id} "${top.doc.title}" comes first.`;

  return (
    <WidgetFrame
      title="Look up a query in an inverted index"
      instructions="Pick a query. The index maps each term to the documents that contain it, so a query reads only its own terms' lists, keeps the documents that appear in all of them, and then ranks those."
      summary={summary}
      status={status}
      stats={[
        {
          label: 'Posting lists read',
          value: `${search.lists.length} of ${postings.size}`,
          detail: 'one per query term, however large the corpus grows',
        },
        {
          label: 'Documents with every term',
          value: `${search.matches.length} of ${miniDocs.length}`,
        },
        {
          label: 'Top result',
          value: top === undefined ? 'none' : `${top.doc.id}: ${top.doc.title}`,
          tone: top === undefined ? undefined : lowQualityOnTop ? 'warn' : 'ok',
          detail: lowQualityOnTop ? 'a rarely clicked page that repeats the query words' : undefined,
        },
      ]}
      controls={
        <>
          <Segmented label="Query" value={query} options={queries} onChange={setQuery} />
          <Toggle
            label="Add the offline popularity signal"
            checked={usePopularity}
            onChange={setUsePopularity}
          />
        </>
      }
    >
      <div className="sdv-invidx">
        <section className="sdv-invidx__panel" aria-label="Documents">
          <h4 className="sdv-invidx__heading">1. Documents</h4>
          <ul className="sdv-invidx__docs">
            {miniDocs.map((doc) => (
              <li key={doc.id} data-match={matched.has(doc.id) ? 'true' : undefined}>
                <span className="sdv-invidx__id">{doc.id}</span>
                <span className="sdv-invidx__title">{doc.title}</span>
                <span className="sdv-invidx__meta">
                  popularity {doc.popularity.toFixed(2)}
                  {matched.has(doc.id) ? ', matches' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="sdv-invidx__panel" aria-label="Posting lists">
          <h4 className="sdv-invidx__heading">2. Term to posting list</h4>
          <ul className="sdv-invidx__terms">
            {[...postings.entries()].map(([term, list]) => (
              <li key={term} data-query={queryTerms.has(term) ? 'true' : undefined}>
                <code>{term}</code>
                <span>{list.map(postingText).join(', ')}</span>
                {queryTerms.has(term) && <span className="sdv-invidx__read">read</span>}
              </li>
            ))}
          </ul>
          <p className="sdv-control__hint">
            Stop words such as "the" and "on" are dropped. d3×3 means the term appears three times in d3.
          </p>
        </section>
        <section className="sdv-invidx__panel" aria-label="Intersect and rank">
          <h4 className="sdv-invidx__heading">3. Intersect, then rank</h4>
          <p className="sdv-invidx__intersect">
            {search.lists.map((list) => list.term).join(' AND ')} →{' '}
            {search.matches.join(', ') || 'no documents'}
          </p>
          {search.results.length === 0 ? (
            <p className="sdv-control__hint">No document has every term, so nothing reaches ranking.</p>
          ) : (
            <ol className="sdv-invidx__results">
              {search.results.map((result) => (
                <li key={result.doc.id}>
                  <span className="sdv-invidx__result-name">
                    {result.doc.id}: {result.doc.title}
                  </span>
                  <span className="sdv-invidx__bar" aria-hidden="true">
                    <span
                      className="sdv-invidx__bar-text"
                      style={{ width: `${(result.text / best) * 100}%` }}
                    />
                    {usePopularity && (
                      <span
                        className="sdv-invidx__bar-pop"
                        style={{ width: `${((POPULARITY_WEIGHT * result.doc.popularity) / best) * 100}%` }}
                      />
                    )}
                  </span>
                  <span className="sdv-invidx__meta">
                    text {score(result.text)}
                    {usePopularity
                      ? ` + popularity ${score(POPULARITY_WEIGHT * result.doc.popularity)} = ${score(result.final)}`
                      : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="sdv-control__hint">
            Text score: rarer terms count more, and repeats of a term add less each time (a simplified BM25).
            {usePopularity ? ' Solid bar: text. Striped bar: popularity.' : ''}
          </p>
        </section>
      </div>
    </WidgetFrame>
  );
}
