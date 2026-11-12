import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import {
  ELECTION_TIMEOUT_MAX_TICKS,
  ELECTION_TIMEOUT_MIN_TICKS,
  formatSeconds,
  type LogEntry,
  NODE_COUNT,
  RaftCluster,
  type RaftCommand,
  raftScenarios,
  runScenario,
} from '../../src/lib/models/raft';
import { createRng, randomInt } from '../../src/lib/rng';

const scenarios = Object.values(raftScenarios);
const seeds = Array.from({ length: 50 }, (_, i) => i + 1);

/** Everything the safety checks remember between ticks. */
interface Watch {
  leaderOfTerm: Map<number, number>;
  committed: LogEntry[];
  /** Term of the leader that first committed each index. */
  commitTerm: number[];
  commitIndex: number[];
}

function newWatch(): Watch {
  return { leaderOfTerm: new Map(), committed: [], commitTerm: [], commitIndex: Array(NODE_COUNT).fill(0) };
}

const same = (a: LogEntry | undefined, b: LogEntry | undefined) =>
  a !== undefined && b !== undefined && a.id === b.id && a.term === b.term;

function checkSafety(cluster: RaftCluster, watch: Watch, where: string) {
  const fail = (rule: string) => {
    throw new Error(`${rule} broken at tick ${cluster.ticks} (${where})`);
  };
  const nodes = cluster.nodes;

  for (const node of nodes) {
    if (node.role !== 'leader') continue;
    const earlier = watch.leaderOfTerm.get(node.term);
    if (earlier !== undefined && earlier !== node.id) fail('Election safety');
    watch.leaderOfTerm.set(node.term, node.id);
  }

  for (const node of nodes) {
    if (node.commitIndex > node.log.length) fail('Commit index within log');
    if (node.commitIndex < (watch.commitIndex[node.id] ?? 0)) fail('Commit index only grows');
    watch.commitIndex[node.id] = node.commitIndex;
    node.log.forEach((entry, i) => {
      if (i > 0 && entry.term < (node.log[i - 1]?.term ?? 0)) fail('Terms never decrease along a log');
    });
  }

  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id >= b.id) continue;
      const shared = Math.min(a.log.length, b.log.length);
      for (let i = shared - 1; i >= 0; i -= 1) {
        if (a.log[i]?.term !== b.log[i]?.term) continue;
        for (let k = 0; k <= i; k += 1) if (!same(a.log[k], b.log[k])) fail('Log matching');
        break;
      }
    }
  }

  for (const node of nodes) {
    for (let i = 0; i < node.commitIndex; i += 1) {
      const entry = node.log[i];
      const known = watch.committed[i];
      if (known === undefined) {
        if (entry === undefined || i !== watch.committed.length) fail('Committed prefix');
        else {
          watch.committed.push(entry);
          watch.commitTerm.push(node.term);
        }
      } else if (!same(entry, known)) {
        fail('State machine safety');
      }
    }
  }

  for (const node of nodes) {
    if (node.role !== 'leader') continue;
    watch.committed.forEach((entry, i) => {
      if ((watch.commitTerm[i] ?? 0) < node.term && !same(node.log[i], entry)) fail('Leader completeness');
    });
  }

  if (cluster.sent !== cluster.texts.length + cluster.pending.length)
    fail('Every sent message is stored or held');
}

function playChecked(
  cluster: RaftCluster,
  schedule: ScheduledCommand<RaftCommand>[],
  ticks: number,
  where: string,
) {
  const watch = newWatch();
  while (cluster.ticks < ticks) {
    stepScheduled(cluster, schedule);
    checkSafety(cluster, watch, where);
  }
  return cluster;
}

function randomSchedule(seed: number, ticks: number): ScheduledCommand<RaftCommand>[] {
  const rng = createRng(seed * 7919);
  const schedule: ScheduledCommand<RaftCommand>[] = [];
  for (let at = 20; at < ticks; at += 1) {
    if (rng() > 0.06) continue;
    const roll = randomInt(rng, 0, 9);
    const node = randomInt(rng, 0, NODE_COUNT - 1);
    let command: RaftCommand;
    if (roll <= 3) command = { type: 'send', text: `m${at}`, via: roll === 0 ? 'isolated' : undefined };
    else if (roll === 4) command = { type: 'crash', node: 'leader' };
    else if (roll === 5) command = { type: 'crash', node };
    else if (roll === 6) command = { type: 'recover', node };
    else if (roll === 7) command = { type: 'recover', node: 'all' };
    else if (roll === 8) command = { type: 'isolate-leader' };
    else command = { type: 'heal' };
    schedule.push({ at, command });
  }
  return schedule;
}

function electionTicks(cluster: RaftCluster, term: number) {
  return cluster.events
    .filter((event) => event.kind === 'election' && event.term === term)
    .map((event) => ({ tick: event.tick, node: event.node }));
}

const commitTimes = (cluster: RaftCluster) =>
  cluster.events.filter((event) => event.kind === 'commit').map((event) => formatSeconds(event.tick));

describe('Raft model playback', () => {
  it('replays a scenario exactly from the same seed', () => {
    for (const scenario of scenarios) {
      const a = runScenario(scenario);
      const b = runScenario(scenario);
      expect(b.events).toEqual(a.events);
      expect(b.nodes).toEqual(a.nodes);
      expect(b.stats()).toEqual(a.stats());
    }
  });

  it('draws different election timers from different seeds', () => {
    const a = runScenario(raftScenarios.crash, 1);
    const b = runScenario(raftScenarios.crash, 2);
    expect(b.events.map((event) => event.text)).not.toEqual(a.events.map((event) => event.text));
  });

  it('resumes from a checkpoint exactly where a straight run goes', () => {
    for (const scenario of scenarios) {
      const straight = runScenario(scenario);
      const cluster = new RaftCluster(scenario.seed);
      while (cluster.ticks < 105) stepScheduled(cluster, scenario.schedule);
      const saved = cluster.checkpoint();
      while (cluster.ticks < 190) stepScheduled(cluster, scenario.schedule);
      cluster.restore(saved);
      expect(cluster.ticks).toBe(105);
      while (cluster.ticks < scenario.length) stepScheduled(cluster, scenario.schedule);
      expect(cluster.events).toEqual(straight.events);
      expect(cluster.nodes).toEqual(straight.nodes);
    }
  });

  it('rebuilds to the same state as a fresh cluster', () => {
    const fresh = new RaftCluster(44);
    const used = new RaftCluster(44);
    const start = used.checkpoint();
    for (let i = 0; i < 150; i += 1) used.step();
    used.restore(start);
    expect(used.checkpoint()).toEqual(fresh.checkpoint());
  });

  it('keeps every election timeout inside the 150 to 300 ms window', () => {
    for (const seed of seeds) {
      const cluster = new RaftCluster(seed);
      for (let i = 0; i < 280; i += 1) {
        cluster.step();
        for (const node of cluster.nodes) {
          expect(node.timeout).toBeGreaterThanOrEqual(ELECTION_TIMEOUT_MIN_TICKS);
          expect(node.timeout).toBeLessThanOrEqual(ELECTION_TIMEOUT_MAX_TICKS);
        }
      }
    }
  });
});

describe('Raft safety', () => {
  it('holds every tick across all scenarios and 50 seeds', () => {
    for (const scenario of scenarios) {
      for (const seed of seeds) {
        playChecked(new RaftCluster(seed), scenario.schedule, scenario.length, `${scenario.id} seed ${seed}`);
      }
    }
  });

  it('holds every tick under random crashes, recoveries, splits, and messages', () => {
    for (const seed of seeds) {
      playChecked(new RaftCluster(seed), randomSchedule(seed, 400), 400, `random seed ${seed}`);
    }
  });

  it('never lets two winners share a term', () => {
    for (const seed of seeds) {
      const cluster = runScenario(raftScenarios.partition, seed, 400);
      const terms = cluster.wins.map((win) => win.term);
      expect(new Set(terms).size).toBe(terms.length);
    }
  });

  it('commits every chat message after a crash, for every seed', () => {
    for (const scenario of [raftScenarios.crash, raftScenarios.split]) {
      for (const seed of seeds) {
        const stats = runScenario(scenario, seed).stats();
        expect(stats.committed).toBe(6);
        expect(stats.sent).toBe(6);
        expect(stats.lost).toBe(0);
      }
    }
  });

  it('loses exactly the two messages the cut-off leader accepted, for every seed', () => {
    for (const seed of seeds) {
      const cluster = runScenario(raftScenarios.partition, seed);
      expect(cluster.committedLog().map((entry) => entry.text)).toEqual([
        'hi',
        'hey!',
        'noon?',
        'sure',
        'see you',
      ]);
      expect(cluster.stats().lost).toBe(2);
    }
  });

  it('erases no committed entry in the Figure 8 scenario, for every seed', () => {
    const scenario = raftScenarios['old-entry'];
    for (const seed of seeds) {
      const cluster = playChecked(
        new RaftCluster(seed),
        scenario.schedule,
        scenario.length,
        `old-entry seed ${seed}`,
      );
      expect(cluster.stats().committedErased).toBe(0);
      expect(cluster.committedLog().map((entry) => entry.text)).toEqual(['hi', 'tacos?', 'see you']);
    }
  });

  it('breaks safety in the Figure 8 scenario once a leader counts copies of older-term entries', () => {
    const scenario = raftScenarios['old-entry'];
    for (const seed of seeds) {
      const options = { unsafeCommit: true };
      expect(runScenario(scenario, seed, scenario.length, options).stats().committedErased).toBeGreaterThan(
        0,
      );
      expect(() =>
        playChecked(
          new RaftCluster(seed, options),
          scenario.schedule,
          scenario.length,
          `unsafe seed ${seed}`,
        ),
      ).toThrow(/broken at tick/);
    }
  });
});

describe('Raft numbers the lesson quotes', () => {
  it('uses one schedule for the crash and split-vote scenarios', () => {
    expect(raftScenarios.split.schedule).toBe(raftScenarios.crash.schedule);
    expect(raftScenarios.crash.seed).toBe(1);
    expect(raftScenarios.split.seed).toBe(44);
  });

  it('leader crash: Node 3 wins term 2 at 1.19 s, 190 ms after the crash', () => {
    const cluster = runScenario(raftScenarios.crash);
    expect(cluster.wins.map((win) => [win.term, win.node + 1, formatSeconds(win.tick)])).toEqual([
      [1, 2, '0.19 s'],
      [2, 3, '1.19 s'],
    ]);
    expect(electionTicks(cluster, 2)).toEqual([{ tick: 113, node: 2 }]);
    expect(commitTimes(cluster)).toEqual(['0.44 s', '0.64 s', '0.84 s', '1.25 s', '1.76 s', '2.34 s']);
    const stats = cluster.stats();
    expect(stats.leaderlessTicks).toBe(19);
    expect(stats.splitTerms).toBe(0);
    expect(stats.electionsStarted).toBe(2);
    expect(stats.committed).toBe(6);
  });

  it('split vote: Node 2 and Node 5 tie 2 to 2 in term 2, then Node 2 wins term 3 at 1.38 s', () => {
    const scenario = raftScenarios.split;
    const cluster = new RaftCluster(scenario.seed);
    while (cluster.ticks < 132) stepScheduled(cluster, scenario.schedule);
    expect(electionTicks(cluster, 2)).toEqual([
      { tick: 114, node: 1 },
      { tick: 114, node: 4 },
    ]);
    expect(cluster.nodes[1]?.votes).toEqual([1, 0]);
    expect(cluster.nodes[4]?.votes).toEqual([4, 3]);
    expect(cluster.nodes[2]?.up).toBe(false);

    while (cluster.ticks < scenario.length) stepScheduled(cluster, scenario.schedule);
    expect(electionTicks(cluster, 3)).toEqual([{ tick: 132, node: 1 }]);
    expect(cluster.events.find((event) => event.kind === 'election' && event.term === 3)?.text).toContain(
      '180 ms',
    );
    expect(cluster.wins.map((win) => [win.term, win.node + 1, formatSeconds(win.tick)])).toEqual([
      [1, 3, '0.22 s'],
      [3, 2, '1.38 s'],
    ]);
    expect(commitTimes(cluster)[3]).toBe('1.44 s');
    const stats = cluster.stats();
    expect(stats.leaderlessTicks).toBe(38);
    expect(stats.splitTerms).toBe(1);
    expect(stats.electionsStarted).toBe(5);
    expect(stats.committed).toBe(6);
  });

  it('old leader cut off: Node 1 wins term 2 at 1.24 s and the old leader erases two messages at 2.02 s', () => {
    const cluster = runScenario(raftScenarios.partition);
    expect(cluster.wins.map((win) => [win.term, win.node + 1, formatSeconds(win.tick)])).toEqual([
      [1, 2, '0.19 s'],
      [2, 1, '1.24 s'],
    ]);
    const accepted = cluster.events
      .filter((event) => event.kind === 'accept' && event.node === 1 && event.term === 1)
      .map((event) => formatSeconds(event.tick));
    expect(accepted).toEqual(['0.40 s', '0.60 s', '1.10 s', '1.40 s']);
    expect(electionTicks(cluster, 2)).toEqual([{ tick: 118, node: 0 }]);
    expect(commitTimes(cluster)).toEqual(['0.44 s', '0.64 s', '1.30 s', '1.76 s', '2.34 s']);
    const stepDown = cluster.events.find((event) => event.kind === 'step-down');
    expect(stepDown && [stepDown.node, formatSeconds(stepDown.tick)]).toEqual([1, '2.02 s']);
    const erased = cluster.events
      .filter((event) => event.kind === 'erase')
      .map((event) => [event.node, formatSeconds(event.tick)]);
    expect(erased).toEqual([
      [1, '2.02 s'],
      [2, '2.03 s'],
    ]);
    const stats = cluster.stats();
    expect(stats.leaderlessTicks).toBe(24);
    expect(stats.erasedCopies).toBe(4);
    expect(stats.lost).toBe(2);
    expect(stats.committed).toBe(5);
    expect(stats.sent).toBe(7);
    expect(cluster.committedLog().map((entry) => entry.text)).toEqual([
      'hi',
      'hey!',
      'noon?',
      'sure',
      'see you',
    ]);
  });

  it('old entry on a majority: Node 1 holds "pizza?" at 1.04 s and Node 5 erases it at 1.32 s', () => {
    const scenario = raftScenarios['old-entry'];
    const safe = runScenario(scenario);
    expect(safe.wins.map((win) => [win.term, win.node + 1, formatSeconds(win.tick)])).toEqual([
      [1, 2, '0.05 s'],
      [2, 1, '0.44 s'],
      [3, 5, '0.72 s'],
      [4, 1, '0.92 s'],
      [5, 5, '1.26 s'],
    ]);
    const hold = safe.events.find((event) => event.kind === 'hold');
    expect(hold && [hold.node, formatSeconds(hold.tick)]).toEqual([0, '1.04 s']);
    expect(hold?.text).toContain('on 3 of 5 servers');
    expect(commitTimes(safe)).toEqual(['0.24 s', '1.74 s']);
    expect(safe.stats().committedErased).toBe(0);

    const unsafe = runScenario(scenario, scenario.seed, scenario.length, { unsafeCommit: true });
    expect(commitTimes(unsafe)).toEqual(['0.24 s', '1.04 s', '1.38 s', '1.74 s']);
    expect(unsafe.events.find((event) => event.kind === 'erase')?.text).toContain(
      'committed message ("pizza?")',
    );
    expect(formatSeconds(unsafe.events.find((event) => event.kind === 'erase')?.tick ?? 0)).toBe('1.32 s');
    expect(unsafe.stats().committedErased).toBe(4);
    expect(() =>
      playChecked(
        new RaftCluster(scenario.seed, { unsafeCommit: true }),
        scenario.schedule,
        scenario.length,
        'unsafe',
      ),
    ).toThrow('Leader completeness broken at tick 127');
  });

  it('runs every scenario to a single agreed chat log', () => {
    for (const scenario of scenarios) {
      const cluster = runScenario(scenario);
      const committed = cluster.committedLog();
      for (const node of cluster.nodes) expect(node.log).toEqual(committed);
    }
  });
});
