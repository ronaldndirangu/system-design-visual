import { createRng, hashString } from '../rng';

/**
 * A toy recommendation funnel for the support assistant. A customer's garden
 * hose is out of stock, and the assistant suggests a handful of replacements
 * from a catalog of 3,000,000 items. Only 26 items are named fixtures written
 * for this lesson; every other catalog item is anonymous and scores below
 * them. Every latency number is illustrative, and nothing here calls a model.
 *
 * Eligibility (ships to this address, not recalled) is known before the
 * request, so it runs with candidate generation and the ranker never scores an
 * item the customer cannot buy. Only live stock is checked after ranking.
 */
export type SourceId = 'embed' | 'together' | 'category' | 'storewide';
export type StageId = 'candidates' | 'ranker' | 'filters' | 'final';
export type RecScenarioId = 'score' | 'funnel' | 'few' | 'popular';
export type DropReason =
  | 'missed'
  | 'belowRanker'
  | 'outOfStock'
  | 'noShip'
  | 'recalled'
  | 'diversity'
  | 'belowTop5';

export interface RecItem {
  id: string;
  name: string;
  brand: string;
  /** A known good replacement for the out of stock hose. */
  relevant: boolean;
  /** The ranker's fixture score for this request, 0 to 1. */
  score: number;
  /** Position in each source's own list. Missing means the source never returns it. */
  ranks: Partial<Record<SourceId, number>>;
  best?: boolean;
  outOfStock?: boolean;
  noShip?: boolean;
  recalled?: boolean;
}

export interface FunnelConfig {
  /** Items each candidate source returns. Empty means no candidate stage: rank the whole catalog. */
  sources: Partial<Record<SourceId, number>>;
  rank: boolean;
}

export interface RecScenario {
  id: RecScenarioId;
  label: string;
  diff: string;
  config: FunnelConfig;
}

export interface SourceRun {
  source: SourceId;
  returned: number;
  ms: number;
  named: string[];
}

export interface StageResult {
  stage: StageId;
  in: number;
  passed: number;
  dropped: number;
  ms: number;
  skipped: boolean;
  /** Named items that entered, in display order. */
  namedIn: string[];
  /** Named items that passed, in the order the next stage sees them. */
  namedPassed: string[];
  namedDropped: { id: string; reason: DropReason }[];
}

export interface FunnelResult {
  config: FunnelConfig;
  sources: SourceRun[];
  /** Items the sources returned before merging. */
  rawEntries: number;
  duplicates: number;
  stages: StageResult[];
  /** Named items shown to the customer, in order. */
  shown: string[];
  /** Anonymous catalog items that filled a shown slot. */
  shownOther: number;
  totalMs: number;
  /** Known good items this customer can buy that reached the ranker. */
  relevantReached: number;
  /** Share of known good items this customer can buy that reached the ranker. */
  recall: number;
  goodShown: number;
  overBudget: boolean;
}

export const REC_SEED = 42;
export const CATALOG_SIZE = 3_000_000;
export const REC_BUDGET_MS = 50;
export const RANKER_MS_PER_ITEM = 0.01;
export const RANKER_KEEP = 15;
export const FILTER_MS = 0.5;
export const RERANK_MS = 0.5;
export const MERGE_MS = 1;
export const SHOWN = 5;
export const MAX_PER_BRAND = 2;
export const FUNNEL_CANDIDATES = 500;
export const FEW_CANDIDATES = 20;

export const request = { name: '50 ft green garden hose', brand: 'Verdant' } as const;

export const sourceInfo: Record<SourceId, { label: string; fixedMs: number; msPerItem: number }> = {
  embed: { label: 'Embedding neighbors', fixedMs: 5, msPerItem: 0.01 },
  together: { label: 'Bought together', fixedMs: 2, msPerItem: 0.004 },
  category: { label: 'Popular in category', fixedMs: 1, msPerItem: 0.004 },
  storewide: { label: 'Store best sellers', fixedMs: 1, msPerItem: 0.004 },
};
const sourceOrder: SourceId[] = ['embed', 'together', 'category', 'storewide'];

export const stageInfo: Record<StageId, { label: string; column: string }> = {
  candidates: { label: 'Candidate generation', column: 'Candidates' },
  ranker: { label: 'Ranker', column: 'Ranked' },
  filters: { label: 'Stock check', column: 'In stock' },
  final: { label: 'Re-rank and pick', column: 'Shown' },
};
export const stageOrder: StageId[] = ['candidates', 'ranker', 'filters', 'final'];

export const dropLabels: Record<DropReason, string> = {
  missed: 'Missed by candidates',
  belowRanker: `Below the ranker\u2019s top ${RANKER_KEEP}`,
  outOfStock: 'Stock check: out of stock',
  noShip: 'Not eligible: does not ship here',
  recalled: 'Not eligible: recalled',
  diversity: 'Skipped for diversity',
  belowTop5: `Below the top ${SHOWN}`,
};

export const items: RecItem[] = [
  {
    id: 'g1',
    name: '50 ft blue garden hose',
    brand: 'Verdant',
    relevant: true,
    score: 0.96,
    ranks: { embed: 14, category: 9 },
    best: true,
  },
  {
    id: 'g2',
    name: '50 ft kink free hose',
    brand: 'FlowRight',
    relevant: true,
    score: 0.93,
    ranks: { embed: 3, category: 2 },
  },
  {
    id: 'g3',
    name: '50 ft heavy duty rubber hose',
    brand: 'Ironline',
    relevant: true,
    score: 0.9,
    ranks: { embed: 22, together: 18 },
  },
  {
    id: 'g4',
    name: '50 ft green garden hose (other seller)',
    brand: 'Verdant',
    relevant: true,
    score: 0.95,
    ranks: { embed: 1 },
    outOfStock: true,
  },
  {
    id: 'g5',
    name: '75 ft green garden hose',
    brand: 'Verdant',
    relevant: true,
    score: 0.88,
    ranks: { embed: 5 },
  },
  {
    id: 'g6',
    name: '50 ft expandable hose',
    brand: 'Stretcha',
    relevant: true,
    score: 0.84,
    ranks: { embed: 16, together: 40 },
  },
  {
    id: 'g7',
    name: '50 ft lightweight hose',
    brand: 'FlowRight',
    relevant: true,
    score: 0.86,
    ranks: { embed: 85 },
  },
  {
    id: 'g8',
    name: '50 ft hose and reel cart',
    brand: 'Ironline',
    relevant: true,
    score: 0.8,
    ranks: { together: 60 },
    noShip: true,
  },
  {
    id: 'g9',
    name: '50 ft black garden hose',
    brand: 'Verdant',
    relevant: true,
    score: 0.91,
    ranks: { embed: 7 },
  },
  {
    id: 'g10',
    name: '50 ft RV fresh water hose',
    brand: 'AquaPure',
    relevant: true,
    score: 0.82,
    ranks: { embed: 900 },
  },
  {
    id: 'n1',
    name: '8 pattern hose nozzle',
    brand: 'Spraymate',
    relevant: false,
    score: 0.42,
    ranks: { embed: 2, together: 1, category: 1 },
  },
  {
    id: 'n2',
    name: 'Hose repair kit',
    brand: 'FlowRight',
    relevant: false,
    score: 0.35,
    ranks: { embed: 4 },
  },
  {
    id: 'n3',
    name: 'Wall hose hanger',
    brand: 'Ironline',
    relevant: false,
    score: 0.3,
    ranks: { embed: 6, together: 3 },
  },
  {
    id: 'n4',
    name: 'Oscillating sprinkler',
    brand: 'Spraymate',
    relevant: false,
    score: 0.4,
    ranks: { together: 2, category: 3 },
  },
  {
    id: 'n5',
    name: 'Two way hose splitter',
    brand: 'Spraymate',
    relevant: false,
    score: 0.33,
    ranks: { embed: 10, together: 4 },
  },
  {
    id: 'n6',
    name: '2 gallon watering can',
    brand: 'Verdant',
    relevant: false,
    score: 0.28,
    ranks: { category: 4 },
  },
  {
    id: 'n7',
    name: 'Wall mount hose reel',
    brand: 'Ironline',
    relevant: false,
    score: 0.38,
    ranks: { embed: 8, together: 5 },
  },
  {
    id: 'n8',
    name: 'Garden gloves',
    brand: 'GreenThumb',
    relevant: false,
    score: 0.2,
    ranks: { together: 6 },
  },
  {
    id: 'n9',
    name: '6 ft shop vacuum hose',
    brand: 'Dustline',
    relevant: false,
    score: 0.15,
    ranks: { embed: 9 },
  },
  {
    id: 'n10',
    name: 'Hose timer',
    brand: 'Spraymate',
    relevant: false,
    score: 0.45,
    ranks: { embed: 11, together: 7 },
    recalled: true,
  },
  {
    id: 'n11',
    name: 'Hose quick connectors',
    brand: 'FlowRight',
    relevant: false,
    score: 0.32,
    ranks: { embed: 12 },
  },
  { id: 'p1', name: 'Phone case', brand: 'Casely', relevant: false, score: 0.02, ranks: { storewide: 1 } },
  { id: 'p2', name: 'USB charger', brand: 'Voltix', relevant: false, score: 0.03, ranks: { storewide: 2 } },
  {
    id: 'p3',
    name: 'Wireless earbuds',
    brand: 'Sonora',
    relevant: false,
    score: 0.04,
    ranks: { storewide: 3 },
  },
  {
    id: 'p4',
    name: 'Paper towels (12 pack)',
    brand: 'Softleaf',
    relevant: false,
    score: 0.05,
    ranks: { storewide: 4 },
  },
  { id: 'p5', name: 'Water bottle', brand: 'Hydra', relevant: false, score: 0.06, ranks: { storewide: 5 } },
];

const byId = new Map(items.map((item) => [item.id, item]));

/** Why this customer can never buy the item, known before the request arrives. */
export function ineligibleReason(item: RecItem): 'noShip' | 'recalled' | null {
  if (item.noShip) return 'noShip';
  if (item.recalled) return 'recalled';
  return null;
}

/** A good replacement this customer can actually buy. */
export const isKnownGood = (item: RecItem) => item.relevant && ineligibleReason(item) === null;
export const RELEVANT_TOTAL = items.filter(isKnownGood).length;

export function itemById(id: string): RecItem {
  const item = byId.get(id);
  if (!item) throw new Error(`Unknown item ${id}`);
  return item;
}

/** Splits a total candidate budget across the three request aware sources. */
export function splitBudget(total: number): FunnelConfig {
  const embed = Math.round(total * 0.6);
  const together = Math.round(total * 0.25);
  return { sources: { embed, together, category: total - embed - together }, rank: true };
}

export const recScenarios: Record<RecScenarioId, RecScenario> = {
  score: {
    id: 'score',
    label: 'Score everything',
    diff: 'no candidate retrieval: the ranker scores every eligible item in the 3,000,000 item catalog',
    config: { sources: {}, rank: true },
  },
  funnel: {
    id: 'funnel',
    label: 'Funnel',
    diff: '500 candidates from three sources, then the ranker',
    config: splitBudget(FUNNEL_CANDIDATES),
  },
  few: {
    id: 'few',
    label: 'Too few candidates',
    diff: 'candidate budget cut from 500 to 20',
    config: splitBudget(FEW_CANDIDATES),
  },
  popular: {
    id: 'popular',
    label: 'Popularity only',
    diff: 'one source, store best sellers; no ranker',
    config: { sources: { storewide: SHOWN }, rank: false },
  },
};
export const recScenarioIds: RecScenarioId[] = ['score', 'funnel', 'few', 'popular'];

const bestRank = (item: RecItem) =>
  Math.min(...sourceOrder.map((source) => item.ranks[source] ?? Number.POSITIVE_INFINITY));
const byScore = (a: string, b: string) => itemById(b).score - itemById(a).score;
const ineligibleDrops = (ids: string[]): StageResult['namedDropped'] =>
  ids.flatMap((id) => {
    const reason = ineligibleReason(itemById(id));
    return reason ? [{ id, reason }] : [];
  });

function stage(
  id: StageId,
  inCount: number,
  passed: number,
  ms: number,
  namedIn: string[],
  namedPassed: string[],
  namedDropped: StageResult['namedDropped'],
  skipped = false,
): StageResult {
  return {
    stage: id,
    in: inCount,
    passed,
    dropped: inCount - passed,
    ms: round(ms),
    skipped,
    namedIn,
    namedPassed,
    namedDropped,
  };
}

/** Runs the whole funnel for one configuration. Pure: the same config always gives the same result. */
export function runFunnel(config: FunnelConfig): FunnelResult {
  const allIds = items.map((item) => item.id);
  const active = sourceOrder.filter((source) => (config.sources[source] ?? 0) > 0);
  const sources: SourceRun[] = active.map((source) => {
    const returned = config.sources[source] ?? 0;
    const info = sourceInfo[source];
    const named = items
      .filter((item) => (item.ranks[source] ?? Number.POSITIVE_INFINITY) <= returned)
      .map((item) => item.id);
    return { source, returned, ms: round(info.fixedMs + info.msPerItem * returned), named };
  });

  const stages: StageResult[] = [];
  let rawEntries = CATALOG_SIZE;
  let duplicates = 0;
  let current: string[];
  let currentCount: number;

  if (sources.length === 0) {
    const dropped = ineligibleDrops(allIds);
    current = allIds.filter((id) => ineligibleReason(itemById(id)) === null);
    currentCount = CATALOG_SIZE - dropped.length;
    stages.push(stage('candidates', CATALOG_SIZE, currentCount, 0, allIds, current, dropped));
  } else {
    rawEntries = sources.reduce((sum, run) => sum + run.returned, 0);
    const namedEntries = sources.reduce((sum, run) => sum + run.named.length, 0);
    const unique = new Set(sources.flatMap((run) => run.named));
    duplicates = namedEntries - unique.size;
    const found = items
      .filter((item) => unique.has(item.id))
      .sort((a, b) => bestRank(a) - bestRank(b) || a.id.localeCompare(b.id));
    current = found.filter((item) => ineligibleReason(item) === null).map((item) => item.id);
    currentCount = rawEntries - duplicates - (found.length - current.length);
    const slowest = Math.max(...sources.map((run) => run.ms));
    const ms = slowest + (sources.length > 1 ? MERGE_MS : 0);
    const dropped = allIds.flatMap((id): StageResult['namedDropped'] => {
      if (!unique.has(id)) return [{ id, reason: 'missed' }];
      const reason = ineligibleReason(itemById(id));
      return reason ? [{ id, reason }] : [];
    });
    stages.push(stage('candidates', CATALOG_SIZE, currentCount, ms, allIds, current, dropped));
  }

  const relevantReached = current.filter((id) => isKnownGood(itemById(id))).length;

  if (config.rank) {
    const sorted = [...current].sort(byScore);
    const keep = Math.min(RANKER_KEEP, currentCount);
    const kept = sorted.slice(0, keep);
    const dropped = sorted.slice(keep).map((id) => ({ id, reason: 'belowRanker' as const }));
    stages.push(
      stage('ranker', currentCount, keep, currentCount * RANKER_MS_PER_ITEM, current, kept, dropped),
    );
    current = kept;
    currentCount = keep;
  } else {
    stages.push(stage('ranker', currentCount, currentCount, 0, current, current, [], true));
  }

  const filtered = current.filter((id) => !itemById(id).outOfStock);
  const filterDrops = current.flatMap((id) =>
    itemById(id).outOfStock ? [{ id, reason: 'outOfStock' as const }] : [],
  );
  const afterFilters = currentCount - filterDrops.length;
  stages.push(stage('filters', currentCount, afterFilters, FILTER_MS, current, filtered, filterDrops));

  const shown: string[] = [];
  const finalDrops: StageResult['namedDropped'] = [];
  const perBrand = new Map<string, number>();
  for (const id of filtered) {
    const brand = itemById(id).brand;
    const count = perBrand.get(brand) ?? 0;
    if (shown.length >= SHOWN) finalDrops.push({ id, reason: 'belowTop5' });
    else if (count >= MAX_PER_BRAND) finalDrops.push({ id, reason: 'diversity' });
    else {
      shown.push(id);
      perBrand.set(brand, count + 1);
    }
  }
  const shownOther = Math.min(SHOWN - shown.length, afterFilters - filtered.length);
  const shownCount = shown.length + shownOther;
  stages.push(stage('final', afterFilters, shownCount, RERANK_MS, filtered, shown, finalDrops));

  const totalMs = round(stages.reduce((sum, s) => sum + s.ms, 0));
  return {
    config,
    sources,
    rawEntries,
    duplicates,
    stages,
    shown,
    shownOther,
    totalMs,
    relevantReached,
    recall: relevantReached / RELEVANT_TOTAL,
    goodShown: shown.filter((id) => isKnownGood(itemById(id))).length,
    overBudget: totalMs > REC_BUDGET_MS,
  };
}

export interface CurvePoint {
  candidates: number;
  unique: number;
  recall: number;
  candidateMs: number;
  rankerMs: number;
  totalMs: number;
  goodShown: number;
  /** Whether the best replacement made the final handful. */
  bestShown: boolean;
  overBudget: boolean;
}

export const CURVE_CANDIDATES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] as const;

/** One funnel run per candidate budget, for the slider. */
export function candidateCurve(): CurvePoint[] {
  return CURVE_CANDIDATES.map((candidates) => {
    const result = runFunnel(splitBudget(candidates));
    const [cand, ranker] = result.stages;
    return {
      candidates,
      unique: cand?.passed ?? 0,
      recall: result.recall,
      candidateMs: cand?.ms ?? 0,
      rankerMs: ranker?.ms ?? 0,
      totalMs: result.totalMs,
      goodShown: result.goodShown,
      bestShown: result.shown.some((id) => itemById(id).best === true),
      overBudget: result.overBudget,
    };
  });
}

/** Candidate count where total latency crosses the budget, interpolated between curve points. */
export function budgetCrossing(curve: CurvePoint[]): number | undefined {
  for (let index = 1; index < curve.length; index += 1) {
    const before = curve[index - 1];
    const after = curve[index];
    if (!before || !after || before.totalMs > REC_BUDGET_MS || after.totalMs <= REC_BUDGET_MS) continue;
    const share = (REC_BUDGET_MS - before.totalMs) / (after.totalMs - before.totalMs);
    return before.candidates + share * (after.candidates - before.candidates);
  }
  return undefined;
}

/** How many sample dots stand in for a crowd of anonymous items. Grows with the log of the count, capped. */
export function crowdDotCount(anonymous: number): number {
  if (anonymous <= 0) return 0;
  return Math.min(24, Math.max(1, Math.round(4 * Math.log10(anonymous + 1))));
}

/** Seeded positions in the unit square, so the crowd looks the same on every replay. */
export function crowdDots(key: string, count: number): { x: number; y: number }[] {
  const rng = createRng(hashString(`${REC_SEED}:${key}`));
  return Array.from({ length: Math.min(count, 24) }, () => ({ x: rng(), y: rng() }));
}

export interface RecEvent {
  tick: number;
  stage: StageId;
  text: string;
  marker: boolean;
}

/** Reveals the funnel one stage per tick, with a transcript of what each stage did. */
export class RecRun {
  readonly scenario: RecScenario;
  readonly result: FunnelResult;
  readonly length = stageOrder.length;
  readonly events: RecEvent[] = [];
  private tickCount = 0;

  constructor(id: RecScenarioId) {
    this.scenario = recScenarios[id];
    this.result = runFunnel(this.scenario.config);
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** Stages revealed so far. */
  get stages(): StageResult[] {
    return this.result.stages.slice(0, this.tickCount);
  }

  get elapsedMs(): number {
    return round(this.stages.reduce((sum, s) => sum + s.ms, 0));
  }

  step(): void {
    if (this.done) return;
    const s = this.result.stages[this.tickCount];
    this.tickCount += 1;
    if (!s) return;
    for (const event of stageEvents(this.result, s)) {
      this.events.push({ tick: this.tickCount, stage: s.stage, ...event });
    }
    if (s.stage === 'ranker' && this.elapsedMs > REC_BUDGET_MS) {
      this.events.push({
        tick: this.tickCount,
        stage: s.stage,
        text: `The running total is ${formatMs(this.elapsedMs)}, past the ${REC_BUDGET_MS} ms budget. The suggestions arrive long after the reply should.`,
        marker: true,
      });
    }
    if (this.done) {
      this.events.push({
        tick: this.tickCount,
        stage: s.stage,
        text: `Done in ${formatMs(this.result.totalMs)} against a ${REC_BUDGET_MS} ms budget. ${this.result.relevantReached} of ${RELEVANT_TOTAL} known good items reached the ranker, and ${this.result.goodShown} of ${SHOWN} shown items are good replacements.`,
        marker: false,
      });
    }
  }
}

function stageEvents(result: FunnelResult, s: StageResult): { text: string; marker: boolean }[] {
  const names = (list: { id: string }[]) => joinNames(list.map((entry) => itemById(entry.id).name));
  const withReasons = (list: StageResult['namedDropped']) =>
    joinNames(list.map((drop) => `${itemById(drop.id).name} (${filterWords[drop.reason] ?? drop.reason})`));
  switch (s.stage) {
    case 'candidates': {
      const ineligible = s.namedDropped.filter((drop) => drop.reason !== 'missed');
      if (result.sources.length === 0) {
        return [
          {
            text: `No candidate retrieval: an eligibility filter on the catalog removes ${withReasons(ineligible)}, and the other ${count(s.passed)} items go straight to the ranker.`,
            marker: false,
          },
        ];
      }
      const parts = result.sources.map(
        (run) => `${sourceInfo[run.source].label} returned ${count(run.returned)}`,
      );
      const slowest = Math.max(...result.sources.map((run) => run.ms));
      const unique = result.rawEntries - result.duplicates;
      const merge =
        result.sources.length > 1
          ? ` Merging removed ${result.duplicates} duplicates in ${MERGE_MS} ms, leaving ${count(unique)} unique candidates.`
          : ` That list goes on unchanged: ${count(unique)} candidates.`;
      const eligibility =
        ineligible.length > 0
          ? ` Before ranking, the eligibility filter removed ${withReasons(ineligible)}, leaving ${count(s.passed)}.`
          : '';
      const ran =
        result.sources.length === 1
          ? `One source ran: ${joinNames(parts)} in ${formatMs(slowest)}.`
          : `${result.sources.length} sources ran side by side: ${joinNames(parts)}. The slowest took ${formatMs(slowest)}.`;
      const events = [{ text: `${ran}${merge}${eligibility}`, marker: false }];
      const missed = s.namedDropped.filter(
        (drop) => drop.reason === 'missed' && isKnownGood(itemById(drop.id)),
      );
      if (missed.length === RELEVANT_TOTAL) {
        events.push({
          text: `Candidates missed all ${RELEVANT_TOTAL} known good items, including the best replacement. The ranker could never recover them.`,
          marker: true,
        });
      } else if (missed.length > 0) {
        const best = missed.some((drop) => itemById(drop.id).best);
        events.push({
          text: `Candidates missed ${missed.length} of ${RELEVANT_TOTAL} known good items${best ? ', including the best replacement' : ''}: ${names(missed)}. The ranker never sees ${missed.length === 1 ? 'it' : 'them'}.`,
          marker: best,
        });
      }
      return events;
    }
    case 'ranker':
      if (s.skipped) {
        return [
          {
            text: 'No ranker: the list keeps its best seller order, whatever the customer asked about.',
            marker: false,
          },
        ];
      }
      return [
        {
          text: `The ranker scored ${count(s.in)} items at ${RANKER_MS_PER_ITEM * 1000} \u00b5s each, ${formatMs(s.ms)}, and kept the top ${s.passed}.`,
          marker: false,
        },
      ];
    case 'filters':
      if (s.namedDropped.length === 0) {
        return [
          {
            text: 'The live stock check removed nothing: every ranked item is in stock right now.',
            marker: false,
          },
        ];
      }
      return [
        {
          text: `The live stock check removed ${withReasons(s.namedDropped)}. ${s.passed} remain.`,
          marker: false,
        },
      ];
    case 'final': {
      const shownNames = joinNames(result.shown.map((id) => itemById(id).name));
      const diversity = s.namedDropped.filter((drop) => drop.reason === 'diversity');
      const skippedBrand = diversity[0] ? itemById(diversity[0].id).brand : '';
      const events = [
        {
          text: `Shown: ${shownNames}.${
            diversity.length > 0
              ? ` The diversity rule skipped ${names(diversity)}, which would be a third ${skippedBrand} item.`
              : ''
          }`,
          marker: false,
        },
      ];
      if (result.goodShown < SHOWN) {
        events.push({
          text:
            result.goodShown === 0
              ? `None of the ${SHOWN} shown items can replace a garden hose.`
              : `Only ${result.goodShown} of the ${SHOWN} shown items are good replacements for a garden hose.`,
          marker: true,
        });
      }
      return events;
    }
  }
}

const filterWords: Partial<Record<DropReason, string>> = {
  outOfStock: 'out of stock',
  noShip: 'does not ship here',
  recalled: 'recalled',
};

/** Every scenario played to the end, for side by side comparison. */
export function finishedResults(): Record<RecScenarioId, FunnelResult> {
  return {
    score: runFunnel(recScenarios.score.config),
    funnel: runFunnel(recScenarios.funnel.config),
    few: runFunnel(recScenarios.few.config),
    popular: runFunnel(recScenarios.popular.config),
  };
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${Math.round(ms).toLocaleString('en-US')} ms`;
  return `${Number(ms.toFixed(2))} ms`;
}

export function count(value: number): string {
  return value.toLocaleString('en-US');
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
