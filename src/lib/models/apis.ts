import { createRng, poisson, randomInt } from '../rng';

/**
 * Toy model of a dashboard client paging through one user's links while the
 * list changes underneath it. Both lanes replay the same pre-generated creates
 * and deletes; only the way the client asks for the next page differs.
 * Pages load every 3 s so each shift is easy to follow.
 */
export type PgScenarioId = 'quiet' | 'busy' | 'cleanup' | 'both';
export type PgLaneKind = 'offset' | 'cursor';
export type PgCellState = 'unseen' | 'once' | 'multi' | 'skipped' | 'new';

export interface PgScenario {
  id: PgScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  /** Mean links created per second while the client pages. */
  createRate: number;
  /** Mean links deleted per second while the client pages. */
  deleteRate: number;
}

export interface PgMutation {
  tick: number;
  kind: 'create' | 'delete';
  id: number;
}

export interface PgLink {
  id: number;
  /** Tick the link was created, or -1 for links that existed before the session. */
  createdAt: number;
  deletedAt: number | null;
}

export interface PgEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface PgLane {
  kind: PgLaneKind;
  label: string;
  /** How many times each link id has appeared on a page. */
  shown: Record<number, number>;
  pages: number;
  rowsShown: number;
  /** Rows the database walks to answer every page so far. Illustrative. */
  rowsScanned: number;
  /** Offset lane: where the next page starts. */
  nextOffset: number;
  /** Cursor lane: the last id the client saw, sent back as after=. */
  cursor: number | null;
  finishedAt: number | null;
  /** Ids on the most recent page, in order. */
  lastPage: number[];
  request: string;
  response: string;
  /** One value per tick: rows shown twice plus links skipped so far. */
  series: number[];
  flaggedDuplicate: boolean;
  flaggedSkip: boolean;
}

interface PgState {
  tick: number;
  links: PgLink[];
  lanes: [PgLane, PgLane];
  events: PgEvent[];
  flaggedCreate: boolean;
  flaggedDelete: boolean;
}

export const PG_TICKS = 24;
export const PG_TICK_SECONDS = 1;
export const PG_PAGE_SIZE = 10;
export const PG_INITIAL_LINKS = 50;
export const PG_FETCH_EVERY = 3;
export const PG_USER = 7;
export const PG_PATH = `/v1/users/${PG_USER}/links`;
export const PG_SEED = 4;

export const pgScenarios: Record<PgScenarioId, PgScenario> = {
  quiet: {
    id: 'quiet',
    label: 'Quiet list',
    diff: 'Baseline: 50 links, newest first. Nothing changes while the client loads a page of 10 every 3 s.',
    createRate: 0,
    deleteRate: 0,
  },
  busy: {
    id: 'busy',
    label: 'Busy creator',
    diff: 'A script creates about 1 link every 2 s while the client pages. Each new link lands on top.',
    createRate: 0.5,
    deleteRate: 0,
  },
  cleanup: {
    id: 'cleanup',
    label: 'Deletions',
    diff: 'The owner deletes about 2 links every 5 s in another tab while the client pages.',
    createRate: 0,
    deleteRate: 0.4,
  },
  both: {
    id: 'both',
    label: 'Both',
    diff: 'About 1 new link every 2 s and 2 deletions every 5 s, at the same time.',
    createRate: 0.5,
    deleteRate: 0.4,
  },
};

/** Creates and deletes for the whole run. Deletes pick any link that is live at that moment. */
export function pgMutations(scenario: PgScenario, seed: number): PgMutation[] {
  const rng = createRng(seed);
  const live = Array.from({ length: PG_INITIAL_LINKS }, (_, index) => index + 1);
  let nextId = PG_INITIAL_LINKS + 1;
  const mutations: PgMutation[] = [];
  for (let tick = 1; tick < PG_TICKS; tick += 1) {
    const creates = poisson(rng, scenario.createRate);
    const deletes = poisson(rng, scenario.deleteRate);
    for (let count = 0; count < creates; count += 1) {
      mutations.push({ tick, kind: 'create', id: nextId });
      live.push(nextId);
      nextId += 1;
    }
    for (let count = 0; count < deletes && live.length > 0; count += 1) {
      const index = randomInt(rng, 0, live.length - 1);
      const [id] = live.splice(index, 1);
      if (id !== undefined) mutations.push({ tick, kind: 'delete', id });
    }
  }
  return mutations;
}

/** Rows the database walks past and returns for one offset page. Illustrative. */
export function offsetRowsScanned(page: number, size: number): number {
  return (page - 1) * size + size;
}

const blankLane = (kind: PgLaneKind, label: string): PgLane => ({
  kind,
  label,
  shown: {},
  pages: 0,
  rowsShown: 0,
  rowsScanned: 0,
  nextOffset: 0,
  cursor: null,
  finishedAt: null,
  lastPage: [],
  request: 'No request yet',
  response: 'Waiting for page 1',
  series: [],
  flaggedDuplicate: false,
  flaggedSkip: false,
});

export interface PgTotals {
  /** Links that existed before page 1 and were still there when the lane finished. */
  stable: number;
  once: number;
  multi: number;
  skipped: number;
  /** Stable links the client has not reached yet. Zero once the lane finishes. */
  ahead: number;
  /** Rows shown minus distinct links shown. */
  duplicates: number;
  /** Links created during the session, still live, that the lane never showed. */
  missedNew: number;
}

/** Live links, newest first. Ids grow with creation time, so newest first means highest id first. */
export function liveLinks(links: readonly PgLink[]): PgLink[] {
  return links.filter((link) => link.deletedAt === null).sort((a, b) => b.id - a.id);
}

function isStable(lane: PgLane, link: PgLink): boolean {
  if (link.createdAt >= 0) return false;
  if (link.deletedAt === null) return true;
  return lane.finishedAt !== null && link.deletedAt > lane.finishedAt;
}

/** True once the client has paged past this link. Position is its index in the live list. */
function passed(lane: PgLane, link: PgLink, position: number): boolean {
  if (lane.finishedAt !== null) return true;
  if (lane.kind === 'offset') return position >= 0 && position < lane.nextOffset;
  return lane.cursor !== null && link.id > lane.cursor;
}

export function pgCellState(lane: PgLane, link: PgLink, position: number): PgCellState {
  const count = lane.shown[link.id] ?? 0;
  if (count > 1) return 'multi';
  if (count === 1) return 'once';
  if (link.createdAt >= 0) return 'new';
  return passed(lane, link, position) ? 'skipped' : 'unseen';
}

export function pgTotals(lane: PgLane, links: readonly PgLink[]): PgTotals {
  const totals: PgTotals = {
    stable: 0,
    once: 0,
    multi: 0,
    skipped: 0,
    ahead: 0,
    duplicates: 0,
    missedNew: 0,
  };
  const positions = new Map(liveLinks(links).map((link, index) => [link.id, index]));
  let distinct = 0;
  for (const link of links) {
    const count = lane.shown[link.id] ?? 0;
    if (count > 0) distinct += 1;
    if (link.createdAt >= 0) {
      if (count === 0 && link.deletedAt === null) totals.missedNew += 1;
      continue;
    }
    if (!isStable(lane, link)) continue;
    totals.stable += 1;
    if (count > 1) totals.multi += 1;
    else if (count === 1) totals.once += 1;
    else if (passed(lane, link, positions.get(link.id) ?? -1)) totals.skipped += 1;
    else totals.ahead += 1;
  }
  totals.duplicates = lane.rowsShown - distinct;
  return totals;
}

export class PgDuel {
  readonly scenario: PgScenario;
  readonly mutations: PgMutation[];
  readonly length = PG_TICKS;
  readonly tickSeconds = PG_TICK_SECONDS;
  private state: PgState;

  constructor(scenario: PgScenario, seed = PG_SEED) {
    this.scenario = scenario;
    this.mutations = pgMutations(scenario, seed);
    this.state = this.initial();
  }

  private initial(): PgState {
    return {
      tick: 0,
      links: Array.from({ length: PG_INITIAL_LINKS }, (_, index) => ({
        id: index + 1,
        createdAt: -1,
        deletedAt: null,
      })),
      lanes: [blankLane('offset', 'Offset pagination'), blankLane('cursor', 'Cursor pagination')],
      events: [],
      flaggedCreate: false,
      flaggedDelete: false,
    };
  }

  get ticks(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.tick >= this.length;
  }

  get lanes(): readonly [PgLane, PgLane] {
    return this.state.lanes;
  }

  get events(): readonly PgEvent[] {
    return this.state.events;
  }

  /** Every link ever seen in the session, including deleted ones. */
  get links(): readonly PgLink[] {
    return this.state.links;
  }

  /** The user's links right now, newest first. */
  get list(): PgLink[] {
    return liveLinks(this.state.links);
  }

  totals(lane: PgLane): PgTotals {
    return pgTotals(lane, this.state.links);
  }

  /** Ids the lane's next request would return if it went out now. */
  nextWindow(lane: PgLane): number[] {
    if (lane.finishedAt !== null) return [];
    return this.pageFor(lane, this.list).map((link) => link.id);
  }

  step(): void {
    if (this.done) return;
    const tick = this.state.tick;
    for (const mutation of this.mutations) {
      if (mutation.tick === tick) this.apply(mutation, tick);
    }
    if (tick % PG_FETCH_EVERY === 0) {
      for (const lane of this.state.lanes) {
        if (lane.finishedAt === null) this.fetch(lane, tick);
      }
    }
    for (const lane of this.state.lanes) {
      const totals = this.totals(lane);
      lane.series.push(totals.duplicates + totals.skipped);
    }
    this.state.tick += 1;
    if (this.done) this.state.events.push({ tick: this.length, text: this.wrapUp(), marker: false });
  }

  checkpoint(): PgState {
    return structuredClone(this.state);
  }

  restore(state: PgState): void {
    this.state = structuredClone(state);
  }

  private pageFor(lane: PgLane, list: PgLink[]): PgLink[] {
    if (lane.kind === 'offset') return list.slice(lane.nextOffset, lane.nextOffset + PG_PAGE_SIZE);
    const cursor = lane.cursor;
    return list.filter((link) => cursor === null || link.id < cursor).slice(0, PG_PAGE_SIZE);
  }

  private apply(mutation: PgMutation, tick: number): void {
    if (mutation.kind === 'create') {
      this.state.links.push({ id: mutation.id, createdAt: tick, deletedAt: null });
      if (this.state.flaggedCreate) return;
      this.state.flaggedCreate = true;
      this.state.events.push({
        tick,
        text: `Link #${mutation.id} is created and lands on top of the list. Every older link moves down one place.`,
        marker: true,
      });
      return;
    }
    const link = this.state.links.find((candidate) => candidate.id === mutation.id);
    if (!link) return;
    link.deletedAt = tick;
    if (this.state.flaggedDelete) return;
    this.state.flaggedDelete = true;
    this.state.events.push({
      tick,
      text: `Link #${mutation.id} is deleted. Every link below it moves up one place.`,
      marker: true,
    });
  }

  private fetch(lane: PgLane, tick: number): void {
    const list = this.list;
    const page = lane.pages + 1;
    const rows = this.pageFor(lane, list);
    let hasMore: boolean;
    if (lane.kind === 'offset') {
      lane.request = `GET ${PG_PATH}?page=${page}&size=${PG_PAGE_SIZE}`;
      lane.rowsScanned += lane.nextOffset + rows.length;
      lane.nextOffset += PG_PAGE_SIZE;
      hasMore = lane.nextOffset < list.length;
    } else {
      lane.request =
        lane.cursor === null
          ? `GET ${PG_PATH}?size=${PG_PAGE_SIZE}`
          : `GET ${PG_PATH}?size=${PG_PAGE_SIZE}&after=${lane.cursor}`;
      lane.rowsScanned += rows.length;
      const last = rows[rows.length - 1];
      if (last) lane.cursor = last.id;
      const cursor = lane.cursor;
      hasMore = cursor !== null && list.some((link) => link.id < cursor);
    }
    lane.pages = page;
    lane.lastPage = rows.map((link) => link.id);
    lane.rowsShown += rows.length;
    let repeat: number | null = null;
    for (const row of rows) {
      const count = (lane.shown[row.id] ?? 0) + 1;
      lane.shown[row.id] = count;
      if (count > 1 && repeat === null) repeat = row.id;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const range = first && last ? `#${first.id} to #${last.id}` : 'none';
    const next = lane.kind === 'cursor' && hasMore ? `, next: after=${lane.cursor}` : '';
    lane.response = `200 OK: ${rows.length} links (${range}), has_more: ${hasMore}${next}`;
    if (!hasMore) lane.finishedAt = tick;

    if (repeat !== null && !lane.flaggedDuplicate) {
      lane.flaggedDuplicate = true;
      this.state.events.push({
        tick,
        text: `${lane.label}: page ${page} repeats link #${repeat}, which an earlier page already showed. New links on top pushed it down past the page boundary.`,
        marker: true,
      });
    }
    if (!lane.flaggedSkip) {
      const skipped = this.list.find((link, position) => pgCellState(lane, link, position) === 'skipped');
      if (skipped) {
        lane.flaggedSkip = true;
        this.state.events.push({
          tick,
          text: `${lane.label}: link #${skipped.id} slid up onto a page the client had already loaded when a link above it was deleted. Page ${page} starts below it, so no page has shown it.`,
          marker: true,
        });
      }
    }
    if (!hasMore) {
      this.state.events.push({
        tick,
        text: `${lane.label} reaches the end after ${page} pages.`,
        marker: true,
      });
    }
  }

  private wrapUp(): string {
    const [offset, cursor] = this.state.lanes;
    const lines = this.state.lanes.map((lane) => {
      const totals = this.totals(lane);
      const status = lane.finishedAt === null ? ' It is still paging.' : '';
      return `${lane.label} loaded ${lane.pages} pages with ${totals.duplicates} repeated rows and ${totals.skipped} links skipped.${status}`;
    });
    const created = this.state.links.some((link) => link.createdAt >= 0);
    if (created) {
      lines.push(
        'Neither lane shows links created after it passed the top of the list. Loading page 1 again picks them up.',
      );
    }
    lines.push(
      `The database walked ${offset.rowsScanned} rows for the offset pages and ${cursor.rowsScanned} for the cursor pages (illustrative).`,
    );
    return lines.join(' ');
  }
}

export type CcClientId = 'mobile' | 'web' | 'partner';
export type CcChangeId = 'addOptional' | 'rename' | 'typeChange' | 'remove' | 'requiredParam' | 'default';
export type CcMode = 'inPlace' | 'expand';
/** ok: keeps working. migrate: works today, must update before the old shape goes away. breaks: errors on deploy. silent: keeps running with wrong behavior. */
export type CcOutcome = 'ok' | 'migrate' | 'breaks' | 'silent';

export interface CcClient {
  id: CcClientId;
  name: string;
  detail: string;
  /** Response fields this client reads. */
  reads: string[];
  /** Request fields this client sends to POST /v1/links. */
  sends: string[];
}

export interface CcChange {
  id: CcChangeId;
  label: string;
  /** What the change does to the contract, shown on its chip. */
  diff: string;
  /** Expand then contract, in order. */
  expandSteps: string[];
}

export interface CcVerdict {
  client: CcClient;
  outcome: CcOutcome;
  reason: string;
}

interface CcRule {
  /** API versions the server runs side by side while clients migrate. */
  versions: number;
  /** New response field this plan adds, if any. A strict parser rejects it. */
  addsField: string | null;
  verdicts: Record<CcClientId, { outcome: CcOutcome; reason: string }>;
}

export const ccClients: CcClient[] = [
  {
    id: 'mobile',
    name: 'Old mobile app (v3)',
    detail: 'Installed on phones that never update. You cannot force a release.',
    reads: ['code', 'url', 'clicks'],
    sends: ['url'],
  },
  {
    id: 'web',
    name: 'Current web app',
    detail:
      'Ships in the same deploy as the API. Tabs opened before a deploy keep the old code until they reload.',
    reads: ['code', 'url', 'clicks'],
    sends: ['url'],
  },
  {
    id: 'partner',
    name: 'Partner integration',
    detail: "Another company's code. It updates on their schedule, after an email.",
    reads: ['code', 'url'],
    sends: ['url'],
  },
];

export const ccChanges: Record<CcChangeId, CcChange> = {
  addOptional: {
    id: 'addOptional',
    label: 'Add an optional field',
    diff: 'Responses gain "title". Nothing else changes.',
    expandSteps: ['Add "title" to /v1 responses. No new version is needed.'],
  },
  rename: {
    id: 'rename',
    label: 'Rename a field',
    diff: '"url" becomes "destination" in responses and in POST bodies.',
    expandSteps: [
      'Expand: /v1 returns both "url" and "destination" and accepts either on POST.',
      'Migrate: ship clients that read "destination". Watch who still sends "url".',
      'Contract: /v2 drops "url". /v1 keeps it until its last client retires.',
    ],
  },
  typeChange: {
    id: 'typeChange',
    label: "Change a field's type",
    diff: '"clicks" changes from the number 1204 to the string "1,204".',
    expandSteps: [
      'Expand: keep "clicks" as a number and add "clicks_display" as a string.',
      'Migrate: clients that want the label read "clicks_display".',
      'Contract: only a /v2 may change what "clicks" means.',
    ],
  },
  remove: {
    id: 'remove',
    label: 'Remove a field',
    diff: '"clicks" moves out of the link to GET /v1/links/{code}/stats.',
    expandSteps: [
      'Expand: add GET /v1/links/{code}/stats and keep "clicks" on the link.',
      'Migrate: clients call the stats endpoint. Stats traffic per client and app version shows who has moved.',
      'Contract: /v2 links omit "clicks". /v1 keeps it until its traffic reaches zero.',
    ],
  },
  requiredParam: {
    id: 'requiredParam',
    label: 'Add a required parameter',
    diff: 'POST /v1/links now requires "domain". Requests without it get 400.',
    expandSteps: [
      'Expand: accept "domain" as optional in /v1, defaulting to sho.rt.',
      'Migrate: clients start sending "domain".',
      'Contract: /v2 requires it. /v1 keeps the default.',
    ],
  },
  default: {
    id: 'default',
    label: 'Change a default',
    diff: 'Redirects switch from 302 to 301. Same fields, same shapes.',
    expandSteps: [
      'Expand: add an optional "redirect" field on create, default 302, with 301 on request.',
      'Migrate: the dashboard offers 301 to users who do not need click counts.',
      'Contract: change the default only in /v2, and say so in the changelog.',
    ],
  },
};

const ok = (reason: string) => ({ outcome: 'ok' as const, reason });
const migrate = (reason: string) => ({ outcome: 'migrate' as const, reason });
const breaks = (reason: string) => ({ outcome: 'breaks' as const, reason });
const silent = (reason: string) => ({ outcome: 'silent' as const, reason });

const addTitle: CcRule = {
  versions: 1,
  addsField: 'title',
  verdicts: {
    mobile: ok('Ignores fields it does not know, so "title" changes nothing.'),
    web: ok('Can start showing "title" whenever it is ready.'),
    partner: ok('Ignores fields it does not know.'),
  },
};

const CC_RULES: Record<CcChangeId, Record<CcMode, CcRule>> = {
  addOptional: { inPlace: addTitle, expand: addTitle },
  rename: {
    inPlace: {
      versions: 1,
      addsField: 'destination',
      verdicts: {
        mobile: breaks(
          'Reads "url", which is gone. Every link shows a blank destination, and its creates fail with 400.',
        ),
        web: breaks(
          'The new code ships in the same deploy, yet tabs opened before it still send "url". Their creates fail with 400 until the user reloads.',
        ),
        partner: breaks('Sends "url" on every create. Each one fails with 400 until they ship a fix.'),
      },
    },
    expand: {
      versions: 2,
      addsField: 'destination',
      verdicts: {
        mobile: migrate('Keeps reading "url" from /v1, which still returns it, until /v1 retires.'),
        web: migrate(
          'Switches to "destination" in the same deploy. Old tabs keep working, since /v1 still returns "url".',
        ),
        partner: migrate('Keeps working on /v1 and moves to "destination" on its own schedule.'),
      },
    },
  },
  typeChange: {
    inPlace: {
      versions: 1,
      addsField: null,
      verdicts: {
        mobile: breaks(
          'Decodes "clicks" as a number. The string "1,204" fails to parse and the list screen errors.',
        ),
        web: breaks(
          'The new parser ships in the same deploy, yet tabs opened before it still expect a number. Their list screen errors until the user reloads.',
        ),
        partner: ok('Never reads "clicks".'),
      },
    },
    expand: {
      versions: 1,
      addsField: 'clicks_display',
      verdicts: {
        mobile: ok('Still reads "clicks" as a number.'),
        web: migrate('Reads "clicks_display" for the label.'),
        partner: ok('Never reads "clicks".'),
      },
    },
  },
  remove: {
    inPlace: {
      versions: 1,
      addsField: null,
      verdicts: {
        mobile: breaks(
          'Reads "clicks", which is missing. The app shows 0 or crashes, depending on its parser.',
        ),
        web: breaks(
          'New code calls the stats endpoint, yet tabs opened before the deploy still read "clicks" from the link and show nothing until the user reloads.',
        ),
        partner: ok('Never reads "clicks".'),
      },
    },
    expand: {
      versions: 2,
      addsField: null,
      verdicts: {
        mobile: migrate('Keeps reading "clicks" from /v1 until /v1 retires.'),
        web: migrate('Calls the stats endpoint and moves to /v2.'),
        partner: ok('Never reads "clicks".'),
      },
    },
  },
  requiredParam: {
    inPlace: {
      versions: 1,
      addsField: null,
      verdicts: {
        mobile: breaks('Never sends "domain". Every create fails with 400.'),
        web: breaks(
          'New code sends "domain", yet tabs opened before the deploy still omit it. Their creates fail with 400 until the user reloads.',
        ),
        partner: breaks('Never sends "domain". Every create fails with 400 until they ship.'),
      },
    },
    expand: {
      versions: 2,
      addsField: null,
      verdicts: {
        mobile: migrate('Omits "domain" and gets the sho.rt default from /v1.'),
        web: migrate('Sends "domain" and moves to /v2.'),
        partner: migrate('Gets the default on /v1 and adds "domain" when it moves to /v2.'),
      },
    },
  },
  default: {
    inPlace: {
      versions: 1,
      addsField: null,
      verdicts: {
        mobile: silent(
          'No error anywhere. Browsers may cache the 301 and skip the server, so the clicks it shows stop growing.',
        ),
        web: silent(
          'Same quiet undercount: repeat visitors whose browsers cached the 301 never reach the server again.',
        ),
        partner: ok('Never reads "clicks".'),
      },
    },
    expand: {
      versions: 2,
      addsField: 'redirect',
      verdicts: {
        mobile: ok('Its links keep the 302 default on /v1, so counts stay honest.'),
        web: migrate('Offers 301 to users who ask for it and moves to /v2.'),
        partner: ok('Never reads "clicks".'),
      },
    },
  },
};

export function evaluateChange(changeId: CcChangeId, mode: CcMode, strictPartner: boolean): CcVerdict[] {
  const rule = CC_RULES[changeId][mode];
  return ccClients.map((client) => {
    const verdict = rule.verdicts[client.id];
    if (client.id === 'partner' && strictPartner && rule.addsField && verdict.outcome !== 'breaks') {
      return {
        client,
        outcome: 'breaks',
        reason: `Its strict parser rejects the unknown field "${rule.addsField}", so every response fails to decode.`,
      };
    }
    return { client, ...verdict };
  });
}

export interface CcSummary {
  broken: number;
  silent: number;
  migrate: number;
  versions: number;
  steps: string[];
}

export function ccSummary(changeId: CcChangeId, mode: CcMode, strictPartner: boolean): CcSummary {
  const verdicts = evaluateChange(changeId, mode, strictPartner);
  const count = (outcome: CcOutcome) => verdicts.filter((verdict) => verdict.outcome === outcome).length;
  return {
    broken: count('breaks'),
    silent: count('silent'),
    migrate: count('migrate'),
    versions: CC_RULES[changeId][mode].versions,
    steps:
      mode === 'inPlace'
        ? ['Deploy the change to /v1. Every client sees it at the same moment.']
        : ccChanges[changeId].expandSteps,
  };
}
