import { describe, expect, it } from 'vitest';
import {
  findExemplars,
  IncidentRun,
  incidentScenarios,
  keeps,
  logsDuring,
  logsFor,
  SamplingRun,
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
  it('conserves traces: kept plus dropped equals completed', () => {
    const result = simulateIncident();
    for (const scenario of Object.values(samplingScenarios)) {
      for (const sampler of scenario.lanes) {
        for (const now of [10_000, 30_000, Number.POSITIVE_INFINITY]) {
          const totals = samplingTotals(sampler, result.traces, now);
          expect(totals.kept + totals.dropped).toBe(totals.completed);
          expect(totals.errorsKept + totals.slowKept + totals.baselineKept).toBe(totals.kept);
        }
      }
    }
  });

  it('makes tail sampling keep every error and every slow trace', () => {
    const result = simulateIncident();
    const tail = samplingScenarios.incident.lanes[1];
    for (const trace of result.traces) {
      if (trace.status === 503 || trace.duration > 1000) expect(keeps(tail, trace)).toBe(true);
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
    const [head, tail] = finish(new SamplingRun(samplingScenarios.incident)).totals();
    expect([head.kept, head.errorsKept, head.slowKept]).toEqual([262, 3, 21]);
    expect([tail.kept, tail.errorsKept, tail.slowKept]).toEqual([489, 50, 201]);
    expect([head.peakBuffered, tail.peakBuffered]).toEqual([0, 772]);
  });

  it('ties on a quiet day except for the spans tail sampling holds', () => {
    const run = finish(new SamplingRun(samplingScenarios.quiet));
    const [head, tail] = run.totals();
    expect(head.kept).toBe(262);
    expect(tail.kept).toBe(head.kept);
    expect(tail.spansStored).toBe(head.spansStored);
    expect(tail.peakBuffered).toBe(726);
    expect(run.events.at(-1)?.text).toContain('A tie');
  });

  it('pins the illustrative seed 42 tight budget duel', () => {
    const [head, tail] = finish(new SamplingRun(samplingScenarios.budget)).totals();
    expect([head.kept, head.errorsKept]).toEqual([31, 0]);
    expect([tail.kept, tail.errorsKept]).toEqual([280, 50]);
  });
});
