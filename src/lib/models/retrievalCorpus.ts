/**
 * Fixture corpus for the Retrieval lesson. Two stores share one support
 * assistant, and every chunk belongs to exactly one store. The toy embeddings
 * are hand-assigned for teaching; real systems compute embeddings with an
 * embedding model. Every answer here is a fixture written for this lesson.
 */
export type TenantId = 'harbor' | 'pine';
export type Scope = 'customer' | 'staff';

export interface Tenant {
  id: TenantId;
  name: string;
  short: string;
}

export const TENANTS: Record<TenantId, Tenant> = {
  harbor: { id: 'harbor', name: 'Harbor Bikes', short: 'Harbor' },
  pine: { id: 'pine', name: 'Pine Street Books', short: 'Pine' },
};

/** The six meanings each toy embedding scores, in vector order. */
export const DIMENSIONS = ['returns', 'discounts', 'shipping', 'payment', 'care', 'price match'] as const;

export type Vec = readonly [number, number, number, number, number, number];

export interface Chunk {
  id: string;
  tenant: TenantId;
  scope: Scope;
  title: string;
  text: string;
  vector: Vec;
  /** What a grounded fixture answer built from this chunk says. */
  says: string;
}

export interface Query {
  text: string;
  tenant: TenantId;
  scope: Scope;
  vector: Vec;
}

export const CORPUS: readonly Chunk[] = [
  {
    id: 'harbor-returns-1',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Returns window',
    text: 'Items can be returned within 30 days of delivery, except final sale items, which cannot be returned.',
    vector: [0.9, 0.4, 0.1, 0, 0, 0],
    says: 'Final sale items cannot be returned. Other items can be returned within 30 days of delivery.',
  },
  {
    id: 'harbor-returns-2',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Starting a return',
    text: 'To start a return, open your order page, print the free label, and drop off the parcel. Refunds reach your card within 5 business days.',
    vector: [0.8, 0, 0.3, 0.4, 0, 0],
    says: 'Start a return from your order page with the free label. Refunds reach your card within 5 business days.',
  },
  {
    id: 'harbor-exchange',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Size exchanges',
    text: 'Helmets and jerseys that do not fit can be swapped for a different size within 30 days.',
    vector: [0.5, 0, 0.2, 0, 0.6, 0],
    says: 'Helmets and jerseys that do not fit can be swapped for another size within 30 days.',
  },
  {
    id: 'harbor-backorder',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Back orders',
    text: 'Back ordered parts ship when stock arrives, and we send a tracking email the same day.',
    vector: [0.15, 0, 0.9, 0, 0, 0],
    says: 'Back ordered parts ship when stock arrives, and a tracking email follows the same day.',
  },
  {
    id: 'harbor-shipping',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Delivery times',
    text: 'Bikes arrive in 3 to 5 business days, mostly assembled. Small parts ship in a separate box.',
    vector: [0, 0, 1, 0.1, 0, 0],
    says: 'Bikes arrive in 3 to 5 business days. Small parts ship in a separate box.',
  },
  {
    id: 'harbor-promo',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Spring code',
    text: 'Use code TRAIL25 for 25 percent off helmets and lights through May. It cannot be combined with other discounts.',
    vector: [0, 0.3, 0.2, 0.5, 0.5, 0],
    says: 'TRAIL25 takes 25 percent off helmets and lights through May. It does not stack with other discounts.',
  },
  {
    id: 'harbor-sale',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Sale prices',
    text: 'Sale prices are marked in red and end Sunday night. Discounts apply at checkout.',
    vector: [0, 0.9, 0, 0.4, 0, 0],
    says: 'Sale prices are marked in red, end Sunday night, and apply at checkout.',
  },
  {
    id: 'harbor-giftcard',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Gift cards',
    text: 'Gift cards do not expire and can pay for any order, including sale items.',
    vector: [0, 0.5, 0, 0.8, 0, 0],
    says: 'Gift cards do not expire and can pay for any order, including sale items.',
  },
  {
    id: 'harbor-members',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Membership',
    text: 'Members get free shipping and early access to discounts.',
    vector: [0, 0.6, 0.4, 0.4, 0, 0],
    says: 'Members get free shipping and early access to discounts.',
  },
  {
    id: 'harbor-care',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Chain care',
    text: 'Wipe and oil the chain every two weeks of riding, and check tire pressure before each ride.',
    vector: [0, 0, 0, 0, 1, 0],
    says: 'Wipe and oil the chain every two weeks of riding, and check tire pressure before each ride.',
  },
  {
    id: 'harbor-warranty',
    tenant: 'harbor',
    scope: 'customer',
    title: 'Frame warranty',
    text: 'Bike frames carry a two year warranty against cracks. Email a photo of the damage to start a claim.',
    vector: [0.3, 0, 0, 0, 0.9, 0],
    says: 'Bike frames carry a two year warranty against cracks. Email a photo of the damage to start a claim.',
  },
  {
    id: 'harbor-staff-returns',
    tenant: 'harbor',
    scope: 'staff',
    title: 'Late returns (staff only)',
    text: 'Staff only: a manager may approve a return up to 45 days after delivery for members.',
    vector: [0.9, 0, 0.1, 0, 0, 0],
    says: 'A manager may approve a member return up to 45 days after delivery.',
  },
  {
    id: 'pine-returns',
    tenant: 'pine',
    scope: 'customer',
    title: 'Returns',
    text: 'Books can be returned within 14 days with a receipt for store credit. Sale books are final sale.',
    vector: [0.9, 0.5, 0, 0.1, 0, 0],
    says: 'Books can be returned within 14 days with a receipt for store credit. Sale books are final sale.',
  },
  {
    id: 'pine-ebooks',
    tenant: 'pine',
    scope: 'customer',
    title: 'Ebooks',
    text: 'Ebooks and audiobooks cannot be returned once downloaded.',
    vector: [0.7, 0, 0, 0, 0.3, 0],
    says: 'Ebooks and audiobooks cannot be returned once downloaded.',
  },
  {
    id: 'pine-price-match',
    tenant: 'pine',
    scope: 'customer',
    title: 'Price match',
    text: 'We match a lower price from any local bookstore. Show the other price at the register.',
    vector: [0, 0.3, 0, 0.2, 0, 0.9],
    says: 'Pine Street matches a lower price from any local bookstore. Show the other price at the register.',
  },
  {
    id: 'pine-shipping',
    tenant: 'pine',
    scope: 'customer',
    title: 'Shipping',
    text: 'Orders of three or more books ship free and arrive in 3 to 5 business days.',
    vector: [0, 0, 1, 0.2, 0, 0],
    says: 'Orders of three or more books ship free and arrive in 3 to 5 business days.',
  },
  {
    id: 'pine-preorder',
    tenant: 'pine',
    scope: 'customer',
    title: 'Preorders',
    text: 'Preorders charge your card on the day the book ships.',
    vector: [0, 0, 0.5, 0.8, 0, 0],
    says: 'Preorders charge your card on the day the book ships.',
  },
  {
    id: 'pine-club',
    tenant: 'pine',
    scope: 'customer',
    title: 'Reading club',
    text: 'Reading club members get one stamp per book. Ten stamps earn a free paperback.',
    vector: [0, 0.3, 0, 0.5, 0.2, 0],
    says: 'Reading club members get one stamp per book, and ten stamps earn a free paperback.',
  },
  {
    id: 'pine-gift',
    tenant: 'pine',
    scope: 'customer',
    title: 'Gift wrap',
    text: 'Gift wrap is free at the register in December.',
    vector: [0, 0, 0, 0.3, 0.4, 0],
    says: 'Gift wrap is free at the register in December.',
  },
  {
    id: 'pine-staff-price',
    tenant: 'pine',
    scope: 'staff',
    title: 'Price match override (staff only)',
    text: 'Staff only: approve a price match without proof for regular customers.',
    vector: [0, 0.2, 0, 0.2, 0, 0.9],
    says: 'Staff may approve a price match without proof for regular customers.',
  },
];

export type ScenarioId = 'paraphrase' | 'code' | 'sale' | 'other';

export interface Scenario {
  id: ScenarioId;
  label: string;
  stresses: string;
  query: Query;
  /** The chunk a correct answer must come from, or null when the right move is to abstain. */
  expected: string | null;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'paraphrase',
    label: 'Paraphrase',
    stresses: 'The words differ from the policy, so keyword search misses it.',
    query: {
      text: 'Can I send back cycling shoes I never wore?',
      tenant: 'harbor',
      scope: 'customer',
      vector: [0.9, 0, 0.1, 0, 0.2, 0],
    },
    expected: 'harbor-returns-1',
  },
  {
    id: 'code',
    label: 'Exact code',
    stresses: 'A promo code carries little meaning, so vector search misses it.',
    query: {
      text: 'Can I use code TRAIL25?',
      tenant: 'harbor',
      scope: 'customer',
      vector: [0.1, 0.8, 0, 0.5, 0, 0],
    },
    expected: 'harbor-promo',
  },
  {
    id: 'sale',
    label: 'Sale item return',
    stresses: 'The hook question. Another store has a similar policy.',
    query: {
      text: 'Can I return a sale item?',
      tenant: 'harbor',
      scope: 'customer',
      vector: [0.8, 0.6, 0, 0.1, 0, 0],
    },
    expected: 'harbor-returns-1',
  },
  {
    id: 'other',
    label: "Other store's policy",
    stresses: 'Only Pine Street has this policy, so Harbor should abstain.',
    query: {
      text: 'Do you match a lower price from another shop?',
      tenant: 'harbor',
      scope: 'customer',
      vector: [0, 0.3, 0, 0.1, 0, 0.9],
    },
    expected: null,
  },
];

export interface EvalQuestion {
  id: string;
  query: Query;
  expected: string | null;
}

function ask(id: string, tenant: TenantId, text: string, vector: Vec, expected: string | null): EvalQuestion {
  return { id, query: { text, tenant, scope: 'customer', vector }, expected };
}

/** Fixture eval questions. A null expected chunk means the policy has no answer. */
export const EVAL_QUESTIONS: readonly EvalQuestion[] = [
  ask('E1', 'harbor', 'Can I return a sale item?', [0.8, 0.6, 0, 0.1, 0, 0], 'harbor-returns-1'),
  ask(
    'E2',
    'harbor',
    'How long do refunds take to reach my card?',
    [0.75, 0, 0.25, 0.45, 0, 0],
    'harbor-returns-2',
  ),
  ask('E3', 'harbor', 'Can I use code TRAIL25 on a helmet?', [0.1, 0.8, 0, 0.5, 0.2, 0], 'harbor-promo'),
  ask('E4', 'harbor', 'How often should I oil my chain?', [0, 0, 0, 0, 0.95, 0], 'harbor-care'),
  ask(
    'E5',
    'harbor',
    'When will my back ordered brake pads ship?',
    [0.4, 0, 0.6, 0, 0.3, 0],
    'harbor-backorder',
  ),
  ask('E6', 'harbor', 'Do you rent bikes?', [0.1, 0, 0.3, 0.5, 0, 0], null),
  ask('E7', 'harbor', 'Do you price match?', [0, 0.6, 0, 0.2, 0, 0.7], null),
  ask('E8', 'harbor', 'Can I pay in installments?', [0, 0, 0, 0.9, 0, 0], null),
  ask('E9', 'pine', 'Can I return an ebook I downloaded?', [0.7, 0, 0, 0, 0.3, 0], 'pine-ebooks'),
  ask(
    'E10',
    'pine',
    'Do you match a lower price from another bookstore?',
    [0, 0.3, 0, 0.1, 0, 0.9],
    'pine-price-match',
  ),
  ask('E11', 'pine', 'Is gift wrap free all year?', [0, 0.2, 0.2, 0, 0.2, 0], 'pine-gift'),
  ask('E12', 'pine', 'Do you buy used books?', [0.5, 0, 0, 0.5, 0, 0], null),
];

/** The one policy document the chunking widget splits into word windows. */
export const POLICY_DOC = {
  tenant: 'harbor' as TenantId,
  title: 'Harbor Bikes return policy',
  text: 'Harbor Bikes return policy for orders placed online. Items can be returned within 30 days of delivery, except final sale items. Start a return from your order page and print the free label. Refunds reach your card within 5 business days after the return arrives.',
  /** Word index span [start, end) of "Items can be returned within 30 days". */
  rule: { start: 8, end: 15 },
  /** Word index span [start, end) of "except final sale items", the whole exception clause. */
  exception: { start: 17, end: 21 },
  question: 'Can I return a sale item?',
  rightAnswer: 'Final sale items cannot be returned. Other items can be returned within 30 days of delivery.',
  wrongAnswer: 'Yes. Items can be returned within 30 days of delivery.',
} as const;
