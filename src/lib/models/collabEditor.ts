import { createRng, randomInt } from '../rng';

/**
 * A toy collaborative editor for plain text. Each copy applies its own edits
 * at once and hears about the other copies' edits later, possibly out of order.
 *
 * IndexReplica sends "insert c at index i" and applies remote edits as-is.
 * CrdtReplica is a sequence CRDT in the RGA style: every character carries a
 * unique id and the id of its left neighbor at the moment it was typed.
 */

export interface CharId {
  site: string;
  counter: number;
}

export function idLabel(id: CharId): string {
  return `${id.site}${id.counter}`;
}

/** Counter first, then site name, so every copy breaks ties the same way. */
export function compareIds(a: CharId, b: CharId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.site === b.site) return 0;
  return a.site < b.site ? -1 : 1;
}

export interface Tile {
  /** Stable React key within one copy. */
  key: string;
  char: string;
  /** What the tile shows under the character: an index or an id. */
  label: string;
  deleted: boolean;
}

export interface DocReplica<Op> {
  readonly site: string;
  text(): string;
  tiles(): Tile[];
  insertAt(at: number, char: string): Op;
  deleteAt(at: number): Op;
  /** Applies a remote op, or holds it until what it depends on has arrived. Returns how many ops it applied. */
  receive(op: Op): number;
  waiting(): readonly Op[];
  tombstones(): number;
  opLabel(op: Op): string;
  /** Why a held op is waiting, such as the id it needs. */
  waitReason(op: Op): string;
}

function quote(char: string): string {
  return `"${char}"`;
}

function clampIndex(at: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(at)));
}

export type IndexOp = { kind: 'insert'; index: number; char: string } | { kind: 'delete'; index: number };

interface IndexChar {
  key: string;
  char: string;
}

/** The naive design: positions are plain numbers, applied on arrival without adjustment. */
export class IndexReplica implements DocReplica<IndexOp> {
  readonly site: string;
  private chars: IndexChar[] = [];
  private nextKey = 0;

  constructor(site: string, start = '') {
    this.site = site;
    for (const char of start) this.chars.push(this.make(char));
  }

  private make(char: string): IndexChar {
    this.nextKey += 1;
    return { key: `${this.site}-${this.nextKey}`, char };
  }

  text(): string {
    return this.chars.map((entry) => entry.char).join('');
  }

  tiles(): Tile[] {
    return this.chars.map((entry, index) => ({
      key: entry.key,
      char: entry.char,
      label: String(index),
      deleted: false,
    }));
  }

  insertAt(at: number, char: string): IndexOp {
    const index = clampIndex(at, this.chars.length);
    this.chars.splice(index, 0, this.make(char));
    return { kind: 'insert', index, char };
  }

  deleteAt(at: number): IndexOp {
    const index = clampIndex(at, this.chars.length - 1);
    this.chars.splice(index, 1);
    return { kind: 'delete', index };
  }

  receive(op: IndexOp): number {
    if (op.kind === 'insert') {
      this.chars.splice(clampIndex(op.index, this.chars.length), 0, this.make(op.char));
    } else if (op.index < this.chars.length) {
      this.chars.splice(op.index, 1);
    }
    return 1;
  }

  waiting(): readonly IndexOp[] {
    return [];
  }

  tombstones(): number {
    return 0;
  }

  opLabel(op: IndexOp): string {
    return op.kind === 'insert' ? `insert ${quote(op.char)} at ${op.index}` : `delete at ${op.index}`;
  }

  waitReason(): string {
    return '';
  }
}

export type CrdtOp =
  | { kind: 'insert'; id: CharId; origin: CharId | null; char: string }
  | { kind: 'delete'; target: CharId };

interface CrdtChar {
  id: CharId;
  origin: CharId | null;
  char: string;
  deleted: boolean;
}

/** Ops that type `text` from an empty document at one site, for a shared starting copy. */
export function seedOps(text: string, site = 'a'): CrdtOp[] {
  const ops: CrdtOp[] = [];
  let origin: CharId | null = null;
  [...text].forEach((char, index) => {
    const id = { site, counter: index + 1 };
    ops.push({ kind: 'insert', id, origin, char });
    origin = id;
  });
  return ops;
}

/**
 * RGA style sequence CRDT. Deleted characters stay as hidden tombstones so
 * later inserts can still find them as left neighbors.
 */
export class CrdtReplica implements DocReplica<CrdtOp> {
  readonly site: string;
  private chars: CrdtChar[] = [];
  private known = new Set<string>();
  private held: CrdtOp[] = [];
  /** Lamport clock: one more than the largest counter this copy has applied. */
  private clock = 0;

  constructor(site: string, start: CrdtOp[] = []) {
    this.site = site;
    for (const op of start) this.receive(op);
  }

  text(): string {
    return this.chars
      .filter((entry) => !entry.deleted)
      .map((entry) => entry.char)
      .join('');
  }

  tiles(): Tile[] {
    return this.chars.map((entry) => {
      const label = idLabel(entry.id);
      return { key: label, char: entry.char, label, deleted: entry.deleted };
    });
  }

  /** Every character including tombstones, in document order, as `id:char` pairs. */
  structure(): string[] {
    return this.chars.map((entry) => `${idLabel(entry.id)}:${entry.char}${entry.deleted ? '-' : ''}`);
  }

  private visibleIndex(at: number): number {
    let seen = -1;
    for (let index = 0; index < this.chars.length; index += 1) {
      if (!this.chars[index]?.deleted) seen += 1;
      if (seen === at) return index;
    }
    return -1;
  }

  insertAt(at: number, char: string): CrdtOp {
    const visible = this.text().length;
    const position = clampIndex(at, visible);
    const left = position === 0 ? undefined : this.chars[this.visibleIndex(position - 1)];
    const op: CrdtOp = {
      kind: 'insert',
      id: { site: this.site, counter: this.clock + 1 },
      origin: left ? left.id : null,
      char,
    };
    this.apply(op);
    return op;
  }

  deleteAt(at: number): CrdtOp {
    const target = this.chars[this.visibleIndex(clampIndex(at, this.text().length - 1))];
    if (!target) throw new Error('Nothing to delete');
    const op: CrdtOp = { kind: 'delete', target: target.id };
    this.apply(op);
    return op;
  }

  private has(id: CharId): boolean {
    return this.known.has(idLabel(id));
  }

  private ready(op: CrdtOp): boolean {
    if (op.kind === 'delete') return this.has(op.target);
    return op.origin === null || this.has(op.origin);
  }

  private apply(op: CrdtOp): void {
    if (op.kind === 'delete') {
      const target = this.chars.find((entry) => compareIds(entry.id, op.target) === 0);
      if (target) target.deleted = true;
      return;
    }
    if (this.has(op.id)) return;
    const { origin } = op;
    let index = origin === null ? 0 : this.chars.findIndex((entry) => compareIds(entry.id, origin) === 0) + 1;
    // Characters anchored at the same spot with a larger id stay to the left, together with
    // everything typed after them; their ids are larger too, so one comparison skips them all.
    while (index < this.chars.length && compareIds(this.chars[index]?.id ?? op.id, op.id) > 0) index += 1;
    this.chars.splice(index, 0, { id: op.id, origin: op.origin, char: op.char, deleted: false });
    this.known.add(idLabel(op.id));
    this.clock = Math.max(this.clock, op.id.counter);
  }

  receive(op: CrdtOp): number {
    if (!this.ready(op)) {
      this.held.push(op);
      return 0;
    }
    this.apply(op);
    let applied = 1;
    let index = this.held.findIndex((entry) => this.ready(entry));
    while (index >= 0) {
      const [next] = this.held.splice(index, 1);
      if (next) this.apply(next);
      applied += 1;
      index = this.held.findIndex((entry) => this.ready(entry));
    }
    return applied;
  }

  waiting(): readonly CrdtOp[] {
    return this.held;
  }

  tombstones(): number {
    return this.chars.filter((entry) => entry.deleted).length;
  }

  opLabel(op: CrdtOp): string {
    if (op.kind === 'delete') return `delete ${idLabel(op.target)}`;
    const after = op.origin ? `after ${idLabel(op.origin)}` : 'at the start';
    return `insert ${quote(op.char)} ${idLabel(op.id)} ${after}`;
  }

  waitReason(op: CrdtOp): string {
    const needs = op.kind === 'delete' ? op.target : op.origin;
    return needs ? `needs ${idLabel(needs)}` : '';
  }
}

export type CopyName = 'ada' | 'ben';
export const copyNames: readonly CopyName[] = ['ada', 'ben'];
export const copyLabels: Record<CopyName, string> = { ada: 'Ada', ben: 'Ben' };
const copySites: Record<CopyName, string> = { ada: 'a', ben: 'b' };

function otherCopy(name: CopyName): CopyName {
  return name === 'ada' ? 'ben' : 'ada';
}

export type ScriptStep =
  | { type: 'type'; who: CopyName; at: number; char: string }
  | { type: 'erase'; who: CopyName; at: number }
  /** Hands one in flight edit to `to`. `slot` 0 is the oldest; a larger slot models reordering. */
  | { type: 'deliver'; to: CopyName; slot?: number };

export type ConvergenceScenarioId = 'same-spot' | 'insert-delete' | 'reordered';

export interface ConvergenceScenario {
  id: ConvergenceScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  /** Text both copies already share, typed earlier by Ada. */
  start: string;
  script: ScriptStep[];
}

export const convergenceScenarios: Record<ConvergenceScenarioId, ConvergenceScenario> = {
  'same-spot': {
    id: 'same-spot',
    label: 'Same-spot inserts',
    diff: 'Both start with Hi. Ada types ! after it while Ben types ya at the same spot.',
    start: 'Hi',
    script: [
      { type: 'type', who: 'ada', at: 2, char: '!' },
      { type: 'type', who: 'ben', at: 2, char: 'y' },
      { type: 'type', who: 'ben', at: 3, char: 'a' },
      { type: 'deliver', to: 'ben' },
      { type: 'deliver', to: 'ada' },
      { type: 'deliver', to: 'ada' },
    ],
  },
  'insert-delete': {
    id: 'insert-delete',
    label: 'Insert beside a delete',
    diff: 'Both start with cast. Ada deletes the s while Ben types o after the c.',
    start: 'cast',
    script: [
      { type: 'erase', who: 'ada', at: 2 },
      { type: 'type', who: 'ben', at: 1, char: 'o' },
      { type: 'deliver', to: 'ada' },
      { type: 'deliver', to: 'ben' },
    ],
  },
  reordered: {
    id: 'reordered',
    label: 'Delivery order swapped',
    diff: 'Both start with cat. Ada types s then !, Ben types h, and the network hands Ben the ! first.',
    start: 'cat',
    script: [
      { type: 'type', who: 'ada', at: 3, char: 's' },
      { type: 'type', who: 'ben', at: 1, char: 'h' },
      { type: 'type', who: 'ada', at: 4, char: '!' },
      { type: 'deliver', to: 'ben', slot: 1 },
      { type: 'deliver', to: 'ada' },
      { type: 'deliver', to: 'ben' },
    ],
  },
};

export type LaneKind = 'index' | 'crdt';
export const laneLabels: Record<LaneKind, string> = { index: 'Index positions', crdt: 'CRDT ids' };

export interface InFlight {
  seq: number;
  from: CopyName;
  label: string;
}

export interface DeliveryResult {
  label: string;
  /** Ops applied by this delivery, counting held ops it released. */
  applied: number;
  held: boolean;
  waitReason: string;
  text: string;
}

/** Two copies that sync through one design, with a queue of edits in flight toward each copy. */
export class SyncLane<Op> {
  readonly kind: LaneKind;
  readonly label: string;
  readonly copies: Record<CopyName, DocReplica<Op>>;
  /** Characters that differ between the copies after each tick of a duel. */
  readonly series: number[] = [];
  private queues: Record<CopyName, { seq: number; from: CopyName; op: Op }[]> = { ada: [], ben: [] };
  private sentCount = 0;
  private appliedCount = 0;

  constructor(kind: LaneKind, make: (site: string) => DocReplica<Op>) {
    this.kind = kind;
    this.label = laneLabels[kind];
    this.copies = { ada: make(copySites.ada), ben: make(copySites.ben) };
  }

  /** Runs a local edit on `who`'s copy and queues it for the other copy. Returns the op's label. */
  edit(step: Extract<ScriptStep, { type: 'type' | 'erase' }>): string {
    const copy = this.copies[step.who];
    const op = step.type === 'type' ? copy.insertAt(step.at, step.char) : copy.deleteAt(step.at);
    this.sentCount += 1;
    this.queues[otherCopy(step.who)].push({ seq: this.sentCount, from: step.who, op });
    return copy.opLabel(op);
  }

  deliver(to: CopyName, slot = 0): DeliveryResult | undefined {
    const queue = this.queues[to];
    const [message] = queue.splice(Math.min(slot, queue.length - 1), 1);
    if (!message) return undefined;
    const copy = this.copies[to];
    const applied = copy.receive(message.op);
    this.appliedCount += applied;
    return {
      label: copy.opLabel(message.op),
      applied,
      held: applied === 0,
      waitReason: copy.waitReason(message.op),
      text: copy.text(),
    };
  }

  inFlight(to: CopyName): InFlight[] {
    return this.queues[to].map((message) => ({
      seq: message.seq,
      from: message.from,
      label: this.copies[message.from].opLabel(message.op),
    }));
  }

  waitingLabels(name: CopyName): string[] {
    const copy = this.copies[name];
    return copy.waiting().map((op) => `${copy.opLabel(op)}, ${copy.waitReason(op)}`);
  }

  text(name: CopyName): string {
    return this.copies[name].text();
  }

  get matches(): boolean {
    return this.copies.ada.text() === this.copies.ben.text();
  }

  get sent(): number {
    return this.sentCount;
  }

  get applied(): number {
    return this.appliedCount;
  }

  get waiting(): number {
    return this.copies.ada.waiting().length + this.copies.ben.waiting().length;
  }

  get inFlightCount(): number {
    return this.queues.ada.length + this.queues.ben.length;
  }

  get tombstones(): number {
    return this.copies.ada.tombstones() + this.copies.ben.tombstones();
  }

  /** Characters at the same position that differ, plus any length difference. */
  get differing(): number {
    const a = this.copies.ada.text();
    const b = this.copies.ben.text();
    let count = Math.abs(a.length - b.length);
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) count += 1;
    }
    return count;
  }
}

export interface ConvergenceEvent {
  tick: number;
  text: string;
  /** False for the wrap up note at the end of a run. */
  marker: boolean;
}

function showText(text: string): string {
  return text === '' ? 'an empty document' : quote(text);
}

/** One scripted story played through both designs at once, one edit or delivery per tick. */
export class ConvergenceDuel {
  readonly scenario: ConvergenceScenario;
  readonly length: number;
  readonly lanes: [SyncLane<IndexOp>, SyncLane<CrdtOp>];
  readonly events: ConvergenceEvent[] = [];
  private tickCount = 0;

  constructor(scenario: ConvergenceScenario) {
    this.scenario = scenario;
    this.length = scenario.script.length;
    const seed = seedOps(scenario.start);
    this.lanes = [
      new SyncLane<IndexOp>('index', (site) => new IndexReplica(site, scenario.start)),
      new SyncLane<CrdtOp>('crdt', (site) => new CrdtReplica(site, seed)),
    ];
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    const step = this.scenario.script[tick];
    this.tickCount += 1;
    if (!step) return;
    const [indexLane, crdtLane] = this.lanes;
    if (step.type === 'deliver') {
      const from = copyLabels[otherCopy(step.to)];
      const reordered = (step.slot ?? 0) > 0;
      const a = indexLane.deliver(step.to, step.slot);
      const b = crdtLane.deliver(step.to, step.slot);
      if (a && b) {
        const lead = reordered
          ? `The network hands ${copyLabels[step.to]} a later edit from ${from} first.`
          : `${copyLabels[step.to]} receives an edit from ${from}.`;
        const crdt = b.held
          ? `CRDT ids holds ${b.label} because it ${b.waitReason}.`
          : b.applied > 1
            ? `CRDT ids applies ${b.label}, then the ${b.applied - 1 === 1 ? 'edit' : 'edits'} it was holding: ${showText(b.text)}.`
            : `CRDT ids applies ${b.label}: ${showText(b.text)}.`;
        this.events.push({
          tick,
          text: `${lead} Index positions applies ${a.label}: ${showText(a.text)}. ${crdt}`,
          marker: true,
        });
      }
    } else {
      const who = copyLabels[step.who];
      const before = indexLane.text(step.who);
      const a = indexLane.edit(step);
      const b = crdtLane.edit(step);
      const action =
        step.type === 'type'
          ? `${who} types ${quote(step.char)} at position ${step.at}`
          : `${who} deletes ${quote(before[step.at] ?? '')} at position ${step.at}`;
      const indexText = indexLane.text(step.who);
      const crdtText = crdtLane.text(step.who);
      const result =
        indexText === crdtText
          ? `making ${showText(indexText)}`
          : `making ${showText(indexText)} in Index positions and ${showText(crdtText)} in CRDT ids`;
      this.events.push({
        tick,
        text: `${action}, ${result}. Index positions sends ${a}; CRDT ids sends ${b}.`,
        marker: true,
      });
    }
    for (const lane of this.lanes) lane.series.push(lane.differing);
    if (this.done) this.events.push({ tick: this.tickCount, text: this.verdict(), marker: false });
  }

  private verdict(): string {
    return this.lanes
      .map((lane) =>
        lane.matches
          ? `${lane.label} ends with both copies at ${showText(lane.text('ada'))}.`
          : `${lane.label} ends with Ada at ${showText(lane.text('ada'))} and Ben at ${showText(lane.text('ben'))}, so the copies differ.`,
      )
      .join(' ');
  }
}

export interface SessionResult {
  texts: string[];
  edits: number;
  /** Largest number of ops any copy held at once while waiting for a dependency. */
  peakWaiting: number;
}

const sessionSites = ['a', 'b', 'c'] as const;
const sessionAlphabet = 'abcdefghij';

/**
 * Random concurrent editing across up to three copies: each step is either a
 * local edit or the delivery of any queued op, so ops arrive in random order.
 */
export function randomSession(
  design: LaneKind,
  seed: number,
  siteCount: 2 | 3,
  edits = 24,
  start = 'hello',
): SessionResult {
  const sites = sessionSites.slice(0, siteCount);
  if (design === 'crdt') {
    const shared = seedOps(start, 's');
    return runSession(
      sites.map((site) => new CrdtReplica(site, shared)),
      seed,
      edits,
    );
  }
  return runSession(
    sites.map((site) => new IndexReplica(site, start)),
    seed,
    edits,
  );
}

function runSession<Op>(copies: DocReplica<Op>[], seed: number, edits: number): SessionResult {
  const rng = createRng(seed);
  const queues: Op[][] = copies.map(() => []);
  let left = edits;
  let peakWaiting = 0;
  const queued = () => queues.reduce((sum, queue) => sum + queue.length, 0);
  while (left > 0 || queued() > 0) {
    if (left > 0 && (queued() === 0 || rng() < 0.5)) {
      const from = randomInt(rng, 0, copies.length - 1);
      const copy = copies[from];
      if (!copy) break;
      const length = copy.text().length;
      const op =
        length > 0 && rng() < 0.3
          ? copy.deleteAt(randomInt(rng, 0, length - 1))
          : copy.insertAt(
              randomInt(rng, 0, length),
              sessionAlphabet[randomInt(rng, 0, sessionAlphabet.length - 1)] ?? 'x',
            );
      queues.forEach((queue, index) => {
        if (index !== from) queue.push(op);
      });
      left -= 1;
    } else {
      const ready = queues
        .map((queue, index) => (queue.length > 0 ? index : -1))
        .filter((index) => index >= 0);
      const to = ready[randomInt(rng, 0, ready.length - 1)] ?? 0;
      const queue = queues[to] ?? [];
      const [op] = queue.splice(randomInt(rng, 0, queue.length - 1), 1);
      if (op) copies[to]?.receive(op);
      peakWaiting = Math.max(peakWaiting, ...copies.map((copy) => copy.waiting().length));
    }
  }
  return { texts: copies.map((copy) => copy.text()), edits, peakWaiting };
}

/** Illustrative: a steady typist enters about 5 characters a second, one op each. */
export const TYPING_OPS_PER_SECOND = 5;

/** Ops arriving at the relay server and copies it must send out when every editor types at once. */
export function relayLoad(
  editors: number,
  opsPerEditor = TYPING_OPS_PER_SECOND,
): { incoming: number; outgoing: number } {
  const incoming = editors * opsPerEditor;
  return { incoming, outgoing: incoming * Math.max(0, editors - 1) };
}

/** Illustrative sizes: a 4 byte site number plus a 4 byte counter per id. */
export const ID_BYTES = 8;
export const CHAR_BYTES = 1;
export const FLAG_BYTES = 1;
/** The character, its own id, its left neighbor's id, and a deleted flag. */
export const BYTES_PER_CRDT_CHAR = CHAR_BYTES + 2 * ID_BYTES + FLAG_BYTES;

/** Bytes the CRDT keeps for a document, counting tombstones, which this toy never removes. */
export function crdtBytes(visibleChars: number, deletedChars: number): number {
  return (visibleChars + deletedChars) * BYTES_PER_CRDT_CHAR;
}
