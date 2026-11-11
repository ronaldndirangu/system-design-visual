import { useReducer, useRef, useState } from 'react';
import {
  type ConsumerState,
  GROUP_SECONDS,
  GroupRun,
  type GroupScenarioId,
  groupScenarios,
  type LogCommand,
  lagOf,
  type PartitionState,
  partitionLabel,
  partitionOf,
  SHORT_CODES,
} from '../../lib/models/partitionedLog';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type StatRow, type Tone, ToneBadge } from '../sim/StatTable';
import { TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import './ConsumerGroupWidget.css';

/** Each track shows the newest 200 events of its partition, about 10 s of clicks. */
const WINDOW = 200;

interface Props {
  scenarios?: GroupScenarioId[];
  initial?: GroupScenarioId;
  title?: string;
  instructions?: string;
  /** Show buttons that add or crash consumers during a run. */
  showActions?: boolean;
}

type ConsumerStatus = { tone: Tone; text: string };

function consumerStatus(consumer: ConsumerState, rebalancing: boolean): ConsumerStatus {
  if (!consumer.alive) return { tone: 'bad', text: 'Crashed' };
  if (rebalancing) return { tone: 'warn', text: 'Paused: rebalancing' };
  if (consumer.partitions.length === 0) return { tone: 'neutral', text: 'Idle: no partition' };
  return { tone: 'ok', text: 'Reading' };
}

const pct = (value: number) => `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;

function PartitionRow({
  part,
  codes,
  rebalancing,
}: {
  part: PartitionState;
  codes: string;
  rebalancing: boolean;
}) {
  const end = part.events.length;
  const start = Math.max(0, end - WINDOW);
  const at = (offset: number) => ((offset - start) / WINDOW) * 100;
  const readTo = Math.max(part.position, start);
  const hiddenUnread = Math.max(0, start - part.position);
  const lag = lagOf(part);
  return (
    <li className="sdv-group__row">
      <div className="sdv-qtracks__head">
        <span className="sdv-qtracks__name">{partitionLabel(part.id)}</span>
        <span className="sdv-group__codes">{codes}</span>
        {rebalancing ? (
          <ToneBadge tone="warn">No reader while the group rebalances</ToneBadge>
        ) : part.owner === null ? (
          <ToneBadge tone="bad">No reader</ToneBadge>
        ) : (
          <span className="sdv-group__owner">Read by consumer {part.owner}</span>
        )}
      </div>
      <div className="sdv-group__track" aria-hidden="true">
        <span className="sdv-group__read" style={{ width: pct(at(readTo)) }} />
        <span
          className="sdv-group__unread"
          style={{ left: pct(at(readTo)), width: pct(at(end) - at(readTo)) }}
        />
        {part.committed >= start && (
          <span className="sdv-group__saved" style={{ left: pct(at(part.committed)) }} />
        )}
        {part.position >= start && (
          <span className="sdv-group__cursor" style={{ left: pct(at(part.position)) }} />
        )}
        {hiddenUnread > 0 && <span className="sdv-group__more">+{hiddenUnread} unread</span>}
      </div>
      <p className="sdv-qtracks__meta">
        <span>Lag {lag}</span>
        <span>
          Read to offset {part.position}, saved at {part.committed}
        </span>
        <span>{end} events in the log</span>
      </p>
    </li>
  );
}

function ConsumerCard({ consumer, rebalancing }: { consumer: ConsumerState; rebalancing: boolean }) {
  const status = consumerStatus(consumer, rebalancing);
  const reads =
    consumer.alive && consumer.partitions.length > 0
      ? `Reads ${consumer.partitions.map(partitionLabel).join(', ')}`
      : consumer.alive && rebalancing
        ? 'Waiting for partitions'
        : 'Reads nothing';
  return (
    <li className="sdv-group__consumer" data-status={consumer.alive ? undefined : 'down'}>
      <span className="sdv-group__consumer-name">Consumer {consumer.id}</span>
      <ToneBadge tone={status.tone}>{status.text}</ToneBadge>
      <span className="sdv-group__consumer-meta">
        {reads}. {consumer.processed.toLocaleString('en-US')} processed.
      </span>
    </li>
  );
}

/** A consumer group reading a 4 partition click log, with lag, crashes, and rebalancing. */
export default function ConsumerGroupWidget({
  scenarios = ['one', 'four', 'crash', 'six'],
  initial,
  title = 'A consumer group reads the click log',
  instructions = 'Pick a scenario, then press Play. Watch the unread part of each partition, the lag, grow or shrink.',
  showActions = true,
}: Props) {
  const hydrated = useHydrated();
  const [scenarioId, setScenarioId] = useState<GroupScenarioId>(initial ?? scenarios[0] ?? 'one');
  const runRef = useRef<GroupRun | null>(null);
  if (!runRef.current) runRef.current = new GroupRun(groupScenarios[scenarioId]);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [notice, setNotice] = useState<{ id: number; text: string }>();

  const restart = (id: GroupScenarioId) => {
    runRef.current = new GroupRun(groupScenarios[id]);
    rerender();
  };
  const chooseScenario = (id: GroupScenarioId) => {
    setScenarioId(id);
    restart(id);
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    rerender();
  };
  const send = (command: LogCommand) => {
    const before = run.log.notes.length;
    run.apply(command);
    const note = run.log.notes.length > before ? run.log.notes.at(-1) : undefined;
    if (note) setNotice((last) => ({ id: (last?.id ?? 0) + 1, text: note.text }));
    rerender();
  };

  const { log } = run;
  const partitionCount = log.config.partitions;
  const rebalancing = log.rebalancing;
  const totals = log.totals;
  const lag = log.lag;
  const seconds = run.ticks * run.tickSeconds;
  const statuses = log.consumers.map((consumer) => consumerStatus(consumer, rebalancing));
  const reading = statuses.filter((status) => status.text === 'Reading').length;
  const idle = statuses.filter((status) => status.text.startsWith('Idle')).length;
  const down = statuses.filter((status) => status.text === 'Crashed').length;
  const live = log.consumers.filter((consumer) => consumer.alive);

  const earlier = run.series.at(-11) ?? 0;
  const lagTone: StatRow =
    lag <= 20
      ? { label: 'Lag now (events not read yet)', value: String(lag), tone: 'ok', note: 'Keeping up' }
      : lag > earlier
        ? { label: 'Lag now (events not read yet)', value: String(lag), tone: 'bad', note: 'Falling behind' }
        : { label: 'Lag now (events not read yet)', value: String(lag), tone: 'warn', note: 'Catching up' };
  const announceState = rebalancing
    ? 'The group is rebalancing, so nobody reads.'
    : lagTone.tone === 'ok'
      ? 'Consumers are keeping up.'
      : lagTone.tone === 'bad'
        ? 'Lag is growing. Consumers are falling behind.'
        : 'Consumers are catching up.';

  const stats: StatRow[] = [
    { label: 'Clicks written to the log', value: totals.produced.toLocaleString('en-US') },
    { label: 'Processed for the first time', value: totals.firstReads.toLocaleString('en-US') },
    {
      label: 'Processed again after a rewind',
      value: totals.rereads.toLocaleString('en-US'),
      ...(totals.rereads > 0 ? { tone: 'warn' as const, note: 'Counted twice' } : {}),
    },
    lagTone,
    { label: 'Peak lag', value: String(run.peakLag) },
    {
      label: 'Consumers',
      value: `${reading} reading, ${idle} idle, ${down} down`,
      ...(rebalancing ? { tone: 'warn' as const, note: 'Rebalancing' } : {}),
    },
  ];

  const summary = `${seconds.toFixed(1)} s of ${GROUP_SECONDS} s. Lag ${lag} events, peak ${run.peakLag}. Consumers: ${reading} reading, ${idle} idle, ${down} down.${rebalancing ? ' The group is rebalancing, so nobody reads.' : ''}`;

  const status = run.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : rebalancing
      ? ({ tone: 'warn', text: `Rebalancing: ${log.rebalanceSecondsLeft.toFixed(1)} s left` } as const)
      : run.ticks === 0
        ? ({ tone: 'neutral', text: 'Ready' } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${GROUP_SECONDS} s` } as const);

  const codesFor = (id: number) =>
    SHORT_CODES.filter((code) => partitionOf(code, partitionCount) === id)
      .map((code) => `/${code}`)
      .join(', ');

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      stats={stats}
      status={status}
      finished={run.done}
      resetKey={scenarioId}
      announceState={announceState}
      notice={notice}
      controls={
        <>
          <div className="sdv-duel__extra sdv-group__skip">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
              Skip to the end
            </button>
          </div>
          {showActions && (
            <fieldset className="sdv-control sdv-crash">
              <legend>Change the group</legend>
              <div className="sdv-crash__buttons">
                <button
                  type="button"
                  className="sdv-button"
                  onClick={() => send({ type: 'join' })}
                  disabled={!hydrated || run.done || live.length >= log.config.maxConsumers}
                >
                  Add a consumer
                </button>
                {live.map((consumer) => (
                  <button
                    key={consumer.id}
                    type="button"
                    className="sdv-button"
                    onClick={() => send({ type: 'crash', consumer: consumer.id })}
                    disabled={!hydrated || run.done}
                  >
                    Crash consumer {consumer.id}
                  </button>
                ))}
              </div>
              <p className="sdv-control__hint">
                Up to {log.config.maxConsumers} consumers. Every join or crash pauses the whole group for{' '}
                {log.config.rebalanceSeconds} s while it hands out partitions again.
              </p>
            </fieldset>
          )}
        </>
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={scenarios.map((id) => ({
          value: id,
          label: groupScenarios[id].label,
          diff: groupScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <div className="sdv-group">
        <section className="sdv-group__topic" aria-label="Click topic, 4 partitions">
          <h4 className="sdv-group__heading">Topic: clicks, {partitionCount} partitions</h4>
          <ul className="sdv-group__rows">
            {log.partitions.map((part) => (
              <PartitionRow key={part.id} part={part} codes={codesFor(part.id)} rebalancing={rebalancing} />
            ))}
          </ul>
        </section>
        <section className="sdv-group__members" aria-label="Consumer group">
          <h4 className="sdv-group__heading">Consumer group: analytics</h4>
          <ul className="sdv-group__consumers">
            {log.consumers.map((consumer) => (
              <ConsumerCard key={consumer.id} consumer={consumer} rebalancing={rebalancing} />
            ))}
          </ul>
        </section>
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the partitions">
        <li>
          <span className="sdv-group__key sdv-group__key--read" aria-hidden="true" /> Read
        </li>
        <li>
          <span className="sdv-group__key sdv-group__key--unread" aria-hidden="true" /> Not read yet (lag)
        </li>
        <li>
          <span className="sdv-group__key sdv-group__key--cursor" aria-hidden="true" /> Read position
        </li>
        <li>
          <span className="sdv-group__key sdv-group__key--saved" aria-hidden="true" /> Saved position
        </li>
        <li>Each track holds the newest {WINDOW} events</li>
      </ul>
      <TraceChart
        title="Lag across all partitions (events not read yet)"
        series={[{ label: 'Lag', values: run.series, variant: 'a' }]}
        length={run.length}
        tickSeconds={run.tickSeconds}
        markers={run.events.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={50}
        summary={`Lag across all partitions: now ${lag}, peak ${run.peakLag}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {run.events.length === 0 ? (
          <p className="sdv-trace__empty">
            Crashes, joins, and rebalances appear here, numbered to match the chart, as the run plays.
          </p>
        ) : (
          <ol>
            {run.events.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(event.tick * run.tickSeconds).toFixed(1)} s</time> {event.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </SimulationShell>
  );
}
