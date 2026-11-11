import { createRng, hashString, type Rng, randomInt } from '../rng';
import { type Budgets, candidates, DEFAULT_BUDGETS, EVAL_SEED, joinNames, PROMPT_TOKENS } from './evalBudget';
import { percentile } from './serverFarm';

/**
 * A toy model of two gateway strategies for the support assistant. The same
 * seeded questions go through both lanes. Routing asks a cheap classifier to
 * pick Small or Medium before the call. A cascade asks Small first and
 * escalates to Medium when a checker rejects the answer. Pass chances, the
 * classifier, and the checker are illustrative: no model was called.
 */

export type Difficulty = 'easy' | 'hard';
export type MixId = 'easy' | 'hard';
export type StrategyId = 'routing' | 'cascade';
export type TierId = 'small' | 'medium';
export type BudgetName = 'quality' | 'latency' | 'cost';

export interface Mix {
  id: MixId;
  label: string;
  diff: string;
  easy: number;
  hard: number;
}

export interface GatewayRequest {
  /** 1 based, in arrival order. */
  id: number;
  difficulty: Difficulty;
  outputTokens: number;
  /** Whether each tier’s answer would pass the rubric. Drawn once, shared by both lanes. */
  passes: Record<TierId, boolean>;
  /** What the routing classifier guesses before any model runs. */
  predicted: Difficulty;
  /** Compared with the checker’s catch and false alarm rates. */
  checkerDraw: number;
  jitter: Record<TierId, number>;
}

export interface CascadeResult {
  requestId: number;
  difficulty: Difficulty;
  /** Models called, in order. */
  tiers: TierId[];
  pass: boolean;
  latencySeconds: number;
  cost: number;
  misrouted: boolean;
  escalated: boolean;
  /** The checker let a failing Small answer through. */
  missedBad: boolean;
  /** The checker escalated a Small answer that would have passed. */
  falseAlarm: boolean;
}

export interface CascadeLane {
  strategy: StrategyId;
  label: string;
  results: CascadeResult[];
}

export interface CascadeEvent {
  tick: number;
  text: string;
  marker: boolean;
}

export interface CascadeSummary {
  strategy: StrategyId | 'medium';
  handled: number;
  passed: number;
  passRate: number;
  p95Seconds: number;
  costPer1k: number;
  escalations: number;
  misroutes: number;
}

export const CASCADE_SEED = EVAL_SEED;

export const mixes: Record<MixId, Mix> = {
  easy: { id: 'easy', label: 'Mostly easy questions', diff: '48 easy, 12 hard', easy: 48, hard: 12 },
  hard: { id: 'hard', label: 'Mostly hard questions', diff: '18 easy, 42 hard', easy: 18, hard: 42 },
};

export const mixOrder: MixId[] = ['easy', 'hard'];

/** Toy chance that each tier’s answer passes the rubric. */
export const PASS_CHANCE: Record<TierId, Record<Difficulty, number>> = {
  small: { easy: 0.95, hard: 0.35 },
  medium: { easy: 0.98, hard: 0.85 },
};

/** A tiny pre-call classifier: right 90% of the time, fast, and nearly free. */
export const CLASSIFIER = { accuracy: 0.9, seconds: 0.05, cost: 0.05 };

/** A schema check plus a confidence score on Small’s answer. */
export const CHECKER = { catchRate: 0.85, falseAlarmRate: 0.05, seconds: 0.03, cost: 0.02 };

export const strategyLabels: Record<StrategyId, string> = {
  routing: 'Routing',
  cascade: 'Cascade',
};

export const budgetNames: Record<BudgetName, string> = {
  quality: 'quality',
  latency: 'p95 latency',
  cost: 'cost',
};

/** Same rule as lesson 1: Small answering a typical question costs one unit. */
const TYPICAL_TOKENS = PROMPT_TOKENS + 75;

const other: Record<Difficulty, Difficulty> = { easy: 'hard', hard: 'easy' };

/** The same mix and seed always yield the same questions in the same order. */
export function buildWorkload(mixId: MixId, seed = CASCADE_SEED): GatewayRequest[] {
  const mix = mixes[mixId];
  const kinds: Difficulty[] = [
    ...Array.from({ length: mix.easy }, () => 'easy' as const),
    ...Array.from({ length: mix.hard }, () => 'hard' as const),
  ];
  shuffle(kinds, createRng(hashString(`${seed}:${mixId}:order`)));
  return kinds.map((difficulty, index) => {
    const rng = createRng(hashString(`${seed}:${mixId}:${index}`));
    const outputTokens = difficulty === 'easy' ? randomInt(rng, 40, 80) : randomInt(rng, 80, 130);
    const passes = {
      small: rng() < PASS_CHANCE.small[difficulty],
      medium: rng() < PASS_CHANCE.medium[difficulty],
    };
    const predicted = rng() < CLASSIFIER.accuracy ? difficulty : other[difficulty];
    const checkerDraw = rng();
    const jitter = { small: rng(), medium: rng() };
    return { id: index + 1, difficulty, outputTokens, passes, predicted, checkerDraw, jitter };
  });
}

export function tierLatency(tier: TierId, request: GatewayRequest): number {
  const candidate = candidates[tier];
  const firstToken = candidate.firstTokenSeconds * (1 + 0.5 * request.jitter[tier]);
  return round(firstToken + request.outputTokens * candidate.secondsPerToken);
}

export function tierCost(tier: TierId, request: GatewayRequest): number {
  return round((candidates[tier].priceRatio * (PROMPT_TOKENS + request.outputTokens)) / TYPICAL_TOKENS);
}

const blank = { misrouted: false, escalated: false, missedBad: false, falseAlarm: false };

/** Routing: the classifier picks one model up front, then that model answers. */
export function routeRequest(request: GatewayRequest): CascadeResult {
  const tier: TierId = request.predicted === 'easy' ? 'small' : 'medium';
  return {
    ...blank,
    requestId: request.id,
    difficulty: request.difficulty,
    tiers: [tier],
    pass: request.passes[tier],
    latencySeconds: round(CLASSIFIER.seconds + tierLatency(tier, request)),
    cost: round(CLASSIFIER.cost + tierCost(tier, request)),
    misrouted: request.predicted !== request.difficulty,
  };
}

/** Cascade: Small answers first; a rejected answer escalates to Medium, which costs both calls. */
export function cascadeRequest(request: GatewayRequest): CascadeResult {
  const smallPass = request.passes.small;
  const escalate = smallPass
    ? request.checkerDraw < CHECKER.falseAlarmRate
    : request.checkerDraw < CHECKER.catchRate;
  const first = tierLatency('small', request) + CHECKER.seconds;
  const firstCost = tierCost('small', request) + CHECKER.cost;
  if (!escalate) {
    return {
      ...blank,
      requestId: request.id,
      difficulty: request.difficulty,
      tiers: ['small'],
      pass: smallPass,
      latencySeconds: round(first),
      cost: round(firstCost),
      missedBad: !smallPass,
    };
  }
  return {
    ...blank,
    requestId: request.id,
    difficulty: request.difficulty,
    tiers: ['small', 'medium'],
    pass: request.passes.medium,
    latencySeconds: round(first + tierLatency('medium', request)),
    cost: round(firstCost + tierCost('medium', request)),
    escalated: true,
    falseAlarm: smallPass,
  };
}

/** The lesson 1 baseline: every question goes to Medium. */
export function mediumRequest(request: GatewayRequest): CascadeResult {
  return {
    ...blank,
    requestId: request.id,
    difficulty: request.difficulty,
    tiers: ['medium'],
    pass: request.passes.medium,
    latencySeconds: tierLatency('medium', request),
    cost: tierCost('medium', request),
  };
}

type FirstKind = 'misrouteHard' | 'misrouteEasy' | 'escalation' | 'falseAlarm' | 'missedBad';

export class CascadeDuel {
  readonly mix: Mix;
  readonly workload: GatewayRequest[];
  readonly length: number;
  readonly lanes: CascadeLane[];
  readonly events: CascadeEvent[] = [];
  private readonly seen = new Set<FirstKind>();
  private tickCount = 0;

  constructor(mixId: MixId, seed = CASCADE_SEED) {
    this.mix = mixes[mixId];
    this.workload = buildWorkload(mixId, seed);
    this.length = this.workload.length;
    this.lanes = (['routing', 'cascade'] as const).map((strategy) => ({
      strategy,
      label: strategyLabels[strategy],
      results: [],
    }));
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** The request handled on the latest tick, if any. */
  get current(): GatewayRequest | undefined {
    return this.workload[this.tickCount - 1];
  }

  /** Send one request through both lanes. */
  step(): void {
    const request = this.workload[this.tickCount];
    if (!request) return;
    this.tickCount += 1;
    const routed = routeRequest(request);
    const cascaded = cascadeRequest(request);
    this.lanes[0]?.results.push(routed);
    this.lanes[1]?.results.push(cascaded);
    for (const text of this.firstTimeNotes(request, routed, cascaded)) {
      this.events.push({ tick: this.tickCount, text, marker: true });
    }
    if (this.done) this.events.push({ tick: this.tickCount, text: this.wrapUp(), marker: false });
  }

  private once(kind: FirstKind): boolean {
    if (this.seen.has(kind)) return false;
    this.seen.add(kind);
    return true;
  }

  private firstTimeNotes(request: GatewayRequest, routed: CascadeResult, cascaded: CascadeResult): string[] {
    const notes: string[] = [];
    if (routed.misrouted && request.difficulty === 'hard' && this.once('misrouteHard')) {
      notes.push(
        `Routing misroute: the classifier called this hard question easy and sent it to Small, which ${
          routed.pass ? 'got lucky and passed' : 'failed'
        }. Misroutes cost quality.`,
      );
    }
    if (routed.misrouted && request.difficulty === 'easy' && this.once('misrouteEasy')) {
      notes.push(
        `Routing misroute: the classifier called this easy question hard, so routing paid Medium prices (${formatUnits(
          routed.cost,
        )} units) where Small would have cost ${formatUnits(tierCost('small', request))}.`,
      );
    }
    if (cascaded.escalated && !cascaded.falseAlarm && this.once('escalation')) {
      notes.push(
        `Cascade escalation: the checker rejected Small’s answer, so Medium answered too. The request paid for both calls: ${formatSeconds(
          cascaded.latencySeconds,
        )} and ${formatUnits(cascaded.cost)} units.`,
      );
    }
    if (cascaded.falseAlarm && this.once('falseAlarm')) {
      notes.push(
        'Cascade false alarm: Small’s answer was fine, but the checker flagged it, so the cascade paid for Medium anyway.',
      );
    }
    if (cascaded.missedBad && this.once('missedBad')) {
      notes.push(
        'Cascade miss: Small’s answer was wrong, but the checker let it through. A cascade is only as good as its checker.',
      );
    }
    return notes;
  }

  private wrapUp(): string {
    const [routing, cascade] = this.lanes.map(summarizeCascadeLane);
    const medium = mediumOnlySummary(this.mix.id);
    if (!routing || !cascade) return '';
    const verdict = (summary: CascadeSummary, name: string) => {
      const misses = missedBudgets(summary);
      return misses.length === 0
        ? `${name} fits every budget`
        : `${name} misses ${joinNames(misses.map((b) => budgetNames[b]))}`;
    };
    const mediumCost = medium.costPer1k.toLocaleString('en-US');
    return `After ${this.length} requests, the cascade escalated ${cascade.escalations} and routing misrouted ${routing.misroutes}. Medium alone would cost ${mediumCost} units per 1,000. Against lesson 1’s budgets: ${verdict(routing, 'routing')}; ${verdict(cascade, 'the cascade')}.`;
  }
}

export function summarizeResults(
  strategy: CascadeSummary['strategy'],
  results: CascadeResult[],
): CascadeSummary {
  const handled = results.length;
  const passed = results.filter((r) => r.pass).length;
  const latencies = results.map((r) => r.latencySeconds).sort((a, b) => a - b);
  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  return {
    strategy,
    handled,
    passed,
    passRate: handled === 0 ? 0 : passed / handled,
    p95Seconds: percentile(latencies, 0.95),
    costPer1k: handled === 0 ? 0 : Math.round((totalCost / handled) * 1000),
    escalations: results.filter((r) => r.escalated).length,
    misroutes: results.filter((r) => r.misrouted).length,
  };
}

export function summarizeCascadeLane(lane: CascadeLane): CascadeSummary {
  return summarizeResults(lane.strategy, lane.results);
}

/** Medium alone on the same requests, for the baseline sentence. */
export function mediumOnlySummary(mixId: MixId, seed = CASCADE_SEED): CascadeSummary {
  return summarizeResults('medium', buildWorkload(mixId, seed).map(mediumRequest));
}

/** Summaries for a finished duel, for prose and tests that only need the final numbers. */
export function finishedCascadeSummaries(mixId: MixId, seed = CASCADE_SEED): CascadeSummary[] {
  const duel = new CascadeDuel(mixId, seed);
  while (!duel.done) duel.step();
  return duel.lanes.map(summarizeCascadeLane);
}

/** Lesson 1’s pass, p95, and cost budgets. This workload has no must decline cases. */
export function missedBudgets(summary: CascadeSummary, budgets: Budgets = DEFAULT_BUDGETS): BudgetName[] {
  const missed: BudgetName[] = [];
  if (summary.passRate < budgets.minPassRate) missed.push('quality');
  if (summary.p95Seconds > budgets.maxP95Seconds) missed.push('latency');
  if (summary.costPer1k > budgets.maxCostPer1k) missed.push('cost');
  return missed;
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

function formatUnits(value: number): string {
  return value.toFixed(2);
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
