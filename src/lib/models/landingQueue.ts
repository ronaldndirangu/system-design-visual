/**
 * The request ledger behind the landing page hero. It decides which server
 * each request goes to, when each server finishes one, and when a request is
 * turned away. The physics scene only animates what this model reports, so a
 * request counts as dropped only when a full server queue rejects it.
 */

/** Requests one server will hold at once, counting those still in transit. */
export const LANDING_CAPACITY = 12;
/** Time one server spends on one request: 200 ms means 5 requests per second. */
export const LANDING_SERVICE_MS = 200;
/** Time a request takes to travel from the load balancer to its server. */
export const LANDING_TRANSIT_MS = 450;
const WINDOW_MS = 4000;

export interface LandingStats {
  arrivedPerSecond: number;
  servedPerSecond: number;
  droppedPerSecond: number;
  servers: number;
}

export interface LandingTotals {
  arrived: number;
  served: number;
  dropped: number;
  inSystem: number;
}

/** Where a request was sent. `accepted` is false when that server's queue was full. */
export interface Assignment {
  id: number;
  server: number;
  accepted: boolean;
}

export interface Completion {
  id: number;
  server: number;
}

interface Job {
  id: number;
  readyAt: number;
}

interface Server {
  queue: Job[];
  freeAt: number;
}

type EventKind = 'arrived' | 'served' | 'dropped';

export class LandingQueue {
  readonly capacity: number;
  private clock = 0;
  private nextId = 0;
  private cursor = 0;
  private readonly pending = new Set<number>();
  private servers: Server[] = [];
  private events: { time: number; kind: EventKind }[] = [];
  private readonly counts: Record<EventKind, number> = { arrived: 0, served: 0, dropped: 0 };

  constructor(servers: number, capacity = LANDING_CAPACITY) {
    this.capacity = capacity;
    this.setServers(servers);
  }

  get now(): number {
    return this.clock;
  }

  get serverCount(): number {
    return this.servers.length;
  }

  queueLength(server: number): number {
    return this.servers[server]?.queue.length ?? 0;
  }

  /** A user sends a request. It waits at the load balancer until `route`. */
  arrive(): number {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.add(id);
    this.record('arrived', this.clock);
    return id;
  }

  /** Round robin: send the request to the next server, or reject it if that queue is full. */
  route(id: number): Assignment | undefined {
    if (!this.pending.delete(id)) return undefined;
    const server = this.cursor % this.servers.length;
    this.cursor += 1;
    return this.enqueue(id, server);
  }

  /** Move time forward and report every request a server finished. */
  advance(ms: number): Completion[] {
    const until = this.clock + Math.max(0, ms);
    const finished: Completion[] = [];
    for (const [index, server] of this.servers.entries()) {
      for (let head = server.queue[0]; head; head = server.queue[0]) {
        const done = Math.max(server.freeAt, head.readyAt) + LANDING_SERVICE_MS;
        if (done > until) break;
        server.queue.shift();
        server.freeAt = done;
        this.record('served', done);
        finished.push({ id: head.id, server: index });
      }
    }
    this.clock = until;
    return finished;
  }

  /**
   * Resize the pool. A removed server hands its queue to the least loaded
   * survivor, so shrinking the pool loses a request only when every survivor
   * is already full.
   */
  setServers(count: number): Assignment[] {
    const target = Math.max(1, Math.floor(count));
    while (this.servers.length < target) this.servers.push({ queue: [], freeAt: this.clock });
    const removed = this.servers.splice(target);
    this.cursor = 0;
    return removed.flatMap((server) => server.queue).map((job) => this.enqueue(job.id, this.leastLoaded()));
  }

  stats(): LandingStats {
    this.prune();
    const seconds = Math.min(this.clock, WINDOW_MS) / 1000 || 1;
    const perSecond = (kind: EventKind) =>
      this.events.filter((event) => event.kind === kind).length / seconds;
    return {
      arrivedPerSecond: perSecond('arrived'),
      servedPerSecond: perSecond('served'),
      droppedPerSecond: perSecond('dropped'),
      servers: this.servers.length,
    };
  }

  totals(): LandingTotals {
    const queued = this.servers.reduce((sum, server) => sum + server.queue.length, 0);
    return { ...this.counts, inSystem: this.pending.size + queued };
  }

  private enqueue(id: number, index: number): Assignment {
    const server = this.servers[index];
    if (!server || server.queue.length >= this.capacity) {
      this.record('dropped', this.clock);
      return { id, server: index, accepted: false };
    }
    server.queue.push({ id, readyAt: this.clock + LANDING_TRANSIT_MS });
    return { id, server: index, accepted: true };
  }

  private leastLoaded(): number {
    let best = 0;
    for (const [index, server] of this.servers.entries()) {
      if (server.queue.length < this.queueLength(best)) best = index;
    }
    return best;
  }

  private record(kind: EventKind, time: number): void {
    this.counts[kind] += 1;
    this.events.push({ time, kind });
    if (this.events.length > 4096) this.prune();
  }

  private prune(): void {
    const cutoff = this.clock - WINDOW_MS;
    this.events = this.events.filter((event) => event.time > cutoff);
  }
}
