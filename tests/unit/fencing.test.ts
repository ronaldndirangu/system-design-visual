import { describe, expect, it } from 'vitest';
import { FenceDuel, type FenceScenarioId, fenceScenarios } from '../../src/lib/models/fencing';

function run(id: FenceScenarioId) {
  const duel = new FenceDuel(fenceScenarios[id]);
  while (!duel.done) duel.step();
  const [lease, fenced] = duel.lanes;
  return { duel, lease: lease.summary(), fenced: fenced.summary() };
}

describe('fencing model', () => {
  it('lets a paused owner corrupt the lease-only log and blocks it with a token', () => {
    const { lease, fenced } = run('pause');
    expect(lease).toMatchObject({ staleAccepted: 1, staleRejected: 0, clashes: 1 });
    expect(fenced).toMatchObject({ staleAccepted: 0, staleRejected: 1, clashes: 0 });
  });

  it('keeps delayed writes in flight after the old owner stops itself', () => {
    const { duel, lease, fenced } = run('delay');
    expect(lease).toMatchObject({ staleAccepted: 3, clashes: 3 });
    expect(fenced).toMatchObject({ staleAccepted: 0, staleRejected: 3, clashes: 0 });
    expect(duel.timeline().some((event) => event.text.includes('3 of its writes are still on the way'))).toBe(
      true,
    );
  });

  it('lets a slow clock outlive the real lease', () => {
    const { lease, fenced } = run('skew');
    expect(lease).toMatchObject({ staleAccepted: 3, clashes: 3 });
    expect(fenced).toMatchObject({ staleAccepted: 0, staleRejected: 1, clashes: 0 });
  });

  it('costs nothing when nothing fails', () => {
    const { lease, fenced } = run('calm');
    expect(lease).toEqual(fenced);
    expect(lease).toMatchObject({ entries: 15, staleAccepted: 0, staleRejected: 0, clashes: 0 });
  });

  it('places the handover at the same times in both lanes, so only the log verdict differs', () => {
    const { duel } = run('pause');
    const [lease, fenced] = duel.lanes;
    const handover = (lane: typeof lease) =>
      lane.marks.filter((mark) => mark.kind === 'expire' || (mark.kind === 'grant' && mark.server === 'B'));
    expect(handover(lease)).toEqual(handover(fenced));
    expect(handover(lease)).toEqual([
      { kind: 'expire', t: 13, token: 1 },
      { kind: 'grant', t: 13.5, server: 'B', token: 2 },
    ]);
    const stale = (lane: typeof lease) => lane.marks.filter((mark) => mark.kind === 'stale');
    expect(stale(lease)).toEqual([expect.objectContaining({ t: 17.5, token: 1, newest: 2, accepted: true })]);
    expect(stale(fenced)).toEqual([
      expect.objectContaining({ t: 17.5, token: 1, newest: 2, accepted: false }),
    ]);
  });

  it('runs a fixed number of ticks', () => {
    const duel = new FenceDuel(fenceScenarios.pause);
    let steps = 0;
    while (!duel.done) {
      duel.step();
      steps += 1;
    }
    expect(steps).toBe(60);
  });
});
