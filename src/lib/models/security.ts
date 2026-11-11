import { createRng, randomInt, type SeededRng } from '../rng';

/**
 * Toy model of DELETE /links/{code} requests passing three checkpoints: a private
 * channel (TLS), sign-in (authentication), and permission (authorization). Two lanes
 * replay the same pre-generated requests. One lane is missing a single defense; the
 * other has all of them. Each request takes under a second so you can watch it move.
 * Callers, links, and timings are illustrative, and no credential here is real.
 */
export type SecScenarioId = 'ownership' | 'expired' | 'plainHttp' | 'repoKey';
export type SecCaller =
  | 'owner'
  | 'other'
  | 'expired'
  | 'anonymous'
  | 'admin'
  | 'job'
  | 'observer'
  | 'keyHolder';
export type SecCredential = 'session' | 'expired' | 'none' | 'copied' | 'leakedKey' | 'adminKey';
export type SecGate = 'tls' | 'authn' | 'authz';
export type SecDefense = 'tls' | 'expiry' | 'ownership' | 'secretManager';
export type SecVerdict = 'allowedCorrect' | 'rejectedCorrect' | 'wronglyAllowed' | 'wronglyRejected';
export type SecStatus = '204' | '401' | '403' | 'refused';

export interface SecRequest {
  id: number;
  caller: SecCaller;
  /** Who sends it, as the transcript names them. */
  who: string;
  /** The identity the credential names. Empty when there is none. */
  user: string;
  /** Who owns the target link. */
  owner: string;
  /** The short code in DELETE /links/{code}. */
  code: string;
  arriveAt: number;
  credential: SecCredential;
  /** The client tries plain HTTP, whatever the server allows. */
  plain: boolean;
  /** The request crosses the cafe Wi-Fi hop, where anyone on the network can listen. */
  cafe: boolean;
  /** What a fully defended server does: true when it should delete the link. */
  legit: boolean;
}

export interface SecScenario {
  id: SecScenarioId;
  label: string;
  /** What this scenario changes, shown on its chip. */
  diff: string;
  /** The defense the first lane is missing. */
  missing: SecDefense;
  /** The caller the missing defense should stop. */
  focus: SecCaller;
  /** Lane names: the lane missing a defense first, the fully defended lane second. */
  lanes: [string, string];
  generate: (seed: number) => SecRequest[];
}

export interface SecEvent {
  tick: number;
  text: string;
  /** False for wrap up notes that belong in the transcript but not on the chart. */
  marker: boolean;
}

export interface SecResult {
  id: number;
  tick: number;
  gate: SecGate;
  status: SecStatus;
  allowed: boolean;
  verdict: SecVerdict;
  text: string;
}

/** The latest request on the cafe Wi-Fi hop, as a listener on that network sees it. */
export interface SecSighting {
  id: number;
  tick: number;
  who: string;
  user: string;
  code: string;
  readable: boolean;
}

interface SecIdentity {
  name: string;
  admin: boolean;
}

export interface SecLane {
  label: string;
  defenses: Record<SecDefense, boolean>;
  /** Indexed by request id minus one: true once the request has arrived. */
  started: boolean[];
  /** Indexed by request id minus one: who sign-in decided the caller is. */
  identities: (SecIdentity | null)[];
  /** Indexed by request id minus one. Null while the request is in flight. */
  results: (SecResult | null)[];
  /** Ids in the order they finished. */
  finished: number[];
  /** Users whose session token crossed the cafe hop in plain text. */
  exposed: string[];
  seen: SecSighting | null;
  /** One value per tick: wrongly allowed so far. */
  series: number[];
  /** Kinds of moments this lane has already annotated on the chart. */
  flags: string[];
}

interface SecState {
  tick: number;
  lanes: [SecLane, SecLane];
  events: SecEvent[];
}

export const SEC_SECONDS = 20;
export const SEC_TICK_SECONDS = 0.1;
export const SEC_TICKS = Math.round(SEC_SECONDS / SEC_TICK_SECONDS);

/** Ticks after arrival when a request reaches each checkpoint. Allowed requests finish at the last one. */
export const SEC_GATE_OFFSETS: Record<SecGate, number> = { tls: 1, authn: 4, authz: 7 };
export const SEC_REQUEST_TICKS = 8;
export const SEC_GATES: SecGate[] = ['tls', 'authn', 'authz'];

/** The repo key timeline: the team notices, rotates and revokes, then redeploys the job. */
export const KEY_DETECT_TICK = 100;
export const KEY_ROTATE_TICK = 120;
export const KEY_REDEPLOY_TICK = 160;

const LAST_ARRIVAL = SEC_TICKS - SEC_REQUEST_TICKS - 4;
const USERS = ['Ana', 'Ben', 'Chen', 'Dee'];
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export const SEC_DEFENSES: { id: SecDefense; gate: SecGate; on: string; off: string }[] = [
  { id: 'tls', gate: 'tls', on: 'HTTPS only', off: 'Plain HTTP allowed' },
  { id: 'expiry', gate: 'authn', on: 'Expiry checked', off: 'Expiry ignored' },
  { id: 'secretManager', gate: 'authn', on: 'Key in a secret manager', off: 'Key in the repo' },
  { id: 'ownership', gate: 'authz', on: 'Ownership checked', off: 'No ownership check' },
];

const LEGIT: Record<SecCaller, boolean> = {
  owner: true,
  admin: true,
  job: true,
  other: false,
  expired: false,
  anonymous: false,
  observer: false,
  keyHolder: false,
};

interface Wave {
  caller: SecCaller;
  count: number;
  from?: number;
  to?: number;
  /** Fixed arrival ticks, for scheduled callers such as the cleanup job. */
  at?: number[];
  user?: string;
  cafe?: boolean;
}

function pick<T>(rng: SeededRng, items: readonly T[]): T {
  return items[randomInt(rng, 0, items.length - 1)] as T;
}

function linkCode(rng: SeededRng): string {
  return Array.from({ length: 4 }, () => CODE_CHARS[randomInt(rng, 0, CODE_CHARS.length - 1)]).join('');
}

function caller(rng: SeededRng, wave: Wave, arriveAt: number): Omit<SecRequest, 'id'> {
  const user = wave.user ?? pick(rng, USERS);
  const base = {
    caller: wave.caller,
    who: user,
    user,
    owner: user,
    code: linkCode(rng),
    arriveAt,
    credential: 'session' as SecCredential,
    plain: false,
    cafe: wave.cafe ?? false,
    legit: LEGIT[wave.caller],
  };
  switch (wave.caller) {
    case 'owner':
      return base;
    case 'other':
      return {
        ...base,
        owner: pick(
          rng,
          USERS.filter((name) => name !== user),
        ),
      };
    case 'expired':
      return { ...base, who: `${user}'s old token`, credential: 'expired' };
    case 'anonymous':
      return { ...base, who: 'Anonymous', user: '', credential: 'none', plain: rng() < 0.5 };
    case 'admin':
      return { ...base, who: 'Admin', user: 'Admin' };
    case 'job':
      return { ...base, who: 'Cleanup job', user: 'Cleanup job', credential: 'adminKey' };
    case 'observer':
      return { ...base, who: 'Observer', user: 'Ben', owner: 'Ben', credential: 'copied' };
    case 'keyHolder':
      return { ...base, who: 'Repo reader', user: '', credential: 'leakedKey' };
  }
}

function stream(seed: number, waves: Wave[]): SecRequest[] {
  const rng = createRng(seed);
  const raw: Omit<SecRequest, 'id'>[] = [];
  for (const wave of waves) {
    for (let index = 0; index < wave.count; index += 1) {
      const arriveAt = wave.at?.[index] ?? randomInt(rng, wave.from ?? 0, wave.to ?? LAST_ARRIVAL);
      raw.push(caller(rng, wave, arriveAt));
    }
  }
  return raw
    .map((request, order) => ({ request, order }))
    .sort((a, b) => a.request.arriveAt - b.request.arriveAt || a.order - b.order)
    .map(({ request }, index) => ({ ...request, id: index + 1 }));
}

const JOB_TICKS = Array.from({ length: 10 }, (_, index) => 5 + index * 20);

export const secScenarios: Record<SecScenarioId, SecScenario> = {
  ownership: {
    id: 'ownership',
    label: 'No ownership check',
    diff: 'DELETE /links/{code} checks that the caller is signed in and never asks who owns the link.',
    missing: 'ownership',
    focus: 'other',
    lanes: ['No ownership check', 'All defenses'],
    generate: (seed) =>
      stream(seed, [
        { caller: 'owner', count: 12 },
        { caller: 'other', count: 10 },
        { caller: 'expired', count: 3 },
        { caller: 'anonymous', count: 5 },
        { caller: 'admin', count: 3 },
      ]),
  },
  expired: {
    id: 'expired',
    label: 'Expired tokens accepted',
    diff: 'Sign-in verifies the token signature but skips its expiry time, so an old token works forever.',
    missing: 'expiry',
    focus: 'expired',
    lanes: ['Expiry ignored', 'All defenses'],
    generate: (seed) =>
      stream(seed, [
        { caller: 'owner', count: 12 },
        { caller: 'other', count: 4 },
        { caller: 'expired', count: 10 },
        { caller: 'anonymous', count: 4 },
        { caller: 'admin', count: 3 },
      ]),
  },
  plainHttp: {
    id: 'plainHttp',
    label: 'Plain HTTP on the cafe Wi-Fi hop',
    diff: "Ben deletes links from a cafe. The API accepts plain HTTP, so anyone on that Wi-Fi can read Ben's request headers.",
    missing: 'tls',
    focus: 'observer',
    lanes: ['Plain HTTP allowed', 'All defenses'],
    generate: (seed) =>
      stream(seed, [
        { caller: 'owner', count: 5, user: 'Ben', cafe: true, from: 0, to: 100 },
        { caller: 'owner', count: 7 },
        { caller: 'other', count: 4 },
        { caller: 'expired', count: 3 },
        { caller: 'anonymous', count: 5 },
        { caller: 'admin', count: 2 },
        { caller: 'observer', count: 6, from: 40 },
      ]),
  },
  repoKey: {
    id: 'repoKey',
    label: 'Admin key in the repo',
    diff: 'A cleanup job reads the admin API key from the source code, so everyone who can read the repo holds it too.',
    missing: 'secretManager',
    focus: 'keyHolder',
    lanes: ['Key in the repo', 'All defenses'],
    generate: (seed) =>
      stream(seed, [
        { caller: 'owner', count: 10 },
        { caller: 'other', count: 4 },
        { caller: 'expired', count: 3 },
        { caller: 'anonymous', count: 4 },
        { caller: 'job', count: JOB_TICKS.length, at: JOB_TICKS },
        { caller: 'keyHolder', count: 8 },
      ]),
  },
};

const blankLane = (label: string, missing: SecDefense | null, count: number): SecLane => ({
  label,
  defenses: {
    tls: true,
    expiry: true,
    ownership: true,
    secretManager: true,
    ...(missing ? { [missing]: false } : {}),
  },
  started: Array.from({ length: count }, () => false),
  identities: Array.from({ length: count }, () => null),
  results: Array.from({ length: count }, () => null),
  finished: [],
  exposed: [],
  seen: null,
  series: [],
  flags: [],
});

export interface SecTotals {
  arrived: number;
  allowed: number;
  rejected: number;
  inFlight: number;
  allowedCorrect: number;
  rejectedCorrect: number;
  wronglyAllowed: number;
  wronglyRejected: number;
}

export function laneTotals(lane: SecLane): SecTotals {
  const totals: SecTotals = {
    arrived: 0,
    allowed: 0,
    rejected: 0,
    inFlight: 0,
    allowedCorrect: 0,
    rejectedCorrect: 0,
    wronglyAllowed: 0,
    wronglyRejected: 0,
  };
  lane.started.forEach((started, index) => {
    if (!started) return;
    totals.arrived += 1;
    const result = lane.results[index];
    if (!result) {
      totals.inFlight += 1;
      return;
    }
    if (result.allowed) totals.allowed += 1;
    else totals.rejected += 1;
    totals[result.verdict] += 1;
  });
  return totals;
}

/** Where a request in flight stands on its lane's track: 0 at arrival, 1 at the permission check. */
export function trackProgress(request: SecRequest, tick: number): number {
  return Math.min(1, Math.max(0, (tick - request.arriveAt) / SEC_GATE_OFFSETS.authz));
}

const link = (code: string) => `sho.rt/${code}`;

export class SecDuel {
  readonly scenario: SecScenario;
  readonly requests: SecRequest[];
  readonly length = SEC_TICKS;
  readonly tickSeconds = SEC_TICK_SECONDS;
  private state: SecState;

  constructor(scenario: SecScenario, seed = 42) {
    this.scenario = scenario;
    this.requests = scenario.generate(seed);
    this.state = this.initial();
  }

  private initial(): SecState {
    const count = this.requests.length;
    const [first, second] = this.scenario.lanes;
    return {
      tick: 0,
      lanes: [blankLane(first, this.scenario.missing, count), blankLane(second, null, count)],
      events: [],
    };
  }

  get ticks(): number {
    return this.state.tick;
  }

  get done(): boolean {
    return this.state.tick >= this.length;
  }

  get lanes(): readonly [SecLane, SecLane] {
    return this.state.lanes;
  }

  get events(): readonly SecEvent[] {
    return this.state.events;
  }

  /** Requests that have arrived but not yet finished, in one lane. */
  inFlight(lane: SecLane): SecRequest[] {
    return this.requests.filter((request) => lane.started[request.id - 1] && !lane.results[request.id - 1]);
  }

  step(): void {
    if (this.done) return;
    const tick = this.state.tick;
    this.keyTimeline(tick);
    for (const request of this.requests) {
      const offset = tick - request.arriveAt;
      if (offset === 0) {
        for (const lane of this.state.lanes) lane.started[request.id - 1] = true;
      }
      const gate = SEC_GATES.find((name) => SEC_GATE_OFFSETS[name] === offset);
      if (!gate) continue;
      for (const lane of this.state.lanes) {
        if (!lane.results[request.id - 1]) this.check(lane, request, gate, tick);
      }
    }
    for (const lane of this.state.lanes) lane.series.push(laneTotals(lane).wronglyAllowed);
    this.state.tick += 1;
    if (this.done) this.state.events.push({ tick: this.length, text: this.wrapUp(), marker: false });
  }

  checkpoint(): SecState {
    return structuredClone(this.state);
  }

  restore(state: SecState): void {
    this.state = structuredClone(state);
  }

  private check(lane: SecLane, request: SecRequest, gate: SecGate, tick: number): void {
    if (gate === 'tls') this.checkChannel(lane, request, tick);
    else if (gate === 'authn') this.checkSignIn(lane, request, tick);
    else this.checkPermission(lane, request, tick);
  }

  private checkChannel(lane: SecLane, request: SecRequest, tick: number): void {
    if (lane.defenses.tls && request.plain) {
      this.finish(
        lane,
        request,
        tick,
        'tls',
        'refused',
        `Refused: ${request.who} tried plain HTTP, and the API listens only for HTTPS.`,
      );
      return;
    }
    if (!request.cafe) return;
    const readable = !lane.defenses.tls;
    lane.seen = { id: request.id, tick, who: request.who, user: request.user, code: request.code, readable };
    if (!readable || lane.exposed.includes(request.user)) return;
    lane.exposed.push(request.user);
    this.flag(
      lane,
      'exposed',
      tick,
      `${lane.label}: ${request.who}'s delete crosses the cafe Wi-Fi as plain text. Anyone on that network can read the session cookie in its headers.`,
    );
  }

  private checkSignIn(lane: SecLane, request: SecRequest, tick: number): void {
    const index = request.id - 1;
    const keyInRepo = !lane.defenses.secretManager;
    const reject = (text: string) =>
      this.finish(lane, request, tick, 'authn', '401', `401 Unauthorized: ${text}`);
    switch (request.credential) {
      case 'session':
        lane.identities[index] = { name: request.user, admin: request.caller === 'admin' };
        return;
      case 'expired':
        if (lane.defenses.expiry) {
          reject('the token expired, so its holder has to sign in again.');
          return;
        }
        lane.identities[index] = { name: request.user, admin: false };
        return;
      case 'none':
        reject(`${request.who} sent no credentials.`);
        return;
      case 'copied':
        if (!lane.exposed.includes(request.user)) {
          reject(
            lane.defenses.tls
              ? 'the observer saw only ciphertext, so it has no session to send.'
              : 'the observer has not yet seen a session to copy.',
          );
          return;
        }
        lane.identities[index] = { name: request.user, admin: false };
        return;
      case 'leakedKey':
        if (!keyInRepo) {
          reject('the repo holds no key, so the repo reader has nothing valid to send.');
          return;
        }
        if (tick >= KEY_ROTATE_TICK) {
          reject(`the leaked admin key was revoked at ${(KEY_ROTATE_TICK * SEC_TICK_SECONDS).toFixed(1)} s.`);
          return;
        }
        lane.identities[index] = { name: 'the admin key', admin: true };
        return;
      case 'adminKey':
        if (keyInRepo && tick >= KEY_ROTATE_TICK && tick < KEY_REDEPLOY_TICK) {
          reject('the cleanup job still sends the revoked key written in its code.');
          this.flag(
            lane,
            'jobRejected',
            tick,
            `${lane.label}: the cleanup job gets 401. Its key lives in the code, so rotating the key breaks the job until someone ships a new build.`,
          );
          return;
        }
        lane.identities[index] = { name: 'the admin key', admin: true };
        return;
    }
  }

  private checkPermission(lane: SecLane, request: SecRequest, tick: number): void {
    const identity = lane.identities[request.id - 1];
    if (!identity) return;
    const owns = identity.name === request.owner;
    if (!identity.admin && !owns && lane.defenses.ownership) {
      this.finish(
        lane,
        request,
        tick,
        'authz',
        '403',
        `403 Forbidden: ${request.who} does not own ${link(request.code)}; ${request.owner} does.`,
      );
      return;
    }
    this.finish(lane, request, tick, 'authz', '204', this.allowedText(request));
  }

  private allowedText(request: SecRequest): string {
    const target = link(request.code);
    switch (request.caller) {
      case 'owner':
        return `204 Deleted: ${request.who} deleted their own link ${target}.`;
      case 'admin':
        return `204 Deleted: Admin removed ${request.owner}'s reported link ${target}.`;
      case 'job':
        return `204 Deleted: the cleanup job removed ${request.owner}'s stale link ${target}.`;
      case 'other':
        return `204 Deleted: ${request.who} deleted ${request.owner}'s link ${target}. Nothing asked whose link it was.`;
      case 'expired':
        return `204 Deleted: an expired token deleted ${request.owner}'s link ${target}.`;
      case 'observer':
        return `204 Deleted: the observer, holding Ben's copied session, deleted Ben's link ${target}.`;
      default:
        return `204 Deleted: a repo reader, holding the admin key, deleted ${request.owner}'s link ${target}.`;
    }
  }

  private finish(
    lane: SecLane,
    request: SecRequest,
    tick: number,
    gate: SecGate,
    status: SecStatus,
    text: string,
  ): void {
    const allowed = status === '204';
    const verdict: SecVerdict = allowed
      ? request.legit
        ? 'allowedCorrect'
        : 'wronglyAllowed'
      : request.legit
        ? 'wronglyRejected'
        : 'rejectedCorrect';
    lane.results[request.id - 1] = { id: request.id, tick, gate, status, allowed, verdict, text };
    lane.finished.push(request.id);
    if (verdict === 'wronglyAllowed') {
      this.flag(lane, 'wronglyAllowed', tick, this.harmNote(lane, request));
    } else if (!allowed && request.caller === this.scenario.focus && lane === this.state.lanes[1]) {
      this.flag(lane, 'stopped', tick, this.stopNote(lane, request, status));
    }
  }

  private harmNote(lane: SecLane, request: SecRequest): string {
    const target = link(request.code);
    switch (request.caller) {
      case 'other':
        return `${lane.label}: ${request.who} deletes ${request.owner}'s link ${target}. The handler confirmed ${request.who} is signed in and never asked whose link it is.`;
      case 'expired':
        return `${lane.label}: a token that expired days ago deletes ${request.owner}'s link ${target}. Its signature is valid, and nothing reads its expiry time.`;
      case 'observer':
        return `${lane.label}: the observer reuses Ben's copied session and deletes ${target}. Sign-in and ownership both pass, because the server sees Ben.`;
      default:
        return `${lane.label}: someone with a copy of the repo deletes ${request.owner}'s link ${target} with the admin key. The server sees a valid key.`;
    }
  }

  private stopNote(lane: SecLane, request: SecRequest, status: SecStatus): string {
    switch (request.caller) {
      case 'other':
        return `${lane.label}: ${request.who}'s delete of ${request.owner}'s link stops at the ownership check with 403 Forbidden.`;
      case 'expired':
        return `${lane.label}: an expired token stops at sign-in with 401 Unauthorized. Its holder has to sign in again.`;
      case 'observer':
        return `${lane.label}: the observer saw only ciphertext on the cafe Wi-Fi, so its request carries no session and gets ${status}.`;
      default:
        return `${lane.label}: the repo holds no key. The repo reader's request gets ${status} Unauthorized.`;
    }
  }

  private flag(lane: SecLane, kind: string, tick: number, text: string): void {
    if (lane.flags.includes(kind)) return;
    lane.flags.push(kind);
    this.state.events.push({ tick, text, marker: true });
  }

  private keyTimeline(tick: number): void {
    if (this.scenario.id !== 'repoKey') return;
    const label = this.state.lanes[0].label;
    const notes: Record<number, string> = {
      [KEY_DETECT_TICK]: `${label}: the audit log shows admin deletes from an unfamiliar address. The team starts rotating the key.`,
      [KEY_ROTATE_TICK]: `${label}: the team issues a new key and revokes the old one. The leaked copy stops working.`,
      [KEY_REDEPLOY_TICK]: `${label}: the cleanup job ships a build that reads the new key from a secret manager. It works again.`,
    };
    const text = notes[tick];
    if (text) this.state.events.push({ tick, text, marker: true });
  }

  private wrapUp(): string {
    const [first, second] = this.state.lanes;
    const a = laneTotals(first);
    const b = laneTotals(second);
    const total = this.requests.length;
    const lane = (name: string, t: SecTotals) =>
      `${name}: ${t.wronglyAllowed} wrongly allowed, ${t.wronglyRejected} wrongly rejected`;
    return `Run ends. ${total} requests. ${lane(first.label, a)}. ${lane(second.label, b)}.`;
  }
}
