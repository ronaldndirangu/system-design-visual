/**
 * Toy model of a chat conversation owned through a lease. Server A owns the conversation, numbers its
 * messages, and appends them to a shared log. Server B waits for the lease. One scripted fault makes A
 * act after its lease has passed to B. Both lanes replay the same script; only the log's check differs.
 */

export const FENCE_TICK_S = 0.5;
export const FENCE_RUN_S = 30;
export const LEASE_S = 10;
export const RENEW_EVERY_S = 3;
export const WRITE_EVERY_S = 2;

export type FenceScenarioId = 'pause' | 'delay' | 'skew' | 'calm';
export type FencePolicy = 'lease' | 'fenced';
export type ServerId = 'A' | 'B';

export interface FenceScenario {
  label: string;
  diff: string;
  /** A checks its lease, picks a sequence number, then freezes before it sends. */
  pause?: { at: number; seconds: number };
  /** Everything A sends from `from` onward arrives `delay` seconds late. */
  slowLink?: { from: number; delay: number };
  /** A's renewals stop reaching the lock service from this time. */
  lockLinkLostAt?: number;
  /** How fast A's clock runs compared with real time. */
  clockRate?: number;
}

export const fenceScenarios: Record<FenceScenarioId, FenceScenario> = {
  pause: {
    label: 'Long pause',
    diff: 'Server A freezes for 12.5 s right after it checks its lease',
    pause: { at: 5, seconds: 12.5 },
  },
  delay: {
    label: 'Slow network',
    diff: 'From 6 s, everything server A sends takes 8 s to arrive',
    slowLink: { from: 6, delay: 8 },
  },
  skew: {
    label: 'Slow clock',
    diff: 'Server A loses the lock service at 4 s, and its clock runs at 60% speed',
    lockLinkLostAt: 4,
    clockRate: 0.6,
  },
  calm: {
    label: 'No faults',
    diff: 'Server A renews on time, and nothing goes wrong',
  },
};

export const fencePolicyLabels: Record<FencePolicy, string> = {
  lease: 'Lease only',
  fenced: 'Lease plus fencing token',
};

export interface FenceEvent {
  t: number;
  text: string;
}

export interface LogEntry {
  seq: number;
  server: ServerId;
  token: number;
  t: number;
}

interface ServerState {
  role: 'standby' | 'owner' | 'out';
  token: number;
  nextSeq: number;
  /** A's own clock reading when it sent the last request the lock service granted. */
  leaseFromLocal: number;
}

interface Pending {
  t: number;
  order: number;
  run: () => void;
}

export interface FenceSummary {
  entries: number;
  staleAccepted: number;
  staleRejected: number;
  /** Sequence numbers that name more than one message. */
  clashes: number;
}

export class FenceLane {
  readonly label: string;
  now = 0;
  readonly lock: { holder: ServerId | null; token: number; expiresAt: number } = {
    holder: null,
    token: 0,
    expiresAt: 0,
  };
  readonly entries: LogEntry[] = [];
  /** The highest token the log has seen. Only the fenced log keeps it. */
  maxToken = 0;
  readonly servers: Record<ServerId, ServerState> = {
    A: { role: 'standby', token: 0, nextSeq: 1, leaseFromLocal: 0 },
    B: { role: 'standby', token: 0, nextSeq: 1, leaseFromLocal: 0 },
  };
  readonly events: FenceEvent[] = [];
  staleAccepted = 0;
  staleRejected = 0;
  inFlight = 0;
  private queue: Pending[] = [];
  private order = 0;

  constructor(
    readonly scenario: FenceScenario,
    readonly policy: FencePolicy,
  ) {
    this.label = fencePolicyLabels[policy];
    this.at(0, () => this.startA());
    for (let t = WRITE_EVERY_S / 2; t < FENCE_RUN_S; t += WRITE_EVERY_S) this.at(t, () => this.writeA(t));
    for (let t = RENEW_EVERY_S; t < FENCE_RUN_S; t += RENEW_EVERY_S) this.at(t, () => this.renewA(t));
    for (let t = 1.5; t < FENCE_RUN_S; t += 1) this.at(t, () => this.pollB(t));
    const { slowLink, lockLinkLostAt, clockRate } = scenario;
    if (slowLink) {
      this.at(slowLink.from, () =>
        this.log(
          slowLink.from,
          `Server A's network slows down. Everything it sends now takes ${slowLink.delay} s to arrive.`,
        ),
      );
    }
    if (lockLinkLostAt !== undefined) {
      const speed =
        clockRate === undefined ? '' : `, and its clock runs at ${Math.round(clockRate * 100)}% speed`;
      this.at(lockLinkLostAt, () =>
        this.log(
          lockLinkLostAt,
          `Server A loses its link to the lock service${speed}. Its renewals stop arriving.`,
        ),
      );
    }
  }

  /** A's clock. It drifts when the scenario sets a clock rate. */
  localA(t: number): number {
    return t * (this.scenario.clockRate ?? 1);
  }

  frozen(t: number): boolean {
    const pause = this.scenario.pause;
    return pause !== undefined && t > pause.at && t < pause.at + pause.seconds;
  }

  advanceTo(t: number) {
    while (this.queue.length > 0 && (this.queue[0]?.t ?? Number.POSITIVE_INFINITY) <= t) {
      const next = this.queue.shift();
      if (!next) break;
      this.now = next.t;
      next.run();
    }
    this.now = t;
  }

  summary(): FenceSummary {
    const writers = new Map<number, number>();
    for (const entry of this.entries) writers.set(entry.seq, (writers.get(entry.seq) ?? 0) + 1);
    let clashes = 0;
    for (const count of writers.values()) if (count > 1) clashes += 1;
    return {
      entries: this.entries.length,
      staleAccepted: this.staleAccepted,
      staleRejected: this.staleRejected,
      clashes,
    };
  }

  private at(t: number, run: () => void) {
    this.queue.push({ t, order: this.order++, run });
    this.queue.sort((a, b) => a.t - b.t || a.order - b.order);
  }

  private log(t: number, text: string) {
    this.events.push({ t, text });
  }

  private grant(server: ServerId, t: number) {
    this.lock.holder = server;
    this.lock.token += 1;
    this.lock.expiresAt = t + LEASE_S;
    const state = this.servers[server];
    state.role = 'owner';
    state.token = this.lock.token;
  }

  private startA() {
    this.grant('A', 0);
    this.servers.A.leaseFromLocal = this.localA(0);
    this.log(0, 'Server A takes the lease with token 1 and starts numbering chat messages.');
  }

  /** A trusts its own clock: the lease lasts LEASE_S from when it sent the last granted request. */
  private aBelievesLease(t: number): boolean {
    return this.localA(t) < this.servers.A.leaseFromLocal + LEASE_S;
  }

  private writeA(t: number) {
    const a = this.servers.A;
    if (a.role !== 'owner' || this.frozen(t)) return;
    if (!this.aBelievesLease(t)) {
      a.role = 'out';
      const waiting =
        this.inFlight > 0
          ? ` ${this.inFlight} of its writes are still on the way, and nothing can call them back.`
          : '';
      this.log(t, `Server A's own timer says its lease ended, so it stops writing.${waiting}`);
      return;
    }
    const seq = a.nextSeq++;
    const pause = this.scenario.pause;
    if (pause && t === pause.at) {
      const wake = pause.at + pause.seconds;
      this.log(
        t,
        `Server A checks its lease, picks seq ${seq}, and freezes in a ${pause.seconds} s garbage collection pause.`,
      );
      this.at(wake, () => {
        this.log(
          wake,
          `Server A wakes up and sends seq ${seq} with token ${a.token}, sure it still owns the chat.`,
        );
        this.sendToLog('A', seq, a.token, wake);
      });
      return;
    }
    this.sendToLog('A', seq, a.token, t);
  }

  private renewA(t: number) {
    const a = this.servers.A;
    if (a.role !== 'owner' || this.frozen(t)) return;
    const { lockLinkLostAt, slowLink } = this.scenario;
    if (lockLinkLostAt !== undefined && t >= lockLinkLostAt) return;
    const arrive = slowLink && t >= slowLink.from ? t + slowLink.delay : t;
    const sentLocal = this.localA(t);
    this.at(arrive, () => {
      const lock = this.lock;
      if (lock.holder === 'A' && lock.token === a.token && arrive < lock.expiresAt) {
        lock.expiresAt = arrive + LEASE_S;
        a.leaseFromLocal = sentLocal;
        return;
      }
      if (a.role === 'owner') {
        a.role = 'out';
        this.log(arrive, "The lock service refuses A's renewal because B holds the lease. A stops.");
      }
    });
  }

  private pollB(t: number) {
    const b = this.servers.B;
    if (b.role !== 'standby') return;
    const lock = this.lock;
    if (lock.holder !== null && t < lock.expiresAt) return;
    this.log(lock.expiresAt, `Server A's lease expires in the lock service. No renewal arrived in time.`);
    this.grant('B', t);
    if (this.policy === 'fenced') this.maxToken = Math.max(this.maxToken, b.token);
    b.nextSeq = this.entries.reduce((high, entry) => Math.max(high, entry.seq), 0) + 1;
    this.log(
      t,
      this.policy === 'fenced'
        ? `Server B takes the lease with token ${b.token}, registers that token with the log, then continues from seq ${b.nextSeq}.`
        : `Server B takes the lease with token ${b.token} and continues from seq ${b.nextSeq}.`,
    );
    for (let at = t + WRITE_EVERY_S / 2; at < FENCE_RUN_S; at += WRITE_EVERY_S) {
      this.at(at, () => this.sendToLog('B', b.nextSeq++, b.token, at));
    }
    for (let at = t + RENEW_EVERY_S; at < FENCE_RUN_S; at += RENEW_EVERY_S) {
      this.at(at, () => {
        if (lock.holder === 'B' && at < lock.expiresAt) lock.expiresAt = at + LEASE_S;
      });
    }
  }

  private sendToLog(server: ServerId, seq: number, token: number, t: number) {
    const slowLink = this.scenario.slowLink;
    const arrive = server === 'A' && slowLink && t >= slowLink.from ? t + slowLink.delay : t;
    if (arrive === t) {
      this.append(server, seq, token, t);
      return;
    }
    this.inFlight += 1;
    this.at(arrive, () => {
      this.inFlight -= 1;
      this.append(server, seq, token, arrive);
    });
  }

  private append(server: ServerId, seq: number, token: number, t: number) {
    const stale = token < this.lock.token;
    if (this.policy === 'fenced') {
      if (token < this.maxToken) {
        if (stale) this.staleRejected += 1;
        const writer = this.servers[server];
        const stepDown = writer.role === 'owner' ? ` Server ${server} steps down.` : '';
        writer.role = 'out';
        this.log(
          t,
          `The log rejects seq ${seq} because token ${token} is older than token ${this.maxToken}.${stepDown}`,
        );
        return;
      }
      this.maxToken = token;
    }
    if (stale) {
      this.staleAccepted += 1;
      const taken = this.entries.some((entry) => entry.seq === seq);
      this.log(
        t,
        taken
          ? `The log accepts seq ${seq} from server ${server} with old token ${token}. Seq ${seq} now names two different messages.`
          : `The log accepts a write from server ${server} with old token ${token}.`,
      );
    }
    this.entries.push({ seq, server, token, t });
  }
}

export class FenceDuel {
  readonly lanes: [FenceLane, FenceLane];
  readonly tickSeconds = FENCE_TICK_S;
  readonly length = Math.round(FENCE_RUN_S / FENCE_TICK_S);
  ticks = 0;

  constructor(readonly scenario: FenceScenario) {
    this.lanes = [new FenceLane(scenario, 'lease'), new FenceLane(scenario, 'fenced')];
  }

  get done(): boolean {
    return this.ticks >= this.length;
  }

  step() {
    if (this.done) return;
    this.ticks += 1;
    for (const lane of this.lanes) lane.advanceTo(this.ticks * this.tickSeconds);
  }

  /**
   * Both lanes' events in time order. An event that happened the same way in both lanes appears once;
   * an event from one lane only carries that lane's name.
   */
  timeline(): { t: number; text: string; lane?: string }[] {
    const [first, second] = this.lanes;
    const key = (event: FenceEvent) => `${event.t}|${event.text}`;
    const inFirst = new Set(first.events.map(key));
    const inSecond = new Set(second.events.map(key));
    const merged = [
      ...first.events.map((event) => ({
        ...event,
        lane: inSecond.has(key(event)) ? undefined : first.label,
      })),
      ...second.events
        .filter((event) => !inFirst.has(key(event)))
        .map((event) => ({ ...event, lane: second.label })),
    ];
    return merged.sort((a, b) => a.t - b.t);
  }
}
