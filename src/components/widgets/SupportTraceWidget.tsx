import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import {
  CapstoneRun,
  type CapstoneScenarioId,
  capstoneScenarioOrder,
  capstoneScenarios,
  getDoc,
  type Harm,
  harmOrder,
  type Outcome,
  type PipelineSummary,
  pipelineLabels,
  type RequestResult,
  type StageId,
  type SupportPipeline,
  type SupportRequest,
  stageOrder,
  summarizePipeline,
  tenants,
} from '../../lib/models/supportAssistant';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type Tone, ToneBadge } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots, type Point } from '../viz/FlowDots';
import type { ComponentKind } from '../viz/kinds';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';
import './SupportTraceWidget.css';

interface Props {
  initial?: CapstoneScenarioId;
  title?: string;
  instructions?: string;
}

const stageInfo: Record<StageId, { kind: ComponentKind; label: string; x: number }> = {
  gateway: { kind: 'loadBalancer', label: 'Gateway', x: 44 },
  cache: { kind: 'cache', label: 'Cache', x: 128 },
  retrieve: { kind: 'vectorIndex', label: 'Retrieve', x: 212 },
  model: { kind: 'model', label: 'Model', x: 296 },
  checks: { kind: 'server', label: 'Checks', x: 380 },
  staff: { kind: 'client', label: 'Staff', x: 464 },
  tool: { kind: 'server', label: 'Refunds', x: 548 },
};
const laneShort: Record<SupportPipeline['id'], string> = { prototype: 'Prototype', guarded: 'Guarded' };

const sublabels: Record<SupportPipeline['id'], Record<StageId, string>> = {
  prototype: {
    gateway: 'shared pool',
    cache: 'text key',
    retrieve: 'all stores',
    model: 'fixture',
    checks: 'none',
    staff: 'budget only',
    tool: 'runs at once',
  },
  guarded: {
    gateway: 'per store',
    cache: 'scoped key',
    retrieve: 'filtered',
    model: 'fixture',
    checks: 'grounding',
    staff: 'approvals',
    tool: 'one key',
  },
};

const STAGE_GAP = 84;
const NODE_W = 72;
const NODE_H = 50;
const ROW_Y = { prototype: 78, guarded: 210 } as const;

const outcomeLabels: Record<Outcome, string> = {
  answered: 'Answered',
  handoff: 'Handed to staff',
  refunded: 'Refunded',
  declined: 'Refund declined',
  budget: 'Over budget, to staff',
};

const harmShort: Record<Harm, string> = {
  leak: 'leak',
  unsupported: 'no evidence',
  badRefund: 'wrong refund',
  starved: 'starved',
};

const harmCount: Record<Harm, [string, string]> = {
  leak: ['leak', 'leaks'],
  unsupported: ['unsupported answer', 'unsupported answers'],
  badRefund: ['wrong refund', 'wrong refunds'],
  starved: ['starved request', 'starved requests'],
};

const stripClass = { ok: 'sdv-strip__hit', warn: 'sdv-strip__miss', bad: 'sdv-strip__bad' } as const;
const dotTone = { ok: 'hit', warn: 'miss', bad: 'bad' } as const;

function resultLabel(result: RequestResult): string {
  const base = result.fromCache ? 'Answered from cache' : outcomeLabels[result.outcome];
  return result.harm ? `${base}: ${harmShort[result.harm]}` : base;
}

function harmsText(summary: PipelineSummary): string {
  const parts = harmOrder
    .filter((harm) => summary.harms[harm] > 0)
    .map((harm) => {
      const n = summary.harms[harm];
      const [one, many] = harmCount[harm];
      return `${n} ${n === 1 ? one : many}`;
    });
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function pathText(path: StageId[]): string {
  return path.map((stage) => stageInfo[stage].label).join(', ');
}

function StageMap({ run, markerId }: { run: CapstoneRun; markerId: string }) {
  const current = run.current;
  const latest = run.lanes.map((lane) => lane.results.at(-1));
  const flows: Flow[] = [];
  const label = current
    ? `Path of request ${current.id} through both pipelines. ${run.lanes
        .map((lane, index) => `${pipelineLabels[lane.id]}: ${pathText(latest[index]?.path ?? [])}`)
        .join('. ')}.`
    : 'Both pipelines have the same stages, except the prototype has no checks. No request handled yet.';

  return (
    <DiagramScroll label="Request paths through both pipelines, scrollable">
      <svg className="sdv-cap__map" viewBox="0 0 592 272" role="img" aria-label={label}>
        <ArrowDefs id={markerId} />
        {run.lanes.map((lane, index) => {
          const y = ROW_Y[lane.id];
          const result = latest[index];
          const path = result?.path ?? [];
          const last = path.at(-1);
          const points: Point[] = [];
          const edges = path.slice(1).map((stage, step) => {
            const from = path[step] ?? stage;
            const ax = stageInfo[from].x;
            const bx = stageInfo[stage].x;
            const skip = bx - ax > STAGE_GAP;
            if (step === 0) points.push([ax, y]);
            if (skip) points.push([(ax + bx) / 2, y - NODE_H / 2 - 25]);
            points.push([bx, y]);
            return skip ? (
              <Edge
                key={`${from}-${stage}`}
                from={[ax, y - NODE_H / 2]}
                to={[bx, y - NODE_H / 2]}
                via={[(ax + bx) / 2, y - NODE_H / 2 - 50]}
                marker={markerId}
                active
              />
            ) : (
              <Edge
                key={`${from}-${stage}`}
                from={[ax + NODE_W / 2, y]}
                to={[bx - NODE_W / 2, y]}
                marker={markerId}
                active
              />
            );
          });
          if (result && points.length > 1) {
            flows.push({
              id: `${lane.id}-${result.request.id}`,
              points,
              tone: dotTone[result.status],
              duration: Math.min(1.1, 0.2 * points.length),
            });
          }
          return (
            <g key={lane.id}>
              <text className="sdv-cap__row-title" x={8} y={y - 48}>
                {pipelineLabels[lane.id]}
              </text>
              {edges}
              {stageOrder.map((stage) => {
                const info = stageInfo[stage];
                if (stage === 'checks' && !lane.guarded) {
                  return (
                    <g key={stage} className="sdv-cap__absent" transform={`translate(${info.x} ${y})`}>
                      <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={4} />
                      <text textAnchor="middle" y={5}>
                        No checks
                      </text>
                    </g>
                  );
                }
                return (
                  <SystemNode
                    key={stage}
                    kind={info.kind}
                    x={info.x}
                    y={y}
                    width={NODE_W}
                    height={NODE_H}
                    label={info.label}
                    sublabel={sublabels[lane.id][stage]}
                    highlight={path.includes(stage)}
                    dim={path.length > 0 && !path.includes(stage)}
                    status={stage === last ? result?.status : undefined}
                  />
                );
              })}
            </g>
          );
        })}
        <FlowDots flows={flows} />
      </svg>
    </DiagramScroll>
  );
}

function SearchHits({ request }: { request: SupportRequest }) {
  return (
    <ul className="sdv-cap__hits" aria-label="Fixture search results over every store, best first">
      {request.hits.map((hit) => {
        const doc = getDoc(hit.doc);
        const other = doc && doc.tenant !== request.tenant;
        const staffOnly = doc?.staffOnly && request.role !== 'staff';
        const tag = other ? `${tenants[doc.tenant].short} only` : staffOnly ? 'staff only' : undefined;
        return (
          <li key={hit.doc} data-blocked={tag ? 'true' : undefined}>
            <span className="sdv-cap__score">{hit.score.toFixed(2)}</span> {doc?.title ?? hit.doc}
            {tag && <span className="sdv-cap__tag">{tag}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function SupportTraceWidget({
  initial = 'leak',
  title = 'Two support assistants, one set of requests',
  instructions = 'Pick a scenario, predict which harms the prototype causes, then press Play. Each step sends one request through both pipelines.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const baseId = safeId(useId(), 'cap');
  const [scenarioId, setScenarioId] = useState<CapstoneScenarioId>(initial);
  const runRef = useRef<CapstoneRun | null>(null);
  runRef.current ??= new CapstoneRun(scenarioId);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: CapstoneScenarioId) => {
    runRef.current = new CapstoneRun(id);
    rerender();
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    run.finish();
    rerender();
  };
  const chooseScenario = (id: CapstoneScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const scenario = run.scenario;
  const summaries = run.lanes.map(summarizePipeline);
  const [proto, guarded] = summaries;
  const current = run.current;
  const started = run.ticks > 0;
  const hasRefunds = scenario.requests.some((request) => request.refund);

  const summary = started
    ? `${run.ticks} of ${run.length} requests handled. ${summaries
        .map(
          (s) =>
            `${pipelineLabels[s.pipeline]}: ${s.answered} answered, ${s.handoff + s.budget} to staff, ${s.spent} units spent, harms: ${harmsText(s)}`,
        )
        .join('. ')}.`
    : `No requests handled yet. ${run.length} requests in this scenario.`;

  const status = run.done
    ? ({
        tone: guarded && guarded.totalHarms === 0 ? 'ok' : 'warn',
        text: `Run complete: prototype ${proto?.totalHarms ?? 0} harms, guarded design ${guarded?.totalHarms ?? 0}`,
      } as const)
    : started
      ? ({ tone: 'neutral', text: `Request ${run.ticks} of ${run.length}` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  const rows: { label: string; cells: string[] }[] = [
    { label: 'Requests handled', cells: summaries.map((s) => String(s.handled)) },
    {
      label: 'Answered (from cache)',
      cells: summaries.map((s) => `${s.answered} (${s.fromCache} from cache)`),
    },
    { label: 'Answers with a citation', cells: summaries.map((s) => `${s.cited} of ${s.answered}`) },
    { label: 'Handed to staff (abstain or failed check)', cells: summaries.map((s) => String(s.handoff)) },
  ];
  if (hasRefunds) {
    rows.push(
      { label: 'Refunds run', cells: summaries.map((s) => String(s.refunded)) },
      { label: 'Refunds declined by staff', cells: summaries.map((s) => String(s.declined)) },
      {
        label: 'Money refunded wrongly',
        cells: summaries.map((s) => `$${s.wrongRefundTotal.toLocaleString('en-US')}`),
      },
    );
  }
  if (scenarioId === 'budget') {
    rows.push({ label: 'Refused for budget', cells: summaries.map((s) => String(s.budget)) });
  }
  rows.push(
    { label: 'Requests a person touched', cells: summaries.map((s) => String(s.staffTouches)) },
    {
      label: `Model units spent (pool ${scenario.pool})`,
      cells: summaries.map((s) => `${s.spent} (Harbor ${s.spentBy.harbor}, Pine ${s.spentBy.pine})`),
    },
    { label: 'Harms', cells: summaries.map(harmsText) },
  );

  const transcript = scenario.requests.slice(0, run.ticks).map((request, index) => ({
    request,
    results: run.lanes.map((lane) => lane.results[index]),
  }));

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={scenarioId}
      ticksPerSecond={1}
      controls={
        <div className="sdv-duel__extra">
          <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
            Skip to the end
          </button>
        </div>
      }
      readout={
        <DiagramScroll label="Totals so far, scrollable">
          <table className="sdv-stats sdv-compare sdv-cap__table">
            <caption>
              Totals so far. A model call costs 3 illustrative units. The prototype shares one pool; the
              guarded design gives each store half.
            </caption>
            <thead>
              <tr>
                <td />
                {run.lanes.map((lane) => (
                  <th key={lane.id} scope="col">
                    {pipelineLabels[lane.id]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => (
                    <td key={run.lanes[index]?.id}>
                      <span className="sdv-stats__value">{cell}</span>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">Verdict</th>
                {summaries.map((s) => (
                  <td key={s.pipeline}>
                    {started ? (
                      <ToneBadge tone={s.totalHarms === 0 ? 'ok' : 'bad'}>
                        {s.totalHarms === 0
                          ? 'No harms'
                          : `${s.totalHarms} ${s.totalHarms === 1 ? 'harm' : 'harms'}`}
                      </ToneBadge>
                    ) : (
                      <span className="sdv-stats__value">none yet</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </DiagramScroll>
      }
    >
      <ScenarioChips
        label="Scenario"
        value={scenarioId}
        options={capstoneScenarioOrder.map((id) => ({
          value: id,
          label: capstoneScenarios[id].label,
          diff: capstoneScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-cap">
          <div className="sdv-cap__now">
            <p className="sdv-cap__now-title">Now handling</p>
            {current ? (
              <m.div
                key={current.id}
                className="sdv-cap__now-body"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <p className="sdv-cap__request">
                  <span className="sdv-cap__rid">{current.id}</span>
                  <span className="sdv-cap__tenant" data-tenant={current.tenant}>
                    <span className="sdv-cap__initial" aria-hidden="true">
                      {tenants[current.tenant].initial}
                    </span>
                    {`${tenants[current.tenant].name}, ${current.role}`}
                  </span>
                  <q>{current.text}</q>
                </p>
                <SearchHits request={current} />
              </m.div>
            ) : (
              <p className="sdv-trace__empty">Press Play or Step to send the first request.</p>
            )}
          </div>
          <StageMap run={run} markerId={`${baseId}-arrow`} />
          <div className="sdv-duel__lanes sdv-cap__lanes">
            {run.lanes.map((lane, index) => {
              const result = lane.results.at(-1);
              const s = summaries[index];
              const stripId = `${baseId}-${lane.id}`;
              const tone: Tone = result?.status ?? 'neutral';
              return (
                <section key={lane.id} className="sdv-duel__lane" aria-label={pipelineLabels[lane.id]}>
                  <h4 className="sdv-duel__lane-title">{pipelineLabels[lane.id]}</h4>
                  {result ? (
                    <div className="sdv-cap__outcome">
                      <ToneBadge tone={tone}>{`${result.request.id}: ${resultLabel(result)}`}</ToneBadge>
                      <p className="sdv-cap__note">{result.note}</p>
                    </div>
                  ) : (
                    <p className="sdv-cap__note">Waiting for the first request</p>
                  )}
                  <div className="sdv-strip">
                    <p className="sdv-strip__label" id={stripId}>
                      Requests, in order
                    </p>
                    <ol className="sdv-strip__items" aria-labelledby={stripId}>
                      {lane.results.map((r) => (
                        <li
                          key={r.request.id}
                          className={stripClass[r.status]}
                          title={`${r.request.id}: ${resultLabel(r)}`}
                        >
                          <span className="sdv-visually-hidden">{`${r.request.id} ${resultLabel(r)}`}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <p className="sdv-cap__meta">
                    {s && s.handled > 0
                      ? `${s.totalHarms} ${s.totalHarms === 1 ? 'harm' : 'harms'}, ${s.staffTouches} for staff, ${s.spent} units`
                      : 'Nothing handled yet'}
                  </p>
                </section>
              );
            })}
          </div>
        </div>
      </MotionRoot>
      <ul className="sdv-legend" aria-label="How to read the requests">
        <li>
          <span className="sdv-strip__hit" aria-hidden="true" /> Handled safely by the assistant
        </li>
        <li>
          <span className="sdv-strip__miss" aria-hidden="true" /> Sent to staff: no evidence, a failed check,
          an approval, or no budget left
        </li>
        <li>
          <span className="sdv-strip__bad" aria-hidden="true" /> Harm: a leak, an unsupported answer, a wrong
          refund, or a store starved by another
        </li>
        <li>
          Requests, documents, and model outputs are fixtures written for this lesson. Units are illustrative.
        </li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {transcript.length === 0 ? (
          <p className="sdv-trace__empty">Each request appears here with what both pipelines did.</p>
        ) : (
          <ol>
            {transcript.map(({ request, results }, index) => (
              <li key={request.id} className="sdv-cap__log-item">
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="sdv-cap__log-body">
                  <p>
                    <strong>{request.id}</strong>
                    {`, ${tenants[request.tenant].short} ${request.role}: `}
                    <q>{request.text}</q>
                  </p>
                  <ul>
                    {run.lanes.map((lane, laneIndex) => {
                      const result = results[laneIndex];
                      return result ? (
                        <li key={lane.id}>
                          <strong>{`${laneShort[lane.id]}, ${resultLabel(result)}.`}</strong> {result.note}
                        </li>
                      ) : null;
                    })}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </SimulationShell>
  );
}
