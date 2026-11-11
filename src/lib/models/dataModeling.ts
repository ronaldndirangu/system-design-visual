import { betterIndex } from '../compare';
import { createRng, createZipf, hashString, type Rng, randomInt } from '../rng';

/**
 * Toy model of one URL shortener dataset stored three ways: relational tables,
 * one document per user, and a key-value store keyed by short code. Every query
 * runs against the same seeded users, links, and clicks. Its cost follows from
 * the records, kilobytes, index entries, and round trips each shape must touch,
 * so no number is typed in by hand. Sizes and milliseconds are illustrative:
 * they rank the shapes for each query and say nothing about a real product.
 */
export type DmShapeId = 'tables' | 'documents' | 'keyvalue';
export type DmQueryId = 'redirect' | 'create' | 'dashboard' | 'analytics' | 'takedown';
/** How a shape reaches its records: straight to a key, through a secondary index, or by reading everything. */
export type DmAccess = 'key' | 'index' | 'scan';

export const DM_USERS = 300;
export const DM_LINKS = 3000;
export const DM_CLICKS = 30_000;
/** Clicks are kept per day for this many days. */
export const DM_CLICK_DAYS = 30;
export const DM_HISTORY_DAYS = 90;
export const DM_DASHBOARD_LINKS = 20;
export const DM_TAKEDOWN_DOMAIN = 'prize-claim.example';

/** Toy sizes in KB: a user row or document header, a link row or record, one day of clicks. */
export const USER_KB = 0.1;
export const LINK_KB = 0.2;
export const DAY_KB = 0.03;

/** Toy costs: every round trip, every record or index entry, and every KB read or written. */
export const ROUND_TRIP_MS = 0.5;
export const PER_RECORD_MS = 0.005;
export const PER_KB_MS = 0.01;
/** A key-value scan returns this many keys per round trip. */
export const SCAN_PAGE_KEYS = 100;

/** One tick plays this many toy milliseconds, so one second on screen stands for 5 toy ms. */
export const MS_PER_TICK = 0.5;
export const DM_TICK_SECONDS = 0.1;
/** Each pane draws its stored data as this many squares, 1% each. */
export const GRID_CELLS = 100;

const EXPIRING_SHARE = 0.2;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DOMAINS: readonly string[] = [
  'news-daily.example',
  'shop-now.example',
  'video-hub.example',
  'docs-share.example',
  'photo-wall.example',
  'recipe-box.example',
  'music-stream.example',
  DM_TAKEDOWN_DOMAIN,
  'job-board.example',
  'travel-deals.example',
  'code-paste.example',
  'game-zone.example',
  'pet-care.example',
  'garden-tips.example',
  'bike-shop.example',
  'book-club.example',
  'film-reviews.example',
  'tech-blog.example',
  'health-notes.example',
  'home-repair.example',
  'car-parts.example',
  'kids-crafts.example',
  'study-guides.example',
  'local-events.example',
  'weather-now.example',
  'sports-scores.example',
  'art-gallery.example',
  'coffee-beans.example',
  'hiking-maps.example',
  'ticket-desk.example',
  'phone-cases.example',
  'camera-gear.example',
  'board-games.example',
  'tea-house.example',
  'yoga-studio.example',
  'chess-club.example',
  'sewing-room.example',
  'bird-watch.example',
  'star-maps.example',
  'surf-report.example',
];
const FIRST_DOMAIN = 'news-daily.example';

export interface DmShape {
  id: DmShapeId;
  label: string;
  /** One line on how this shape lays out the data. */
  layout: string;
  /** What one stored record is called, singular then plural. */
  unit: [string, string];
}

export const DM_SHAPES: readonly DmShape[] = [
  {
    id: 'tables',
    label: 'Tables',
    layout:
      'users, links, and clicks_daily rows, with indexes on links(owner_id, created_at) and links(domain)',
    unit: ['row', 'rows'],
  },
  {
    id: 'documents',
    label: 'Documents',
    layout: 'One document per user with its links and daily clicks inside; only _id is indexed',
    unit: ['document', 'documents'],
  },
  {
    id: 'keyvalue',
    label: 'Key-value',
    layout: 'Each code maps to one record with its URL, owner, domain, and daily clicks; no other index',
    unit: ['key', 'keys'],
  },
];

export interface DmQuery {
  id: DmQueryId;
  label: string;
  /** What this query asks, shown on its chip. */
  diff: string;
  /** How the wrap up names it, as in "Tables fits the dashboard best". */
  noun: string;
  /** Illustrative requests per second. */
  perSecond: number;
  rateText: string;
}

export const DM_QUERY_IDS: readonly DmQueryId[] = [
  'redirect',
  'create',
  'dashboard',
  'analytics',
  'takedown',
];

export const dmQueries: Record<DmQueryId, DmQuery> = {
  redirect: {
    id: 'redirect',
    label: 'Redirect',
    diff: 'Find the long URL for the hottest code. About 20,000 a second.',
    noun: 'the redirect',
    perSecond: 20_000,
    rateText: '20,000 a second',
  },
  create: {
    id: 'create',
    label: 'Create a link',
    diff: 'Save a new link for user 1, the busiest account. About 20 a second.',
    noun: 'creating a link',
    perSecond: 20,
    rateText: '20 a second',
  },
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard',
    diff: "User 1's 20 newest links with click counts. About 50 a second.",
    noun: 'the dashboard',
    perSecond: 50,
    rateText: '50 a second',
  },
  analytics: {
    id: 'analytics',
    label: 'Analytics',
    diff: 'Clicks per day for the hottest link. About 10 a second.',
    noun: 'analytics',
    perSecond: 10,
    rateText: '10 a second',
  },
  takedown: {
    id: 'takedown',
    label: 'Takedown',
    diff: `Every link that points at ${DM_TAKEDOWN_DOMAIN}. About 3 a day.`,
    noun: 'the takedown',
    perSecond: 3 / 86_400,
    rateText: '3 a day',
  },
};

export interface DmDay {
  /** Days ago; 0 is today. */
  day: number;
  count: number;
}

export interface DmLink {
  code: string;
  owner: number;
  domain: string;
  /** Days since the link was created; 0 is today. */
  createdAgo: number;
  /** Days until the link expires (0 is today), or null when it never expires. */
  expiresIn: number | null;
  clicks: number;
  /** Clicks per day over the last 30 days, only the days that had any. */
  daily: DmDay[];
}

export interface DmRange {
  offset: number;
  kb: number;
}

export interface DmStore {
  shape: DmShapeId;
  totalKb: number;
  /** Record keys in storage order. */
  keys: string[];
  /** Byte range of each record, in storage order. */
  order: DmRange[];
  at: Map<string, DmRange>;
  regions: string[];
  /** The region under the middle of each grid square. */
  cellRegions: number[];
}

export interface DmDataset {
  seed: number;
  links: DmLink[];
  byCode: Map<string, DmLink>;
  /** Links owned by each user. */
  owned: DmLink[][];
  powerUser: number;
  hottest: DmLink;
  /** The link the create query saves. */
  newLink: DmLink;
  stores: Record<DmShapeId, DmStore>;
}

export interface DmPlan {
  shape: DmShapeId;
  access: DmAccess;
  accessLabel: string;
  note: string;
  /** Byte ranges the query reads or writes, in order. */
  touched: DmRange[];
  records: number;
  indexEntries: number;
  kb: number;
  roundTrips: number;
  costMs: number;
}

const userKey = (user: number) => `user:${user}`;
const linkKey = (code: string) => `link:${code}`;
const dayKey = (code: string, day: number) => `day:${code}:${day}`;
const round2 = (value: number) => Math.round(value * 100) / 100;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function linkKb(link: DmLink): number {
  return LINK_KB + DAY_KB * link.daily.length;
}

function makeCode(rng: Rng, taken: Set<string>): string {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i += 1) code += BASE62.charAt(randomInt(rng, 0, BASE62.length - 1));
  } while (taken.has(code));
  taken.add(code);
  return code;
}

function shuffled(rng: Rng, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i);
    const swap = order[i] ?? i;
    order[i] = order[j] ?? j;
    order[j] = swap;
  }
  return order;
}

interface StoredItem {
  key: string;
  kb: number;
  region: number;
}

function placeStore(shape: DmShapeId, items: StoredItem[], regions: string[]): DmStore {
  const keys: string[] = [];
  const order: DmRange[] = [];
  const at = new Map<string, DmRange>();
  let offset = 0;
  for (const item of items) {
    const range = { offset, kb: item.kb };
    keys.push(item.key);
    order.push(range);
    at.set(item.key, range);
    offset += item.kb;
  }
  const cellRegions: number[] = [];
  let index = 0;
  for (let cell = 0; cell < GRID_CELLS; cell += 1) {
    const middle = ((cell + 0.5) / GRID_CELLS) * offset;
    while (index < items.length - 1 && (order[index]?.offset ?? 0) + (order[index]?.kb ?? 0) <= middle) {
      index += 1;
    }
    cellRegions.push(items[index]?.region ?? 0);
  }
  return { shape, totalKb: round2(offset), keys, order, at, regions, cellRegions };
}

/** The seeded users, links, and clicks, stored as tables, documents, and key-value records. */
export function buildDataset(seed = 42): DmDataset {
  const rng = createRng(seed);
  const pickOwner = createZipf(DM_USERS, 1);
  const pickDomain = createZipf(DOMAINS.length, 1);
  const taken = new Set<string>();
  const links: DmLink[] = [];
  for (let i = 0; i < DM_LINKS; i += 1) {
    links.push({
      code: makeCode(rng, taken),
      owner: pickOwner(rng),
      domain: DOMAINS[pickDomain(rng)] ?? FIRST_DOMAIN,
      createdAgo: randomInt(rng, 0, DM_HISTORY_DAYS - 1),
      expiresIn: rng() < EXPIRING_SHARE ? randomInt(rng, 0, 59) : null,
      clicks: 0,
      daily: [],
    });
  }

  // Popularity is shuffled so the hottest links are not simply the first ones created.
  const popularity = shuffled(rng, DM_LINKS);
  const pickLink = createZipf(DM_LINKS, 1);
  const perDay = links.map(() => new Array<number>(DM_CLICK_DAYS).fill(0));
  for (let click = 0; click < DM_CLICKS; click += 1) {
    const index = popularity[pickLink(rng)] ?? 0;
    const link = links[index];
    const days = perDay[index];
    if (!link || !days) continue;
    const day = randomInt(rng, 0, Math.min(DM_CLICK_DAYS - 1, link.createdAgo));
    days[day] = (days[day] ?? 0) + 1;
  }
  links.forEach((link, index) => {
    link.daily = (perDay[index] ?? []).flatMap((count, day) => (count > 0 ? [{ day, count }] : []));
    link.clicks = sum(link.daily.map((entry) => entry.count));
  });

  const users = Array.from({ length: DM_USERS }, (_, user) => user);
  const owned = users.map((): DmLink[] => []);
  for (const link of links) owned[link.owner]?.push(link);
  const counts = owned.map((list) => list.length);
  const powerUser = counts.indexOf(Math.max(...counts));
  const hottest = links.reduce((best, link) => (link.clicks > best.clicks ? link : best));
  const newLink: DmLink = {
    code: makeCode(rng, taken),
    owner: powerUser,
    domain: FIRST_DOMAIN,
    createdAgo: 0,
    expiresIn: null,
    clicks: 0,
    daily: [],
  };

  const byCode = new Map(links.map((link) => [link.code, link]));
  const sortedLinks = [...links].sort((a, b) => compareText(a.code, b.code));
  const tables = placeStore(
    'tables',
    [
      ...users.map((user) => ({ key: userKey(user), kb: USER_KB, region: 0 })),
      ...sortedLinks.map((link) => ({ key: linkKey(link.code), kb: LINK_KB, region: 1 })),
      ...sortedLinks.flatMap((link) =>
        link.daily.map((entry) => ({ key: dayKey(link.code, entry.day), kb: DAY_KB, region: 2 })),
      ),
    ],
    ['users', 'links', 'clicks_daily'],
  );
  const documents = placeStore(
    'documents',
    users.map((user) => ({
      key: userKey(user),
      kb: USER_KB + sum((owned[user] ?? []).map(linkKb)),
      region: user === powerUser ? 1 : 0,
    })),
    ['other users', `user ${powerUser + 1}`],
  );
  const keyvalue = placeStore(
    'keyvalue',
    [
      ...users.map((user) => ({ key: userKey(user), kb: USER_KB, region: 0 })),
      ...links.map((link) => ({ key: linkKey(link.code), kb: linkKb(link), region: 0 })),
    ]
      .map((item) => ({ item, hash: hashString(item.key) }))
      .sort((a, b) => a.hash - b.hash || compareText(a.item.key, b.item.key))
      .map(({ item }) => item),
    ['keys in hash order'],
  );

  return {
    seed,
    links,
    byCode,
    owned,
    powerUser,
    hottest,
    newLink,
    stores: { tables, documents, keyvalue },
  };
}

interface PlanInput {
  access: DmAccess;
  accessLabel: string;
  note: string;
  touched: DmRange[];
  /** KB charged when it differs from the touched ranges, as when a write grows a document. */
  kb?: number;
  indexEntries?: number;
  roundTrips?: number;
}

function makePlan(shape: DmShapeId, input: PlanInput): DmPlan {
  const kb = round2(input.kb ?? sum(input.touched.map((range) => range.kb)));
  const indexEntries = input.indexEntries ?? 0;
  const roundTrips = input.roundTrips ?? 1;
  const records = input.touched.length;
  const costMs = roundTrips * ROUND_TRIP_MS + (records + indexEntries) * PER_RECORD_MS + kb * PER_KB_MS;
  return {
    shape,
    access: input.access,
    accessLabel: input.accessLabel,
    note: input.note,
    touched: input.touched,
    records,
    indexEntries,
    kb,
    roundTrips,
    costMs: Math.round(costMs * 1e6) / 1e6,
  };
}

function rangeOf(store: DmStore, key: string): DmRange {
  return store.at.get(key) ?? { offset: 0, kb: 0 };
}

function documentScan(data: DmDataset, note: string): DmPlan {
  return makePlan('documents', {
    access: 'scan',
    accessLabel: 'Full collection scan',
    note,
    touched: data.stores.documents.order,
  });
}

function keyScan(data: DmDataset, note: string): DmPlan {
  const order = data.stores.keyvalue.order;
  return makePlan('keyvalue', {
    access: 'scan',
    accessLabel: 'Full key scan',
    note,
    touched: order,
    roundTrips: Math.ceil(order.length / SCAN_PAGE_KEYS),
  });
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function redirectPlan(data: DmDataset, shape: DmShapeId, code: string): DmPlan {
  if (shape === 'tables') {
    return makePlan(shape, {
      access: 'key',
      accessLabel: 'Primary key lookup',
      note: 'links.code is the primary key, so one row answers.',
      touched: [rangeOf(data.stores.tables, linkKey(code))],
    });
  }
  if (shape === 'documents') {
    return documentScan(
      data,
      'Only _id is indexed. Nothing leads from a code to the document that holds it, so the database reads them all.',
    );
  }
  return makePlan(shape, {
    access: 'key',
    accessLabel: 'Get by key',
    note: 'The code is the key, and its record holds the URL.',
    touched: [rangeOf(data.stores.keyvalue, linkKey(code))],
  });
}

/** Where a new record lands in a store sorted by `before`: the offset of the first record it sorts ahead of. */
function insertAt(store: DmStore, from: number, to: number, before: (key: string) => boolean): number {
  for (let index = from; index < to; index += 1) {
    const key = store.keys[index];
    if (key !== undefined && before(key)) return store.order[index]?.offset ?? store.totalKb;
  }
  const last = store.order[to - 1];
  return last ? last.offset + last.kb : store.totalKb;
}

function createPlan(data: DmDataset, shape: DmShapeId): DmPlan {
  const link = data.newLink;
  if (shape === 'tables') {
    const store = data.stores.tables;
    const offset = insertAt(
      store,
      DM_USERS,
      DM_USERS + DM_LINKS,
      (key) => compareText(linkKey(link.code), key) < 0,
    );
    return makePlan(shape, {
      access: 'key',
      accessLabel: 'Insert one row',
      note: 'Writes one row plus an entry in each secondary index. The primary key refuses a duplicate code.',
      touched: [{ offset, kb: LINK_KB }],
      indexEntries: 2,
    });
  }
  if (shape === 'documents') {
    const range = rangeOf(data.stores.documents, userKey(link.owner));
    const kb = round2(range.kb + LINK_KB);
    return makePlan(shape, {
      access: 'key',
      accessLabel: 'Update by _id',
      note: `Appends to user ${link.owner + 1}'s document. Toy assumption: the write costs all ${formatKb(kb)} KB of the document. Real engines apply targeted updates such as $push, yet the document keeps growing.`,
      touched: [range],
      kb,
    });
  }
  const store = data.stores.keyvalue;
  const hash = hashString(linkKey(link.code));
  const offset = insertAt(store, 0, store.keys.length, (key) => {
    const other = hashString(key);
    return hash < other || (hash === other && compareText(linkKey(link.code), key) < 0);
  });
  return makePlan(shape, {
    access: 'key',
    accessLabel: 'Put if absent',
    note: 'Writes one key and fails if the code is already taken.',
    touched: [{ offset, kb: LINK_KB }],
  });
}

/** A user's newest links first, the order the owner index keeps them in. */
function newestLinks(data: DmDataset, user: number): DmLink[] {
  return [...(data.owned[user] ?? [])]
    .sort((a, b) => a.createdAgo - b.createdAgo || compareText(a.code, b.code))
    .slice(0, DM_DASHBOARD_LINKS);
}

function dashboardPlan(data: DmDataset, shape: DmShapeId, user: number): DmPlan {
  if (shape === 'tables') {
    const store = data.stores.tables;
    const picked = newestLinks(data, user);
    return makePlan(shape, {
      access: 'index',
      accessLabel: 'Secondary index',
      note: 'links(owner_id, created_at) finds the newest links; summing their clicks_daily rows gives the counts.',
      touched: [
        ...picked.map((link) => rangeOf(store, linkKey(link.code))),
        ...picked.flatMap((link) => link.daily.map((entry) => rangeOf(store, dayKey(link.code, entry.day)))),
      ],
      indexEntries: picked.length,
    });
  }
  if (shape === 'documents') {
    const count = data.owned[user]?.length ?? 0;
    return makePlan(shape, {
      access: 'key',
      accessLabel: 'Get by _id',
      note:
        count > DM_DASHBOARD_LINKS
          ? `One read, but it loads all ${plural(count, 'link', 'links')} and every day of clicks to show ${DM_DASHBOARD_LINKS}.`
          : `One read returns all ${plural(count, 'link', 'links')} with their clicks.`,
      touched: [rangeOf(data.stores.documents, userKey(user))],
    });
  }
  return keyScan(data, 'No index by owner, so the app pages through every key, 100 per round trip.');
}

function analyticsPlan(data: DmDataset, shape: DmShapeId, code: string): DmPlan {
  if (shape === 'tables') {
    const link = data.byCode.get(code);
    return makePlan(shape, {
      access: 'key',
      accessLabel: 'Primary key range',
      note: "clicks_daily is keyed by (code, day), so one link's days sit side by side.",
      touched: (link?.daily ?? []).map((entry) => rangeOf(data.stores.tables, dayKey(code, entry.day))),
    });
  }
  if (shape === 'documents') {
    return documentScan(data, 'Same gap as the redirect: no index leads from a code to its document.');
  }
  return makePlan(shape, {
    access: 'key',
    accessLabel: 'Get by key',
    note: 'The daily counts sit inside the record, so one read returns them.',
    touched: [rangeOf(data.stores.keyvalue, linkKey(code))],
  });
}

function takedownPlan(data: DmDataset, shape: DmShapeId, domain: string): DmPlan {
  if (shape === 'tables') {
    const matches = data.links
      .filter((link) => link.domain === domain)
      .sort((a, b) => compareText(a.code, b.code));
    return makePlan(shape, {
      access: 'index',
      accessLabel: 'Secondary index',
      note: 'links(domain) lists every matching code, and the job reads those rows.',
      touched: matches.map((link) => rangeOf(data.stores.tables, linkKey(link.code))),
      indexEntries: matches.length,
    });
  }
  if (shape === 'documents') {
    return documentScan(data, 'No index on links.domain, so the database opens every document.');
  }
  return keyScan(data, 'No index by domain, so the job pages through every key, 100 per round trip.');
}

/** How one shape answers one of the five queries on this dataset. */
export function planQuery(data: DmDataset, shape: DmShapeId, query: DmQueryId): DmPlan {
  switch (query) {
    case 'redirect':
      return redirectPlan(data, shape, data.hottest.code);
    case 'create':
      return createPlan(data, shape);
    case 'dashboard':
      return dashboardPlan(data, shape, data.powerUser);
    case 'analytics':
      return analyticsPlan(data, shape, data.hottest.code);
    case 'takedown':
      return takedownPlan(data, shape, DM_TAKEDOWN_DOMAIN);
  }
}

/** The dashboard for any user, in shape order, so the lesson can compare a typical account with the busiest. */
export function dashboardPlans(data: DmDataset, user: number): DmPlan[] {
  return DM_SHAPES.map((shape) => dashboardPlan(data, shape.id, user));
}

export function formatMs(value: number): string {
  if (value < 1) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return Math.round(value).toLocaleString('en-US');
}

export function formatKb(value: number): string {
  if (value < 1) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return Math.round(value).toLocaleString('en-US');
}

export function formatAmount(kb: number): string {
  if (kb >= 1e6) return `${(kb / 1e6).toFixed(1)} GB`;
  if (kb >= 1e3) return `${(kb / 1e3).toFixed(1)} MB`;
  if (kb >= 1) return `${Math.round(kb)} KB`;
  return 'under 1 KB';
}

/** Data a query moves at its usual rate: per second for busy queries, per day for rare jobs. */
export function formatLoad(kb: number, query: DmQuery): string {
  return query.perSecond >= 1
    ? `${formatAmount(kb * query.perSecond)}/s`
    : `${formatAmount(kb * query.perSecond * 86_400)} a day`;
}

/**
 * Which shapes earn a "Best" badge: each one that ties or beats every other shape.
 * When all three tie, none does.
 */
export function bestShapes(costs: readonly number[]): boolean[] {
  const shown = costs.map(formatMs);
  const best = costs.map((cost, i) =>
    costs.every(
      (other, j) => i === j || betterIndex([cost, other], 'lower', [shown[i] ?? '', shown[j] ?? '']) !== 1,
    ),
  );
  return best.every(Boolean) ? best.map(() => false) : best;
}

export interface DmFitCell {
  shape: DmShapeId;
  access: DmAccess;
  accessLabel: string;
  costMs: number;
  best: boolean;
}

export interface DmFitRow {
  query: DmQueryId;
  label: string;
  cells: DmFitCell[];
}

/** Every query against every shape: the "which shape fits which query" table. */
export function fitTable(data: DmDataset): DmFitRow[] {
  return DM_QUERY_IDS.map((query) => {
    const plans = DM_SHAPES.map((shape) => planQuery(data, shape.id, query));
    const best = bestShapes(plans.map((plan) => plan.costMs));
    return {
      query,
      label: dmQueries[query].label,
      cells: plans.map((plan, index) => ({
        shape: plan.shape,
        access: plan.access,
        accessLabel: plan.accessLabel,
        costMs: plan.costMs,
        best: best[index] ?? false,
      })),
    };
  });
}

export interface DmStats {
  users: number;
  links: number;
  clicks: number;
  dailyRows: number;
  totalKb: number;
  powerUser: number;
  powerUserLinks: number;
  powerDocKb: number;
  /** The busiest user's document as a share of all stored data, in percent. */
  powerDocShare: number;
  /** The user in the middle of the links-per-user ranking. */
  medianUser: number;
  medianUserLinks: number;
  hottestCode: string;
  hottestClicks: number;
  hottestDays: number;
  takedownLinks: number;
  expiringToday: number;
}

export function datasetStats(data: DmDataset): DmStats {
  const counts = data.owned.map((list) => list.length);
  const ranked = counts
    .map((count, user) => ({ count, user }))
    .sort((a, b) => b.count - a.count || a.user - b.user);
  const median = ranked[Math.floor(ranked.length / 2)] ?? { count: 0, user: 0 };
  const powerDocKb = rangeOf(data.stores.documents, userKey(data.powerUser)).kb;
  const totalKb = data.stores.tables.totalKb;
  return {
    users: DM_USERS,
    links: data.links.length,
    clicks: sum(data.links.map((link) => link.clicks)),
    dailyRows: sum(data.links.map((link) => link.daily.length)),
    totalKb,
    powerUser: data.powerUser,
    powerUserLinks: counts[data.powerUser] ?? 0,
    powerDocKb: round2(powerDocKb),
    powerDocShare: Math.round((powerDocKb / totalKb) * 100),
    medianUser: median.user,
    medianUserLinks: median.count,
    hottestCode: data.hottest.code,
    hottestClicks: data.hottest.clicks,
    hottestDays: data.hottest.daily.length,
    takedownLinks: data.links.filter((link) => link.domain === DM_TAKEDOWN_DOMAIN).length,
    expiringToday: data.links.filter((link) => link.expiresIn === 0).length,
  };
}

export interface DmCounterChoice {
  label: string;
  /** Rows the dashboard reads for the busiest user. */
  dashboardRows: number;
  dashboardMs: number;
  /** Rows each click writes. */
  writesPerClick: number;
  /** Rows written per second at the redirect rate, before any batching. */
  writesPerSecond: number;
}

/**
 * The click counter two ways: normalized (sum clicks_daily on every dashboard read) and
 * denormalized (a click_count column on links that every click also updates).
 */
export function counterChoices(data: DmDataset): [DmCounterChoice, DmCounterChoice] {
  const normalized = dashboardPlan(data, 'tables', data.powerUser);
  const picked = newestLinks(data, data.powerUser);
  const denormalized = makePlan('tables', {
    access: 'index',
    accessLabel: 'Secondary index',
    note: 'links.click_count holds the total, so the dashboard reads only the link rows.',
    touched: picked.map((link) => rangeOf(data.stores.tables, linkKey(link.code))),
    indexEntries: picked.length,
  });
  const clicksPerSecond = dmQueries.redirect.perSecond;
  return [
    {
      label: 'Normalized',
      dashboardRows: normalized.records,
      dashboardMs: normalized.costMs,
      writesPerClick: 1,
      writesPerSecond: clicksPerSecond,
    },
    {
      label: 'Denormalized',
      dashboardRows: denormalized.records,
      dashboardMs: denormalized.costMs,
      writesPerClick: 2,
      writesPerSecond: clicksPerSecond * 2,
    },
  ];
}

export interface DmEvent {
  tick: number;
  text: string;
  /** True for the single closing note. */
  wrapUp: boolean;
}

export interface DmRunState {
  tick: number;
  finished: boolean[];
  events: DmEvent[];
}

export interface DmPane {
  shape: DmShape;
  plan: DmPlan;
  /** Records read or written so far. */
  done: number;
  finished: boolean;
  best: boolean;
  /** One flag per grid square: true once the query has touched data in it. */
  lit: boolean[];
}

function ticksFor(plan: DmPlan): number {
  return Math.ceil(plan.costMs / MS_PER_TICK - 1e-9);
}

/** For each grid square, the position in `touched` of the first record that falls in it, or -1. */
function firstTouchByCell(plan: DmPlan, totalKb: number): number[] {
  const first = new Array<number>(GRID_CELLS).fill(-1);
  plan.touched.forEach((range, position) => {
    const start = Math.min(GRID_CELLS - 1, Math.floor((range.offset / totalKb) * GRID_CELLS));
    const end = Math.min(
      GRID_CELLS - 1,
      Math.max(start, Math.ceil(((range.offset + range.kb) / totalKb) * GRID_CELLS) - 1),
    );
    for (let cell = start; cell <= end; cell += 1) {
      if (first[cell] === -1) first[cell] = position;
    }
  });
  return first;
}

/** One query played against all three shapes at once, on the same dataset. */
export class DmRun {
  readonly query: DmQuery;
  readonly data: DmDataset;
  readonly plans: readonly DmPlan[];
  readonly best: readonly boolean[];
  readonly length: number;
  readonly tickSeconds = DM_TICK_SECONDS;
  private readonly firstTouch: number[][];
  private state: DmRunState;

  constructor(queryId: DmQueryId, data: DmDataset = buildDataset()) {
    this.query = dmQueries[queryId];
    this.data = data;
    this.plans = DM_SHAPES.map((shape) => planQuery(data, shape.id, queryId));
    this.best = bestShapes(this.plans.map((plan) => plan.costMs));
    this.length = Math.max(1, ...this.plans.map(ticksFor));
    this.firstTouch = this.plans.map((plan) => firstTouchByCell(plan, data.stores[plan.shape].totalKb));
    this.state = this.initial();
  }

  private initial(): DmRunState {
    return { tick: 0, finished: this.plans.map(() => false), events: [] };
  }

  get ticks(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.tick >= this.length;
  }

  get elapsedMs(): number {
    return this.state.tick * MS_PER_TICK;
  }

  get events(): readonly DmEvent[] {
    return this.state.events;
  }

  get panes(): DmPane[] {
    const elapsed = this.elapsedMs;
    return this.plans.map((plan, index) => {
      const finished = this.state.finished[index] ?? false;
      const done = finished
        ? plan.records
        : Math.min(plan.records, Math.floor((plan.records * elapsed) / plan.costMs));
      return {
        shape: DM_SHAPES[index] ?? (DM_SHAPES[0] as DmShape),
        plan,
        done,
        finished,
        best: finished && (this.best[index] ?? false),
        lit: (this.firstTouch[index] ?? []).map((position) => position >= 0 && position < done),
      };
    });
  }

  step(): void {
    if (this.done) return;
    this.state.tick += 1;
    const tick = this.state.tick;
    const elapsed = this.elapsedMs;
    this.plans.forEach((plan, index) => {
      if (this.state.finished[index] || elapsed + 1e-9 < plan.costMs) return;
      this.state.finished[index] = true;
      this.state.events.push({ tick, text: finishText(plan), wrapUp: false });
    });
    if (this.done) this.state.events.push({ tick, text: this.wrapUp(), wrapUp: true });
  }

  checkpoint(): DmRunState {
    return structuredClone(this.state);
  }

  restore(state: DmRunState): void {
    this.state = structuredClone(state);
  }

  private wrapUp(): string {
    const names = DM_SHAPES.filter((_, index) => this.best[index]).map((shape) => shape.label);
    const { noun, perSecond, rateText } = this.query;
    const rare = perSecond < 1 ? ' At that rate, even a full scan may be acceptable.' : '';
    const verdict =
      names.length === 0
        ? `All three shapes tie on ${noun}.`
        : names.length === 1
          ? `${names[0]} fits ${noun} best.`
          : `${names.join(' and ')} tie for ${noun}.`;
    const worst = this.plans.reduce((most, plan) => (plan.costMs > most.costMs ? plan : most));
    const worstLabel = shapeOf(worst.shape).label;
    return `Run ends. ${verdict} At ${rateText}, ${worstLabel} would move ${formatLoad(worst.kb, this.query)}.${rare}`;
  }
}

export function shapeOf(id: DmShapeId): DmShape {
  return DM_SHAPES.find((shape) => shape.id === id) ?? (DM_SHAPES[0] as DmShape);
}

function finishText(plan: DmPlan): string {
  const shape = shapeOf(plan.shape);
  const [one, many] = shape.unit;
  const parts = [
    plan.indexEntries > 0 ? `${plural(plan.indexEntries, 'index entry', 'index entries')} and ` : '',
    `${plural(plan.records, one, many)} (${formatKb(plan.kb)} KB)`,
    ` in ${plural(plan.roundTrips, 'round trip', 'round trips')}`,
  ];
  return `${shape.label} finishes in ${formatMs(plan.costMs)} toy ms: ${parts.join('')}.`;
}
