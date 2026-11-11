import { describe, expect, it } from 'vitest';
import { type ScheduledCommand, stepScheduled } from '../../src/lib/models/adapter';
import { Duel, duelScenarios, sentPerSecond, summarize } from '../../src/lib/models/balancerDuel';
import { type FarmCommand, type FarmTick, ServerFarm, type Strategy } from '../../src/lib/models/serverFarm';

const strategies: Strategy[] = ['round-robin', 'random', 'least-connections'];

const busySchedule: ScheduledCommand<FarmCommand>[] = [
  { at: 0, command: { type: 'heavy-share', value: 0.1 } },
  { at: 20, command: { type: 'crash', server: 1 } },
  { at: 45, command: { type: 'recover', server: 1 } },
  { at: 60, command: { type: 'rate', value: 320 } },
  { at: 80, command: { type: 'capacities', value: [100, 100] } },
  { at: 110, command: { type: 'capacities', value: [100, 100, 100, 100] } },
];

function play(farm: ServerFarm, ticks: number, schedule = busySchedule): FarmTick[] {
  const out: FarmTick[] = [];
  for (let i = 0; i < ticks; i += 1) out.push(stepScheduled(farm, schedule));
  return out;
}

const farmConfig = { capacities: [100, 100, 100], arrivalRate: 240, queueLimit: 60, seed: 7 };

describe('ServerFarm playback', () => {
  it('feeds every strategy the same arrivals and request costs', () => {
    const runs = strategies.map((strategy) => play(new ServerFarm({ ...farmConfig, strategy }), 150));
    const arrivals = runs.map((ticks) => ticks.map((tick) => tick.arrived));
    expect(arrivals[1]).toEqual(arrivals[0]);
    expect(arrivals[2]).toEqual(arrivals[0]);
  });

  it('applies scheduled commands before their tick', () => {
    const farm = new ServerFarm({ ...farmConfig, arrivalRate: 0 });
    stepScheduled(farm, [{ at: 0, command: { type: 'rate', value: 500 } }]);
    expect(farm.totals.arrived).toBeGreaterThan(30);
  });

  it('replays a scripted run exactly', () => {
    const a = play(new ServerFarm(farmConfig), 150);
    const b = play(new ServerFarm(farmConfig), 150);
    expect(b).toEqual(a);
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const farm = new ServerFarm(farmConfig);
    const start = farm.checkpoint();
    const first = play(farm, 150);
    farm.restore(start);
    expect(farm.ticks).toBe(0);
    expect(play(farm, 150)).toEqual(first);
  });

  it('resumes from a checkpoint midway, in the same or a fresh farm', () => {
    const farm = new ServerFarm(farmConfig);
    play(farm, 70);
    const saved = farm.checkpoint();
    const rest = play(farm, 80);

    farm.restore(saved);
    expect(play(farm, 80)).toEqual(rest);

    const fresh = new ServerFarm({ seed: 999 });
    fresh.restore(saved);
    expect(play(fresh, 80)).toEqual(rest);
  });

  it('keeps checkpoints independent of later changes', () => {
    const farm = new ServerFarm(farmConfig);
    play(farm, 30);
    const saved = farm.checkpoint();
    const queued = saved.servers.map((server) => server.queue.length);
    play(farm, 30);
    expect(saved.servers.map((server) => server.queue.length)).toEqual(queued);
  });

  it('accounts for every request: arrived = served + rejected + failed + in flight', () => {
    for (const strategy of strategies) {
      const farm = new ServerFarm({ ...farmConfig, strategy });
      for (let i = 0; i < 150; i += 1) {
        stepScheduled(farm, busySchedule);
        const { arrived, served, rejected, failed } = farm.totals;
        expect(arrived).toBe(served + rejected + failed + farm.inFlight);
      }
    }
  });
});

describe('Balancer duel', () => {
  const run = (duel: Duel) => {
    while (!duel.done) duel.step();
    return duel;
  };

  it('ties when every request costs the same', () => {
    const [rr, lc] = run(new Duel(duelScenarios.equal)).lanes.map(summarize);
    expect(lc).toEqual(rr);
  });

  it('shows least connections cutting the 95th percentile when some requests are slow, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const [rr, lc] = run(new Duel(duelScenarios.slow, undefined, seed)).lanes.map(summarize);
      expect(lc?.arrived).toBe(rr?.arrived);
      expect(lc?.p95Ms ?? 0).toBeLessThan((rr?.p95Ms ?? 0) * 0.8);
      expect(lc?.longestQueue ?? 0).toBeLessThan(rr?.longestQueue ?? 0);
    }
  });

  it('shows least connections feeding a crashed server more traffic, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const duel = run(new Duel(duelScenarios.crash, undefined, seed));
      const [rr, lc] = duel.lanes.map(summarize);
      expect(lc?.failed ?? 0).toBeGreaterThan((rr?.failed ?? 0) * 1.3);
    }
  });

  it('pins the illustrative numbers the lesson quotes for seed 42', () => {
    const slow = run(new Duel(duelScenarios.slow)).lanes.map(summarize);
    expect(Math.round(slow[0]?.p95Ms ?? 0)).toBe(193);
    expect(Math.round(slow[1]?.p95Ms ?? 0)).toBe(90);
    const crash = run(new Duel(duelScenarios.crash)).lanes.map(summarize);
    expect(crash[0]?.failed).toBe(139);
    expect(crash[1]?.failed).toBe(211);
  });

  it('annotates the crash, the health check, and the failures so far', () => {
    const duel = run(new Duel(duelScenarios.crash));
    const texts = duel.events.map((event) => `${(event.tick * duel.tickSeconds).toFixed(1)} ${event.text}`);
    expect(texts[0]).toBe('3.0 Server 1 crashes.');
    expect(texts).toContain(
      '5.0 Health checks remove server 1. Failed so far: round robin 139, least connections 211.',
    );
  });

  it('flags a stuck queue only for round robin in the slow scenario', () => {
    const duel = run(new Duel(duelScenarios.slow));
    const stuck = duel.events.filter((event) => event.text.includes('requests wait at server'));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.text.startsWith('Round robin')).toBe(true);
  });

  it('sends the crashed server about half the traffic under least connections before removal', () => {
    const duel = new Duel(duelScenarios.crash);
    while (duel.ticks < 45) duel.step();
    const rr = sentPerSecond(duel.lanes[0], duel.tickSeconds).get(0) ?? 0;
    const lc = sentPerSecond(duel.lanes[1], duel.tickSeconds).get(0) ?? 0;
    expect(rr).toBeLessThan(80);
    expect(lc).toBeGreaterThan(1.3 * rr);
    expect(lc).toBeLessThan(0.6 * (duelScenarios.crash.config.arrivalRate ?? 0));
  });

  it('stops after the run length', () => {
    const duel = run(new Duel(duelScenarios.equal));
    expect(duel.ticks).toBe(200);
    duel.step();
    expect(duel.ticks).toBe(200);
    expect(duel.lanes[0].series).toHaveLength(200);
  });
});
