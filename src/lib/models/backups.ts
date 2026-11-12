/**
 * Toy recovery model. An accidental DELETE replicates to every replica within a second, so recovery has to come
 * from backups. Times are minutes from midnight on the incident day; negative values fall on the day before.
 */

export type BackupStrategyId = 'full' | 'incremental' | 'pitr';
export type RecoveryScenarioId = 'afternoon' | 'late' | 'corrupt' | 'large';

export const RESTORE_GB_PER_HOUR = 500;
export const INCREMENTAL_EVERY_MIN = 60;
export const INCREMENTAL_APPLY_MIN = 3;
export const WAL_REPLAY_SPEEDUP = 10;
export const CHANGED_GB_PER_HOUR = 5;
export const WAL_GB_PER_HOUR = 8;
export const RPO_TARGET_MIN = 60;
export const RTO_TARGET_MIN = 240;
export const DAY_MIN = 1440;

export const strategyIds: readonly BackupStrategyId[] = ['full', 'incremental', 'pitr'];

export const strategyLabels: Record<BackupStrategyId, string> = {
  full: 'Full backups only',
  incremental: 'Full plus hourly incrementals',
  pitr: 'Snapshot plus WAL replay',
};

export interface RecoveryScenario {
  id: RecoveryScenarioId;
  label: string;
  diff: string;
  dbGb: number;
  deleteAtMin: number;
  latestBaseCorrupt: boolean;
}

export const recoveryScenarios: Record<RecoveryScenarioId, RecoveryScenario> = {
  afternoon: {
    id: 'afternoon',
    label: 'Afternoon delete',
    diff: '1 TB database. A migration deletes every order row at 15:40.',
    dbGb: 1000,
    deleteAtMin: 940,
    latestBaseCorrupt: false,
  },
  late: {
    id: 'late',
    label: 'Just before the backup',
    diff: '1 TB database. The bad delete lands at 23:50, ten minutes before the nightly backup.',
    dbGb: 1000,
    deleteAtMin: 1430,
    latestBaseCorrupt: false,
  },
  corrupt: {
    id: 'corrupt',
    label: 'Latest backup is corrupt',
    diff: 'Afternoon delete, but nobody ever restored the newest base backup. It fails at the end of the load.',
    dbGb: 1000,
    deleteAtMin: 940,
    latestBaseCorrupt: true,
  },
  large: {
    id: 'large',
    label: 'Ten times the data',
    diff: 'Afternoon delete on a 10 TB database. Same write rate, ten times the bytes to load.',
    dbGb: 10000,
    deleteAtMin: 940,
    latestBaseCorrupt: false,
  },
};

export interface RecoveryOutcome {
  strategy: BackupStrategyId;
  restorePointMin: number;
  dataLostMin: number;
  /** Minutes from starting the restore to a writable database, including any failed first attempt. */
  restoreMin: number;
  failedAttemptMin: number;
  storageGbPerDay: number;
  meetsRpo: boolean;
  meetsRto: boolean;
}

export function baseRestoreMin(dbGb: number): number {
  return (dbGb / RESTORE_GB_PER_HOUR) * 60;
}

export function recoveryOutcome(
  strategy: BackupStrategyId,
  scenario: RecoveryScenario,
  baseEveryMin: number,
): RecoveryOutcome {
  const { dbGb, deleteAtMin, latestBaseCorrupt } = scenario;
  const loadMin = baseRestoreMin(dbGb);
  const lastBase = Math.floor(deleteAtMin / baseEveryMin) * baseEveryMin;
  const usableBase = latestBaseCorrupt ? lastBase - baseEveryMin : lastBase;
  const failedAttemptMin = latestBaseCorrupt ? loadMin : 0;
  const basesPerDay = DAY_MIN / baseEveryMin;

  let restorePointMin: number;
  let applyMin: number;
  let storageGbPerDay = basesPerDay * dbGb;

  if (strategy === 'full') {
    restorePointMin = usableBase;
    applyMin = 0;
  } else if (strategy === 'incremental') {
    // Incrementals chain on the base before them, so a corrupt base strands every incremental taken after it.
    restorePointMin = latestBaseCorrupt
      ? lastBase - INCREMENTAL_EVERY_MIN
      : lastBase + Math.floor((deleteAtMin - lastBase) / INCREMENTAL_EVERY_MIN) * INCREMENTAL_EVERY_MIN;
    applyMin = ((restorePointMin - usableBase) / INCREMENTAL_EVERY_MIN) * INCREMENTAL_APPLY_MIN;
    storageGbPerDay += (24 - basesPerDay) * CHANGED_GB_PER_HOUR;
  } else {
    restorePointMin = deleteAtMin;
    applyMin = (deleteAtMin - usableBase) / WAL_REPLAY_SPEEDUP;
    storageGbPerDay += 24 * WAL_GB_PER_HOUR;
  }

  const dataLostMin = deleteAtMin - restorePointMin;
  const restoreMin = failedAttemptMin + loadMin + applyMin;
  return {
    strategy,
    restorePointMin,
    dataLostMin,
    restoreMin,
    failedAttemptMin,
    storageGbPerDay,
    meetsRpo: dataLostMin <= RPO_TARGET_MIN,
    meetsRto: restoreMin <= RTO_TARGET_MIN,
  };
}

export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatClock(minutes: number): string {
  const day = minutes < 0 ? 'yesterday ' : '';
  const within = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const hh = String(Math.floor(within / 60)).padStart(2, '0');
  const mm = String(within % 60).padStart(2, '0');
  return `${day}${hh}:${mm}`;
}
