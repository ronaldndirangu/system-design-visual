import { createRng, randomInt } from '../rng';

/**
 * A toy group chat on three replicas. Any replica accepts a write and copies
 * it to the other two after a seeded delay. A load balancer sends each request
 * to a seeded replica. The same pre-generated workload runs once per
 * consistency guarantee, so the only difference between runs is the promise
 * the system keeps. One tick stands for roughly 100 ms (illustrative).
 */

export const HORIZON = 40;
/** No person starts a new request after this tick, so every run settles by HORIZON. */
export const LAST_START = 30;
export const REPLICAS = 3;
export const LEADER = 0;
export const MIN_DELAY = 2;
export const MAX_DELAY = 8;
export const DEFAULT_WORKLOAD_SEED = 28;
const MAX_REQUESTS = 40;

export const replicaNames = ['R1', 'R2', 'R3'] as const;
export const people = ['Ana', 'Ben', 'Carla'] as const;
/** Ticks between one person's polls. */
const PERIOD = [2, 2, 3];
const FIRST_REQUEST = [1, 2, 3];

export interface ChatMessage {
  id: number;
  author: number;
  text: string;
  /** The message its author must see before writing this one. */
  after: number | null;
}

export const chatMessages: ChatMessage[] = [
  { id: 1, author: 0, text: 'Lunch at noon?', after: null },
  { id: 2, author: 1, text: 'Yes, see you there', after: 1 },
  { id: 3, author: 0, text: 'Booked a table for two', after: 2 },
];

export type AnomalyKind = 'stale' | 'ownMissing' | 'backwards' | 'outOfOrder';

export const anomalyKinds: AnomalyKind[] = ['stale', 'ownMissing', 'backwards', 'outOfOrder'];

export const anomalyLabels: Record<AnomalyKind, string> = {
  stale: 'Stale read',
  ownMissing: 'Own message missing',
  backwards: 'Went backwards',
  outOfOrder: 'Reply before question',
};

export type GuaranteeId = 'eventual' | 'monotonic' | 'readYourWrites' | 'causal' | 'linearizable';

export interface Guarantee {
  id: GuaranteeId;
  label: string;
  rule: string;
  rulesOut: AnomalyKind[];
}

export const guarantees: Guarantee[] = [
  {
    id: 'eventual',
    label: 'Eventual',
    rule: 'A read returns whatever its replica holds right now',
    rulesOut: [],
  },
  {
    id: 'monotonic',
    label: 'Monotonic reads',
    rule: 'A read waits until its replica holds every message you already saw',
    rulesOut: ['backwards'],
  },
  {
    id: 'readYourWrites',
    label: 'Read your writes',
    rule: 'A read waits until its replica holds every message you wrote',
    rulesOut: ['ownMissing'],
  },
  {
    id: 'causal',
    label: 'Causal',
    rule: 'Requests wait for what you saw and wrote; replicas hold a reply until its question lands',
    rulesOut: ['backwards', 'ownMissing', 'outOfOrder'],
  },
  {
    id: 'linearizable',
    label: 'Linearizable',
    rule: 'Every request goes to leader R1; a write waits until a majority stores it',
    rulesOut: ['stale', 'backwards', 'ownMissing', 'outOfOrder'],
  },
];

export interface Workload {
  seed: number;
  /** routes[person][k]: the replica the load balancer picks for that person's k-th request. */
  routes: number[][];
  /** delays[message index][replica]: ticks for a copy of that message to reach that replica. */
  delays: number[][];
}

export function createWorkload(seed: number): Workload {
  const rng = createRng(seed);
  const routes = people.map(() =>
    Array.from({ length: MAX_REQUESTS }, () => randomInt(rng, 0, REPLICAS - 1)),
  );
  const delays = chatMessages.map(() =>
    Array.from({ length: REPLICAS }, () => randomInt(rng, MIN_DELAY, MAX_DELAY)),
  );
  return { seed, routes, delays };
}

export interface Gap {
  message: number;
  anomaly: AnomalyKind;
}

export interface ReadRecord {
  kind: 'read';
  person: number;
  replica: number;
  start: number;
  end: number;
  /** Message ids the read returned, in id order. */
  sees: number[];
  /** Messages the read lacked that a stronger promise would have shown, with the broken promise. */
  gaps: Gap[];
  anomalies: AnomalyKind[];
}

export interface WriteRecord {
  kind: 'write';
  person: number;
  replica: number;
  start: number;
  /** Tick the system acknowledged the write to its author. */
  end: number;
  message: number;
}

export type RequestRecord = ReadRecord | WriteRecord;

/** One message landing on one replica. A gap between arrive and apply means it waited. */
export interface CopyRecord {
  replica: number;
  message: number;
  /** Replica that sent this copy, or null when the write itself landed here. */
  from: number | null;
  sent: number;
  arrive: number;
  apply: number;
}

interface InboundCopy {
  replica: number;
  message: number;
  from: number;
  sent: number;
  arrive: number;
}

export interface GuaranteeRun {
  guarantee: GuaranteeId;
  requests: RequestRecord[];
  copies: CopyRecord[];
  /** Requests still waiting at HORIZON. LAST_START leaves room for this to stay zero. */
  unfinished: number;
}

interface Active {
  kind: 'read' | 'write';
  replica: number;
  start: number;
  message: number;
}

interface PersonState {
  next: number;
  count: number;
  pendingWrite: number | null;
  active: Active | null;
  seen: Set<number>;
  wrote: Set<number>;
}

function holdsAll(applied: Set<number>, needed: Iterable<number>): boolean {
  for (const message of needed) if (!applied.has(message)) return false;
  return true;
}

/** Plays one guarantee over the shared workload, tick by tick, until HORIZON. */
export function runGuarantee(workload: Workload, guarantee: GuaranteeId): GuaranteeRun {
  const linear = guarantee === 'linearizable';
  const causal = guarantee === 'causal';
  const applied = Array.from({ length: REPLICAS }, () => new Set<number>());
  const deps = new Map<number, Set<number>>();
  const acked = new Map<number, number>();
  const inbound: InboundCopy[] = [];
  const buffered: InboundCopy[] = [];
  const commits: { message: number; start: number; at: number }[] = [];
  const copies: CopyRecord[] = [];
  const requests: RequestRecord[] = [];
  const state: PersonState[] = people.map((_, person) => ({
    next: FIRST_REQUEST[person] ?? 1,
    count: 0,
    pendingWrite: person === 0 ? 1 : null,
    active: null,
    seen: new Set<number>(),
    wrote: new Set<number>(),
  }));

  const sendCopies = (message: number, origin: number, at: number) => {
    const delays = workload.delays[message - 1] ?? [];
    for (let replica = 0; replica < REPLICAS; replica += 1) {
      if (replica === origin) continue;
      inbound.push({ replica, message, from: origin, sent: at, arrive: at + (delays[replica] ?? MAX_DELAY) });
    }
  };

  const ready = (person: PersonState, active: Active, tick: number): boolean => {
    const holds = applied[active.replica] ?? new Set<number>();
    if (active.kind === 'write') {
      if (linear) return (acked.get(active.message) ?? Number.POSITIVE_INFINITY) <= tick;
      return !causal || (holdsAll(holds, person.seen) && holdsAll(holds, person.wrote));
    }
    switch (guarantee) {
      case 'monotonic':
        return holdsAll(holds, person.seen);
      case 'readYourWrites':
        return holdsAll(holds, person.wrote);
      case 'causal':
        return holdsAll(holds, person.seen) && holdsAll(holds, person.wrote);
      default:
        return true;
    }
  };

  const begin = (index: number, person: PersonState, tick: number) => {
    const replica = linear ? LEADER : (workload.routes[index]?.[person.count] ?? 0);
    person.count += 1;
    const message = person.pendingWrite;
    if (message === null) {
      person.active = { kind: 'read', replica, start: tick, message: 0 };
      return;
    }
    person.active = { kind: 'write', replica, start: tick, message };
    deps.set(message, new Set([...person.seen, ...person.wrote]));
    if (linear) {
      const delays = workload.delays[message - 1] ?? [];
      const fastest = Math.min(...delays.filter((_, replica) => replica !== LEADER));
      commits.push({ message, start: tick, at: tick + fastest });
      sendCopies(message, LEADER, tick);
    }
  };

  const finishWrite = (index: number, person: PersonState, active: Active, tick: number) => {
    if (!linear) {
      applied[active.replica]?.add(active.message);
      copies.push({
        replica: active.replica,
        message: active.message,
        from: null,
        sent: tick,
        arrive: tick,
        apply: tick,
      });
      acked.set(active.message, tick);
      sendCopies(active.message, active.replica, tick);
    }
    requests.push({
      kind: 'write',
      person: index,
      replica: active.replica,
      start: active.start,
      end: tick,
      message: active.message,
    });
    person.wrote.add(active.message);
    person.pendingWrite = null;
    person.next = tick + (PERIOD[index] ?? 2);
  };

  const finishRead = (index: number, person: PersonState, active: Active, tick: number) => {
    const holds = applied[active.replica] ?? new Set<number>();
    const sees = [...holds].sort((a, b) => a - b);
    const gaps: Gap[] = [];
    for (const { id } of chatMessages) {
      if (holds.has(id)) continue;
      if ((acked.get(id) ?? Number.POSITIVE_INFINITY) < active.start)
        gaps.push({ message: id, anomaly: 'stale' });
      if (person.wrote.has(id)) gaps.push({ message: id, anomaly: 'ownMissing' });
      if (person.seen.has(id)) gaps.push({ message: id, anomaly: 'backwards' });
      if (sees.some((shown) => deps.get(shown)?.has(id))) gaps.push({ message: id, anomaly: 'outOfOrder' });
    }
    const anomalies = anomalyKinds.filter((kind) => gaps.some((gap) => gap.anomaly === kind));
    requests.push({
      kind: 'read',
      person: index,
      replica: active.replica,
      start: active.start,
      end: tick,
      sees,
      gaps,
      anomalies,
    });
    for (const id of sees) person.seen.add(id);
    const reply = chatMessages.find(
      (message) =>
        message.author === index &&
        message.after !== null &&
        holds.has(message.after) &&
        !person.wrote.has(message.id),
    );
    if (reply) {
      person.pendingWrite = reply.id;
      person.next = tick + 1;
    } else {
      person.next = tick + (PERIOD[index] ?? 2);
    }
  };

  for (let tick = 0; tick <= HORIZON; tick += 1) {
    for (let i = inbound.length - 1; i >= 0; i -= 1) {
      const copy = inbound[i];
      if (copy && copy.arrive === tick) {
        buffered.push(copy);
        inbound.splice(i, 1);
      }
    }
    buffered.sort((a, b) => a.message - b.message || a.replica - b.replica);
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < buffered.length; i += 1) {
        const copy = buffered[i];
        if (!copy) continue;
        const holds = applied[copy.replica] ?? new Set<number>();
        if (causal && !holdsAll(holds, deps.get(copy.message) ?? [])) continue;
        holds.add(copy.message);
        copies.push({ ...copy, apply: tick });
        buffered.splice(i, 1);
        progress = true;
        break;
      }
    }
    for (const commit of commits) {
      if (commit.at !== tick) continue;
      applied[LEADER]?.add(commit.message);
      copies.push({
        replica: LEADER,
        message: commit.message,
        from: null,
        sent: commit.start,
        arrive: commit.start,
        apply: tick,
      });
      acked.set(commit.message, tick);
    }

    state.forEach((person, index) => {
      if (!person.active) {
        if (tick < person.next || tick > LAST_START || person.count >= MAX_REQUESTS) return;
        begin(index, person, tick);
      }
      const active = person.active;
      if (!active || !ready(person, active, tick)) return;
      if (active.kind === 'write') finishWrite(index, person, active, tick);
      else finishRead(index, person, active, tick);
      person.active = null;
    });
  }

  const unfinished = state.filter((person) => person.active !== null).length;
  return { guarantee, requests, copies, unfinished };
}

export interface Tally {
  reads: number;
  anomalousReads: number;
  anomalies: Record<AnomalyKind, number>;
  /** Ticks people spent waiting on requests, summed. */
  waitTicks: number;
  requests: number;
  /** Share of requests that landed on the busiest replica. */
  busiestShare: number;
}

/** What a run had produced by `tick`: finished reads count, waits count up to `tick`. */
export function tallyRun(run: GuaranteeRun, tick: number): Tally {
  const anomalies: Record<AnomalyKind, number> = { stale: 0, ownMissing: 0, backwards: 0, outOfOrder: 0 };
  let reads = 0;
  let anomalousReads = 0;
  let waitTicks = 0;
  let started = 0;
  const perReplica = new Array<number>(REPLICAS).fill(0);
  for (const request of run.requests) {
    if (request.start > tick) continue;
    started += 1;
    perReplica[request.replica] = (perReplica[request.replica] ?? 0) + 1;
    waitTicks += Math.min(request.end, tick) - request.start;
    if (request.kind !== 'read' || request.end > tick) continue;
    reads += 1;
    if (request.anomalies.length > 0) anomalousReads += 1;
    for (const kind of request.anomalies) anomalies[kind] += 1;
  }
  return {
    reads,
    anomalousReads,
    anomalies,
    waitTicks,
    requests: started,
    busiestShare: started === 0 ? 0 : Math.max(...perReplica) / started,
  };
}

/** Every guarantee over one shared workload, revealed one tick at a time. */
export class ConsistencyLadder {
  readonly workload: Workload;
  readonly runs: Record<GuaranteeId, GuaranteeRun>;
  private now = 0;

  constructor(seed: number = DEFAULT_WORKLOAD_SEED) {
    this.workload = createWorkload(seed);
    const entries = guarantees.map(({ id }) => [id, runGuarantee(this.workload, id)] as const);
    this.runs = Object.fromEntries(entries) as Record<GuaranteeId, GuaranteeRun>;
  }

  get tick(): number {
    return this.now;
  }

  get done(): boolean {
    return this.now >= HORIZON;
  }

  step(): void {
    if (!this.done) this.now += 1;
  }

  reset(): void {
    this.now = 0;
  }

  tally(guarantee: GuaranteeId): Tally {
    return tallyRun(this.runs[guarantee], this.now);
  }
}
