import { createRng, randomInt } from '../rng';

/**
 * Toy model of request handlers writing to one database at the same time.
 * Each handler reads (or checks), works for a moment, then writes. Two lanes
 * replay the same pre-generated requests; only the write statement differs.
 * Handlers are stretched to tenths of a second so overlaps are easy to see.
 * Real handlers take milliseconds, and busy services overlap just the same.
 */
export type TxScenarioId = 'counter' | 'editors' | 'alias' | 'quiet';
export type TxKind = 'counter' | 'edit' | 'alias';
export type TxOutcome = 'ok' | 'stale' | 'rejected' | 'taken' | 'duplicate';

export interface TxRequest {
  id: number;
  who: string;
  /** Tick when the handler reads the row or checks the alias. */
  readAt: number;
  /** Tick when it sends its write. */
  writeAt: number;
  /** The alias a user claims. Empty for clicks and edits. */
  alias: string;
}

export interface TxScenario {
  id: TxScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  kind: TxKind;
  /** Lane names: the unguarded write first, the guarded write second. */
  lanes: [string, string];
  /** The write each lane sends, shown under its name. */
  statements: [string, string];
  generate: (seed: number) => TxRequest[];
}

export interface TxEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface TxRead {
  /** The row version when the handler read it. Every applied write bumps it. */
  version: number;
  /** The click count the handler read. */
  value: number;
  /** For edits: who wrote the version this handler opened. */
  editor: string;
}

export interface TxResult {
  id: number;
  tick: number;
  outcome: TxOutcome;
  text: string;
}

export interface TxRow {
  alias: string;
  owner: string;
}

export interface TxLane {
  label: string;
  statement: string;
  guarded: boolean;
  /** Click count, or the number of the edit the row shows. */
  stored: number;
  version: number;
  /** Who wrote the row's current destination. */
  editor: string;
  rows: TxRow[];
  /** Indexed by request id minus one. Null until the handler reads. */
  reads: (TxRead | null)[];
  /** Indexed by request id minus one. Null while the request is in flight. */
  results: (TxResult | null)[];
  /** Ids in the order they finished. */
  finished: number[];
  /** One value per tick: clicks lost, edits erased, or duplicate rows. */
  series: number[];
  /** Set once this lane has annotated its first contested write. */
  flagged: boolean;
}

interface TxState {
  tick: number;
  lanes: [TxLane, TxLane];
  events: TxEvent[];
  /** Indexed by request id minus one: true once it overlapped another request. */
  overlapped: boolean[];
}

export const TX_SECONDS = 20;
export const TX_TICK_SECONDS = 0.1;
export const TX_TICKS = Math.round(TX_SECONDS / TX_TICK_SECONDS);

const EDITORS = ['Ana', 'Ben', 'Chen'];
export const TX_ALIASES = ['launch', 'sale', 'docs', 'jobs', 'promo'];

function clickWorkload(seed: number, count: number, from: number, to: number): TxRequest[] {
  const rng = createRng(seed);
  const starts = Array.from({ length: count }, () => randomInt(rng, from, to)).sort((a, b) => a - b);
  return starts.map((readAt, index) => ({
    id: index + 1,
    who: `Click ${index + 1}`,
    readAt,
    writeAt: readAt + randomInt(rng, 3, 6),
    alias: '',
  }));
}

function quietWorkload(seed: number): TxRequest[] {
  const rng = createRng(seed);
  return Array.from({ length: 10 }, (_, index) => {
    const readAt = 4 + index * 20;
    return {
      id: index + 1,
      who: `Click ${index + 1}`,
      readAt,
      writeAt: readAt + randomInt(rng, 3, 6),
      alias: '',
    };
  });
}

/** Each editor opens the link, thinks, saves, pauses, and repeats, so nobody overlaps themselves. */
function editWorkload(seed: number): TxRequest[] {
  const rng = createRng(seed);
  const raw: Omit<TxRequest, 'id'>[] = [];
  for (const who of EDITORS) {
    let at = randomInt(rng, 0, 20);
    for (let edit = 0; edit < 3; edit += 1) {
      const writeAt = at + randomInt(rng, 15, 35);
      raw.push({ who, readAt: at, writeAt, alias: '' });
      at = writeAt + randomInt(rng, 5, 30);
    }
  }
  raw.sort((a, b) => a.readAt - b.readAt || a.writeAt - b.writeAt);
  return raw.map((request, index) => ({ ...request, id: index + 1 }));
}

/**
 * A promo email suggests five aliases. For each word, three readers try it
 * within half a second of each other, and a fourth tries it a few seconds later.
 */
function aliasWorkload(seed: number): TxRequest[] {
  const rng = createRng(seed);
  const raw: Omit<TxRequest, 'id' | 'who'>[] = [];
  TX_ALIASES.forEach((alias, word) => {
    const rush = 5 + word * 30 + randomInt(rng, 0, 8);
    for (let claim = 0; claim < 3; claim += 1) {
      const readAt = rush + randomInt(rng, 0, 4);
      raw.push({ alias, readAt, writeAt: readAt + randomInt(rng, 3, 6) });
    }
    const late = rush + randomInt(rng, 12, 20);
    raw.push({ alias, readAt: late, writeAt: late + randomInt(rng, 3, 6) });
  });
  raw.sort((a, b) => a.readAt - b.readAt || a.writeAt - b.writeAt);
  return raw.map((request, index) => ({ ...request, id: index + 1, who: `User ${index + 1}` }));
}

const counterLanes: [string, string] = ['Read, then write', 'Atomic increment'];
const counterStatements: [string, string] = ['SET clicks = :read + 1', 'SET clicks = clicks + 1'];

export const txScenarios: Record<TxScenarioId, TxScenario> = {
  counter: {
    id: 'counter',
    label: 'Busy click counter',
    diff: 'Baseline: 30 clicks on sho.rt/launch in 17 s. Each handler takes 0.3 to 0.6 s between its read and its write.',
    kind: 'counter',
    lanes: counterLanes,
    statements: counterStatements,
    generate: (seed) => clickWorkload(seed, 30, 0, 170),
  },
  editors: {
    id: 'editors',
    label: 'Three editors',
    diff: 'Ana, Ben, and Chen each edit the destination of sho.rt/launch 3 times, spending 1.5 to 3.5 s in the form.',
    kind: 'edit',
    lanes: ['Last write wins', 'Conditional update'],
    statements: ['SET url = :new', 'SET url = :new WHERE version = :read'],
    generate: editWorkload,
  },
  alias: {
    id: 'alias',
    label: 'Same custom alias',
    diff: '20 users claim 5 aliases. Three people try each word within 0.5 s; a fourth tries it seconds later.',
    kind: 'alias',
    lanes: ['Check, then insert', 'Unique key'],
    statements: ['SELECT, then INSERT', 'INSERT, alias is UNIQUE'],
    generate: aliasWorkload,
  },
  quiet: {
    id: 'quiet',
    label: 'Quiet link',
    diff: 'Click counter with 10 clicks, one every 2 s. Each handler finishes before the next click arrives.',
    kind: 'counter',
    lanes: counterLanes,
    statements: counterStatements,
    generate: quietWorkload,
  },
};

const blankLane = (label: string, statement: string, guarded: boolean, count: number): TxLane => ({
  label,
  statement,
  guarded,
  stored: 0,
  version: 0,
  editor: 'nobody',
  rows: [],
  reads: Array.from({ length: count }, () => null),
  results: Array.from({ length: count }, () => null),
  finished: [],
  series: [],
  flagged: false,
});

export interface TxTotals {
  arrived: number;
  ok: number;
  stale: number;
  rejected: number;
  taken: number;
  duplicate: number;
  inFlight: number;
  /** Clicks lost, edits erased, or duplicate rows, depending on the scenario. */
  harm: number;
}

export function laneTotals(lane: TxLane, kind: TxKind): TxTotals {
  const totals: TxTotals = {
    arrived: 0,
    ok: 0,
    stale: 0,
    rejected: 0,
    taken: 0,
    duplicate: 0,
    inFlight: 0,
    harm: 0,
  };
  lane.reads.forEach((read, index) => {
    if (!read) return;
    totals.arrived += 1;
    const result = lane.results[index];
    if (result) totals[result.outcome] += 1;
    else totals.inFlight += 1;
  });
  if (kind === 'counter') totals.harm = totals.ok + totals.stale - lane.stored;
  else if (kind === 'edit') totals.harm = totals.stale;
  else totals.harm = totals.duplicate;
  return totals;
}

/**
 * Row for each request on the handler timeline, indexed by id minus one.
 * Editors get one row each; other requests pack into the first row that is free.
 */
export function timelineRows(kind: TxKind, requests: readonly TxRequest[]): number[] {
  if (kind === 'edit') return requests.map((request) => Math.max(0, EDITORS.indexOf(request.who)));
  const rowEnds: number[] = [];
  const rows: number[] = [];
  for (const request of [...requests].sort((a, b) => a.readAt - b.readAt || a.id - b.id)) {
    let row = rowEnds.findIndex((end) => end < request.readAt);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(request.writeAt);
    } else {
      rowEnds[row] = request.writeAt;
    }
    rows[request.id - 1] = row;
  }
  return rows;
}

/** What a request in flight holds right now, in plain words. */
export function inFlightText(scenario: TxScenario, lane: TxLane, request: TxRequest): string {
  const read = lane.reads[request.id - 1];
  if (!read) return `${request.who} has not started`;
  switch (scenario.kind) {
    case 'counter':
      return lane.guarded
        ? `${request.who} will add 1 to whatever the row holds`
        : `${request.who} read ${read.value}, will write ${read.value + 1}`;
    case 'edit':
      return lane.guarded
        ? `${request.who} opened version ${read.version}, will save only if it is still ${read.version}`
        : `${request.who} opened version ${read.version}, will save over whatever is there`;
    case 'alias':
      return `${request.who} found ${request.alias} free, will insert it`;
  }
}

export class TxDuel {
  readonly scenario: TxScenario;
  readonly requests: TxRequest[];
  readonly length = TX_TICKS;
  readonly tickSeconds = TX_TICK_SECONDS;
  private state: TxState;

  constructor(scenario: TxScenario, seed = 42) {
    this.scenario = scenario;
    this.requests = scenario.generate(seed);
    this.state = this.initial();
  }

  private initial(): TxState {
    const count = this.requests.length;
    const [first, second] = this.scenario.lanes;
    const [firstStatement, secondStatement] = this.scenario.statements;
    return {
      tick: 0,
      lanes: [
        blankLane(first, firstStatement, false, count),
        blankLane(second, secondStatement, true, count),
      ],
      events: [],
      overlapped: Array.from({ length: count }, () => false),
    };
  }

  get ticks(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.tick >= this.length;
  }

  get lanes(): readonly [TxLane, TxLane] {
    return this.state.lanes;
  }

  get events(): readonly TxEvent[] {
    return this.state.events;
  }

  get overlapped(): readonly boolean[] {
    return this.state.overlapped;
  }

  /** Requests that have read but not yet finished, in one lane. */
  inFlight(lane: TxLane): TxRequest[] {
    return this.requests.filter((request) => lane.reads[request.id - 1] && !lane.results[request.id - 1]);
  }

  step(): void {
    if (this.done) return;
    const tick = this.state.tick;
    // Writes land before reads in the same tick, so a read sees every write up to now.
    for (const request of this.requests) {
      if (request.writeAt !== tick) continue;
      this.state.lanes.forEach((lane) => {
        this.write(lane, request, tick);
      });
    }
    for (const request of this.requests) {
      if (request.readAt !== tick) continue;
      this.noteOverlap(request, tick);
      this.state.lanes.forEach((lane) => {
        this.read(lane, request, tick);
      });
    }
    for (const lane of this.state.lanes) lane.series.push(laneTotals(lane, this.scenario.kind).harm);
    this.state.tick += 1;
    if (this.done) this.state.events.push({ tick: this.length, text: this.wrapUp(), marker: false });
  }

  checkpoint(): TxState {
    return structuredClone(this.state);
  }

  restore(state: TxState): void {
    this.state = structuredClone(state);
  }

  private read(lane: TxLane, request: TxRequest, tick: number): void {
    const index = request.id - 1;
    lane.reads[index] = { version: lane.version, value: lane.stored, editor: lane.editor };
    if (this.scenario.kind === 'alias' && lane.rows.some((row) => row.alias === request.alias)) {
      this.finish(
        lane,
        request,
        tick,
        'taken',
        `${request.who}: ${request.alias} is taken, so the form asks for another.`,
      );
    }
  }

  private write(lane: TxLane, request: TxRequest, tick: number): void {
    const index = request.id - 1;
    const read = lane.reads[index];
    if (!read || lane.results[index]) return;
    const contested =
      this.scenario.kind === 'alias'
        ? lane.rows.some((row) => row.alias === request.alias)
        : lane.version !== read.version;
    switch (this.scenario.kind) {
      case 'counter':
        this.writeCounter(lane, request, read, tick, contested);
        break;
      case 'edit':
        this.writeEdit(lane, request, read, tick, contested);
        break;
      case 'alias':
        this.writeAlias(lane, request, tick, contested);
        break;
    }
  }

  private writeCounter(
    lane: TxLane,
    request: TxRequest,
    read: TxRead,
    tick: number,
    contested: boolean,
  ): void {
    const before = lane.stored;
    lane.stored = lane.guarded ? before + 1 : read.value + 1;
    lane.version += 1;
    if (lane.guarded) {
      this.finish(lane, request, tick, 'ok', `${request.who} added 1: ${before} to ${lane.stored}.`);
      if (contested) {
        this.flag(
          lane,
          tick,
          `${lane.label}: ${request.who} adds 1 to the current ${before}, so the row holds ${lane.stored}. Nothing lost.`,
        );
      }
      return;
    }
    if (!contested) {
      this.finish(lane, request, tick, 'ok', `${request.who} read ${read.value}, wrote ${lane.stored}.`);
      return;
    }
    this.finish(
      lane,
      request,
      tick,
      'stale',
      `${request.who} read ${read.value} and wrote ${lane.stored}, but the row already held ${before}.`,
    );
    const lost = laneTotals(lane, 'counter').harm;
    this.flag(
      lane,
      tick,
      `${lane.label}: ${request.who} writes ${lane.stored} from its stale read of ${read.value}, over the ${before} already stored. Clicks lost so far: ${lost}.`,
    );
  }

  private writeEdit(lane: TxLane, request: TxRequest, read: TxRead, tick: number, contested: boolean): void {
    if (lane.guarded && contested) {
      this.finish(
        lane,
        request,
        tick,
        'rejected',
        `${request.who}'s save expected version ${read.version}, found ${lane.version}. Rejected, so ${request.who} reloads.`,
      );
      this.flag(
        lane,
        tick,
        `${lane.label}: ${request.who}'s save expects version ${read.version} and finds ${lane.version}. The update changes 0 rows, so ${request.who} reloads and sees ${lane.editor}'s edit.`,
      );
      return;
    }
    const erased = lane.editor;
    lane.version += 1;
    lane.stored = request.id;
    lane.editor = request.who;
    if (!contested) {
      this.finish(
        lane,
        request,
        tick,
        'ok',
        `${request.who} saved edit ${request.id} as version ${lane.version}.`,
      );
      return;
    }
    this.finish(
      lane,
      request,
      tick,
      'stale',
      `${request.who} saved edit ${request.id} over ${erased}'s newer edit without seeing it.`,
    );
    this.flag(
      lane,
      tick,
      `${lane.label}: ${request.who} saves over ${erased}'s edit without ever seeing it. Both of them saw "Saved".`,
    );
  }

  private writeAlias(lane: TxLane, request: TxRequest, tick: number, contested: boolean): void {
    if (lane.guarded && contested) {
      this.finish(
        lane,
        request,
        tick,
        'rejected',
        `${request.who}'s insert of ${request.alias} hit the unique key. The API answers 409 Conflict.`,
      );
      this.flag(
        lane,
        tick,
        `${lane.label}: ${request.who}'s insert of ${request.alias} fails. The API answers 409 Conflict and asks for another alias.`,
      );
      return;
    }
    const owner = lane.rows.find((row) => row.alias === request.alias)?.owner;
    lane.rows.push({ alias: request.alias, owner: request.who });
    if (!contested) {
      this.finish(lane, request, tick, 'ok', `${request.who} created ${request.alias}.`);
      return;
    }
    this.finish(
      lane,
      request,
      tick,
      'duplicate',
      `${request.who} inserted a second ${request.alias} row. ${owner} owns one too.`,
    );
    this.flag(
      lane,
      tick,
      `${lane.label}: ${request.who} inserts a second ${request.alias} row. ${owner} and ${request.who} both see "Your link is ready", but a redirect can follow only one.`,
    );
  }

  private finish(lane: TxLane, request: TxRequest, tick: number, outcome: TxOutcome, text: string): void {
    lane.results[request.id - 1] = { id: request.id, tick, outcome, text };
    lane.finished.push(request.id);
  }

  private flag(lane: TxLane, tick: number, text: string): void {
    if (lane.flagged) return;
    lane.flagged = true;
    this.state.events.push({ tick, text, marker: true });
  }

  /** Marks requests that run at the same time as another; for aliases, only claims on the same free word count. */
  private noteOverlap(request: TxRequest, tick: number): void {
    const lane = this.state.lanes[0];
    const alias = this.scenario.kind === 'alias';
    if (alias && lane.rows.some((row) => row.alias === request.alias)) return;
    const rivals = this.inFlight(lane).filter((other) => !alias || other.alias === request.alias);
    if (rivals.length === 0) return;
    const firstOverlap = !this.state.overlapped.some(Boolean);
    this.state.overlapped[request.id - 1] = true;
    for (const other of rivals) this.state.overlapped[other.id - 1] = true;
    if (!firstOverlap) return;
    const rival = rivals[0];
    if (!rival) return;
    const text =
      this.scenario.kind === 'counter'
        ? `${request.who} starts while ${rival.who.toLowerCase()} is still in flight. Both read ${lane.stored}.`
        : this.scenario.kind === 'edit'
          ? `${request.who} opens the link while ${rival.who}'s edit is still open. Both start from version ${lane.version}.`
          : `${lane.label}: ${request.who} checks ${request.alias} while ${rival.who}'s claim is still in flight. Both find it free.`;
    this.state.events.push({ tick, text, marker: true });
  }

  private wrapUp(): string {
    const [first, second] = this.state.lanes;
    const kind = this.scenario.kind;
    const a = laneTotals(first, kind);
    const b = laneTotals(second, kind);
    const total = this.requests.length;
    const overlaps = this.state.overlapped.filter(Boolean).length;
    if (kind === 'counter') {
      if (overlaps === 0) {
        return `Run ends. No two clicks overlapped, so both lanes stored all ${total}.`;
      }
      return `Run ends. ${overlaps} of ${total} clicks overlapped another. ${first.label} stored ${first.stored} (${a.harm} lost); ${second.label.toLowerCase()} stored ${second.stored}.`;
    }
    if (kind === 'edit') {
      return `Run ends. ${total} saves. ${first.label}: ${a.stale} erased a teammate's edit without warning. ${second.label}: ${b.rejected} rejected and reloaded, none erased.`;
    }
    return `Run ends. ${total} claims. ${first.label}: ${a.duplicate} duplicate alias rows. ${second.label}: ${b.rejected} claims got 409 Conflict, no duplicates.`;
  }
}
