import { useState } from 'react';
import {
  type BackupStrategyId,
  formatClock,
  formatDuration,
  type RecoveryOutcome,
  type RecoveryScenarioId,
  RPO_TARGET_MIN,
  RTO_TARGET_MIN,
  recoveryOutcome,
  recoveryScenarios,
  strategyIds,
  strategyLabels,
} from '../../lib/models/backups';
import { formatBytes } from '../../lib/models/estimates';
import { CompareTable } from '../sim/CompareTable';
import { Segmented } from '../sim/controls';
import { ScenarioChips } from '../sim/ScenarioChips';
import type { StatRow, Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';

type IntervalId = '24h' | '6h';

const INTERVALS: Record<IntervalId, number> = { '24h': 1440, '6h': 360 };
const intervalOptions = [
  { value: '24h' as const, label: 'Every 24 h' },
  { value: '6h' as const, label: 'Every 6 h' },
];

const scenarioOptions = Object.values(recoveryScenarios).map(({ id, label, diff }) => ({
  value: id,
  label,
  diff,
}));

function verdict(outcome: RecoveryOutcome): { tone: Tone; text: string } {
  if (outcome.meetsRpo && outcome.meetsRto) return { tone: 'ok', text: 'Meets both budgets' };
  const misses = [
    outcome.meetsRpo ? '' : `loses ${formatDuration(outcome.dataLostMin)} of writes`,
    outcome.meetsRto ? '' : `takes ${formatDuration(outcome.restoreMin)} to restore`,
  ].filter(Boolean);
  return { tone: misses.length === 2 ? 'bad' : 'warn', text: `Misses: ${misses.join(' and ')}` };
}

interface Props {
  title?: string;
}

export default function BackupRestoreWidget({ title = 'Restore after an accidental DELETE' }: Props) {
  const [scenarioId, setScenarioId] = useState<RecoveryScenarioId>('afternoon');
  const [intervalId, setIntervalId] = useState<IntervalId>('24h');
  const scenario = recoveryScenarios[scenarioId];
  const outcomes = strategyIds.map((id) => recoveryOutcome(id, scenario, INTERVALS[intervalId]));
  const byId = Object.fromEntries(outcomes.map((o) => [o.strategy, o])) as Record<
    BackupStrategyId,
    RecoveryOutcome
  >;
  const passing = outcomes.filter((o) => o.meetsRpo && o.meetsRto).length;

  const status: { tone: Tone; text: string } =
    passing === 0
      ? { tone: 'bad', text: 'No strategy meets both budgets' }
      : { tone: passing === outcomes.length ? 'ok' : 'warn', text: `${passing} of 3 meet both budgets` };

  const stats: StatRow[] = [
    {
      label: 'Budgets',
      value: `RPO ${formatDuration(RPO_TARGET_MIN)}, RTO ${formatDuration(RTO_TARGET_MIN)}`,
      detail: 'at most this much lost data, and at most this long until the orders are back',
    },
    ...strategyIds.map((id) => ({ label: strategyLabels[id], ...verdictRow(byId[id]) })),
  ];
  if (byId.full.failedAttemptMin > 0) {
    stats.push({
      label: 'First restore attempt',
      value: `Fails after ${formatDuration(byId.full.failedAttemptMin)}`,
      tone: 'bad',
      detail: 'the newest base backup never went through a restore drill, so every strategy starts over',
    });
  }

  const summary =
    `${scenario.label}, base backup ${intervalOptions.find((o) => o.value === intervalId)?.label.toLowerCase()}. ` +
    outcomes
      .map(
        (o) =>
          `${strategyLabels[o.strategy]}: ${formatDuration(o.dataLostMin)} lost, ${formatDuration(o.restoreMin)} to restore.`,
      )
      .join(' ');

  return (
    <WidgetFrame
      title={title}
      instructions="Toy numbers: restores load 500 GB per hour, each incremental takes 3 minutes to apply, and WAL replays ten times faster than the database wrote it. Pick a scenario and how often the base backup runs."
      summary={summary}
      status={status}
      stats={stats}
      statsCaption="Against the budgets"
      controls={
        <>
          <ScenarioChips
            label="Scenario"
            value={scenarioId}
            options={scenarioOptions}
            onChange={setScenarioId}
          />
          <Segmented
            label="Full backup or snapshot"
            value={intervalId}
            options={intervalOptions}
            onChange={setIntervalId}
          />
        </>
      }
    >
      <p className="sdv-sim__note">
        At {formatClock(scenario.deleteAtMin)} the DELETE commits on the primary and reaches every replica
        within a second. Replicas copy mistakes as faithfully as they copy good writes, so the restore comes
        from backups.
      </p>
      <CompareTable
        caption="Three backup strategies, same incident"
        columns={strategyIds.map((id) => strategyLabels[id])}
        rows={[
          {
            label: 'Restore point',
            values: outcomes.map((o) => o.restorePointMin),
            format: (value, column) =>
              outcomes[column]?.strategy === 'pitr' ? 'just before the DELETE' : formatClock(value),
          },
          {
            label: 'Writes lost (RPO)',
            values: outcomes.map((o) => o.dataLostMin),
            format: formatDuration,
            better: 'lower',
          },
          {
            label: 'Time to restore (RTO)',
            values: outcomes.map((o) => o.restoreMin),
            format: formatDuration,
            better: 'lower',
          },
          {
            label: 'Backup bytes per day',
            values: outcomes.map((o) => o.storageGbPerDay),
            format: (value) => formatBytes(value * 1e9),
            better: 'lower',
          },
        ]}
      />
    </WidgetFrame>
  );
}

function verdictRow(outcome: RecoveryOutcome): Pick<StatRow, 'value' | 'tone'> {
  const { tone, text } = verdict(outcome);
  return { value: text, tone };
}
