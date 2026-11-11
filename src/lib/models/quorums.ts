import { createRng, type Rng, randomInt } from '../rng';
import { HashRing, keyPosition } from './hashing';

/**
 * Toy model for the quorums lesson: one shopping cart stored on a hash ring of
 * five replicas. The cart service walks clockwise from the cart's key and
 * keeps N copies on the first N replicas it meets (the preference list).
 *
 * - A write ("add an item") carries the whole cart as a new version. The cart
 *   service sends it to every live replica in the preference list and
 *   confirms it to the shopper once W replicas have applied it.
 * - A read ("view the cart") asks R live replicas and returns the newest
 *   version among their answers.
 * - A replica that goes down keeps its data and misses every write until it
 *   returns. The model has no read repair and no hinted handoff, so a
 *   returning replica stays behind until the next write reaches it.
 *
 * Every number is illustrative. The requests, the network delays, and the
 * order the cart service tries replicas are drawn once from a seed and shared
 * by every quorum setting, so the settings differ only in N, R, and W. The
 * whole run is computed up front and revealed tick by tick, so replays and
 * resets match exactly.
 */

export const QUORUM_SECONDS = 7;
export const TICK_MS = 100;
/** How long the cart service waits for replicas before it gives up. */
export const TIMEOUT_MS = 800;
/** How fast the cart service refuses when too few replicas are up to try. */
export const REFUSE_MS = 4;
/** Requests stop here so every answer lands inside the run. */
const LAST_REQUEST_MS = 6000;
/** Chance that a replica is busy and applies a write late. */
const SLOW_CHANCE = 0.3;
export const WORKLOAD_SEED = 28;

export const REPLICAS = ['replica-a', 'replica-b', 'replica-c', 'replica-d', 'replica-e'] as const;
export type ReplicaId = (typeof REPLICAS)[number];
export const CART_KEY = 'cart:sam';
export const replicaRing = new HashRing(REPLICAS);

export const CATALOG = [
  'mug',
  'book',
  'scarf',
  'lamp',
  'tea',
  'pen',
  'jam',
  'soap',
  'socks',
  'kite',
  'rug',
  'map',
  'cup',
  'hat',
  'fig',
  'oil',
] as const;

export function replicaLabel(replica: string): string {
  return replica.slice(-1).toUpperCase();
}

/** The first `n` distinct replicas clockwise from the key's position on the ring. */
export function preferenceList(key: string, n: number, ring: HashRing = replicaRing): ReplicaId[] {
  const position = keyPosition(key);
  const points = ring.points;
  const first = points.findIndex((point) => point.position >= position);
  const start = Math.max(first, 0);
  const list: ReplicaId[] = [];
  for (let i = 0; i < points.length && list.length < n; i += 1) {
    const point = points[(start + i) % points.length];
    const replica = point?.shard as ReplicaId | undefined;
    if (replica && !list.includes(replica)) list.push(replica);
  }
  return list;
}

/** All five replicas in the order the cart's copies go: A, D, B, E, C. */
export const PREFERENCE: readonly ReplicaId[] = preferenceList(CART_KEY, REPLICAS.length);

export type QuorumSettingId = 'n3r1w1' | 'n3r2w2' | 'n3r1w3' | 'n5r3w3';

export interface QuorumSetting {
  id: QuorumSettingId;
  label: string;
  diff: string;
  n: number;
  r: number;
  w: number;
}

export const quorumSettings: Record<QuorumSettingId, QuorumSetting> = {
  n3r1w1: {
    id: 'n3r1w1',
    label: 'N3 R1 W1',
    diff: 'R + W = 2, at most N = 3: sets can miss',
    n: 3,
    r: 1,
    w: 1,
  },
  n3r2w2: { id: 'n3r2w2', label: 'N3 R2 W2', diff: 'R + W = 4 > N = 3: sets overlap', n: 3, r: 2, w: 2 },
  n3r1w3: {
    id: 'n3r1w3',
    label: 'N3 R1 W3',
    diff: 'R + W = 4 > N = 3: each write waits for all 3',
    n: 3,
    r: 1,
    w: 3,
  },
  n5r3w3: { id: 'n5r3w3', label: 'N5 R3 W3', diff: 'R + W = 6 > N = 5: sets overlap', n: 5, r: 3, w: 3 },
};

export const quorumSettingOrder: readonly QuorumSettingId[] = ['n3r1w1', 'n3r2w2', 'n3r1w3', 'n5r3w3'];

export function overlaps(setting: QuorumSetting): boolean {
  return setting.r + setting.w > setting.n;
}

export type FailureId = 'none' | 'one' | 'two';

export interface FailureScenario {
  id: FailureId;
  label: string;
  diff: string;
  /** Short phrase for sentences, such as "replica D down". */
  phrase: string;
  down: readonly ReplicaId[];
  from: number;
  to: number;
}

export const OUTAGE_FROM = 1000;
export const OUTAGE_TO = 3500;

export const failureScenarios: Record<FailureId, FailureScenario> = {
  none: {
    id: 'none',
    label: 'All replicas up',
    diff: 'no outage',
    phrase: 'all replicas up',
    down: [],
    from: OUTAGE_FROM,
    to: OUTAGE_TO,
  },
  one: {
    id: 'one',
    label: 'One replica down',
    diff: 'D down from 1.0 s to 3.5 s',
    phrase: 'replica D down',
    down: ['replica-d'],
    from: OUTAGE_FROM,
    to: OUTAGE_TO,
  },
  two: {
    id: 'two',
    label: 'Two replicas down',
    diff: 'D and B down from 1.0 s to 3.5 s',
    phrase: 'replicas D and B down',
    down: ['replica-d', 'replica-b'],
    from: OUTAGE_FROM,
    to: OUTAGE_TO,
  },
};

export const failureOrder: readonly FailureId[] = ['none', 'one', 'two'];

export function isDown(failure: FailureScenario, replica: ReplicaId, at: number): boolean {
  return failure.down.includes(replica) && at >= failure.from && at < failure.to;
}

export type OpKind = 'write' | 'read';

export interface CartOp {
  /** Also the op's index in the workload. */
  id: number;
  at: number;
  kind: OpKind;
  /** Writes: the cart version this write stores. */
  version: number | null;
  /** Writes: the item Sam adds. */
  item: string | null;
  /** Reads: true when Sam views the cart right after adding an item. */
  followsWrite: boolean;
  /** Per replica: ms from the cart service sending the request until the replica applies the write or serves the read. */
  reach: Record<ReplicaId, number>;
  /** Per replica: ms for the replica's answer to travel back. */
  back: Record<ReplicaId, number>;
  /** Reads: every replica, in the order the cart service tries them. */
  order: readonly ReplicaId[];
}

export type Outcome = 'ok' | 'stale' | 'failed';
export type FailReason = 'unavailable' | 'timeout';

export interface ReplicaReply {
  replica: ReplicaId;
  /** When the replica applied the write or served the read. */
  at: number;
  /** When the cart service hears back. */
  arriveAt: number;
  /** Writes: the version applied. Reads: the version the replica held. */
  version: number;
}

export interface OpResult {
  op: CartOp;
  outcome: Outcome;
  reason: FailReason | null;
  /** When Sam hears back, with an answer or an error. */
  replyAt: number;
  /** Replicas the cart service sent the request to. */
  contacted: ReplicaId[];
  /** Replicas that applied the write or answered the read, in the order their answers arrived. */
  replies: ReplicaReply[];
  /** Replicas whose answers made the quorum: the first W acks or the R replies. */
  counted: ReplicaId[];
  /** Reads: the version Sam saw. */
  seen: number | null;
  /** Reads: the newest version confirmed to Sam before the read started; 0 is the empty cart. */
  expected: number;
}

export interface Apply {
  replica: ReplicaId;
  at: number;
  version: number;
}

interface Moment {
  at: number;
  text: string;
}

export interface QuorumRun {
  setting: QuorumSetting;
  failure: FailureScenario;
  preference: ReplicaId[];
  /** Indexed by op id. */
  results: OpResult[];
  /** Sorted by time. */
  applies: Apply[];
  moments: Moment[];
}

export interface QuorumEvent {
  tick: number;
  at: number;
  text: string;
  marker: boolean;
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

function draftOp(
  rng: Rng,
  kind: OpKind,
  at: number,
  version: number | null,
  followsWrite: boolean,
): Omit<CartOp, 'id'> {
  const reach = {} as Record<ReplicaId, number>;
  const back = {} as Record<ReplicaId, number>;
  for (const replica of REPLICAS) {
    const trip = randomInt(rng, 2, 10);
    const work =
      kind === 'write'
        ? rng() < SLOW_CHANCE
          ? randomInt(rng, 150, 450)
          : randomInt(rng, 5, 40)
        : randomInt(rng, 1, 4);
    reach[replica] = trip + work;
    back[replica] = randomInt(rng, 2, 10);
  }
  const item = version === null ? null : (CATALOG[(version - 1) % CATALOG.length] as string);
  return { at, kind, version, item, followsWrite, reach, back, order: shuffled(rng, REPLICAS) };
}

/** Sam's adds and views for the whole run, with every replica's delays drawn up front. */
export function generateWorkload(seed: number): CartOp[] {
  const rng = createRng(seed);
  const drafts: Omit<CartOp, 'id'>[] = [];
  let at = 120;
  let version = 0;
  while (at <= LAST_REQUEST_MS) {
    if (rng() < 0.65) {
      version += 1;
      drafts.push(draftOp(rng, 'write', at, version, false));
      const viewAt = at + randomInt(rng, 60, 200);
      if (viewAt <= LAST_REQUEST_MS) drafts.push(draftOp(rng, 'read', viewAt, null, true));
    } else {
      drafts.push(draftOp(rng, 'read', at, null, false));
    }
    at += randomInt(rng, 260, 480);
  }
  return drafts.sort((a, b) => a.at - b.at).map((draft, id) => ({ ...draft, id }));
}

/** The newest version a replica held at `at` (inclusive); 0 is the empty cart every replica starts with. */
function versionAt(applies: readonly Apply[], replica: ReplicaId, at: number): number {
  let version = 0;
  for (const apply of applies) {
    if (apply.at > at) break;
    if (apply.replica === replica) version = Math.max(version, apply.version);
  }
  return version;
}

function byArrival(a: ReplicaReply, b: ReplicaReply): number {
  return a.arriveAt - b.arriveAt || a.replica.localeCompare(b.replica);
}

function runWrite(
  op: CartOp,
  setting: QuorumSetting,
  failure: FailureScenario,
  preference: readonly ReplicaId[],
  applies: Apply[],
): OpResult {
  const base = { op, seen: null, expected: 0 };
  const up = preference.filter((replica) => !isDown(failure, replica, op.at));
  if (up.length < setting.w) {
    return {
      ...base,
      outcome: 'failed',
      reason: 'unavailable',
      replyAt: op.at + REFUSE_MS,
      contacted: [],
      replies: [],
      counted: [],
    };
  }
  const version = op.version ?? 0;
  const replies: ReplicaReply[] = [];
  for (const replica of up) {
    const at = op.at + op.reach[replica];
    if (isDown(failure, replica, at)) continue;
    applies.push({ replica, at, version });
    replies.push({ replica, at, arriveAt: at + op.back[replica], version });
  }
  replies.sort(byArrival);
  const deadline = op.at + TIMEOUT_MS;
  const quorum = replies[setting.w - 1];
  if (quorum && quorum.arriveAt <= deadline) {
    return {
      ...base,
      outcome: 'ok',
      reason: null,
      replyAt: quorum.arriveAt,
      contacted: up,
      replies,
      counted: replies.slice(0, setting.w).map((reply) => reply.replica),
    };
  }
  return {
    ...base,
    outcome: 'failed',
    reason: 'timeout',
    replyAt: deadline,
    contacted: up,
    replies,
    counted: [],
  };
}

function runRead(
  op: CartOp,
  setting: QuorumSetting,
  failure: FailureScenario,
  preference: readonly ReplicaId[],
  applies: readonly Apply[],
  confirmed: readonly OpResult[],
): OpResult {
  let expected = 0;
  for (const write of confirmed) {
    if (write.replyAt <= op.at) expected = Math.max(expected, write.op.version ?? 0);
  }
  const base = { op, expected };
  const up = op.order.filter((replica) => preference.includes(replica) && !isDown(failure, replica, op.at));
  if (up.length < setting.r) {
    return {
      ...base,
      outcome: 'failed',
      reason: 'unavailable',
      replyAt: op.at + REFUSE_MS,
      contacted: [],
      replies: [],
      counted: [],
      seen: null,
    };
  }
  const contacted = up.slice(0, setting.r);
  const replies: ReplicaReply[] = [];
  for (const replica of contacted) {
    const at = op.at + op.reach[replica];
    if (isDown(failure, replica, at)) continue;
    replies.push({ replica, at, arriveAt: at + op.back[replica], version: versionAt(applies, replica, at) });
  }
  replies.sort(byArrival);
  const deadline = op.at + TIMEOUT_MS;
  const last = replies[setting.r - 1];
  if (!last || last.arriveAt > deadline) {
    return {
      ...base,
      outcome: 'failed',
      reason: 'timeout',
      replyAt: deadline,
      contacted,
      replies,
      counted: [],
      seen: null,
    };
  }
  const seen = Math.max(...replies.map((reply) => reply.version));
  return {
    ...base,
    outcome: seen < expected ? 'stale' : 'ok',
    reason: null,
    replyAt: last.arriveAt,
    contacted,
    replies,
    counted: contacted,
    seen,
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export function listReplicas(replicas: readonly string[]): string {
  const labels = replicas.map(replicaLabel);
  if (labels.length <= 1) return labels[0] ?? 'none';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function itemFor(version: number): string {
  return CATALOG[(version - 1) % CATALOG.length] as string;
}

function staleText(result: OpResult, confirmedAt: number): string {
  const seen = result.seen ?? 0;
  const missing = result.expected - seen;
  const what = missing === 1 ? `the ${itemFor(result.expected)}` : `${missing} confirmed adds`;
  return `Stale read: the cart service asks ${listReplicas(result.contacted)} and gets v${seen}. The add of the ${itemFor(result.expected)} (v${result.expected}) was confirmed to Sam at ${seconds(confirmedAt)}, so the cart is missing ${what}.`;
}

function overlapText(result: OpResult): string {
  const seen = result.seen ?? 0;
  const versions = [...new Set(result.replies.map((reply) => reply.version))].sort((a, b) => a - b);
  const clauses = versions.map((version) => {
    const holders = result.replies.filter((reply) => reply.version === version).map((reply) => reply.replica);
    const verb = holders.length === 1 ? 'holds' : 'hold';
    return `${listReplicas(holders)} ${version < seen ? `still ${verb}` : verb} v${version}`;
  });
  const holdings =
    clauses.length <= 2 ? clauses.join(' and ') : `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
  return `Overlap saves the read: the cart service asks ${listReplicas(result.contacted)}. ${holdings}, so the service returns the newest, v${seen}.`;
}

function failureText(
  result: OpResult,
  setting: QuorumSetting,
  failure: FailureScenario,
  preference: readonly ReplicaId[],
): string {
  const { op } = result;
  const up = preference.filter((replica) => !isDown(failure, replica, op.at)).length;
  const upText = `only ${up} of the ${setting.n} replicas for this cart ${up === 1 ? 'is' : 'are'} up`;
  if (result.reason === 'unavailable') {
    return op.kind === 'write'
      ? `Write refused: Sam adds the ${op.item}, but ${upText} and W = ${setting.w}.`
      : `Read refused: ${upText} and R = ${setting.r}.`;
  }
  if (op.kind === 'write') {
    const count = result.replies.filter((reply) => reply.arriveAt <= result.replyAt).length;
    return `Write failed: ${plural(count, 'replica', 'replicas')} confirmed the ${op.item} within ${TIMEOUT_MS} ms and W = ${setting.w}. Copies that applied it keep it.`;
  }
  const count = result.replies.filter((reply) => reply.arriveAt <= result.replyAt).length;
  return `Read failed: ${count} of the ${setting.r} replicas asked answered within ${TIMEOUT_MS} ms.`;
}

const MAX_STALE_MOMENTS = 3;
const MAX_FAILED_MOMENTS = 2;
const MAX_OVERLAP_MOMENTS = 2;

function runMoments(
  results: readonly OpResult[],
  setting: QuorumSetting,
  failure: FailureScenario,
  preference: readonly ReplicaId[],
): Moment[] {
  const moments: Moment[] = [];
  const confirmedAt = new Map<number, number>();
  for (const result of results) {
    if (result.op.kind === 'write' && result.outcome === 'ok')
      confirmedAt.set(result.op.version ?? 0, result.replyAt);
  }
  let stale = 0;
  let failedWrites = 0;
  let failedReads = 0;
  let saves = 0;
  for (const result of results) {
    const { op } = result;
    if (result.outcome === 'stale' && stale < MAX_STALE_MOMENTS) {
      stale += 1;
      moments.push({ at: result.replyAt, text: staleText(result, confirmedAt.get(result.expected) ?? 0) });
    }
    if (result.outcome === 'failed') {
      const isWrite = op.kind === 'write';
      if ((isWrite ? failedWrites : failedReads) < MAX_FAILED_MOMENTS) {
        if (isWrite) failedWrites += 1;
        else failedReads += 1;
        moments.push({ at: result.replyAt, text: failureText(result, setting, failure, preference) });
      }
    }
    if (
      result.outcome === 'ok' &&
      op.kind === 'read' &&
      saves < MAX_OVERLAP_MOMENTS &&
      result.expected > 0 &&
      result.replies.some((reply) => reply.version < result.expected)
    ) {
      saves += 1;
      moments.push({ at: result.replyAt, text: overlapText(result) });
    }
  }
  return moments;
}

export function runQuorum(
  setting: QuorumSetting,
  failure: FailureScenario,
  workload: readonly CartOp[],
): QuorumRun {
  const preference = PREFERENCE.slice(0, setting.n);
  const applies: Apply[] = [];
  const results: OpResult[] = new Array(workload.length);
  for (const op of workload) {
    if (op.kind === 'write') results[op.id] = runWrite(op, setting, failure, preference, applies);
  }
  applies.sort((a, b) => a.at - b.at || a.replica.localeCompare(b.replica));
  const confirmed = results.filter((result) => result?.outcome === 'ok');
  for (const op of workload) {
    if (op.kind === 'read') results[op.id] = runRead(op, setting, failure, preference, applies, confirmed);
  }
  return {
    setting,
    failure,
    preference,
    results,
    applies,
    moments: runMoments(results, setting, failure, preference),
  };
}

export interface QuorumSummary {
  issued: number;
  writes: number;
  reads: number;
  /** Confirmed writes and up-to-date reads. */
  ok: number;
  stale: number;
  failed: number;
  failedWrites: number;
  failedReads: number;
  inFlight: number;
  /** Average wait for a confirmed write. */
  averageWriteMs: number;
  /** Average wait for an answered read, stale or not. */
  averageReadMs: number;
}

/** Totals for everything that happened before `now` (ms). */
export function summarize(run: QuorumRun, now: number): QuorumSummary {
  const sum: QuorumSummary = {
    issued: 0,
    writes: 0,
    reads: 0,
    ok: 0,
    stale: 0,
    failed: 0,
    failedWrites: 0,
    failedReads: 0,
    inFlight: 0,
    averageWriteMs: 0,
    averageReadMs: 0,
  };
  let writeWait = 0;
  let writeCount = 0;
  let readWait = 0;
  let readCount = 0;
  for (const result of run.results) {
    const { op } = result;
    if (op.at >= now) continue;
    sum.issued += 1;
    if (op.kind === 'write') sum.writes += 1;
    else sum.reads += 1;
    if (result.replyAt >= now) continue;
    if (result.outcome === 'failed') {
      sum.failed += 1;
      if (op.kind === 'write') sum.failedWrites += 1;
      else sum.failedReads += 1;
      continue;
    }
    if (result.outcome === 'stale') sum.stale += 1;
    else sum.ok += 1;
    if (op.kind === 'write') {
      writeWait += result.replyAt - op.at;
      writeCount += 1;
    } else {
      readWait += result.replyAt - op.at;
      readCount += 1;
    }
  }
  sum.inFlight = sum.issued - sum.ok - sum.stale - sum.failed;
  sum.averageWriteMs = writeCount > 0 ? writeWait / writeCount : 0;
  sum.averageReadMs = readCount > 0 ? readWait / readCount : 0;
  return sum;
}

/** The newest version a replica holds just before `now`. */
export function replicaVersion(run: QuorumRun, replica: ReplicaId, now: number): number {
  return versionAt(run.applies, replica, now - 1);
}

/** The newest version confirmed to Sam before `now`; 0 is the empty cart. */
export function confirmedVersion(run: QuorumRun, now: number): number {
  let version = 0;
  for (const result of run.results) {
    if (result.op.kind === 'write' && result.outcome === 'ok' && result.replyAt < now)
      version = Math.max(version, result.op.version ?? 0);
  }
  return version;
}

/** The op whose answer Sam heard most recently before `now`. */
export function lastAnswered(run: QuorumRun, now: number, kind?: OpKind): OpResult | null {
  let latest: OpResult | null = null;
  for (const result of run.results) {
    if (result.replyAt >= now || (kind && result.op.kind !== kind)) continue;
    if (!latest || result.replyAt >= latest.replyAt) latest = result;
  }
  return latest;
}

export function describeOp(op: CartOp): string {
  return op.kind === 'write' ? `Add the ${op.item} (v${op.version})` : 'View the cart';
}

/** One line for the transcript and the live readout. */
export function resultText(result: OpResult, now: number): string {
  if (result.replyAt >= now) return 'Waiting';
  const wait = result.replyAt - result.op.at;
  if (result.outcome === 'failed') {
    return result.reason === 'unavailable'
      ? `Refused in ${wait} ms: too few replicas up`
      : `Failed after ${wait} ms: too few answers in time`;
  }
  if (result.op.kind === 'write') return `Confirmed in ${wait} ms by ${listReplicas(result.counted)}`;
  const from = listReplicas(result.contacted);
  if (result.outcome === 'stale')
    return `Stale: saw v${result.seen} from ${from} in ${wait} ms, though v${result.expected} was confirmed`;
  return `Saw v${result.seen} from ${from} in ${wait} ms, up to date`;
}

export class QuorumSim {
  readonly setting: QuorumSetting;
  readonly failure: FailureScenario;
  readonly workload: readonly CartOp[];
  /** Every setting on the same requests and failure, for the comparison table. */
  readonly runs: Record<QuorumSettingId, QuorumRun>;
  readonly run: QuorumRun;
  readonly length = (QUORUM_SECONDS * 1000) / TICK_MS;
  readonly tickSeconds = TICK_MS / 1000;
  readonly events: QuorumEvent[] = [];
  /** Running totals, one value per tick. */
  readonly staleSeries: number[] = [];
  readonly failedSeries: number[] = [];
  private readonly timeline: Moment[];
  private revealed = 0;
  private tickCount = 0;

  constructor(settingId: QuorumSettingId, failureId: FailureId, seed = WORKLOAD_SEED) {
    this.setting = quorumSettings[settingId];
    this.failure = failureScenarios[failureId];
    this.workload = generateWorkload(seed);
    const failure = this.failure;
    this.runs = Object.fromEntries(
      quorumSettingOrder.map((id) => [id, runQuorum(quorumSettings[id], failure, this.workload)]),
    ) as Record<QuorumSettingId, QuorumRun>;
    this.run = this.runs[settingId];
    const down = failure.down;
    const one = down.length === 1;
    const names = `${one ? 'Replica' : 'Replicas'} ${listReplicas(down)}`;
    const outage: Moment[] =
      down.length === 0
        ? []
        : [
            {
              at: failure.from,
              text: `${names} ${one ? 'goes' : 'go'} down. A down replica keeps its data and misses every write until it returns.`,
            },
            {
              at: failure.to,
              text: `${names} ${one ? 'is' : 'are'} back with only what ${one ? 'it' : 'they'} held at ${seconds(failure.from)}. Nothing in this model copies the missed adds over, so ${one ? 'it stays' : 'they stay'} behind until the next write delivers the whole cart.`,
            },
          ];
    this.timeline = [...outage, ...this.run.moments].sort((a, b) => a.at - b.at);
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  /** Simulated time shown on screen, in ms. */
  get now(): number {
    return this.tickCount * TICK_MS;
  }

  step(): void {
    if (this.done) return;
    const tick = this.tickCount;
    this.tickCount += 1;
    const now = this.now;
    while (this.revealed < this.timeline.length) {
      const moment = this.timeline[this.revealed] as Moment;
      if (moment.at >= now) break;
      this.events.push({ tick, at: moment.at, text: moment.text, marker: true });
      this.revealed += 1;
    }
    const sum = summarize(this.run, now);
    this.staleSeries.push(sum.stale);
    this.failedSeries.push(sum.failed);
    if (this.done) {
      const text = `Run complete. ${this.setting.label} with ${this.failure.phrase}: ${plural(sum.stale, 'stale read', 'stale reads')} and ${sum.failed} failed out of ${sum.issued} requests. Average wait: ${Math.round(sum.averageWriteMs)} ms per confirmed write, ${Math.round(sum.averageReadMs)} ms per read.`;
      this.events.push({ tick, at: now, text, marker: false });
    }
  }
}
