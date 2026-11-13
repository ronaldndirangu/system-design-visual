import { describe, expect, it } from 'vitest';
import {
  HOME_FOURTH_SERVER,
  HOME_RATE_MAX,
  type HomePolicy,
  runRouting,
  summarizeRouting,
  turnTakingShare,
} from '../../src/lib/models/homeRouting';

const policies: HomePolicy[] = ['round-robin', 'least-connections'];

describe('home routing challenge', () => {
  it('matches the numbers the page prints', () => {
    const table = policies.map((policy) => summarizeRouting(runRouting({ policy })));
    expect(table).toEqual([
      {
        policy: 'round-robin',
        servers: 3,
        rate: 8,
        arrived: 173,
        served: 134,
        rejected: 34,
        inFlight: 5,
        assigned: [58, 58, 57],
        firstRejectionSeconds: 3,
      },
      {
        policy: 'least-connections',
        servers: 3,
        rate: 8,
        arrived: 173,
        served: 171,
        rejected: 0,
        inFlight: 2,
        assigned: [77, 76, 20],
        firstRejectionSeconds: null,
      },
    ]);
  });

  it('sends both policies the same arrivals at the same moments', () => {
    const [turns, fewest] = policies.map((policy) => runRouting({ policy }));
    const times = (run: typeof turns) =>
      run?.frames.flatMap((frame) => frame.events.map((event) => event.time));
    expect(times(turns)).toEqual(times(fewest));
    expect(turns?.frames.map((frame) => frame.arrived)).toEqual(fewest?.frames.map((frame) => frame.arrived));
  });

  it('replays exactly', () => {
    expect(runRouting({ policy: 'round-robin' })).toEqual(runRouting({ policy: 'round-robin' }));
  });

  it('still overloads the slow server when a fourth server joins and the balancer takes turns', () => {
    const turns = summarizeRouting(runRouting({ policy: 'round-robin', capacities: HOME_FOURTH_SERVER }));
    const fewest = summarizeRouting(
      runRouting({ policy: 'least-connections', capacities: HOME_FOURTH_SERVER }),
    );
    expect(turns).toMatchObject({ served: 148, rejected: 20, assigned: [44, 43, 43, 43] });
    expect(fewest).toMatchObject({ served: 171, rejected: 0, assigned: [56, 48, 17, 52] });
    expect(turnTakingShare(8, 3)).toBeCloseTo(2.67, 2);
    expect(turnTakingShare(8, 4)).toBe(2);
  });

  it('rejects under both policies once traffic outgrows every server together', () => {
    for (const policy of policies) {
      const result = summarizeRouting(runRouting({ policy, rate: HOME_RATE_MAX }));
      expect(result.rejected).toBeGreaterThan(200);
      expect(result.firstRejectionSeconds).not.toBeNull();
    }
  });

  it('accounts for every request on every tick', () => {
    for (const policy of policies) {
      let previous = { arrived: 0, served: 0, rejected: 0, inFlight: 0 };
      for (const frame of runRouting({ policy }).frames) {
        expect(frame.arrived - previous.arrived).toBe(
          frame.served -
            previous.served +
            frame.rejected -
            previous.rejected +
            frame.inFlight -
            previous.inFlight,
        );
        expect(frame.queues.reduce((sum, queue) => sum + queue, 0)).toBe(frame.inFlight);
        previous = frame;
      }
    }
  });

  it('records one traced decision per arrival that agrees with the outcome', () => {
    for (const policy of policies) {
      const run = runRouting({ policy });
      let previous = { arrived: 0, rejected: 0 };
      for (const frame of run.frames) {
        expect(frame.events).toHaveLength(frame.arrived - previous.arrived);
        expect(frame.events.filter((event) => event.outcome === 'rejected')).toHaveLength(
          frame.rejected - previous.rejected,
        );
        for (const event of frame.events) {
          expect(event.candidates.map((candidate) => candidate.id)).toEqual([0, 1, 2]);
          if (policy === 'least-connections' && event.chosen !== null) {
            const shortest = Math.min(...event.candidates.map((candidate) => candidate.queueLength));
            expect(event.candidates.find((candidate) => candidate.id === event.chosen)?.queueLength).toBe(
              shortest,
            );
          }
        }
        previous = frame;
      }
      expect(run.firstRejection?.event.outcome ?? 'rejected').toBe('rejected');
    }
  });
});
