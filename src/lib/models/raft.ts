import type { SeededRng } from '../rng';
import { createRng, randomInt } from '../rng';
import type { ModelAdapter, ScheduledCommand } from './adapter';
import { stepScheduled } from './adapter';

/**
 * A simplified Raft cluster for teaching: five servers agree on a shared chat
 * log through leader election with randomized timeouts, terms, log
 * replication, and commit on a majority. It leaves out snapshots, membership
 * changes, pre-vote, the no-op entry a new leader usually writes, and
 * client retries. One tick stands for an illustrative 10 ms.
 */

export const NODE_COUNT = 5;
export const MAJORITY = 3;
export const MS_PER_TICK = 10;
export const ELECTION_TIMEOUT_MIN_TICKS = 15;
export const ELECTION_TIMEOUT_MAX_TICKS = 30;
export const HEARTBEAT_TICKS = 5;

const IDS = Array.from({ length: NODE_COUNT }, (_, id) => id);

export type Role = 'follower' | 'candidate' | 'leader';

export interface LogEntry {
  /** Unique per chat message the cluster ever accepted. */
  id: number;
  term: number;
  text: string;
}

export interface RaftNode {
  id: number;
  up: boolean;
  role: Role;
  term: number;
  votedFor: number | null;
  log: LogEntry[];
  /** Entries 1..commitIndex are committed. */
  commitIndex: number;
  /** Tick at which a follower or candidate starts an election. */
  deadline: number;
  /** The election timeout drawn at the last timer reset, in ticks. */
  timeout: number;
  votes: number[];
  nextIndex: number[];
  matchIndex: number[];
  heartbeatAt: number;
}

export type RaftMessage =
  | { type: 'vote'; term: number; lastIndex: number; lastTerm: number }
  | { type: 'vote-reply'; term: number; granted: boolean }
  | {
      type: 'append';
      term: number;
      prevIndex: number;
      prevTerm: number;
      entries: LogEntry[];
      leaderCommit: number;
    }
  | { type: 'append-reply'; term: number; success: boolean; match: number; length: number };

export interface InFlight {
  seq: number;
  from: number;
  to: number;
  sentAt: number;
  deliverAt: number;
  message: RaftMessage;
}

export type RaftCommand =
  | { type: 'crash'; node: number | 'leader' }
  | { type: 'recover'; node: number | 'all' }
  /** Cuts the current leader and the next server off from the other three. */
  | { type: 'isolate-leader' }
  | { type: 'heal' }
  /** A chat message from a client. `via: 'isolated'` comes from a user stuck on the cut-off side. */
  | { type: 'send'; text: string; via?: 'isolated' };

export type RaftEventKind =
  | 'election'
  | 'leader'
  | 'refuse'
  | 'step-down'
  | 'accept'
  | 'commit'
  | 'erase'
  | 'crash'
  | 'recover'
  | 'partition'
  | 'heal'
  | 'client';

export interface RaftEvent {
  tick: number;
  kind: RaftEventKind;
  text: string;
  node: number | null;
  term: number;
  /** Marked events also appear on the timeline. */
  marker: boolean;
}

export interface RaftTick {
  tick: number;
  events: RaftEvent[];
}

export interface LeaderRun {
  start: number;
  /** Exclusive. */
  end: number;
  leader: number | null;
  term: number;
}

export interface Win {
  term: number;
  node: number;
  tick: number;
  votes: number[];
}

export interface RaftState {
  ticks: number;
  nodes: RaftNode[];
  inFlight: InFlight[];
  seq: number;
  queued: RaftCommand[];
  /** Text of every accepted chat message, by entry id. */
  texts: string[];
  pending: string[];
  waiting: boolean;
  /** Partition group per server, or null when every server can reach every other. */
  groups: number[] | null;
  isolated: number | null;
  electionTerms: number[];
  wins: Win[];
  electionsStarted: number;
  leaderlessTicks: number;
  erasedCopies: number;
  sent: number;
  messages: number;
  runs: LeaderRun[];
  events: RaftEvent[];
}

export interface RaftCheckpoint {
  state: RaftState;
  rng: number;
}

export interface RaftStats {
  leader: number | null;
  term: number;
  committed: number;
  sent: number;
  electionsStarted: number;
  /** Election terms that ended without a winner. */
  splitTerms: number;
  leaderlessTicks: number;
  erasedCopies: number;
  /** Accepted chat messages that no server stores any more. */
  lost: number;
  messages: number;
}

export function nodeName(id: number): string {
  return `Node ${id + 1}`;
}

export function formatSeconds(tick: number): string {
  return `${((tick * MS_PER_TICK) / 1000).toFixed(2)} s`;
}

/** Neighbors on the ring are one hop apart (20 ms); the others are two hops (30 ms). */
export function messageDelayTicks(a: number, b: number): number {
  const gap = Math.abs(a - b);
  return Math.min(gap, NODE_COUNT - gap) === 1 ? 2 : 3;
}

export function lastTerm(node: RaftNode): number {
  return node.log[node.log.length - 1]?.term ?? 0;
}

function quoteList(entries: readonly LogEntry[]): string {
  return entries.map((entry) => `"${entry.text}"`).join(', ');
}

function nameList(ids: readonly number[]): string {
  return ids.map(nodeName).join(', ');
}

export class RaftCluster implements ModelAdapter<RaftCommand, RaftTick, RaftCheckpoint> {
  private state: RaftState;
  private readonly rng: SeededRng;
  private current: RaftEvent[] = [];
  private now = 0;

  constructor(readonly seed: number) {
    this.rng = createRng(seed);
    this.state = {
      ticks: 0,
      nodes: IDS.map((id) => ({
        id,
        up: true,
        role: 'follower',
        term: 0,
        votedFor: null,
        log: [],
        commitIndex: 0,
        deadline: 0,
        timeout: 0,
        votes: [],
        nextIndex: IDS.map(() => 1),
        matchIndex: IDS.map(() => 0),
        heartbeatAt: 0,
      })),
      inFlight: [],
      seq: 0,
      queued: [],
      texts: [],
      pending: [],
      waiting: false,
      groups: null,
      isolated: null,
      electionTerms: [],
      wins: [],
      electionsStarted: 0,
      leaderlessTicks: 0,
      erasedCopies: 0,
      sent: 0,
      messages: 0,
      runs: [],
      events: [],
    };
    for (const node of this.state.nodes) this.resetTimer(node);
  }

  get ticks(): number {
    return this.state.ticks;
  }

  get nodes(): readonly RaftNode[] {
    return this.state.nodes;
  }

  get inFlight(): readonly InFlight[] {
    return this.state.inFlight;
  }

  get events(): readonly RaftEvent[] {
    return this.state.events;
  }

  get runs(): readonly LeaderRun[] {
    return this.state.runs;
  }

  get wins(): readonly Win[] {
    return this.state.wins;
  }

  get groups(): readonly number[] | null {
    return this.state.groups;
  }

  get pending(): readonly string[] {
    return this.state.pending;
  }

  get texts(): readonly string[] {
    return this.state.texts;
  }

  get sent(): number {
    return this.state.sent;
  }

  apply(command: RaftCommand): void {
    this.state.queued.push({ ...command });
  }

  step(): RaftTick {
    const s = this.state;
    this.now = s.ticks;
    this.current = [];
    const queued = s.queued;
    s.queued = [];
    for (const command of queued) this.run(command);
    this.deliverDue();
    for (const node of s.nodes) {
      if (!node.up) continue;
      if (node.role === 'leader') {
        if (this.now >= node.heartbeatAt) this.broadcastAppend(node);
      } else if (this.now >= node.deadline) {
        this.startElection(node);
      }
    }
    this.flushClient();
    this.track();
    s.ticks = this.now + 1;
    return { tick: this.now, events: this.current };
  }

  checkpoint(): RaftCheckpoint {
    return { state: structuredClone(this.state), rng: this.rng.getState() };
  }

  restore(checkpoint: RaftCheckpoint): void {
    this.state = structuredClone(checkpoint.state);
    this.rng.setState(checkpoint.rng);
  }

  connected(a: number, b: number): boolean {
    const groups = this.state.groups;
    return groups === null || groups[a] === groups[b];
  }

  /** The up leader with the highest term, even one that cannot reach a majority. */
  leaderId(): number | null {
    let best: RaftNode | null = null;
    for (const node of this.state.nodes) {
      if (node.up && node.role === 'leader' && (!best || node.term > best.term)) best = node;
    }
    return best ? best.id : null;
  }

  /** A leader that can still reach a majority, so it can commit. */
  workingLeader(): number | null {
    let best: RaftNode | null = null;
    for (const node of this.state.nodes) {
      if (!node.up || node.role !== 'leader') continue;
      const reach = this.state.nodes.filter((peer) => peer.up && this.connected(node.id, peer.id)).length;
      if (reach >= MAJORITY && (!best || node.term > best.term)) best = node;
    }
    return best ? best.id : null;
  }

  /** The longest committed log any server knows about. */
  committedLog(): LogEntry[] {
    let best: RaftNode | null = null;
    for (const node of this.state.nodes) if (!best || node.commitIndex > best.commitIndex) best = node;
    return best ? best.log.slice(0, best.commitIndex) : [];
  }

  stats(): RaftStats {
    const s = this.state;
    const term = Math.max(...s.nodes.map((node) => node.term));
    const won = new Set(s.wins.map((win) => win.term));
    const stored = new Set(s.nodes.flatMap((node) => node.log.map((entry) => entry.id)));
    return {
      leader: this.workingLeader(),
      term,
      committed: this.committedLog().length,
      sent: s.sent,
      electionsStarted: s.electionsStarted,
      splitTerms: s.electionTerms.filter((t) => !won.has(t) && t < term).length,
      leaderlessTicks: s.leaderlessTicks,
      erasedCopies: s.erasedCopies,
      lost: s.texts.filter((_, id) => !stored.has(id)).length,
      messages: s.messages,
    };
  }

  private node(id: number): RaftNode {
    const node = this.state.nodes[id];
    if (!node) throw new Error(`No server ${id}`);
    return node;
  }

  private emit(kind: RaftEventKind, text: string, node: number | null, term: number, marker: boolean) {
    const event: RaftEvent = { tick: this.now, kind, text, node, term, marker };
    this.current.push(event);
    this.state.events.push(event);
  }

  private resetTimer(node: RaftNode) {
    node.timeout = randomInt(this.rng, ELECTION_TIMEOUT_MIN_TICKS, ELECTION_TIMEOUT_MAX_TICKS);
    node.deadline = this.now + node.timeout;
  }

  private send(from: number, to: number, message: RaftMessage) {
    if (from === to || !this.connected(from, to)) return;
    const s = this.state;
    s.messages += 1;
    s.inFlight.push({
      seq: s.seq,
      from,
      to,
      sentAt: this.now,
      deliverAt: this.now + messageDelayTicks(from, to),
      message,
    });
    s.seq += 1;
  }

  private run(command: RaftCommand) {
    const s = this.state;
    switch (command.type) {
      case 'crash': {
        const id = command.node === 'leader' ? this.leaderId() : command.node;
        if (id === null) return;
        const node = this.node(id);
        if (!node.up) return;
        const wasLeader = node.role === 'leader';
        node.up = false;
        node.role = 'follower';
        node.votes = [];
        this.emit(
          'crash',
          `${nodeName(id)}${wasLeader ? ' (the leader)' : ''} crashed.`,
          id,
          node.term,
          true,
        );
        return;
      }
      case 'recover': {
        const ids = command.node === 'all' ? IDS : [command.node];
        for (const id of ids) {
          const node = this.node(id);
          if (node.up) continue;
          node.up = true;
          node.role = 'follower';
          this.resetTimer(node);
          this.emit('recover', `${nodeName(id)} came back as a follower.`, id, node.term, true);
        }
        return;
      }
      case 'isolate-leader': {
        const leader = this.leaderId();
        if (leader === null) return;
        const partner = (leader + 1) % NODE_COUNT;
        s.groups = IDS.map((id) => (id === leader || id === partner ? 1 : 0));
        s.isolated = leader;
        this.emit(
          'partition',
          `The network split: ${nodeName(leader)} (the leader) and ${nodeName(partner)} can reach only each other.`,
          leader,
          this.node(leader).term,
          true,
        );
        return;
      }
      case 'heal': {
        if (s.groups === null) return;
        s.groups = null;
        s.isolated = null;
        this.emit('heal', 'The network healed, so every server can reach every other again.', null, 0, true);
        return;
      }
      case 'send': {
        s.sent += 1;
        const target = command.via === 'isolated' && s.isolated !== null ? this.node(s.isolated) : null;
        if (target?.up && target.role === 'leader') this.accept(target, command.text);
        else s.pending.push(command.text);
        return;
      }
    }
  }

  private deliverDue() {
    const s = this.state;
    const due = s.inFlight
      .filter((flight) => flight.deliverAt <= this.now)
      .sort((a, b) => a.deliverAt - b.deliverAt || a.seq - b.seq);
    if (due.length === 0) return;
    s.inFlight = s.inFlight.filter((flight) => flight.deliverAt > this.now);
    for (const flight of due) {
      const node = this.node(flight.to);
      if (!node.up || !this.connected(flight.from, flight.to)) continue;
      const message = flight.message;
      switch (message.type) {
        case 'vote':
          this.onVote(node, flight.from, message);
          break;
        case 'vote-reply':
          this.onVoteReply(node, flight.from, message);
          break;
        case 'append':
          this.onAppend(node, flight.from, message);
          break;
        case 'append-reply':
          this.onAppendReply(node, flight.from, message);
          break;
      }
    }
  }

  private adoptTerm(node: RaftNode, term: number) {
    const wasLeader = node.role === 'leader';
    node.term = term;
    node.votedFor = null;
    node.role = 'follower';
    node.votes = [];
    if (wasLeader) {
      // A deposed leader's old deadline is long past; without a reset it would stand again at once.
      this.resetTimer(node);
      this.emit(
        'step-down',
        `${nodeName(node.id)} saw term ${term} and stepped down to follower.`,
        node.id,
        term,
        true,
      );
    }
  }

  private startElection(node: RaftNode) {
    const s = this.state;
    const retry = node.role === 'candidate';
    const previousVotes = node.votes.length;
    const waited = node.timeout * MS_PER_TICK;
    node.term += 1;
    node.role = 'candidate';
    node.votedFor = node.id;
    node.votes = [node.id];
    this.resetTimer(node);
    s.electionsStarted += 1;
    if (!s.electionTerms.includes(node.term)) s.electionTerms.push(node.term);
    const name = nodeName(node.id);
    const text = retry
      ? `${name} got ${previousVotes} of ${NODE_COUNT} votes in term ${node.term - 1}, short of a majority, so after a fresh random ${waited} ms it asked again in term ${node.term}.`
      : `${name} heard nothing from a leader for ${waited} ms and asked for votes in term ${node.term}.`;
    this.emit('election', text, node.id, node.term, true);
    const request: RaftMessage = {
      type: 'vote',
      term: node.term,
      lastIndex: node.log.length,
      lastTerm: lastTerm(node),
    };
    for (const peer of IDS) this.send(node.id, peer, request);
  }

  private onVote(node: RaftNode, from: number, message: Extract<RaftMessage, { type: 'vote' }>) {
    if (message.term > node.term) this.adoptTerm(node, message.term);
    const mine = lastTerm(node);
    const upToDate =
      message.lastTerm > mine || (message.lastTerm === mine && message.lastIndex >= node.log.length);
    const granted =
      message.term === node.term && (node.votedFor === null || node.votedFor === from) && upToDate;
    if (granted) {
      node.votedFor = from;
      this.resetTimer(node);
    } else if (message.term === node.term && !upToDate) {
      this.emit(
        'refuse',
        `${nodeName(node.id)} refused to vote for ${nodeName(from)} in term ${node.term}: ${nodeName(from)}'s log is missing entries.`,
        node.id,
        node.term,
        false,
      );
    }
    this.send(node.id, from, { type: 'vote-reply', term: node.term, granted });
  }

  private onVoteReply(node: RaftNode, from: number, message: Extract<RaftMessage, { type: 'vote-reply' }>) {
    if (message.term > node.term) {
      this.adoptTerm(node, message.term);
      return;
    }
    if (node.role !== 'candidate' || message.term !== node.term || !message.granted) return;
    if (!node.votes.includes(from)) node.votes.push(from);
    if (node.votes.length >= MAJORITY) this.becomeLeader(node);
  }

  private becomeLeader(node: RaftNode) {
    node.role = 'leader';
    node.nextIndex = IDS.map(() => node.log.length + 1);
    node.matchIndex = IDS.map((id) => (id === node.id ? node.log.length : 0));
    const voters = node.votes.filter((id) => id !== node.id);
    this.state.wins.push({ term: node.term, node: node.id, tick: this.now, votes: [...node.votes] });
    this.emit(
      'leader',
      `${nodeName(node.id)} won term ${node.term} with ${node.votes.length} of ${NODE_COUNT} votes (itself, ${nameList(voters)}) and became leader.`,
      node.id,
      node.term,
      true,
    );
    this.broadcastAppend(node);
  }

  private broadcastAppend(leader: RaftNode) {
    for (const peer of IDS) if (peer !== leader.id) this.sendAppend(leader, peer);
    leader.heartbeatAt = this.now + HEARTBEAT_TICKS;
  }

  private sendAppend(leader: RaftNode, peer: number) {
    const next = leader.nextIndex[peer] ?? 1;
    const prevIndex = next - 1;
    this.send(leader.id, peer, {
      type: 'append',
      term: leader.term,
      prevIndex,
      prevTerm: leader.log[prevIndex - 1]?.term ?? 0,
      entries: leader.log.slice(prevIndex),
      leaderCommit: leader.commitIndex,
    });
  }

  private onAppend(node: RaftNode, from: number, message: Extract<RaftMessage, { type: 'append' }>) {
    if (message.term < node.term) {
      this.send(node.id, from, {
        type: 'append-reply',
        term: node.term,
        success: false,
        match: 0,
        length: node.log.length,
      });
      return;
    }
    if (message.term > node.term) this.adoptTerm(node, message.term);
    if (node.role === 'candidate') {
      node.role = 'follower';
      node.votes = [];
    }
    this.resetTimer(node);
    const { prevIndex } = message;
    if (
      prevIndex > node.log.length ||
      (prevIndex > 0 && node.log[prevIndex - 1]?.term !== message.prevTerm)
    ) {
      this.send(node.id, from, {
        type: 'append-reply',
        term: node.term,
        success: false,
        match: 0,
        length: node.log.length,
      });
      return;
    }
    const erased: LogEntry[] = [];
    message.entries.forEach((entry, k) => {
      const position = prevIndex + k;
      const existing = node.log[position];
      if (existing && existing.term === entry.term) return;
      if (existing) erased.push(...node.log.splice(position));
      node.log.push(entry);
    });
    if (erased.length > 0) {
      this.state.erasedCopies += erased.length;
      const noun = erased.length === 1 ? 'message' : 'messages';
      this.emit(
        'erase',
        `${nodeName(node.id)} erased ${erased.length} uncommitted ${noun} (${quoteList(erased)}) that conflicted with the term ${message.term} leader's log.`,
        node.id,
        node.term,
        true,
      );
    }
    const lastNew = prevIndex + message.entries.length;
    node.commitIndex = Math.max(node.commitIndex, Math.min(message.leaderCommit, lastNew));
    this.send(node.id, from, {
      type: 'append-reply',
      term: node.term,
      success: true,
      match: lastNew,
      length: node.log.length,
    });
  }

  private onAppendReply(
    leader: RaftNode,
    from: number,
    message: Extract<RaftMessage, { type: 'append-reply' }>,
  ) {
    if (message.term > leader.term) {
      this.adoptTerm(leader, message.term);
      return;
    }
    if (leader.role !== 'leader' || message.term !== leader.term) return;
    const matched = leader.matchIndex[from] ?? 0;
    if (message.success) {
      leader.matchIndex[from] = Math.max(matched, message.match);
      leader.nextIndex[from] = (leader.matchIndex[from] ?? 0) + 1;
      this.advanceCommit(leader);
      return;
    }
    const next = leader.nextIndex[from] ?? 1;
    leader.nextIndex[from] = Math.max(matched + 1, Math.min(next - 1, message.length + 1));
    this.sendAppend(leader, from);
  }

  private advanceCommit(leader: RaftNode) {
    for (let index = leader.log.length; index > leader.commitIndex; index -= 1) {
      // Raft counts replicas only for entries from the leader's own term; older entries commit with them.
      if (leader.log[index - 1]?.term !== leader.term) return;
      const stored = leader.matchIndex.filter((match) => match >= index).length;
      if (stored < MAJORITY) continue;
      const fresh = leader.log.slice(leader.commitIndex, index);
      leader.commitIndex = index;
      const first = index - fresh.length + 1;
      const span = fresh.length === 1 ? `entry ${index}` : `entries ${first} to ${index}`;
      const pronoun = fresh.length === 1 ? 'it' : 'them';
      this.emit(
        'commit',
        `${nodeName(leader.id)} committed ${span} (${quoteList(fresh)}): ${stored} of ${NODE_COUNT} servers store ${pronoun}.`,
        leader.id,
        leader.term,
        false,
      );
      return;
    }
  }

  private accept(leader: RaftNode, text: string) {
    const s = this.state;
    const entry: LogEntry = { id: s.texts.length, term: leader.term, text };
    s.texts.push(text);
    leader.log.push(entry);
    leader.matchIndex[leader.id] = leader.log.length;
    const reach = s.nodes.filter((peer) => peer.up && this.connected(leader.id, peer.id)).length;
    const stuck =
      reach < MAJORITY
        ? ` It reaches only ${reach} of ${NODE_COUNT} servers, so this entry cannot commit.`
        : '';
    this.emit(
      'accept',
      `${nodeName(leader.id)} (leader, term ${leader.term}) added "${text}" as entry ${leader.log.length}.${stuck}`,
      leader.id,
      leader.term,
      false,
    );
    this.broadcastAppend(leader);
  }

  /** The chat client sits with the majority side of any split. */
  private clientLeader(): RaftNode | null {
    const s = this.state;
    let best: RaftNode | null = null;
    for (const node of s.nodes) {
      if (!node.up || node.role !== 'leader') continue;
      if (s.groups !== null && s.groups[node.id] !== 0) continue;
      if (!best || node.term > best.term) best = node;
    }
    return best;
  }

  private flushClient() {
    const s = this.state;
    if (s.pending.length === 0) return;
    const leader = this.clientLeader();
    if (!leader) {
      if (!s.waiting) {
        s.waiting = true;
        this.emit(
          'client',
          `The chat client could not reach a leader, so it holds "${s.pending[0]}" until one is elected.`,
          null,
          0,
          false,
        );
      }
      return;
    }
    s.waiting = false;
    const texts = s.pending;
    s.pending = [];
    for (const text of texts) this.accept(leader, text);
  }

  private track() {
    const s = this.state;
    const leader = this.workingLeader();
    const term = leader === null ? 0 : this.node(leader).term;
    if (leader === null && s.wins.length > 0) s.leaderlessTicks += 1;
    const last = s.runs[s.runs.length - 1];
    if (last && last.leader === leader && last.term === term) last.end = this.now + 1;
    else s.runs.push({ start: this.now, end: this.now + 1, leader, term });
  }
}

export type RaftScenarioId = 'crash' | 'split' | 'partition';

export interface RaftScenario {
  id: RaftScenarioId;
  label: string;
  diff: string;
  seed: number;
  /** Ticks in one run. */
  length: number;
  schedule: ScheduledCommand<RaftCommand>[];
}

const opening: ScheduledCommand<RaftCommand>[] = [
  { at: 40, command: { type: 'send', text: 'hi' } },
  { at: 60, command: { type: 'send', text: 'hey!' } },
  { at: 80, command: { type: 'send', text: 'lunch?' } },
];

const crashSchedule: ScheduledCommand<RaftCommand>[] = [
  ...opening,
  { at: 100, command: { type: 'crash', node: 'leader' } },
  { at: 110, command: { type: 'send', text: 'noon?' } },
  { at: 170, command: { type: 'send', text: 'sure' } },
  { at: 200, command: { type: 'recover', node: 'all' } },
  { at: 230, command: { type: 'send', text: 'see you' } },
];

export const raftScenarios: Record<RaftScenarioId, RaftScenario> = {
  crash: {
    id: 'crash',
    label: 'Leader crash',
    diff: 'leader crashes at 1.00 s, back at 2.00 s',
    seed: 1,
    length: 280,
    schedule: crashSchedule,
  },
  split: {
    id: 'split',
    label: 'Split vote',
    diff: 'same crash, seed 44: two timers run out at 1.14 s',
    seed: 44,
    length: 280,
    schedule: crashSchedule,
  },
  partition: {
    id: 'partition',
    label: 'Old leader cut off',
    diff: 'leader and one follower cut off from 1.00 s to 2.00 s',
    seed: 1,
    length: 280,
    schedule: [
      { at: 40, command: { type: 'send', text: 'hi' } },
      { at: 60, command: { type: 'send', text: 'hey!' } },
      { at: 100, command: { type: 'isolate-leader' } },
      { at: 110, command: { type: 'send', text: 'tacos?', via: 'isolated' } },
      { at: 120, command: { type: 'send', text: 'noon?' } },
      { at: 140, command: { type: 'send', text: '6 pm?', via: 'isolated' } },
      { at: 170, command: { type: 'send', text: 'sure' } },
      { at: 200, command: { type: 'heal' } },
      { at: 230, command: { type: 'send', text: 'see you' } },
    ],
  },
};

/** Runs a scenario from a fresh cluster, optionally with another seed. */
export function runScenario(
  scenario: RaftScenario,
  seed = scenario.seed,
  ticks = scenario.length,
): RaftCluster {
  const cluster = new RaftCluster(seed);
  while (cluster.ticks < ticks) stepScheduled(cluster, scenario.schedule);
  return cluster;
}
