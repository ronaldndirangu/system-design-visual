import { describe, expect, it } from 'vitest';
import {
  type BackupStrategyId,
  formatClock,
  formatDuration,
  type RecoveryScenarioId,
  recoveryOutcome,
  recoveryScenarios,
} from '../../src/lib/models/backups';

const run = (strategy: BackupStrategyId, scenario: RecoveryScenarioId, baseEveryMin = 1440) =>
  recoveryOutcome(strategy, recoveryScenarios[scenario], baseEveryMin);

describe('backup recovery model', () => {
  it('trades data lost against restore time on an afternoon delete', () => {
    const full = run('full', 'afternoon');
    const incremental = run('incremental', 'afternoon');
    const pitr = run('pitr', 'afternoon');

    expect([full.dataLostMin, full.restoreMin]).toEqual([940, 120]);
    expect([incremental.restorePointMin, incremental.dataLostMin, incremental.restoreMin]).toEqual([
      900, 40, 165,
    ]);
    expect([pitr.dataLostMin, pitr.restoreMin]).toEqual([0, 214]);
    expect([full.meetsRpo, incremental.meetsRpo, pitr.meetsRpo]).toEqual([false, true, true]);
    expect([full.meetsRto, incremental.meetsRto, pitr.meetsRto]).toEqual([true, true, true]);
  });

  it('pushes WAL replay past the RTO when the delete lands just before the nightly snapshot', () => {
    const pitr = run('pitr', 'late');
    expect(pitr.restoreMin).toBe(263);
    expect(pitr.meetsRto).toBe(false);
    expect(run('pitr', 'late', 360).restoreMin).toBe(155);
  });

  it('falls back a whole base interval and wastes a load when the latest base is corrupt', () => {
    const full = run('full', 'corrupt');
    const incremental = run('incremental', 'corrupt');
    const pitr = run('pitr', 'corrupt');

    expect(full.failedAttemptMin).toBe(120);
    expect([full.restorePointMin, full.dataLostMin, full.restoreMin]).toEqual([-1440, 2380, 240]);
    expect([incremental.restorePointMin, incremental.dataLostMin, incremental.restoreMin]).toEqual([
      -60, 1000, 309,
    ]);
    expect([pitr.dataLostMin, pitr.restoreMin]).toEqual([0, 478]);
  });

  it('misses every restore budget when only the data size grows', () => {
    for (const strategy of ['full', 'incremental', 'pitr'] as const) {
      const outcome = run(strategy, 'large');
      expect(outcome.restoreMin).toBeGreaterThanOrEqual(1200);
      expect(outcome.meetsRto).toBe(false);
    }
  });

  it('charges storage for every extra base backup', () => {
    expect(run('full', 'afternoon').storageGbPerDay).toBe(1000);
    expect(run('full', 'afternoon', 360).storageGbPerDay).toBe(4000);
    expect(run('incremental', 'afternoon').storageGbPerDay).toBe(1115);
    expect(run('pitr', 'afternoon').storageGbPerDay).toBe(1192);
  });

  it('formats durations and clock times', () => {
    expect(formatDuration(940)).toBe('15 h 40 min');
    expect(formatDuration(40)).toBe('40 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatClock(900)).toBe('15:00');
    expect(formatClock(-60)).toBe('yesterday 23:00');
    expect(formatClock(-1440)).toBe('yesterday 00:00');
  });
});
