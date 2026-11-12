import { describe, expect, it } from 'vitest';
import { BLOCK_MB, FileSyncRun, fileSyncScenarios, linkOutages } from '../../src/lib/models/fileSync';

function finish(run: FileSyncRun) {
  while (!run.done) run.step();
  return run;
}

describe('file sync duel', () => {
  it('restarts the whole file on every drop while blocks resume', () => {
    const run = finish(new FileSyncRun(fileSyncScenarios.flaky));
    const [whole, blocks] = run.totals();
    expect(whole).toMatchObject({ sentMb: 753.8, wastedMb: 453.8, requests: 3, drops: 2, finishedAt: 311.8 });
    expect(blocks).toMatchObject({ sentMb: 301.8, wastedMb: 1.8, requests: 79, drops: 1, finishedAt: 134.2 });
    expect(blocks.wastedMb).toBeLessThanOrEqual(blocks.drops * BLOCK_MB);
    expect(Math.min(...run.series[0].slice(110, 116))).toBe(0);
  });

  it('sends only the changed block when the server holds the rest', () => {
    const [whole, blocks] = finish(new FileSyncRun(fileSyncScenarios.edit)).totals();
    expect(whole).toMatchObject({ sentMb: 1000, finishedAt: 400.1 });
    expect(blocks).toMatchObject({ sentMb: 4, skippedMb: 996, requests: 3, finishedAt: 3.9 });
  });

  it('lets one request win on a small file over a good link', () => {
    const [whole, blocks] = finish(new FileSyncRun(fileSyncScenarios.tiny)).totals();
    expect(whole).toMatchObject({ sentMb: 2, requests: 1, finishedAt: 0.9 });
    expect(blocks).toMatchObject({ sentMb: 2, requests: 3, finishedAt: 1.2 });
  });

  it('replays the same seed and changes with another', () => {
    const a = finish(new FileSyncRun(fileSyncScenarios.flaky, 7));
    const b = finish(new FileSyncRun(fileSyncScenarios.flaky, 7));
    expect(b.series).toEqual(a.series);
    expect(b.events).toEqual(a.events);
    expect(linkOutages(fileSyncScenarios.flaky, 7)).not.toEqual(linkOutages(fileSyncScenarios.flaky, 42));
    expect(a.events.at(-1)).toMatchObject({ tick: a.length, marker: false });
  });
});
