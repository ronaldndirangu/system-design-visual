/**
 * A toy multi-tenant support assistant for the AI systems capstone. Two
 * pipelines handle the same fixture requests with the same fixture model
 * outputs: a prototype with no guards, and a guarded design. Only the system
 * around the model differs. No model is called; every score, cost, and budget
 * is illustrative, and every answer is a fixture written for this lesson.
 */
export type TenantId = 'harbor' | 'pine';
export type Role = 'customer' | 'staff';
export type PipelineId = 'prototype' | 'guarded';
export type StageId = 'gateway' | 'cache' | 'retrieve' | 'model' | 'checks' | 'staff' | 'tool';
export type Outcome = 'answered' | 'handoff' | 'refunded' | 'declined' | 'budget';
export type Harm = 'leak' | 'unsupported' | 'badRefund' | 'starved';
export type EndStatus = 'ok' | 'warn' | 'bad';
export type CapstoneScenarioId = 'leak' | 'weak' | 'refund' | 'budget';

export interface Tenant {
  id: TenantId;
  name: string;
  short: string;
  initial: string;
}

export interface SupportDoc {
  id: string;
  tenant: TenantId;
  staffOnly: boolean;
  title: string;
  /** What an answer grounded in this document says. */
  says: string;
}

export interface SearchHit {
  doc: string;
  /** Relevance from a search over every store’s documents. Illustrative. */
  score: number;
}

export interface RefundAsk {
  order: string;
  amount: number;
  /** Whether the store’s policy allows this refund. */
  valid: boolean;
  /** The reviewer’s reason, written as a fixture. */
  reason: string;
}

export interface SupportRequest {
  id: string;
  tenant: TenantId;
  role: Role;
  text: string;
  /** Policy questions are cacheable. Questions about one customer’s order are not. */
  cacheable: boolean;
  /** Top hits over every store’s documents, best first. */
  hits: SearchHit[];
  /** The fixture answer states this, and no retrieved document supports it. */
  invents?: string;
  /** The fixture answer cites this document id instead of the best hit. */
  cites?: string;
  /** The fixture model output is a refund tool call. */
  refund?: RefundAsk;
}

export interface CapstoneScenario {
  id: CapstoneScenarioId;
  label: string;
  diff: string;
  /** Model budget for the run in cost units. The guarded design splits it evenly per store. */
  pool: number;
  requests: SupportRequest[];
}

export interface RequestResult {
  request: SupportRequest;
  outcome: Outcome;
  harm?: Harm;
  status: EndStatus;
  /** Stages the request visited, in order. */
  path: StageId[];
  cost: number;
  cites: string[];
  fromCache: boolean;
  note: string;
}

export interface PipelineSummary {
  pipeline: PipelineId;
  handled: number;
  answered: number;
  fromCache: number;
  cited: number;
  handoff: number;
  refunded: number;
  declined: number;
  budget: number;
  staffTouches: number;
  spent: number;
  spentBy: Record<TenantId, number>;
  harms: Record<Harm, number>;
  totalHarms: number;
  wrongRefundTotal: number;
}

export const EVIDENCE_THRESHOLD = 0.6;
export const MODEL_CALL_UNITS = 3;
export const PROMPT_VERSION = 'v3';

export const tenants: Record<TenantId, Tenant> = {
  harbor: { id: 'harbor', name: 'Harbor Bikes', short: 'Harbor', initial: 'H' },
  pine: { id: 'pine', name: 'Pine Street Books', short: 'Pine', initial: 'P' },
};

export const pipelineLabels: Record<PipelineId, string> = {
  prototype: 'Prototype (no guards)',
  guarded: 'Guarded design',
};

export const stageOrder: StageId[] = ['gateway', 'cache', 'retrieve', 'model', 'checks', 'staff', 'tool'];

export const harmLabels: Record<Harm, string> = {
  leak: 'Leaked another store’s or staff only data',
  unsupported: 'Answered without evidence',
  badRefund: 'Refunded against policy or twice',
  starved: 'Refused because another store spent the budget',
};

export const harmOrder: Harm[] = ['leak', 'unsupported', 'badRefund', 'starved'];

export const supportDocs: SupportDoc[] = [
  {
    id: 'harbor/returns',
    tenant: 'harbor',
    staffOnly: false,
    title: 'Harbor returns policy',
    says: 'Unused bikes and parts come back within 30 days.',
  },
  {
    id: 'harbor/shipping',
    tenant: 'harbor',
    staffOnly: false,
    title: 'Harbor delivery times',
    says: 'Bikes arrive in 3 to 5 working days.',
  },
  {
    id: 'harbor/warranty',
    tenant: 'harbor',
    staffOnly: false,
    title: 'Harbor frame warranty',
    says: 'Bike frames carry a 2 year warranty.',
  },
  {
    id: 'harbor/refund-review',
    tenant: 'harbor',
    staffOnly: true,
    title: 'Harbor refund review rules (staff only)',
    says: 'Refunds over $200 need a second reviewer, and accounts with 3 refunds in 30 days get flagged.',
  },
  {
    id: 'harbor/recall',
    tenant: 'harbor',
    staffOnly: false,
    title: 'Harbor brake recall notice',
    says: 'Trail 3 bikes get a free brake repair. Stop riding until it is done.',
  },
  {
    id: 'pine/returns',
    tenant: 'pine',
    staffOnly: false,
    title: 'Pine Street returns policy',
    says: 'Books come back within 14 days with a receipt.',
  },
  {
    id: 'pine/ebooks',
    tenant: 'pine',
    staffOnly: false,
    title: 'Pine Street ebook policy',
    says: 'Ebooks are final sale once downloaded.',
  },
  {
    id: 'pine/gift-cards',
    tenant: 'pine',
    staffOnly: false,
    title: 'Pine Street gift cards',
    says: 'Gift cards come in any amount from $10 to $200.',
  },
  {
    id: 'pine/preorders',
    tenant: 'pine',
    staffOnly: false,
    title: 'Pine Street preorders',
    says: 'Preorders ship on release day and are charged when they ship.',
  },
  {
    id: 'pine/shipping',
    tenant: 'pine',
    staffOnly: false,
    title: 'Pine Street shipping',
    says: 'Pine Street ships to the US and Canada.',
  },
];

const docById = new Map(supportDocs.map((doc) => [doc.id, doc]));

export function getDoc(id: string): SupportDoc | undefined {
  return docById.get(id);
}

const returnWindow = 'What is your return window?';

export const capstoneScenarios: Record<CapstoneScenarioId, CapstoneScenario> = {
  leak: {
    id: 'leak',
    label: 'Tenant leak probe',
    diff: '6 requests. Both stores ask the same cached question, a Pine customer asks about bikes, and a Harbor customer asks about staff only rules. Pool 60 units.',
    pool: 60,
    requests: [
      {
        id: 'L1',
        tenant: 'harbor',
        role: 'customer',
        text: returnWindow,
        cacheable: true,
        hits: [
          { doc: 'harbor/returns', score: 0.88 },
          { doc: 'pine/returns', score: 0.86 },
        ],
      },
      {
        id: 'L2',
        tenant: 'pine',
        role: 'customer',
        text: returnWindow,
        cacheable: true,
        hits: [
          { doc: 'pine/returns', score: 0.88 },
          { doc: 'harbor/returns', score: 0.86 },
        ],
      },
      {
        id: 'L3',
        tenant: 'pine',
        role: 'customer',
        text: 'Do bikes come with a warranty?',
        cacheable: true,
        hits: [
          { doc: 'harbor/warranty', score: 0.84 },
          { doc: 'pine/returns', score: 0.31 },
        ],
      },
      {
        id: 'L4',
        tenant: 'harbor',
        role: 'customer',
        text: 'How do you decide when to flag a refund?',
        cacheable: true,
        hits: [
          { doc: 'harbor/refund-review', score: 0.79 },
          { doc: 'harbor/returns', score: 0.48 },
        ],
      },
      {
        id: 'L5',
        tenant: 'harbor',
        role: 'staff',
        text: 'When does a refund need a second review?',
        cacheable: true,
        hits: [
          { doc: 'harbor/refund-review', score: 0.86 },
          { doc: 'harbor/returns', score: 0.44 },
        ],
      },
      {
        id: 'L6',
        tenant: 'pine',
        role: 'customer',
        text: returnWindow,
        cacheable: true,
        hits: [
          { doc: 'pine/returns', score: 0.88 },
          { doc: 'harbor/returns', score: 0.86 },
        ],
      },
    ],
  },
  weak: {
    id: 'weak',
    label: 'Weak evidence',
    diff: '5 requests. Two have no document that answers them, and one gets an answer that cites a document search never returned. Evidence gate 0.6.',
    pool: 60,
    requests: [
      {
        id: 'W1',
        tenant: 'pine',
        role: 'customer',
        text: 'Can I return a book I bought 10 days ago?',
        cacheable: true,
        hits: [
          { doc: 'pine/returns', score: 0.86 },
          { doc: 'harbor/returns', score: 0.71 },
        ],
      },
      {
        id: 'W2',
        tenant: 'pine',
        role: 'customer',
        text: 'Can I return a signed first edition?',
        cacheable: true,
        hits: [
          { doc: 'pine/returns', score: 0.52 },
          { doc: 'harbor/returns', score: 0.45 },
        ],
        invents: 'promised that signed copies come back like any book',
      },
      {
        id: 'W3',
        tenant: 'harbor',
        role: 'customer',
        text: 'Do you match a lower price from another shop?',
        cacheable: true,
        hits: [
          { doc: 'harbor/returns', score: 0.41 },
          { doc: 'pine/returns', score: 0.37 },
        ],
        invents: 'promised a price match that no policy offers',
      },
      {
        id: 'W4',
        tenant: 'harbor',
        role: 'customer',
        text: 'How long does delivery take?',
        cacheable: true,
        hits: [
          { doc: 'harbor/shipping', score: 0.81 },
          { doc: 'pine/shipping', score: 0.74 },
        ],
      },
      {
        id: 'W5',
        tenant: 'pine',
        role: 'customer',
        text: 'Is there a student discount?',
        cacheable: true,
        hits: [
          { doc: 'pine/gift-cards', score: 0.62 },
          { doc: 'pine/returns', score: 0.4 },
        ],
        invents: 'offered 10% off for students',
        cites: 'pine/student-discount',
      },
    ],
  },
  refund: {
    id: 'refund',
    label: 'Refund requests',
    diff: '4 requests. The model asks for a refund every time: one valid, two against policy, and one double submit of the valid one.',
    pool: 60,
    requests: [
      {
        id: 'F1',
        tenant: 'harbor',
        role: 'customer',
        text: 'Order 2201, a bike light, arrived broken. Please refund it.',
        cacheable: false,
        hits: [{ doc: 'harbor/returns', score: 0.83 }],
        refund: { order: '2201', amount: 45, valid: true, reason: 'broken on arrival and inside 30 days' },
      },
      {
        id: 'F2',
        tenant: 'pine',
        role: 'customer',
        text: 'I did not like the ebook I downloaded. Refund order 3310.',
        cacheable: false,
        hits: [{ doc: 'pine/ebooks', score: 0.84 }],
        refund: { order: '3310', amount: 12, valid: false, reason: 'ebooks are final sale once downloaded' },
      },
      {
        id: 'F3',
        tenant: 'harbor',
        role: 'customer',
        text: 'Refund order 2207. I rode the bike for 50 days and changed my mind.',
        cacheable: false,
        hits: [{ doc: 'harbor/returns', score: 0.79 }],
        refund: {
          order: '2207',
          amount: 640,
          valid: false,
          reason: 'the bike is used and past the 30 day window',
        },
      },
      {
        id: 'F4',
        tenant: 'harbor',
        role: 'customer',
        text: 'Order 2201, a bike light, arrived broken. Please refund it.',
        cacheable: false,
        hits: [{ doc: 'harbor/returns', score: 0.83 }],
        refund: { order: '2201', amount: 45, valid: true, reason: 'broken on arrival and inside 30 days' },
      },
    ],
  },
  budget: {
    id: 'budget',
    label: 'Budget runs out',
    diff: '9 requests. A brake recall sends Harbor 6 new questions while Pine asks 3. Pool 20 units: shared, or 10 per store.',
    pool: 20,
    requests: [
      recallQuestion('B1', 'Is the Trail 3 bike part of the brake recall?', 0.86),
      recallQuestion('B2', 'How do I book a recall repair?', 0.82),
      recallQuestion('B3', 'Can I ride my bike before the repair?', 0.77),
      pineQuestion('B4', 'Do you sell gift cards?', 'pine/gift-cards', 0.88),
      recallQuestion('B5', 'Does the recall repair cost anything?', 0.84),
      recallQuestion('B6', 'Do I need my receipt for the recall?', 0.73),
      recallQuestion('B7', 'How long does a recall repair take?', 0.8),
      pineQuestion('B8', 'Can I preorder a book that is not out yet?', 'pine/preorders', 0.85),
      pineQuestion('B9', 'Do you ship to Canada?', 'pine/shipping', 0.83),
    ],
  },
};

export const capstoneScenarioOrder: CapstoneScenarioId[] = ['leak', 'weak', 'refund', 'budget'];

function recallQuestion(id: string, text: string, score: number): SupportRequest {
  return {
    id,
    tenant: 'harbor',
    role: 'customer',
    text,
    cacheable: true,
    hits: [{ doc: 'harbor/recall', score }],
  };
}

function pineQuestion(id: string, text: string, doc: string, score: number): SupportRequest {
  return { id, tenant: 'pine', role: 'customer', text, cacheable: true, hits: [{ doc, score }] };
}

interface CacheEntry {
  doc: string;
  cites: string[];
}

function mayRead(request: SupportRequest, doc: SupportDoc): boolean {
  return doc.tenant === request.tenant && (!doc.staffOnly || request.role === 'staff');
}

function whoAsked(request: SupportRequest): string {
  return `${tenants[request.tenant].short} ${request.role}`;
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

/** Why a document is out of bounds for this request, or undefined if it is allowed. */
function blockReason(request: SupportRequest, doc: SupportDoc): string | undefined {
  if (doc.tenant !== request.tenant) return `a ${tenants[doc.tenant].short} document`;
  if (doc.staffOnly && request.role !== 'staff') return 'a staff only document';
  return undefined;
}

export class SupportPipeline {
  readonly id: PipelineId;
  readonly results: RequestResult[] = [];
  readonly spentBy: Record<TenantId, number> = { harbor: 0, pine: 0 };
  private readonly pool: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly refunded = new Set<string>();

  constructor(id: PipelineId, pool: number) {
    this.id = id;
    this.pool = pool;
  }

  get guarded(): boolean {
    return this.id === 'guarded';
  }

  get spent(): number {
    return this.spentBy.harbor + this.spentBy.pine;
  }

  get share(): number {
    return this.pool / 2;
  }

  cacheKey(request: SupportRequest): string {
    const text = request.text.trim().toLowerCase();
    return this.guarded ? `${request.tenant}|${request.role}|${PROMPT_VERSION}|${text}` : text;
  }

  handle(request: SupportRequest): RequestResult {
    const result = this.route(request);
    this.results.push(result);
    return result;
  }

  private route(request: SupportRequest): RequestResult {
    const path: StageId[] = ['gateway', 'cache'];
    const key = this.cacheKey(request);
    const done = (fields: Omit<RequestResult, 'request' | 'path' | 'status'>): RequestResult => ({
      request,
      path,
      status: fields.harm
        ? 'bad'
        : fields.outcome === 'handoff' || fields.outcome === 'budget'
          ? 'warn'
          : 'ok',
      ...fields,
    });

    const cached = request.cacheable ? this.cache.get(key) : undefined;
    if (cached) {
      const doc = getDoc(cached.doc);
      const reason = doc ? blockReason(request, doc) : undefined;
      return done({
        outcome: 'answered',
        harm: reason ? 'leak' : undefined,
        cost: 0,
        cites: cached.cites,
        fromCache: true,
        note: reason
          ? `Cache hit on the question text alone served an answer built from ${reason}: “${doc?.says}”`
          : `Cache hit on store, role, prompt version, and question. Served the cited answer for 0 units.`,
      });
    }

    const used = this.guarded ? this.spentBy[request.tenant] : this.spent;
    const limit = this.guarded ? this.share : this.pool;
    if (used + MODEL_CALL_UNITS > limit) {
      path.push('staff');
      // Same rule in both pipelines: the store could still afford this call inside its even share.
      const starved = this.spentBy[request.tenant] + MODEL_CALL_UNITS <= this.share;
      const tenant = tenants[request.tenant].short;
      return done({
        outcome: 'budget',
        harm: starved ? 'starved' : undefined,
        cost: 0,
        cites: [],
        fromCache: false,
        note: this.guarded
          ? `${tenant} has used ${used} of its ${limit} unit share, so the gateway hands this to staff. The other store keeps its share.`
          : starved
            ? `The shared pool has ${limit - used} of ${limit} units left. ${tenant} used only ${this.spentBy[request.tenant]}: the other store spent the rest. Handed to staff.`
            : `The shared pool has ${limit - used} of ${limit} units left, under the ${MODEL_CALL_UNITS} a model call needs. Handed to staff.`,
      });
    }

    path.push('retrieve');
    const allowed = this.guarded
      ? request.hits.filter((hit) => {
          const doc = getDoc(hit.doc);
          return doc ? mayRead(request, doc) : false;
        })
      : request.hits;
    const best = allowed[0];
    if (this.guarded && (!best || best.score < EVIDENCE_THRESHOLD)) {
      path.push('staff');
      const top = request.hits[0];
      const topDoc = top ? getDoc(top.doc) : undefined;
      const removed = topDoc ? blockReason(request, topDoc) : undefined;
      const filtered = removed && topDoc ? `Filters removed ${topDoc.title}, ${removed}. ` : '';
      const evidence = best
        ? `Best evidence this ${request.role} may read scored ${best.score.toFixed(2)}`
        : 'Nothing left';
      return done({
        outcome: 'handoff',
        cost: 0,
        cites: [],
        fromCache: false,
        note: `${filtered}${evidence}, under the ${EVIDENCE_THRESHOLD} gate. Abstained and handed the question to staff.`,
      });
    }
    if (!best) throw new Error(`Request ${request.id} has no search hits`);

    path.push('model');
    this.spentBy[request.tenant] += MODEL_CALL_UNITS;
    const cite = request.cites ?? best.doc;

    if (this.guarded) {
      path.push('checks');
      if (!allowed.some((hit) => hit.doc === cite)) {
        path.push('staff');
        return done({
          outcome: 'handoff',
          cost: MODEL_CALL_UNITS,
          cites: [],
          fromCache: false,
          note: `The answer cited ${cite}, a document search never returned. Checks rejected it and handed the question to staff.`,
        });
      }
    }

    if (request.refund) return this.refund(request, request.refund, path, done);

    const doc = getDoc(best.doc);
    const reason = doc ? blockReason(request, doc) : undefined;
    const harm: Harm | undefined = reason ? 'leak' : request.invents ? 'unsupported' : undefined;
    const cites = this.guarded ? [cite] : [];
    if (request.cacheable) this.cache.set(key, { doc: best.doc, cites });
    const title = doc?.title ?? best.doc;
    let note: string;
    if (reason)
      note = `Searched every store and answered a ${whoAsked(request)} from ${reason}: “${doc?.says}”`;
    else if (request.invents)
      note = `No retrieved document supports the answer: the fixture model ${request.invents}.`;
    else
      note = this.guarded
        ? `Answered from ${title} and cited ${cite}.`
        : `Answered from ${title}, with no citation.`;
    return done({ outcome: 'answered', harm, cost: MODEL_CALL_UNITS, cites, fromCache: false, note });
  }

  private refund(
    request: SupportRequest,
    ask: RefundAsk,
    path: StageId[],
    done: (fields: Omit<RequestResult, 'request' | 'path' | 'status'>) => RequestResult,
  ): RequestResult {
    const amount = money(ask.amount);
    const base = { cost: MODEL_CALL_UNITS, fromCache: false };
    const duplicate = this.refunded.has(ask.order);
    if (!this.guarded) {
      path.push('tool');
      this.refunded.add(ask.order);
      const harm: Harm | undefined = duplicate || !ask.valid ? 'badRefund' : undefined;
      return done({
        ...base,
        outcome: 'refunded',
        harm,
        cites: [],
        note: duplicate
          ? `The double submit ran the ${amount} refund for order ${ask.order} a second time.`
          : ask.valid
            ? `The tool ran the ${amount} refund for order ${ask.order} at once. This one happened to be valid.`
            : `The tool ran the ${amount} refund for order ${ask.order} at once, though ${ask.reason}.`,
      });
    }
    const cites = [request.hits[0]?.doc ?? ''];
    if (duplicate) {
      path.push('tool');
      return done({
        ...base,
        outcome: 'answered',
        cites,
        note: `Idempotency key refund:${ask.order} already exists, so the tool returned the first result. No second refund.`,
      });
    }
    path.push('staff');
    if (!ask.valid) {
      return done({
        ...base,
        outcome: 'declined',
        cites,
        note: `The model proposed a ${amount} refund for order ${ask.order}. Staff declined it: ${ask.reason}.`,
      });
    }
    path.push('tool');
    this.refunded.add(ask.order);
    return done({
      ...base,
      outcome: 'refunded',
      cites,
      note: `The model proposed a ${amount} refund for order ${ask.order}. Staff approved it (${ask.reason}), and the tool ran it once under key refund:${ask.order}.`,
    });
  }
}

export class CapstoneRun {
  readonly scenario: CapstoneScenario;
  readonly length: number;
  readonly lanes: [SupportPipeline, SupportPipeline];
  private tickCount = 0;

  constructor(scenarioId: CapstoneScenarioId) {
    this.scenario = capstoneScenarios[scenarioId];
    this.length = this.scenario.requests.length;
    this.lanes = [
      new SupportPipeline('prototype', this.scenario.pool),
      new SupportPipeline('guarded', this.scenario.pool),
    ];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** The request handled on the latest tick, if any. */
  get current(): SupportRequest | undefined {
    return this.scenario.requests[this.tickCount - 1];
  }

  /** Send the next request through both pipelines. */
  step(): void {
    const request = this.scenario.requests[this.tickCount];
    if (!request) return;
    this.tickCount += 1;
    for (const lane of this.lanes) lane.handle(request);
  }

  finish(): void {
    while (!this.done) this.step();
  }
}

export function summarizePipeline(pipeline: SupportPipeline): PipelineSummary {
  const results = pipeline.results;
  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
  const harms: Record<Harm, number> = { leak: 0, unsupported: 0, badRefund: 0, starved: 0 };
  let wrongRefundTotal = 0;
  for (const result of results) {
    if (!result.harm) continue;
    harms[result.harm] += 1;
    if (result.harm === 'badRefund') wrongRefundTotal += result.request.refund?.amount ?? 0;
  }
  const answers = results.filter((r) => r.outcome === 'answered');
  return {
    pipeline: pipeline.id,
    handled: results.length,
    answered: answers.length,
    fromCache: answers.filter((r) => r.fromCache).length,
    cited: answers.filter((r) => r.cites.length > 0).length,
    handoff: count('handoff'),
    refunded: count('refunded'),
    declined: count('declined'),
    budget: count('budget'),
    staffTouches: results.filter((r) => r.path.includes('staff')).length,
    spent: pipeline.spent,
    spentBy: { ...pipeline.spentBy },
    harms,
    totalHarms: harmOrder.reduce((sum, harm) => sum + harms[harm], 0),
    wrongRefundTotal,
  };
}

/** Summaries for a finished scenario, for prose checks and widgets that need only the end state. */
export function finishedCapstone(scenarioId: CapstoneScenarioId): PipelineSummary[] {
  const run = new CapstoneRun(scenarioId);
  run.finish();
  return run.lanes.map(summarizePipeline);
}
