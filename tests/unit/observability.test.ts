import { describe, expect, it } from 'vitest';
import {
  decideSampling,
  findExemplars,
  IncidentRun,
  incidentScenarios,
  logsDuring,
  logsFor,
  SamplingRun,
  samplerBudget,
  samplingScenarios,
  samplingTotals,
  selfTime,
  simulateIncident,
  slowestSelfSpan,
} from '../../src/lib/models/observability';

function finish<T extends { done: boolean; step(): void }>(run: T): T {
  while (!run.done) run.step();
  return run;
}

describe('simulateIncident', () => {
  it('replays the same traces for the same seed', () => {
    expect(simulateIncident()).toEqual(simulateIncident());
  });

  it('draws an identical workload in every scenario', () => {
    const [deploy, noDeploy, bigger] = Object.values(incidentScenarios).map((scenario) =>
      simulateIncident(scenario.overrides),
    );
    const shape = (result: ReturnType<typeof simulateIncident> | undefined) =>
      result?.traces.map((trace) => [trace.id, trace.start, trace.route, trace.cacheHit]);
    expect(shape(noDeploy)).toEqual(shape(deploy));
    expect(shape(bigger)).toEqual(shape(deploy));
    expect(deploy?.ticks.slice(0, 200)).toEqual(noDeploy?.ticks.slice(0, 200));
  });

  it('conserves requests on every tick', () => {
    for (const scenario of Object.values(incidentScenarios)) {
      const result = simulateIncident(scenario.overrides);
      for (const point of result.ticks) {
        expect(point.arrived).toBe(point.completed + point.inFlight);
        expect(point.failed).toBeLessThanOrEqual(point.completed);
        expect(point.busy).toBeLessThanOrEqual(result.config.poolSize);
      }
    }
  });

  it('keeps child spans inside their parent with no overlap', () => {
    for (const trace of simulateIncident().traces) {
      for (const span of trace.spans) {
        expect(selfTime(trace, span)).toBeGreaterThanOrEqual(0);
      }
      expect(trace.spans[0]?.duration).toBe(trace.duration);
      expect(trace.end - trace.start).toBe(trace.duration);
    }
  });

  it('only fails requests that waited the full pool timeout', () => {
    const result = simulateIncident();
    for (const trace of result.traces.filter((t) => t.status === 503)) {
      expect(trace.poolWait).toBe(result.config.poolTimeoutMs);
      expect(trace.spans.some((span) => span.name.startsWith('db.query'))).toBe(false);
    }
  });

  it('pins the illustrative seed 42 incident', () => {
    const deploy = finish(new IncidentRun(incidentScenarios.deploy));
    const end = deploy.current;
    expect(deploy.result.traces).toHaveLength(2347);
    expect(end?.completed).toBe(2338);
    expect(end?.failed).toBe(50);
    expect(deploy.result.events.map((event) => event.tick)).toEqual([200, 207, 212, 244, 245]);
    expect(Math.max(...deploy.result.ticks.map((point) => point.browseP99))).toBe(1054);
  });

  it('shows that no deploy means no errors and a bigger pool hides the symptom', () => {
    const noDeploy = simulateIncident(incidentScenarios.noDeploy.overrides);
    const bigger = simulateIncident(incidentScenarios.biggerPool.overrides);
    expect(noDeploy.ticks.at(-1)?.failed).toBe(0);
    expect(noDeploy.events).toEqual([]);
    expect(bigger.ticks.at(-1)?.failed).toBe(0);
    expect(Math.max(...bigger.ticks.map((point) => point.browseP99))).toBe(137);
    expect(Math.max(...bigger.ticks.map((point) => point.checkoutP99))).toBe(828);
  });
});

describe('IncidentRun', () => {
  it('matches a fresh run after a reset', () => {
    const first = new IncidentRun(incidentScenarios.deploy);
    for (let i = 0; i < 250; i += 1) first.step();
    const replay = new IncidentRun(incidentScenarios.deploy);
    for (let i = 0; i < 250; i += 1) replay.step();
    expect(replay.series((point) => point.browseP99)).toEqual(first.series((point) => point.browseP99));
    expect(replay.events).toEqual(first.events);
  });

  it('reveals events only once their tick has played', () => {
    const run = new IncidentRun(incidentScenarios.deploy);
    for (let i = 0; i < 201; i += 1) run.step();
    expect(run.events.map((event) => event.tick)).toEqual([200]);
    finish(run);
    expect(run.events.at(-1)?.marker).toBe(false);
    run.step();
    expect(run.ticks).toBe(run.length);
  });
});

describe('trace exemplars', () => {
  const result = simulateIncident();
  const exemplars = findExemplars(result);

  it('points each exemplar at the span that owns its time', () => {
    expect(slowestSelfSpan(exemplars.typical.trace).name).toBe('payments.charge');
    expect(slowestSelfSpan(exemplars.slowCheckout.trace).name).toBe('db.query orders');
    expect(slowestSelfSpan(exemplars.slowBrowse.trace).name).toBe('db.pool.acquire');
    expect(slowestSelfSpan(exemplars.failedBrowse.trace).name).toBe('db.pool.acquire');
    expect(exemplars.failedBrowse.trace.status).toBe(503);
  });

  it('separates self time from the inclusive duration of the parent', () => {
    const trace = exemplars.slowBrowse.trace;
    const root = trace.spans[0];
    expect(root && selfTime(trace, root)).toBeLessThan(10);
    expect(root?.duration).toBe(771);
  });

  it('counts parallel children once, as the union of their time', () => {
    const span = (id: string, parent: string | null, start: number, duration: number) => ({
      id,
      parent,
      name: id,
      service: 'shop',
      start,
      duration,
    });
    const root = span('root', null, 0, 100);
    const trace = {
      ...exemplars.typical.trace,
      spans: [root, span('a', 'root', 10, 80), span('b', 'root', 10, 80)],
    };
    expect(selfTime(trace, root)).toBe(20);
    const staggered = { ...trace, spans: [root, span('a', 'root', 0, 60), span('b', 'root', 40, 50)] };
    expect(selfTime(staggered, root)).toBe(10);
    const overrun = { ...trace, spans: [root, span('a', 'root', 50, 80), span('b', 'root', -10, 30)] };
    expect(selfTime(overrun, root)).toBe(30);
  });

  it('tags every log line with the correlation ID and interleaves other requests', () => {
    const trace = exemplars.slowBrowse.trace;
    const own = logsFor(trace, result.config.poolSize);
    expect(own.every((line) => line.traceId === trace.id)).toBe(true);
    expect(own.some((line) => line.level === 'warn' && line.message.includes('waited 727 ms'))).toBe(true);
    const window = logsDuring(result, trace);
    expect(window.length).toBeLessThanOrEqual(40);
    for (const line of own) expect(window).toContainEqual(line);
    expect(window.some((line) => line.traceId !== trace.id)).toBe(true);
  });
});

describe('sampling', () => {
  it('conserves traces: kept plus dropped plus pending equals completed', () => {
    const result = simulateIncident();
    for (const scenario of Object.values(samplingScenarios)) {
      for (const sampler of scenario.lanes) {
        for (const now of [10_000, 30_000, Number.POSITIVE_INFINITY]) {
          const totals = samplingTotals(sampler, result.traces, now);
          expect(totals.kept + totals.dropped + totals.pending).toBe(totals.completed);
          expect(totals.errorsKept + totals.slowKept + totals.baselineKept).toBe(totals.kept);
          if (now === Number.POSITIVE_INFINITY) {
            expect(totals.missed).toBe(totals.errors + totals.slow - totals.errorsKept - totals.slowKept);
          }
        }
      }
    }
  });

  it('counts the same finished requests in both lanes mid run, with tail decisions still pending', () => {
    const result = simulateIncident();
    const [headSampler, tailSampler] = samplingScenarios.incident.lanes;
    const head = samplingTotals(headSampler, result.traces, 30_000);
    const tail = samplingTotals(tailSampler, result.traces, 30_000);
    expect(tail.completed).toBe(head.completed);
    expect(tail.errors).toBe(head.errors);
    expect(tail.slow).toBe(head.slow);
    expect(head.pending).toBe(0);
    expect(tail.pending).toBeGreaterThan(0);
    const final = samplingTotals(tailSampler, result.traces, Number.POSITIVE_INFINITY);
    expect(final.pending).toBe(0);
  });

  it('makes tail sampling fill each window with failures first, then slow requests, then the rest', () => {
    const result = simulateIncident();
    const tail = samplingScenarios.incident.lanes[1];
    const rank = (trace: (typeof result.traces)[number]) =>
      trace.status === 503 ? 0 : trace.duration > 1000 ? 1 : 2;
    const windows = new Map<number, { kept: number[]; dropped: number[] }>();
    decideSampling(tail, result.traces).forEach((decision, index) => {
      const window = windows.get(decision.at) ?? { kept: [], dropped: [] };
      const trace = result.traces[index];
      if (trace) (decision.kept ? window.kept : window.dropped).push(rank(trace));
      windows.set(decision.at, window);
    });
    for (const { kept, dropped } of windows.values()) {
      if (kept.length > 0 && dropped.length > 0) {
        expect(Math.min(...dropped)).toBeGreaterThanOrEqual(Math.max(...kept));
      }
    }
  });

  it('makes every sampling policy retain the same budget', () => {
    for (const scenario of Object.values(samplingScenarios)) {
      const run = new SamplingRun(scenario);
      const [headSampler, tailSampler] = scenario.lanes;
      expect(samplerBudget(headSampler)).toBe(samplerBudget(tailSampler));
      const budget = samplerBudget(tailSampler);
      while (!run.done) {
        run.step();
        const [, tail] = run.totals();
        const decided = tail.kept + tail.dropped;
        expect(tail.kept).toBe(Math.floor(budget * decided + 1e-9));
      }
      const [head] = run.totals();
      const spread = 3 * Math.sqrt(head.completed * budget * (1 - budget));
      expect(Math.abs(head.kept - budget * head.completed)).toBeLessThanOrEqual(spread);
    }
    for (const seed of [1, 7, 99]) {
      const { traces } = simulateIncident({ seed });
      const tail = samplingTotals(samplingScenarios.incident.lanes[1], traces, Number.POSITIVE_INFINITY);
      expect(tail.kept).toBe(Math.floor(0.1 * tail.completed + 1e-9));
    }
  });

  it('replays the same duel after a reset', () => {
    const first = finish(new SamplingRun(samplingScenarios.incident));
    const replay = finish(new SamplingRun(samplingScenarios.incident));
    expect(replay.series).toEqual(first.series);
    expect(replay.totals()).toEqual(first.totals());
    expect(replay.events).toEqual(first.events);
  });

  it('pins the illustrative seed 42 incident duel', () => {
    const run = finish(new SamplingRun(samplingScenarios.incident));
    const [head, tail] = run.totals();
    expect([head.kept, head.errorsKept, head.slowKept, head.missed]).toEqual([262, 3, 21, 227]);
    expect([tail.kept, tail.errorsKept, tail.slowKept, tail.missed]).toEqual([234, 36, 62, 153]);
    expect([head.peakBuffered, tail.peakBuffered]).toEqual([0, 945]);
    expect(run.events.at(-1)?.text).toContain('153 failed or slow requests overflowed the tail budget');
  });

  it('spends the budget on ordinary traces on a quiet day, while tail sampling holds spans', () => {
    const run = finish(new SamplingRun(samplingScenarios.quiet));
    const [head, tail] = run.totals();
    expect([head.errors, head.slow]).toEqual([0, 0]);
    expect([head.kept, head.baselineKept]).toEqual([262, 262]);
    expect([tail.kept, tail.baselineKept]).toEqual([234, 234]);
    expect([head.peakBuffered, tail.peakBuffered]).toEqual([0, 952]);
    expect(run.events.at(-1)?.text).toContain('Both spent the budget on ordinary traces');
  });

  it('pins the illustrative seed 42 tight budget duel', () => {
    const [head, tail] = finish(new SamplingRun(samplingScenarios.budget)).totals();
    expect([head.kept, head.errorsKept]).toEqual([31, 0]);
    expect([tail.kept, tail.errorsKept, tail.baselineKept, tail.missed]).toEqual([23, 4, 12, 240]);
  });
});
