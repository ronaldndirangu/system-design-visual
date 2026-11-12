import { createRng, poisson, randomInt } from '../rng';
import { preferenceList, REPLICAS, type ReplicaId, replicaLabel, replicaRing } from './quorums';

/**
 * Two replication policies share one seeded workload on a five-node ring with N = 3, R = 2, W = 2.
 *
 * - Strict quorum: only a key's three home replicas count. A write or read that cannot reach two of
 *   them is refused up front. The coordinator keeps a hint for each home replica that missed a write,
 *   but hints never count toward W.
 * - Sloppy quorum: requests go to the first three healthy nodes on the clockwise walk from the key.
 *   A fallback node counts toward W, stores the write, and keeps a hint naming the home replica it
 *   stands in for. It holds only what it took during the outage, so it answers "not found" for older keys.
 *
 * Both lanes replay hints to returning nodes at the same throttled rate and both read-repair the
 * replicas they asked. Requests are instantaneous and a version is a global write counter, so a read
 * is stale when the newest version among its R answers is older than the last write that lane accepted.
 * Time moves in 100 ms steps; every number is illustrative.
 */

export type KvStoreDuelId = 'two-down' | 'one-down' | 'slow-handoff';

export interface KvStoreScenario {
  id: KvStoreDuelId;
  label: string;
  diff: string;
  down: readonly ReplicaId[];
  downFrom: number;
  downUntil: number;
  handoffPerSecond: number;
  tickSeconds: number;
  maxSeconds: number;
}

export const KV_N = 3;
export const KV_R = 2;
export const KV_W = 2;
export const KV_KEYS = 300;
export const KV_OPS_PER_SECOND = 60;
const STEP_MS = 100;

export const kvStoreScenarios: Record<KvStoreDuelId, KvStoreScenario> = {
  'two-down': {
    id: 'two-down',
    label: 'Two nodes down',
    diff: 'Nodes D and B stop for 20 s. They sit next to each other on the ring, so some keys lose two of their three home copies',
    down: ['replica-d', 'replica-b'],
    downFrom: 5,
    downUntil: 25,
    handoffPerSecond: 100,
    tickSeconds: 1,
    maxSeconds: 40,
  },
  'one-down': {
    id: 'one-down',
    label: 'One node down',
    diff: 'Only node D stops for 20 s, so every key keeps at least two home copies',
    down: ['replica-d'],
    downFrom: 5,
    downUntil: 25,
    handoffPerSecond: 100,
    tickSeconds: 1,
    maxSeconds: 40,
  },
  'slow-handoff': {
    id: 'slow-handoff',
    label: 'Throttled handoff',
    diff: 'Nodes D and B stop for 20 s, and hints replay at 10 per second instead of 100',
    down: ['replica-d', 'replica-b'],
    downFrom: 5,
    downUntil: 25,
    handoffPerSecond: 10,
    tickSeconds: 1,
    maxSeconds: 60,
  },
};

export interface KvNodeState {
  id: ReplicaId;
  label: string;
  down: boolean;
  /** Keys this node is a home replica for. */
  owned: number;
  /** Home keys where this node holds an older version than the last accepted write. */
  behind: number;
  /** Hints waiting to be replayed to this node. */
  owed: number;
}

export interface KvStoreTotals {
  writes: number;
  writesRefused: number;
  reads: number;
  readsRefused: number;
  staleReads: number;
  staleAfterReturn: number;
  hintsPending: number;
  hintsDelivered: number;
  readRepairs: number;
  nodes: KvNodeState[];
}

export interface KvStoreEvent {
  tick: number;
  text: string;
  marker: boolean;
}

interface Op {
  kind: 'read' | 'write';
  key: number;
  /** Seeded draw that picks which R contacted replicas answer first. */
  pick: number;
}

interface Hint {
  target: ReplicaId;
  key: number;
  version: number;
}

export const kvKey = (index: number) => `user:${index}`;

/** Home replicas and the full clockwise walk for every key, computed once. */
const KEY_HOMES: ReplicaId[][] = [];
const KEY_WALKS: ReplicaId[][] = [];
for (let index = 0; index < KV_KEYS; index += 1) {
  const walk = preferenceList(kvKey(index), REPLICAS.length);
  KEY_WALKS.push(walk);
  KEY_HOMES.push(walk.slice(0, KV_N));
}

/** The order nodes sit on the ring, which is the order the clockwise walk visits them. */
export const KV_RING: readonly ReplicaId[] = (() => {
  const order = replicaRing.points.map((point) => point.shard as ReplicaId);
  const start = Math.max(0, order.indexOf('replica-a'));
  return [...order.slice(start), ...order.slice(0, start)];
})();

function choose<T>(items: readonly T[], count: number, pick: number): T[] {
  const combos: T[][] = [];
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length === count) {
      combos.push(chosen);
      return;
    }
    for (let i = start; i < items.length; i += 1) walk(i + 1, [...chosen, items[i] as T]);
  };
  walk(0, []);
  return combos[Math.min(combos.length - 1, Math.floor(pick * combos.length))] ?? [];
}

type ReadResult = { outcome: 'ok' | 'stale' | 'refused'; responders: ReplicaId[] };

class Lane {
  readonly sloppy: boolean;
  private readonly stores = new Map<ReplicaId, Int32Array>();
  /** Newest version this lane accepted per key; a read older than this is stale. */
  private readonly latest = new Int32Array(KV_KEYS);
  private hints: Hint[] = [];
  writes = 0;
  writesRefused = 0;
  reads = 0;
  readsRefused = 0;
  staleReads = 0;
  staleAfterReturn = 0;
  hintsDelivered = 0;
  readRepairs = 0;

  constructor(sloppy: boolean) {
    this.sloppy = sloppy;
    for (const replica of REPLICAS) this.stores.set(replica, new Int32Array(KV_KEYS).fill(-1));
    KEY_HOMES.forEach((homes, key) => {
      for (const home of homes) this.store(home)[key] = 0;
    });
  }

  private store(replica: ReplicaId): Int32Array {
    const store = this.stores.get(replica);
    if (!store) throw new Error(`unknown replica ${replica}`);
    return store;
  }

  private apply(replica: ReplicaId, key: number, version: number) {
    const store = this.store(replica);
    if ((store[key] ?? -1) < version) store[key] = version;
  }

  private contacts(key: number, up: ReadonlySet<ReplicaId>): ReplicaId[] {
    const candidates = this.sloppy ? (KEY_WALKS[key] ?? []) : (KEY_HOMES[key] ?? []);
    return candidates.filter((replica) => up.has(replica)).slice(0, KV_N);
  }

  get pending(): number {
    return this.hints.length;
  }

  write(key: number, version: number, up: ReadonlySet<ReplicaId>): boolean {
    const targets = this.contacts(key, up);
    if (targets.length < KV_W) {
      this.writesRefused += 1;
      return false;
    }
    this.writes += 1;
    this.latest[key] = version;
    for (const target of targets) this.apply(target, key, version);
    const missed = (KEY_HOMES[key] ?? []).filter((home) => !up.has(home));
    // Strict: the coordinator keeps a hint per missed home replica. Sloppy: each fallback that took the
    // write keeps one, so a home replica gets a hint only when a fallback stood in for it.
    const hinted = this.sloppy ? missed.slice(0, targets.length - (KV_N - missed.length)) : missed;
    for (const target of hinted) this.hints.push({ target, key, version });
    return true;
  }

  read(key: number, pick: number, up: ReadonlySet<ReplicaId>, returned: boolean): ReadResult {
    const contacted = this.contacts(key, up);
    if (contacted.length < KV_R) {
      this.readsRefused += 1;
      return { outcome: 'refused', responders: [] };
    }
    this.reads += 1;
    const responders = choose(contacted, KV_R, pick);
    const newest = Math.max(...responders.map((replica) => this.store(replica)[key] ?? -1));
    for (const replica of responders) {
      if ((this.store(replica)[key] ?? -1) < newest) {
        this.apply(replica, key, newest);
        this.readRepairs += 1;
      }
    }
    if (newest >= (this.latest[key] ?? 0)) return { outcome: 'ok', responders };
    this.staleReads += 1;
    if (returned) this.staleAfterReturn += 1;
    return { outcome: 'stale', responders };
  }

  handoff(budget: number, up: ReadonlySet<ReplicaId>): number {
    let delivered = 0;
    const kept: Hint[] = [];
    for (const hint of this.hints) {
      if (delivered < budget && up.has(hint.target)) {
        this.apply(hint.target, hint.key, hint.version);
        delivered += 1;
      } else {
        kept.push(hint);
      }
    }
    this.hints = kept;
    this.hintsDelivered += delivered;
    return delivered;
  }

  totals(up: ReadonlySet<ReplicaId>): KvStoreTotals {
    const nodes = KV_RING.map((id) => {
      const store = this.store(id);
      let owned = 0;
      let behind = 0;
      KEY_HOMES.forEach((homes, key) => {
        if (!homes.includes(id)) return;
        owned += 1;
        if ((store[key] ?? -1) < (this.latest[key] ?? 0)) behind += 1;
      });
      const owed = this.hints.filter((hint) => hint.target === id).length;
      return { id, label: replicaLabel(id), down: !up.has(id), owned, behind, owed };
    });
    return {
      writes: this.writes,
      writesRefused: this.writesRefused,
      reads: this.reads,
      readsRefused: this.readsRefused,
      staleReads: this.staleReads,
      staleAfterReturn: this.staleAfterReturn,
      hintsPending: this.hints.length,
      hintsDelivered: this.hintsDelivered,
      readRepairs: this.readRepairs,
      nodes,
    };
  }
}

/** The seeded request stream both lanes replay, one list of operations per 100 ms step. */
export function kvWorkload(steps: number, seed = 42): Op[][] {
  const rng = createRng(seed);
  const perStep = (KV_OPS_PER_SECOND * STEP_MS) / 1000;
  return Array.from({ length: steps }, () =>
    Array.from({ length: poisson(rng, perStep) }, () => ({
      kind: rng() < 0.5 ? ('read' as const) : ('write' as const),
      key: randomInt(rng, 0, KV_KEYS - 1),
      pick: rng(),
    })),
  );
}

const names = (replicas: readonly ReplicaId[]) => {
  const labels = replicas.map(replicaLabel);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : (labels[0] ?? '');
};

/** Both policies serve the same requests through the same outage, sampled once per chart tick. */
export class KvStoreRun {
  readonly scenario: KvStoreScenario;
  readonly length: number;
  readonly tickSeconds: number;
  /** Requests refused or answered with stale data in each tick, per lane. */
  readonly series: [number[], number[]] = [[], []];
  readonly events: KvStoreEvent[] = [];
  private readonly snapshots: Array<[KvStoreTotals, KvStoreTotals]> = [];
  private readonly errors: Array<[number, number]> = [];
  private readonly timeline: KvStoreEvent[] = [];
  private readonly initial: [KvStoreTotals, KvStoreTotals];
  private readonly final: [KvStoreTotals, KvStoreTotals];
  private tickCount = 0;

  constructor(scenario: KvStoreScenario, seed = 42) {
    this.scenario = scenario;
    this.tickSeconds = scenario.tickSeconds;
    const stepsPerSecond = 1000 / STEP_MS;
    const stepsPerTick = Math.round(scenario.tickSeconds * stepsPerSecond);
    const limit = scenario.maxSeconds * stepsPerSecond;
    const downFrom = scenario.downFrom * stepsPerSecond;
    const downUntil = scenario.downUntil * stepsPerSecond;
    const budget = (scenario.handoffPerSecond * STEP_MS) / 1000;
    const ops = kvWorkload(limit, seed);
    const lanes: [Lane, Lane] = [new Lane(false), new Lane(true)];
    const everyone = new Set<ReplicaId>(REPLICAS);
    const degraded = new Set<ReplicaId>(REPLICAS.filter((replica) => !scenario.down.includes(replica)));
    const tickOf = (step: number) => Math.floor(step / stepsPerTick);
    const first = { refused: false, stale: false, staleAfter: false, drained: [false, false] };
    let version = 0;
    let tickErrors: [number, number] = [0, 0];
    this.initial = [lanes[0].totals(everyone), lanes[1].totals(everyone)];

    for (let step = 0; step < limit; step += 1) {
      const up = step >= downFrom && step < downUntil ? degraded : everyone;
      const returned = step >= downUntil;
      const tick = tickOf(step);
      if (step === downFrom) {
        this.timeline.push({
          tick,
          text: `${names(scenario.down)} ${scenario.down.length === 1 ? 'stops' : 'stop'} answering`,
          marker: true,
        });
      }
      if (step === downUntil) {
        const waiting = (lane: Lane) => `${lane.pending} ${lane.pending === 1 ? 'hint' : 'hints'}`;
        const single = scenario.down.length === 1;
        this.timeline.push({
          tick,
          text: `${names(scenario.down)} ${single ? 'comes' : 'come'} back. Strict holds ${waiting(lanes[0])} for ${single ? 'it' : 'them'}; sloppy holds ${waiting(lanes[1])}`,
          marker: true,
        });
      }
      lanes.forEach((lane, index) => {
        const hadHints = lane.pending > 0;
        lane.handoff(budget, up);
        if (returned && hadHints && lane.pending === 0 && !first.drained[index]) {
          first.drained[index] = true;
          const name = index === 0 ? 'Strict' : 'Sloppy';
          this.timeline.push({ tick, text: `${name} lane replays its last hint`, marker: true });
        }
      });
      for (const op of ops[step] ?? []) {
        const key = kvKey(op.key);
        const homes = names(KEY_HOMES[op.key] ?? []);
        if (op.kind === 'write') {
          version += 1;
          const accepted = lanes.map((lane) => lane.write(op.key, version, up));
          accepted.forEach((ok, index) => {
            if (!ok) tickErrors[index as 0 | 1] += 1;
          });
          if (!accepted[0] && !first.refused) {
            first.refused = true;
            this.timeline.push({
              tick,
              text: `Strict refuses a write to ${key}: its home replicas are ${homes}, and only one is up`,
              marker: true,
            });
          }
          continue;
        }
        const results = lanes.map((lane) => lane.read(op.key, op.pick, up, returned));
        results.forEach((result, index) => {
          if (result.outcome !== 'ok') tickErrors[index as 0 | 1] += 1;
        });
        const sloppy = results[1];
        if (sloppy?.outcome === 'stale' && !returned && !first.stale) {
          first.stale = true;
          this.timeline.push({
            tick,
            text: `Sloppy answers a read of ${key} from ${names(sloppy.responders)}. Neither holds its latest write, so the client gets an old value or “not found”`,
            marker: true,
          });
        }
        if (sloppy?.outcome === 'stale' && returned && !first.staleAfter) {
          first.staleAfter = true;
          this.timeline.push({
            tick,
            text: `After the return, sloppy reads ${key} from ${names(sloppy.responders)} before their hints land and serves an old value`,
            marker: true,
          });
        }
      }
      if ((step + 1) % stepsPerTick === 0 || step + 1 === limit) {
        this.snapshots.push([lanes[0].totals(up), lanes[1].totals(up)]);
        this.errors.push(tickErrors);
        tickErrors = [0, 0];
      }
    }
    this.length = this.snapshots.length;
    this.final = this.snapshots[this.length - 1] ?? this.initial;
  }

  get ticks(): number {
    return this.tickCount;
  }

  get done(): boolean {
    return this.tickCount >= this.length;
  }

  get labels(): [string, string] {
    return ['Strict quorum', 'Sloppy quorum + hints'];
  }

  totals(): [KvStoreTotals, KvStoreTotals] {
    if (this.tickCount === 0) return this.initial;
    return this.snapshots[this.tickCount - 1] ?? this.final;
  }

  /** Totals at the end of the run, whatever tick the run has reached. */
  finalTotals(): [KvStoreTotals, KvStoreTotals] {
    return this.final;
  }

  step() {
    if (this.done) return;
    const tick = this.tickCount;
    const errors = this.errors[tick];
    if (errors) {
      this.series[0].push(errors[0] / this.tickSeconds);
      this.series[1].push(errors[1] / this.tickSeconds);
    }
    this.events.push(...this.timeline.filter((event) => event.tick === tick));
    this.tickCount += 1;
    if (this.done) {
      const [strict, sloppy] = this.final;
      const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
      const note =
        `Strict refused ${plural(strict.writesRefused, 'write')} and ${plural(strict.readsRefused, 'read')} ` +
        `and served ${plural(strict.staleReads, 'stale read')}. Sloppy refused ${plural(sloppy.writesRefused + sloppy.readsRefused, 'request')} ` +
        `and served ${plural(sloppy.staleReads, 'stale read')}, ${sloppy.staleAfterReturn} of them after ${this.scenario.down.length === 1 ? 'the node' : 'the nodes'} came back.`;
      this.events.push({ tick: this.length, text: note, marker: false });
    }
  }
}
