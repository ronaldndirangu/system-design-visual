/**
 * A toy retrieval pipeline for the Retrieval lesson. Keyword search uses a
 * simplified BM25-like score (summed inverse document frequency of shared
 * terms). Vector search uses cosine similarity over toy embeddings that are
 * hand-assigned for teaching; real systems compute embeddings with an
 * embedding model. The two ranked lists are fused with reciprocal rank fusion.
 * Everything is deterministic and every number is illustrative.
 */
import { hashString } from '../rng';
import {
  type Chunk,
  CORPUS,
  EVAL_QUESTIONS,
  type EvalQuestion,
  POLICY_DOC,
  type Query,
  SCENARIOS,
  type Scenario,
  type ScenarioId,
  type Scope,
  TENANTS,
  type TenantId,
  type Vec,
} from './retrievalCorpus';

export type FilterMode = 'pre' | 'post' | 'none';

/** RRF constant from Cormack, Clarke, and Buettcher (SIGIR 2009). */
export const RRF_K = 60;
/** How many results each retriever contributes to fusion. */
export const LIST_DEPTH = 5;
/** How many fused chunks go to the model. */
export const TOP_K = 3;
/** Evidence threshold the hybrid search widget uses. */
export const DEFAULT_THRESHOLD = 0.8;

export const ABSTAIN_TEXT =
  'I could not find this in the store policy. Want me to connect you with a person?';

const STOPWORDS = new Set(
  (
    'a an the i can do does you your my is are of to for on in at it its and or be that this with from ' +
    'how what when we me if any after by our once was will which they them as have has all should not'
  ).split(' '),
);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase, split on letters and digits, drop stopwords, and strip plural and past endings. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => !STOPWORDS.has(w)).map(stem);
}

function uniqueTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

const CHUNK_TERMS = new Map<string, Set<string>>(CORPUS.map((c) => [c.id, new Set(tokenize(c.text))]));

const DOC_FREQ = (() => {
  const df = new Map<string, number>();
  for (const terms of CHUNK_TERMS.values()) {
    for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
})();

/** Inverse document frequency over the whole corpus, so scores do not change with the filter mode. */
export function idf(term: string): number {
  const n = CORPUS.length;
  const df = DOC_FREQ.get(term) ?? 0;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

const BY_ID = new Map<string, Chunk>(CORPUS.map((c) => [c.id, c]));

export function chunkById(id: string): Chunk {
  const chunk = BY_ID.get(id);
  if (!chunk) throw new Error(`Unknown chunk ${id}`);
  return chunk;
}

export interface KeywordHit {
  score: number;
  matched: string[];
}

/** Simplified keyword score: the summed idf of query terms the chunk contains. */
export function keywordScore(queryText: string, chunk: Chunk): KeywordHit {
  const terms = CHUNK_TERMS.get(chunk.id) ?? new Set<string>();
  const matched = uniqueTerms(queryText).filter((t) => terms.has(t));
  return { score: matched.reduce((sum, t) => sum + idf(t), 0), matched };
}

/** Share of the query's idf weight that the chunk contains, from 0 to 1. */
export function keywordCoverage(queryText: string, chunk: Chunk): number {
  const all = uniqueTerms(queryText);
  const total = all.reduce((sum, t) => sum + idf(t), 0);
  return total === 0 ? 0 : keywordScore(queryText, chunk).score / total;
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [i, x] of a.entries()) {
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Simplified evidence check: how strongly a chunk supports an answer to the query. */
export function support(query: Query, chunk: Chunk): number {
  return Math.max(cosine(query.vector, chunk.vector), keywordCoverage(query.text, chunk));
}

export interface User {
  tenant: TenantId;
  scope: Scope;
}

/** A user reads only their own store's chunks, and staff-only chunks need staff scope. */
export function canRead(chunk: Chunk, user: User): boolean {
  return chunk.tenant === user.tenant && (chunk.scope === 'customer' || user.scope === 'staff');
}

export interface Ranked {
  id: string;
  rank: number;
  score: number;
}

function rankBy(chunks: readonly Chunk[], score: (c: Chunk) => number): Ranked[] {
  return chunks
    .map((c) => ({ id: c.id, score: score(c) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, LIST_DEPTH)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export function rankKeyword(query: Query, chunks: readonly Chunk[]): Ranked[] {
  return rankBy(chunks, (c) => keywordScore(query.text, c).score);
}

export function rankVector(query: Query, chunks: readonly Chunk[]): Ranked[] {
  return rankBy(chunks, (c) => cosine(query.vector, c.vector));
}

/** Reciprocal rank fusion for one document: the sum of 1/(k + rank). A missing rank adds 0. */
export function rrfScore(ranks: readonly (number | null)[], k = RRF_K): number {
  return ranks.reduce<number>((sum, r) => (r === null ? sum : sum + 1 / (k + r)), 0);
}

export interface FusedRow {
  id: string;
  rank: number;
  keywordRank: number | null;
  vectorRank: number | null;
  score: number;
}

/** Fuse two ranked lists. Ties break by chunk id so the order never depends on input order. */
export function fuse(keyword: readonly Ranked[], vector: readonly Ranked[], k = RRF_K): FusedRow[] {
  const ids = [...new Set([...keyword.map((r) => r.id), ...vector.map((r) => r.id)])];
  return ids
    .map((id) => {
      const keywordRank = keyword.find((r) => r.id === id)?.rank ?? null;
      const vectorRank = vector.find((r) => r.id === id)?.rank ?? null;
      return { id, keywordRank, vectorRank, score: rrfScore([keywordRank, vectorRank], k) };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export type LeakKind = 'tenant' | 'scope';

export interface Leak {
  id: string;
  kind: LeakKind;
}

export interface Answer {
  kind: 'answered' | 'abstained';
  /** The chunk the answer text comes from. */
  from: string | null;
  text: string;
  citations: string[];
}

/**
 * Answer from the sent chunk with the strongest support. When even that chunk is
 * below the threshold, abstain and offer a person. Fused RRF scores only encode
 * rank, so they cannot serve as evidence.
 */
export function answerFrom(query: Query, sent: readonly string[], threshold: number): Answer {
  let best: string | null = null;
  let bestSupport = -1;
  for (const id of sent) {
    const s = support(query, chunkById(id));
    if (s > bestSupport) {
      best = id;
      bestSupport = s;
    }
  }
  if (best === null || bestSupport < threshold) {
    return { kind: 'abstained', from: null, text: ABSTAIN_TEXT, citations: [] };
  }
  return {
    kind: 'answered',
    from: best,
    text: chunkById(best).says,
    citations: sent.filter((id) => support(query, chunkById(id)) >= threshold),
  };
}

function leaksIn(ids: readonly string[], user: User): Leak[] {
  return ids
    .map((id) => chunkById(id))
    .filter((c) => !canRead(c, user))
    .map((c) => ({ id: c.id, kind: c.tenant === user.tenant ? ('scope' as const) : ('tenant' as const) }));
}

export interface Retrieval {
  mode: FilterMode;
  threshold: number;
  searchable: string[];
  keyword: Ranked[];
  vector: Ranked[];
  fused: FusedRow[];
  topK: string[];
  /** Chunks that reach the model. */
  sent: string[];
  /** Chunks the post-filter removed after top-k. */
  dropped: string[];
  /** Sent chunks the user may not read. */
  leaks: Leak[];
  support: Record<string, number>;
  answer: Answer;
}

/** Keep the first k ids, then apply the filter mode's rule for what reaches the model. */
function select(ids: readonly string[], user: User, mode: FilterMode): { topK: string[]; sent: string[] } {
  const topK = ids.slice(0, TOP_K);
  const sent = mode === 'post' ? topK.filter((id) => canRead(chunkById(id), user)) : topK;
  return { topK, sent };
}

export function retrieve(query: Query, mode: FilterMode, threshold = DEFAULT_THRESHOLD): Retrieval {
  const user: User = { tenant: query.tenant, scope: query.scope };
  const pool = mode === 'pre' ? CORPUS.filter((c) => canRead(c, user)) : CORPUS;
  const keyword = rankKeyword(query, pool);
  const vector = rankVector(query, pool);
  const fused = fuse(keyword, vector);
  const { topK, sent } = select(
    fused.map((r) => r.id),
    user,
    mode,
  );
  const supportById: Record<string, number> = {};
  for (const row of fused) supportById[row.id] = support(query, chunkById(row.id));
  return {
    mode,
    threshold,
    searchable: pool.map((c) => c.id),
    keyword,
    vector,
    fused,
    topK,
    sent,
    dropped: topK.filter((id) => !sent.includes(id)),
    leaks: leaksIn(sent, user),
    support: supportById,
    answer: answerFrom(query, sent, threshold),
  };
}

export type RetrieverId = 'keyword' | 'vector' | 'hybrid';

export interface RetrieverResult {
  retriever: RetrieverId;
  /** Rank of the expected chunk in this retriever's list, or null when it is missing. */
  expectedRank: number | null;
  answer: Answer;
  correct: boolean;
}

export function isCorrect(answer: Answer, expected: string | null): boolean {
  return expected === null ? answer.kind === 'abstained' : answer.from === expected;
}

/** Compare keyword alone, vector alone, and hybrid on the same filter mode and threshold. */
export function compareRetrievers(
  scenario: Scenario,
  mode: FilterMode,
  threshold = DEFAULT_THRESHOLD,
): RetrieverResult[] {
  const result = retrieve(scenario.query, mode, threshold);
  const user: User = { tenant: scenario.query.tenant, scope: scenario.query.scope };
  const lists: Record<RetrieverId, string[]> = {
    keyword: result.keyword.map((r) => r.id),
    vector: result.vector.map((r) => r.id),
    hybrid: result.fused.map((r) => r.id),
  };
  return (['keyword', 'vector', 'hybrid'] as const).map((retriever) => {
    const ids = lists[retriever];
    const answer = answerFrom(scenario.query, select(ids, user, mode).sent, threshold);
    const index = scenario.expected === null ? -1 : ids.indexOf(scenario.expected);
    return {
      retriever,
      expectedRank: index === -1 ? null : index + 1,
      answer,
      correct: isCorrect(answer, scenario.expected),
    };
  });
}

export function scenarioById(id: ScenarioId): Scenario {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}`);
  return scenario;
}

export type StageKind = 'filter' | 'keyword' | 'vector' | 'fuse' | 'topk' | 'postfilter' | 'answer';
export type StageTone = 'info' | 'ok' | 'warn' | 'bad';

export interface Stage {
  kind: StageKind;
  text: string;
  tone: StageTone;
}

export interface RunEvent extends Stage {
  tick: number;
}

const fmt = (n: number, digits = 3) => n.toFixed(digits);

function rrfTerms(row: FusedRow): string {
  const parts = [row.keywordRank, row.vectorRank]
    .filter((r): r is number => r !== null)
    .map((r) => `1/(60+${r})`);
  return parts.join(' + ');
}

function buildStages(scenario: Scenario, result: Retrieval): Stage[] {
  const tenant = TENANTS[scenario.query.tenant];
  const stages: Stage[] = [];
  if (result.mode === 'pre') {
    stages.push({
      kind: 'filter',
      text: `Pre-filter: search only ${tenant.name} customer chunks (${result.searchable.length} of ${CORPUS.length}).`,
      tone: 'ok',
    });
  }
  const scope = result.mode === 'pre' ? `${tenant.short} chunks` : 'all chunks from every store';
  stages.push({
    kind: 'keyword',
    text:
      result.keyword.length === 0
        ? `Keyword search over ${scope}: no chunk shares a query word.`
        : `Keyword search over ${scope}: ${result.keyword.length} chunk${result.keyword.length === 1 ? '' : 's'} share query words. Top: ${result.keyword[0]?.id ?? 'none'}.`,
    tone: 'info',
  });
  stages.push({
    kind: 'vector',
    text: `Vector search over ${scope}: top ${result.vector.length} by cosine. Top: ${result.vector[0]?.id ?? 'none'}.`,
    tone: 'info',
  });
  for (const row of result.fused) {
    stages.push({
      kind: 'fuse',
      text: `Fuse ${row.id}: ${rrfTerms(row)} = ${fmt(row.score, 4)}, fused rank ${row.rank}.`,
      tone: 'info',
    });
  }
  const leakText = result.leaks.length > 0 && result.mode === 'none';
  stages.push({
    kind: 'topk',
    text: leakText
      ? `Top ${TOP_K} go to the model with no filter: ${result.topK.join(', ')}. ${result.leaks.length} of them the user may not read.`
      : `Top ${TOP_K} fused chunks: ${result.topK.join(', ')}.`,
    tone: leakText ? 'bad' : 'info',
  });
  if (result.mode === 'post') {
    stages.push({
      kind: 'postfilter',
      text:
        result.dropped.length === 0
          ? `Post-filter keeps all ${result.sent.length} chunks.`
          : `Post-filter drops ${result.dropped.join(', ')}. Only ${result.sent.length} of ${TOP_K} chunks reach the model.`,
      tone: result.dropped.length === 0 ? 'ok' : 'warn',
    });
  }
  const correct = isCorrect(result.answer, scenario.expected);
  stages.push({
    kind: 'answer',
    text:
      result.answer.kind === 'abstained'
        ? `No sent chunk reaches the ${fmt(result.threshold, 2)} evidence threshold, so the assistant abstains.`
        : `Answer from ${result.answer.from} (support ${fmt(result.support[result.answer.from ?? ''] ?? 0, 2)}), citing ${result.answer.citations.join(', ')}.`,
    tone: correct && result.leaks.length === 0 ? 'ok' : 'bad',
  });
  return stages;
}

/** Step-by-step reveal of one retrieval, for the animated widget. Needs no randomness. */
export class HybridRun {
  readonly scenario: Scenario;
  readonly result: Retrieval;
  readonly stages: readonly Stage[];
  cursor = 0;
  events: RunEvent[] = [];

  constructor(
    readonly scenarioId: ScenarioId,
    readonly mode: FilterMode,
    readonly threshold = DEFAULT_THRESHOLD,
  ) {
    this.scenario = scenarioById(scenarioId);
    this.result = retrieve(this.scenario.query, mode, threshold);
    this.stages = buildStages(this.scenario, this.result);
  }

  get done(): boolean {
    return this.cursor >= this.stages.length;
  }

  step(): void {
    const stage = this.stages[this.cursor];
    if (!stage) return;
    this.cursor += 1;
    this.events.push({ ...stage, tick: this.cursor });
  }

  reset(): void {
    this.cursor = 0;
    this.events = [];
  }

  revealed(kind: StageKind): boolean {
    return this.events.some((e) => e.kind === kind);
  }

  get fusedShown(): number {
    return this.events.filter((e) => e.kind === 'fuse').length;
  }
}

export interface WordChunk {
  id: string;
  start: number;
  end: number;
  words: string[];
  ruleWords: number;
  hasRule: boolean;
  hasException: boolean;
}

export interface ChunkingResult {
  chunks: WordChunk[];
  sent: WordChunk;
  /** The sent chunk holds the 30-day rule and the sale exception together. */
  together: boolean;
  correct: boolean;
  answer: string;
}

const POLICY_WORDS = POLICY_DOC.text.split(' ');

function spanOverlap(start: number, end: number, span: { start: number; end: number }): number {
  return Math.max(0, Math.min(end, span.end) - Math.max(start, span.start));
}

/** Fixed word windows: each chunk starts size minus overlap words after the last. */
export function chunkWords(size: number, overlap: number): WordChunk[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer');
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new RangeError('overlap must be at least 0 and less than size');
  }
  const ruleLength = POLICY_DOC.rule.end - POLICY_DOC.rule.start;
  const exceptionLength = POLICY_DOC.exception.end - POLICY_DOC.exception.start;
  const chunks: WordChunk[] = [];
  for (let start = 0; ; start += size - overlap) {
    const end = Math.min(start + size, POLICY_WORDS.length);
    const ruleWords = spanOverlap(start, end, POLICY_DOC.rule);
    chunks.push({
      id: `harbor-policy-c${chunks.length}`,
      start,
      end,
      words: POLICY_WORDS.slice(start, end),
      ruleWords,
      hasRule: ruleWords === ruleLength,
      hasException: spanOverlap(start, end, POLICY_DOC.exception) === exceptionLength,
    });
    if (end >= POLICY_WORDS.length) break;
  }
  return chunks;
}

/**
 * Fixture retrieval sends one chunk: the one holding the most of the 30-day
 * rule, preferring a chunk that also holds the sale exception.
 */
export function chunkPolicy(size: number, overlap: number): ChunkingResult {
  const chunks = chunkWords(size, overlap);
  const exceptionLength = POLICY_DOC.exception.end - POLICY_DOC.exception.start;
  const score = (c: WordChunk) => c.ruleWords + (c.hasRule && c.hasException ? exceptionLength : 0);
  const first = chunks[0];
  if (!first) throw new Error('chunkWords returned no chunks');
  let sent = first;
  for (const c of chunks) if (score(c) > score(sent)) sent = c;
  const together = sent.hasRule && sent.hasException;
  const correct = sent.hasException;
  return {
    chunks,
    sent,
    together,
    correct,
    answer: correct ? POLICY_DOC.rightAnswer : POLICY_DOC.wrongAnswer,
  };
}

export function policyWordCount(): number {
  return POLICY_WORDS.length;
}

export type EvalOutcome = 'correct' | 'wrong' | 'abstained';

export interface EvalRow {
  question: EvalQuestion;
  /** The sent chunk with the strongest support. */
  top: string | null;
  support: number;
  outcome: EvalOutcome;
  answer: Answer;
}

export interface EvalCounts {
  correct: number;
  wrong: number;
  abstained: number;
  /** Abstentions where the policy truly has no answer. */
  rightToAbstain: number;
}

/** Run every eval question with pre-filtered hybrid retrieval at one threshold. */
export function evaluate(threshold: number): EvalRow[] {
  return EVAL_QUESTIONS.map((question) => {
    const result = retrieve(question.query, 'pre', threshold);
    const best = answerFrom(question.query, result.sent, 0);
    const top = best.from;
    const answer = result.answer;
    const outcome: EvalOutcome =
      answer.kind === 'abstained' ? 'abstained' : answer.from === question.expected ? 'correct' : 'wrong';
    return { question, top, support: top === null ? 0 : (result.support[top] ?? 0), outcome, answer };
  });
}

export function countOutcomes(rows: readonly EvalRow[]): EvalCounts {
  return {
    correct: rows.filter((r) => r.outcome === 'correct').length,
    wrong: rows.filter((r) => r.outcome === 'wrong').length,
    abstained: rows.filter((r) => r.outcome === 'abstained').length,
    rightToAbstain: rows.filter((r) => r.outcome === 'abstained' && r.question.expected === null).length,
  };
}

export interface CacheKeyInput {
  tenant: TenantId;
  scope: Scope;
  model: string;
  promptVersion: string;
  sampling: string;
  query: string;
}

/** An exact-match answer cache key. The store and permission scope keep entries apart. */
export function cacheKey(input: CacheKeyInput): string {
  const normalized = input.query.toLowerCase().replace(/\s+/g, ' ').trim();
  const digest = hashString(normalized).toString(16).padStart(8, '0');
  return [input.tenant, input.scope, input.model, input.promptVersion, input.sampling, `q:${digest}`].join(
    '|',
  );
}
