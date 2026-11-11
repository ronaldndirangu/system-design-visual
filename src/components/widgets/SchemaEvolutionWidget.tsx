import { useReducer, useRef, useState } from 'react';
import {
  clickV1,
  clickV2,
  DEPLOY_AT_SECONDS,
  type EventShape,
  fieldsUsed,
  type ReadOutcome,
  readError,
  SCHEMA_SECONDS,
  type SchemaChange,
  SchemaDuel,
  type SchemaLane,
  schemaChangeOptions,
} from '../../lib/models/eventDesign';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { SeriesSwatch, type SeriesVariant, TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { KindIcon } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import './SchemaEvolutionWidget.css';

/** The outcome strip shows this many of the latest clicks. */
const RECENT = 60;

const changes: SchemaChange[] = ['add-field', 'rename', 'version'];
const variants: [SeriesVariant, SeriesVariant] = ['a', 'b'];

const outcomeText: Record<ReadOutcome, string> = {
  counted: 'read and counted',
  parked: 'rejected and parked in the dead-letter queue',
};
const outcomeOrder: ReadOutcome[] = ['counted', 'parked'];

type DiffMark = 'same' | 'added' | 'removed';

interface Props {
  title?: string;
  instructions?: string;
}

const list = (fields: string[]) =>
  fields.length <= 2 ? fields.join(' and ') : `${fields.slice(0, -1).join(', ')}, and ${fields.at(-1)}`;

function diffLines(
  shape: EventShape,
  base: EventShape | null,
): { field: string; type: string; mark: DiffMark }[] {
  const lines: { field: string; type: string; mark: DiffMark }[] = [];
  if (base) {
    for (const [field, type] of Object.entries(base)) {
      if (!(field in shape)) lines.push({ field, type, mark: 'removed' });
    }
  }
  for (const [field, type] of Object.entries(shape)) {
    lines.push({ field, type, mark: base && !(field in base) ? 'added' : 'same' });
  }
  return lines;
}

const markPrefix: Record<DiffMark, string> = { same: ' ', added: '+', removed: '-' };
const markText: Record<DiffMark, string> = { same: '', added: 'added', removed: 'removed' };

function Payload({ caption, shape, base }: { caption: string; shape: EventShape; base: EventShape | null }) {
  const lines = diffLines(shape, base);
  const added = lines.filter((line) => line.mark === 'added').map((line) => line.field);
  const removed = lines.filter((line) => line.mark === 'removed').map((line) => line.field);
  const changesText = [
    added.length > 0 ? `adds ${list(added)}` : '',
    removed.length > 0 ? `removes ${list(removed)}` : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const fields = lines
    .filter((line) => line.mark !== 'removed')
    .map((line) => `${line.field} (${line.type})`);
  return (
    <figure className="sdv-schema__payload">
      <figcaption className="sdv-schema__payload-title">{caption}</figcaption>
      <pre className="sdv-schema__code" aria-hidden="true">
        <code>
          {'{\n'}
          {lines.map((line) => (
            <span key={`${line.mark}-${line.field}`} className="sdv-schema__line" data-diff={line.mark}>
              {`${markPrefix[line.mark]} "${line.field}": "${line.type}"`}
              {line.mark !== 'same' && <span className="sdv-schema__mark"> {markText[line.mark]}</span>}
              {'\n'}
            </span>
          ))}
          {'}'}
        </code>
      </pre>
      <p className="sdv-schema__payload-text">
        Fields: {list(fields)}.{changesText && ` Compared with v1, it ${changesText}.`}
      </p>
    </figure>
  );
}

function NodeChip({
  kind,
  name,
  tone,
  text,
  stuck = false,
}: {
  kind: ComponentKind;
  name: string;
  tone: Tone;
  text: string;
  stuck?: boolean;
}) {
  return (
    <li className={`sdv-schema__node sdv-node sdv-node--${kind}`} data-status={stuck ? 'stuck' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="sdv-schema__icon">
        <KindIcon kind={kind} size={24} />
      </svg>
      <span className="sdv-schema__node-name">{name}</span>
      <ToneBadge tone={tone}>{text}</ToneBadge>
    </li>
  );
}

function pathText(lane: SchemaLane): string {
  if (lane.style === 'strict') {
    return `Checks each click against the whole v1 contract (${list(Object.keys(clickV1))}) and rejects any field it does not know.`;
  }
  return `Checks only the fields it reads (${list(Object.keys(fieldsUsed))}) and ignores every other field.`;
}

function LanePane({
  lane,
  variant,
  change,
}: {
  lane: SchemaLane;
  variant: SeriesVariant;
  change: SchemaChange;
}) {
  const { model } = lane;
  const t = model.totals;
  const deployed = model.deployed !== null;
  const error = readError(model.topicShape, lane.style);
  const recent = model.recent(RECENT);
  const counts = outcomeOrder.map((outcome) => ({
    outcome,
    count: recent.filter((value) => value === outcome).length,
  }));
  const stripText =
    recent.length === 0
      ? 'No clicks yet.'
      : `The latest ${recent.length} clicks, oldest first: ${counts
          .filter((part) => part.count > 0)
          .map((part) => `${part.count} ${outcomeText[part.outcome]}`)
          .join(', ')}.`;
  const badges: { tone: Tone; text: string }[] = [];
  if (error) badges.push({ tone: 'bad', text: `Rejects every click since the deploy: ${error}` });
  else badges.push({ tone: 'ok', text: 'Counts every click' });
  if (deployed && change === 'version') {
    badges.push({ tone: 'neutral', text: 'Still reads v1, can move to v2 on its own schedule' });
  }
  return (
    <section className="sdv-duel__lane" aria-label={lane.label}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <p className="sdv-schema__path">{pathText(lane)}</p>
      <ul className="sdv-schema__nodes" aria-label={`${lane.label}: components`}>
        <NodeChip
          kind="queue"
          name="Click topic, v1"
          tone={deployed && change !== 'version' ? 'warn' : 'ok'}
          text={deployed && change !== 'version' ? 'Shape changed' : 'v1 shape'}
        />
        <NodeChip
          kind="server"
          name="Analytics consumer"
          tone={error ? 'bad' : 'ok'}
          text={error ? 'Rejecting' : 'Counting'}
          stuck={Boolean(error)}
        />
        <NodeChip
          kind="queue"
          name="Dead-letter queue"
          tone={t.parked > 0 ? 'bad' : 'ok'}
          text={t.parked > 0 ? `${t.parked} parked` : 'Empty'}
        />
      </ul>
      <div className="sdv-schema__strip" aria-hidden="true">
        {recent.map((outcome, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the strip is a fixed window of positions
          <span key={index} className="sdv-schema__cell" data-outcome={outcome} />
        ))}
      </div>
      <p className="sdv-schema__strip-text">{stripText}</p>
      <div className="sdv-schema__verdict">
        {badges.map((badge) => (
          <ToneBadge key={badge.text} tone={badge.tone}>
            {badge.text}
          </ToneBadge>
        ))}
      </div>
    </section>
  );
}

/** One schema change shipped mid run, read by a strict and a tolerant consumer on the same clicks. */
export default function SchemaEvolutionWidget({
  title = 'Ship a schema change to live consumers',
  instructions = `Pick a change, then press Play. The click service ships it at ${DEPLOY_AT_SECONDS} s while both consumers read the same clicks.`,
}: Props) {
  const hydrated = useHydrated();
  const [change, setChange] = useState<SchemaChange>('add-field');
  const duelRef = useRef<SchemaDuel | null>(null);
  if (!duelRef.current) duelRef.current = new SchemaDuel(change);
  const duel = duelRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (next: SchemaChange) => {
    duelRef.current = new SchemaDuel(next);
    rerender();
  };
  const chooseChange = (next: SchemaChange) => {
    setChange(next);
    restart(next);
  };
  const onTick = () => {
    duel.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!duel.done) duel.step();
    rerender();
  };

  const [strict, tolerant] = duel.lanes;
  const a = strict.model.totals;
  const b = tolerant.model.totals;
  const seconds = duel.ticks * duel.tickSeconds;
  const deployed = strict.model.deployed !== null;

  const rows: CompareRow[] = [
    { label: 'Clicks (same for both)', values: [a.clicks, b.clicks] },
    { label: 'Events published, every topic', values: [a.published, b.published] },
    { label: 'Read and counted', values: [a.counted, b.counted], better: 'higher' },
    { label: 'Parked in the dead-letter queue', values: [a.parked, b.parked], better: 'lower' },
  ];
  if (change === 'version') rows.push({ label: 'Events on the v2 topic', values: [a.v2Only, b.v2Only] });

  const summary = `${seconds.toFixed(1)} s of ${SCHEMA_SECONDS} s. ${schemaChangeOptions[change].label}${deployed ? ' shipped' : ` ships at ${DEPLOY_AT_SECONDS} s`}. Strict reader: ${a.counted} counted, ${a.parked} parked. Tolerant reader: ${b.counted} counted, ${b.parked} parked.`;
  const markerEvents = duel.events.filter((event) => event.marker);
  const notes = duel.events.filter((event) => !event.marker);

  const status = duel.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : duel.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : a.parked + b.parked > 0
        ? ({ tone: 'warn', text: `Clicks parking at ${seconds.toFixed(1)} s` } as const)
        : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${SCHEMA_SECONDS} s` } as const);

  const v1Shape = strict.model.topicShape;
  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(change)}
      summary={summary}
      status={status}
      finished={duel.done}
      resetKey={change}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || duel.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <CompareTable
          caption="Whole run so far, same clicks and same deploy for both"
          columns={[strict.label, tolerant.label]}
          rows={rows}
        />
      }
    >
      <ScenarioChips
        label="Schema change the click service ships"
        value={change}
        options={changes.map((id) => ({
          value: id,
          label: schemaChangeOptions[id].label,
          diff: schemaChangeOptions[id].diff,
        }))}
        onChange={chooseChange}
      />
      <div className="sdv-schema__payloads">
        <Payload
          caption={deployed ? 'Click event on the v1 topic, after the deploy' : 'Click event on the v1 topic'}
          shape={v1Shape}
          base={deployed && change !== 'version' ? clickV1 : null}
        />
        {deployed && change === 'version' ? (
          <Payload caption="Click event on the new v2 topic" shape={clickV2.version} base={clickV1} />
        ) : (
          !deployed && (
            <p className="sdv-schema__pending">
              At {DEPLOY_AT_SECONDS} s the click service ships this change: {schemaChangeOptions[change].diff}
              .
            </p>
          )
        )}
      </div>
      <div className="sdv-duel__lanes">
        {duel.lanes.map((lane, index) => (
          <LanePane key={lane.style} lane={lane} variant={variants[index] ?? 'a'} change={change} />
        ))}
      </div>
      <ul className="sdv-qtracks__legend" aria-label="How to read the click strips">
        {outcomeOrder.map((outcome) => (
          <li key={outcome}>
            <span className="sdv-schema__cell sdv-schema__key" data-outcome={outcome} aria-hidden="true" />
            {outcomeText[outcome].charAt(0).toUpperCase() + outcomeText[outcome].slice(1)}
          </li>
        ))}
      </ul>
      <TraceChart
        title="Clicks in the dead-letter queue"
        series={duel.lanes.map((lane, index) => ({
          label: lane.label,
          values: lane.series,
          variant: variants[index] ?? 'a',
        }))}
        length={duel.length}
        tickSeconds={duel.tickSeconds}
        markers={markerEvents.map((event, index) => ({ tick: event.tick, number: index + 1 }))}
        minMax={20}
        summary={`Clicks in the dead-letter queue. ${strict.label} ${a.parked}, ${tolerant.label.toLowerCase()} ${b.parked}.`}
      />
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">
            The deploy and the first click each consumer rejects appear here, numbered to match the chart.
          </p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>{(event.tick * duel.tickSeconds).toFixed(1)} s</time> {event.text}
              </li>
            ))}
          </ol>
        )}
        {notes.map((event) => (
          <p key={`${event.tick}-${event.text}`} className="sdv-trace__note">
            {event.text}
          </p>
        ))}
      </div>
      {!hydrated && <p className="sdv-trace__empty">The simulation starts once the page finishes loading.</p>}
    </SimulationShell>
  );
}
