import { m } from 'motion/react';
import { useReducer, useRef, useState } from 'react';
import {
  cacheKey,
  canRead,
  chunkById,
  compareRetrievers,
  type FilterMode,
  type FusedRow,
  HybridRun,
  keywordScore,
  type LeakKind,
  type Ranked,
  type RetrieverId,
  RRF_K,
  type StageTone,
  TOP_K,
  type User,
} from '../../lib/models/retrieval';
import { SCENARIOS, type ScenarioId, TENANTS } from '../../lib/models/retrievalCorpus';
import { Segmented } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell, TOY_MODEL_ASSUMPTIONS } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { TranscriptScroll } from '../sim/TranscriptScroll';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { UiIcon } from '../viz/icons';
import './RetrievalShared.css';
import './HybridSearchWidget.css';

interface Props {
  initial?: ScenarioId;
  initialMode?: FilterMode;
  title?: string;
  instructions?: string;
}

const modeLabels: Record<FilterMode, string> = {
  pre: 'Pre-filter',
  post: 'Post-filter',
  none: 'No filter',
};

const retrieverLabels: Record<RetrieverId, string> = {
  keyword: 'Keyword only',
  vector: 'Vector only',
  hybrid: 'Hybrid (RRF)',
};

const leakLabels: Record<LeakKind, string> = {
  tenant: 'Another store',
  scope: 'Staff only',
};

const stageTones: Record<StageTone, Tone> = {
  info: 'neutral',
  ok: 'ok',
  warn: 'warn',
  bad: 'bad',
};

const stageNotes: Record<StageTone, string> = {
  info: '',
  ok: 'OK',
  warn: 'Warning',
  bad: 'Problem',
};

const score4 = (value: number) => value.toFixed(4);

function rrfTerms(row: FusedRow): string {
  return [row.keywordRank, row.vectorRank]
    .filter((rank): rank is number => rank !== null)
    .map((rank) => `1/(${RRF_K}+${rank})`)
    .join(' + ');
}

function blockedKind(id: string, user: User): LeakKind | null {
  const chunk = chunkById(id);
  if (canRead(chunk, user)) return null;
  return chunk.tenant === user.tenant ? 'scope' : 'tenant';
}

function StorePill({ id }: { id: string }) {
  const chunk = chunkById(id);
  return (
    <span className="sdv-rag-pill" data-tenant={chunk.tenant}>
      {TENANTS[chunk.tenant].short}
      {chunk.scope === 'staff' ? ', staff' : ''}
    </span>
  );
}

function RankedLane({
  title,
  hint,
  rows,
  shown,
  waiting,
  empty,
  queryText,
  keyword,
}: {
  title: string;
  hint: string;
  rows: Ranked[];
  shown: boolean;
  waiting: string;
  empty: string;
  queryText: string;
  keyword: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <section className="sdv-duel__lane" aria-label={title}>
      <h4 className="sdv-duel__lane-title">{title}</h4>
      <p className="sdv-rag-meta">{hint}</p>
      {!shown ? (
        <p className="sdv-trace__empty">{waiting}</p>
      ) : rows.length === 0 ? (
        <p className="sdv-rag-none">
          <UiIcon name="warn" /> {empty}
        </p>
      ) : (
        <ol className="sdv-rag-list">
          {rows.map((row, index) => {
            const matched = keyword ? keywordScore(queryText, chunkById(row.id)).matched : [];
            return (
              <m.li
                key={row.id}
                className="sdv-rag-row"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: reduced ? 0 : index * 0.05 }}
              >
                <span className="sdv-rag-rank">{row.rank}</span>
                <span className="sdv-rag-id">{row.id}</span>
                <StorePill id={row.id} />
                <span className="sdv-rag-score">{keyword ? row.score.toFixed(2) : row.score.toFixed(3)}</span>
                {keyword && matched.length > 0 && (
                  <span className="sdv-rag-meta sdv-rag-row__wide">shares: {matched.join(', ')}</span>
                )}
              </m.li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default function HybridSearchWidget({
  initial = 'sale',
  initialMode = 'pre',
  title = 'Fuse keyword and vector search with RRF',
  instructions = 'Pick a query and a filter mode, predict which list finds the right chunk, then press Play. Each step reveals one stage of the search.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const [scenarioId, setScenarioId] = useState<ScenarioId>(initial);
  const [mode, setMode] = useState<FilterMode>(initialMode);
  const runRef = useRef<HybridRun | null>(null);
  runRef.current ??= new HybridRun(scenarioId, mode);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: ScenarioId, nextMode: FilterMode) => {
    runRef.current = new HybridRun(id, nextMode);
    rerender();
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    rerender();
  };
  const chooseScenario = (id: ScenarioId) => {
    setScenarioId(id);
    restart(id, mode);
  };
  const chooseMode = (next: FilterMode) => {
    setMode(next);
    restart(scenarioId, next);
  };

  const { scenario, result } = run;
  const query = scenario.query;
  const user: User = { tenant: query.tenant, scope: query.scope };
  const tenant = TENANTS[query.tenant];
  const started = run.events.length > 0;
  const keywordShown = run.revealed('keyword');
  const vectorShown = run.revealed('vector');
  const topKShown = run.revealed('topk');
  const postShown = run.revealed('postfilter');
  const answerShown = run.revealed('answer');
  const fusedRows = result.fused.slice(0, run.fusedShown);
  const answer = result.answer;
  const correct =
    scenario.expected === null ? answer.kind === 'abstained' : answer.from === scenario.expected;
  const leaked = result.leaks.length > 0;
  const comparison = compareRetrievers(scenario, mode);
  const key = cacheKey({
    tenant: query.tenant,
    scope: query.scope,
    model: 'Medium',
    promptVersion: 'v3',
    sampling: 't0',
    corpusVersion: 'idx7',
    conversation: [],
    query: query.text,
  });

  const searchScope =
    mode === 'pre'
      ? `${result.searchable.length} ${tenant.short} customer chunks`
      : `all ${result.searchable.length} chunks from both stores`;

  const verdict: { tone: Tone; text: string } = leaked
    ? {
        tone: 'bad',
        text: `Leak: the model saw ${result.leaks.length} chunk${result.leaks.length === 1 ? '' : 's'} this customer may not read`,
      }
    : correct
      ? {
          tone: 'ok',
          text:
            answer.kind === 'abstained'
              ? 'Correct abstention: this store has no such policy'
              : 'Grounded in the right chunk',
        }
      : {
          tone: 'bad',
          text:
            answer.kind === 'abstained'
              ? 'Wrong abstention: the policy has the answer'
              : 'Answered from the wrong chunk',
        };

  const summary = answerShown
    ? `${scenario.label}, ${modeLabels[mode]}. Top ${TOP_K}: ${result.topK.join(', ')}. ${
        answer.kind === 'abstained'
          ? 'The assistant abstains and offers a person.'
          : `Fixture answer from ${answer.from}, citing ${answer.citations.join(', ')}.`
      } ${verdict.text}.`
    : started
      ? `Stage ${run.cursor} of ${run.stages.length}. ${run.events.at(-1)?.text ?? ''}`
      : `Ready. Query: ${query.text} ${modeLabels[mode]}.`;

  const status = run.done
    ? ({ tone: verdict.tone, text: verdict.text } as const)
    : started
      ? ({ tone: 'neutral', text: `Stage ${run.cursor} of ${run.stages.length}` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  const stats = [
    { label: 'Searchable chunks', value: `${result.searchable.length} of 20`, detail: modeLabels[mode] },
    {
      label: 'Keyword hits',
      value: keywordShown ? String(result.keyword.length) : 'not yet',
    },
    {
      label: 'Vector hits',
      value: vectorShown ? String(result.vector.length) : 'not yet',
    },
    {
      label: 'Fused rows',
      value: `${run.fusedShown} of ${result.fused.length}`,
      detail: `RRF with k = ${RRF_K}`,
    },
  ];

  const readout = run.done ? (
    <DiagramScroll label="Keyword only, vector only, and hybrid on this query, scrollable">
      <table className="sdv-stats sdv-compare">
        <caption>
          Same query and {modeLabels[mode].toLowerCase()}, three retrievers. Each sends its top {TOP_K} to the
          same fixture answer step. Illustrative.
        </caption>
        <thead>
          <tr>
            <td />
            {comparison.map((c) => (
              <th key={c.retriever} scope="col">
                {retrieverLabels[c.retriever]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Rank of the right chunk</th>
            {comparison.map((c) => (
              <td key={c.retriever}>
                <span className="sdv-stats__value">
                  {scenario.expected === null
                    ? 'No right chunk, should abstain'
                    : c.expectedRank === null
                      ? 'Not in the list'
                      : `Rank ${c.expectedRank}`}
                </span>
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Fixture answer from</th>
            {comparison.map((c) => (
              <td key={c.retriever}>
                <span className="sdv-stats__value">
                  {c.answer.kind === 'abstained' ? 'Abstained' : (c.answer.from ?? 'Abstained')}
                </span>
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Result</th>
            {comparison.map((c) => (
              <td key={c.retriever}>
                <ToneBadge tone={c.correct ? 'ok' : 'bad'}>{c.correct ? 'Correct' : 'Wrong'}</ToneBadge>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </DiagramScroll>
  ) : undefined;

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId, mode)}
      summary={summary}
      status={status}
      stats={stats}
      readout={readout}
      finished={run.done}
      resetKey={`${scenarioId}-${mode}`}
      ticksPerSecond={2}
      assumptions={TOY_MODEL_ASSUMPTIONS}
      keyStats={[
        { label: 'Searchable chunks', value: `${result.searchable.length} of 20` },
        { label: 'Fused rows', value: `${run.fusedShown} of ${result.fused.length}` },
        { label: 'Answer', value: run.done ? verdict.text : 'not yet' },
      ]}
      readoutCount={run.done ? 3 : stats.length}
      started={started}
      controls={
        <>
          <Segmented
            label="Tenant filter"
            value={mode}
            options={(['pre', 'post', 'none'] as const).map((value) => ({ value, label: modeLabels[value] }))}
            onChange={chooseMode}
          />
          <div className="sdv-duel__extra">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
              Skip to the end
            </button>
          </div>
        </>
      }
    >
      <div className="sdv-rag">
        <ScenarioChips
          label="Query"
          value={scenarioId}
          options={SCENARIOS.map((s) => ({ value: s.id, label: s.label, diff: s.stresses }))}
          onChange={chooseScenario}
        />
        <div className="sdv-rag-panel">
          <p className="sdv-rag-title">
            Query from a {tenant.name} {query.scope}
          </p>
          <p className="sdv-rag-query">
            <q>{query.text}</q>
          </p>
          <p className="sdv-rag-meta">Searching {searchScope}. Each list keeps its top 5.</p>
        </div>
        <MotionRoot>
          <div className="sdv-duel__lanes sdv-rag-lanes">
            <RankedLane
              title="Keyword list"
              hint="Simplified score: summed rarity of shared words"
              rows={result.keyword}
              shown={keywordShown}
              waiting="Waiting for keyword search"
              empty="No chunk shares a query word"
              queryText={query.text}
              keyword
            />
            <RankedLane
              title="Vector list"
              hint="Cosine similarity of toy embeddings"
              rows={result.vector}
              shown={vectorShown}
              waiting="Waiting for vector search"
              empty="No similar chunk"
              queryText={query.text}
              keyword={false}
            />
          </div>
          <section className="sdv-rag-panel" aria-label="Fused list">
            <h4 className="sdv-duel__lane-title">Fused with RRF</h4>
            <p className="sdv-rag-meta">
              Score = sum of 1/({RRF_K} + rank) over the lists that hold the chunk. A missing list adds 0.
            </p>
            {fusedRows.length === 0 ? (
              <p className="sdv-trace__empty">Fusion starts after both lists are in.</p>
            ) : (
              <ol className="sdv-rag-list">
                {fusedRows.map((row) => {
                  const inTopK = topKShown && result.topK.includes(row.id);
                  const blocked = inTopK ? blockedKind(row.id, user) : null;
                  const dropped = postShown && result.dropped.includes(row.id);
                  return (
                    <m.li
                      key={row.id}
                      className="sdv-rag-row"
                      data-top={inTopK ? 'true' : undefined}
                      initial={reduced ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <span className="sdv-rag-rank">{row.rank}</span>
                      <span className="sdv-rag-id">{row.id}</span>
                      <StorePill id={row.id} />
                      <span className="sdv-rag-score">{score4(row.score)}</span>
                      <span className="sdv-rag-meta sdv-rag-row__wide">
                        {rrfTerms(row)} (keyword{' '}
                        {row.keywordRank === null ? 'missing' : `rank ${row.keywordRank}`}, vector{' '}
                        {row.vectorRank === null ? 'missing' : `rank ${row.vectorRank}`})
                      </span>
                      {(inTopK || blocked) && (
                        <span className="sdv-rag-flags sdv-rag-row__wide">
                          {inTopK && !dropped && <ToneBadge tone="neutral">{`Top ${TOP_K}`}</ToneBadge>}
                          {blocked && (
                            <ToneBadge tone={mode === 'none' ? 'bad' : 'warn'}>
                              {mode === 'none' ? `Leak: ${leakLabels[blocked]}` : leakLabels[blocked]}
                            </ToneBadge>
                          )}
                          {dropped && <ToneBadge tone="warn">Dropped by post-filter</ToneBadge>}
                        </span>
                      )}
                    </m.li>
                  );
                })}
              </ol>
            )}
          </section>
          <section className="sdv-rag-panel" aria-label="Fixture answer">
            <h4 className="sdv-duel__lane-title">Fixture answer</h4>
            {!answerShown ? (
              <p className="sdv-trace__empty">The answer appears after the top {TOP_K} reach the model.</p>
            ) : (
              <m.div
                className="sdv-rag-answer"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <p className="sdv-rag-answer__text">{answer.text}</p>
                {answer.kind === 'answered' ? (
                  <ul className="sdv-rag-cites" aria-label="Citations">
                    {answer.citations.map((id) => {
                      const leak = result.leaks.find((l) => l.id === id);
                      return (
                        <li key={id} className="sdv-rag-cite" data-leak={leak ? 'true' : undefined}>
                          {leak && <UiIcon name="bad" />}
                          {`[${id}]`}
                          {leak && <span className="sdv-rag-cite__flag">{leakLabels[leak.kind]}</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="sdv-rag-handoff">
                    <UiIcon name="check" /> Handoff offered: a person picks up the conversation.
                  </p>
                )}
                <ToneBadge tone={verdict.tone}>{verdict.text}</ToneBadge>
                <p className="sdv-rag-meta">
                  Answer cache key: <code className="sdv-rag-key">{key}</code>. The store, permission scope,
                  index version, and earlier turns are part of the key, so another store, a reindex, or a
                  follow-up question never reads this entry.
                </p>
              </m.div>
            )}
          </section>
        </MotionRoot>
        <ul className="sdv-legend" aria-label="How to read the search">
          <li>
            Keyword score is simplified: the summed rarity (inverse document frequency) of the words a chunk
            shares with the query.
          </li>
          <li>
            Vector score is cosine similarity. Toy embeddings are hand-assigned for teaching; real systems
            compute embeddings with an embedding model.
          </li>
          <li>
            <span className="sdv-rag-pill" data-tenant="pine">
              Pine
            </span>{' '}
            marks a Pine Street Books chunk. Staff chunks say staff. A red flag marks a chunk this customer
            may not read.
          </li>
          <li>Fixture answers are written for this lesson. Every number is illustrative.</li>
        </ul>
        <div className="sdv-trace__log">
          <p className="sdv-trace__log-title">What happened</p>
          {run.events.length === 0 ? (
            <p className="sdv-trace__empty">Press Play or Step to run the first stage.</p>
          ) : (
            <TranscriptScroll label="What happened">
              <ol>
                {run.events.map((event) => (
                  <li key={event.tick}>
                    <span className="sdv-trace__num" aria-hidden="true">
                      {event.tick}
                    </span>
                    <time>Step {event.tick}</time>
                    <span>
                      {event.text}
                      {event.tone !== 'info' && (
                        <>
                          {' '}
                          <ToneBadge tone={stageTones[event.tone]}>{stageNotes[event.tone]}</ToneBadge>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </TranscriptScroll>
          )}
        </div>
      </div>
    </SimulationShell>
  );
}
