import { m } from 'motion/react';
import { useId, useReducer, useRef, useState } from 'react';
import {
  type AgentCard,
  AgentDuel,
  type AgentLane,
  type AgentScenarioId,
  type AgentSummary,
  ALL_GUARDS,
  agentScenarios,
  COST_CAP,
  type GuardId,
  type Guards,
  guardLabels,
  guardOrder,
  STEP_CAP,
  scenarioOrder,
  summarizeLane,
} from '../../lib/models/agentRun';
import { Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { ToneBadge } from '../sim/StatTable';
import { SeriesSwatch } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { safeId } from '../viz/SystemNode';
import './AgentDuelWidget.css';

interface Props {
  initial?: AgentScenarioId;
  title?: string;
  instructions?: string;
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const kindLabels: Record<AgentCard['kind'], string> = {
  plan: 'Plan',
  call: 'Tool call',
  event: 'Event',
  answer: 'Answer',
};

const guardHints: Record<GuardId, string> = {
  scoped: 'Tools act only on the signed-in customer\u2019s orders.',
  dataOnly: 'Retrieved text can inform an answer but cannot trigger a write.',
  approval: 'A person approves every refund before it runs.',
  budget: `At most ${STEP_CAP} tool calls and ${COST_CAP} cost units per request.`,
  cancelToken: 'Closing the chat stops in-flight calls and the loop.',
};

interface CardGroup {
  key: number;
  cards: AgentCard[];
}

function groupable(card: AgentCard): boolean {
  return card.kind === 'call' && card.status === 'executed' && !card.untrusted && !card.unauthorized;
}

/** Fold runs of the same executed tool into one card, so a 30 call loop stays readable. */
function groupCards(cards: AgentCard[]): CardGroup[] {
  const groups: CardGroup[] = [];
  for (const card of cards) {
    const last = groups.at(-1);
    const previous = last?.cards.at(-1);
    if (last && previous && groupable(card) && groupable(previous) && previous.tool === card.tool) {
      last.cards.push(card);
    } else {
      groups.push({ key: card.id, cards: [card] });
    }
  }
  return groups;
}

function statusBadge(card: AgentCard): { tone: Tone; text: string } | undefined {
  if (card.kind === 'answer') return card.reason ? { tone: 'warn', text: card.reason } : undefined;
  if (card.kind !== 'call') return undefined;
  switch (card.status) {
    case 'executed':
      return card.unauthorized
        ? { tone: 'bad', text: card.reason ?? 'Unauthorized' }
        : { tone: 'ok', text: 'Ran' };
    case 'running':
      return { tone: 'neutral', text: 'Running' };
    case 'blocked':
      return { tone: 'ok', text: card.reason ?? 'Blocked' };
    case 'pending':
      return { tone: 'warn', text: card.reason ?? 'Needs approval' };
    case 'cancelled':
      return { tone: 'ok', text: card.reason ?? 'Cancelled' };
    default:
      return undefined;
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function budgetText(lane: AgentLane): string {
  return lane.guards.budget
    ? `Tool calls ${lane.toolCalls} of ${STEP_CAP} \u00b7 Cost ${lane.cost} of ${COST_CAP} units`
    : `Tool calls ${lane.toolCalls}, no cap \u00b7 Cost ${lane.cost} units, no cap`;
}

function laneSentence(lane: AgentLane, s: AgentSummary): string {
  return `${lane.label}: ${s.attempted} tool calls attempted, ${s.executed} executed, ${s.blocked} blocked, ${
    s.pending
  } waiting for approval, ${s.cancelled} cancelled, ${plural(s.refunds, 'refund', 'refunds')}, ${plural(
    s.emails,
    'email',
    'emails',
  )}, ${plural(s.unauthorized, 'unauthorized side effect', 'unauthorized side effects')}, ${s.cost} cost units`;
}

function AgentCardItem({ group, lane, reduced }: { group: CardGroup; lane: AgentLane; reduced: boolean }) {
  const card = group.cards.at(-1);
  if (!card) return null;
  const repeats = group.cards.length;
  const badge = statusBadge(card);
  const isCall = card.kind === 'call';
  return (
    <m.li
      className="sdv-agent-card"
      data-kind={card.kind}
      data-status={card.status}
      data-unauthorized={card.unauthorized ? 'true' : undefined}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <p className="sdv-agent-card__head">
        <span className="sdv-agent-card__kind">{kindLabels[card.kind]}</span>
        {card.origin === 'retrieved' && (
          <span className="sdv-agent-card__origin">Follows retrieved text</span>
        )}
        {repeats > 1 && (
          <m.span
            key={repeats}
            className="sdv-agent-card__count"
            initial={reduced ? false : { scale: 1.25 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            {`${card.tool} ran ${repeats} times`}
          </m.span>
        )}
      </p>
      {isCall ? (
        <p className="sdv-agent-card__text">
          <code>{card.text}</code>
        </p>
      ) : (
        <p className="sdv-agent-card__text">{card.text}</p>
      )}
      {card.untrusted && (
        <div className="sdv-agent-untrusted" data-tagged={lane.guards.dataOnly ? 'true' : 'false'}>
          <p className="sdv-agent-untrusted__label">
            {lane.guards.dataOnly
              ? 'Retrieved text, tagged as untrusted data'
              : 'Retrieved text, mixed into the instructions'}
          </p>
          <p className="sdv-agent-untrusted__text">{card.untrusted}</p>
        </div>
      )}
      {card.result && (
        <p className="sdv-agent-card__result">
          {repeats > 1 ? `Latest result: ${card.result}` : `Result: ${card.result}`}
        </p>
      )}
      {badge && (
        <m.span
          key={`${card.status ?? card.kind}-${badge.text}`}
          className="sdv-agent-card__badge"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <ToneBadge tone={badge.tone}>{badge.text}</ToneBadge>
        </m.span>
      )}
    </m.li>
  );
}

function LanePane({ lane, request, reduced }: { lane: AgentLane; request: string; reduced: boolean }) {
  const over = lane.cost > COST_CAP;
  const fill = Math.min(lane.cost / COST_CAP, 1) * 100;
  const groups = groupCards(lane.cards);
  return (
    <section className="sdv-duel__lane sdv-agent-lane" aria-label={lane.label} data-lane={lane.id}>
      <h4 className="sdv-duel__lane-title">
        <SeriesSwatch variant={lane.id === 'unguarded' ? 'a' : 'b'} />
        {lane.label}
      </h4>
      <p className="sdv-agent-request">
        <span className="sdv-agent-request__who">Customer</span> <q>{request}</q>
      </p>
      <div className="sdv-agent-meter" data-capped={lane.guards.budget ? 'true' : 'false'} data-over={over}>
        <p className="sdv-agent-meter__text">{budgetText(lane)}</p>
        <span className="sdv-agent-meter__track" aria-hidden="true">
          <span className="sdv-agent-meter__fill" style={{ width: `${fill}%` }} />
        </span>
      </div>
      {lane.cards.length === 0 ? (
        <p className="sdv-trace__empty">Waiting for the first step.</p>
      ) : (
        <ol className="sdv-agent-cards" aria-label={`${lane.label} trace`}>
          {groups.map((group) => (
            <AgentCardItem key={group.key} group={group} lane={lane} reduced={reduced} />
          ))}
        </ol>
      )}
    </section>
  );
}

export default function AgentDuelWidget({
  initial = 'injected',
  title = 'Two agents, same model, same fixture trace',
  instructions = 'Pick a scenario, predict what the unguarded agent does, then press Play. Each step plays one turn of the agent loop in both lanes.',
}: Props) {
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const baseId = safeId(useId(), 'agent');
  const [scenarioId, setScenarioId] = useState<AgentScenarioId>(initial);
  const [guards, setGuards] = useState<Guards>(ALL_GUARDS);
  const runRef = useRef<AgentDuel | null>(null);
  runRef.current ??= new AgentDuel(scenarioId, guards);
  const run = runRef.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const restart = (id: AgentScenarioId, next: Guards) => {
    runRef.current = new AgentDuel(id, next);
    rerender();
  };
  const onTick = () => {
    run.step();
    rerender();
  };
  const skipToEnd = () => {
    while (!run.done) run.step();
    rerender();
  };
  const chooseScenario = (id: AgentScenarioId) => {
    setScenarioId(id);
    restart(id, guards);
  };
  const toggleGuard = (id: GuardId, on: boolean) => {
    const next = { ...guards, [id]: on };
    setGuards(next);
    restart(scenarioId, next);
  };

  const scenario = agentScenarios[scenarioId];
  const summaries = run.lanes.map(summarizeLane);
  const guarded = summaries[1];
  const started = run.ticks > 0;
  const guardBits = guardOrder.map((id) => (guards[id] ? '1' : '0')).join('');

  const summary = started
    ? `Step ${run.ticks} of ${run.length}. ${run.lanes
        .map((lane, index) => {
          const s = summaries[index];
          return s ? laneSentence(lane, s) : lane.label;
        })
        .join('. ')}.`
    : `Nothing has run yet. ${run.length} steps in the ${scenario.label.toLowerCase()} scenario.`;

  const status = run.done
    ? (guarded?.unauthorized ?? 0) === 0
      ? ({ tone: 'ok', text: 'Run complete' } as const)
      : ({
          tone: 'bad',
          text: 'Run complete: the guarded agent committed an unauthorized side effect',
        } as const)
    : started
      ? ({ tone: 'neutral', text: `Step ${run.ticks} of ${run.length}` } as const)
      : ({ tone: 'neutral', text: 'Ready' } as const);

  const markerEvents = run.events.filter((event) => event.marker);
  const notes = run.events.filter((event) => !event.marker);

  const capText = (lane: AgentLane, used: number, cap: number, unit: string) =>
    lane.guards.budget ? `${used} of ${cap}${unit}` : `${used}${unit}, no cap`;

  const rows: { label: string; cells: string[] }[] = [
    { label: 'Tool calls attempted', cells: summaries.map((s) => String(s.attempted)) },
    { label: 'Executed', cells: summaries.map((s) => String(s.executed)) },
    { label: 'Blocked by policy', cells: summaries.map((s) => String(s.blocked)) },
    { label: 'Waiting for approval', cells: summaries.map((s) => String(s.pending)) },
    { label: 'Cancelled', cells: summaries.map((s) => String(s.cancelled)) },
    { label: 'Still running', cells: summaries.map((s) => String(s.inFlight)) },
    {
      label: 'Refunds issued',
      cells: summaries.map((s) => (s.refunds > 0 ? `${s.refunds} ($${s.refundTotal})` : '0')),
    },
    { label: 'Emails sent', cells: summaries.map((s) => String(s.emails)) },
    {
      label: 'Tool calls used',
      cells: run.lanes.map((lane) => capText(lane, lane.toolCalls, STEP_CAP, '')),
    },
    {
      label: 'Cost units (illustrative)',
      cells: run.lanes.map((lane) => capText(lane, lane.cost, COST_CAP, ' units')),
    },
  ];

  return (
    <SimulationShell
      title={title}
      instructions={instructions}
      onTick={onTick}
      onReset={() => restart(scenarioId, guards)}
      summary={summary}
      status={status}
      finished={run.done}
      resetKey={`${scenarioId}:${guardBits}`}
      ticksPerSecond={2}
      controls={
        <>
          <div className="sdv-duel__extra">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || run.done}>
              Skip to the end
            </button>
          </div>
          <fieldset className="sdv-agent-guards" aria-describedby={`${baseId}-guards-note`}>
            <legend>Guards on the guarded agent</legend>
            <p className="sdv-agent-guards__note" id={`${baseId}-guards-note`}>
              The unguarded agent always runs with every guard off. Changing a guard restarts the run.
            </p>
            <ul className="sdv-agent-guards__list">
              {guardOrder.map((id) => (
                <li key={id}>
                  <Toggle
                    label={guardLabels[id]}
                    checked={guards[id]}
                    onChange={(on) => toggleGuard(id, on)}
                  />
                  <span className="sdv-agent-guards__hint">{guardHints[id]}</span>
                </li>
              ))}
            </ul>
          </fieldset>
        </>
      }
      readout={
        <DiagramScroll label="Tool calls and side effects so far, scrollable">
          <table className="sdv-stats sdv-compare sdv-agent-table">
            <caption>
              {`Tool calls and side effects so far. Every attempted call ends executed, blocked, waiting for approval, cancelled, or still running. The guarded agent\u2019s budget: ${STEP_CAP} tool calls and ${COST_CAP} cost units.`}
            </caption>
            <thead>
              <tr>
                <td />
                {run.lanes.map((lane) => (
                  <th key={lane.id} scope="col">
                    {lane.label}
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
                <th scope="row">Unauthorized side effects</th>
                {summaries.map((s) => (
                  <td key={s.lane}>
                    {started ? (
                      <ToneBadge tone={s.unauthorized === 0 ? 'ok' : 'bad'}>
                        {s.unauthorized === 0 ? 'None' : String(s.unauthorized)}
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
        options={scenarioOrder.map((id) => ({
          value: id,
          label: agentScenarios[id].label,
          diff: agentScenarios[id].diff,
        }))}
        onChange={chooseScenario}
      />
      <MotionRoot>
        <div className="sdv-duel__lanes sdv-agent-lanes">
          {run.lanes.map((lane) => (
            <LanePane key={lane.id} lane={lane} request={scenario.request} reduced={reduced} />
          ))}
        </div>
      </MotionRoot>
      <ul className="sdv-legend sdv-agent-legend" aria-label="How to read the agent traces">
        <li>
          <SeriesSwatch variant="a" /> Unguarded agent: every guard off
        </li>
        <li>
          <SeriesSwatch variant="b" /> Guarded agent: the guards you pick
        </li>
        <li>
          <span className="sdv-agent-legend__card" data-status="blocked" aria-hidden="true" /> Dashed: the
          policy blocked the call
        </li>
        <li>
          <span className="sdv-agent-legend__card" data-status="pending" aria-hidden="true" /> Dotted: waiting
          for approval, or cancelled
        </li>
        <li>
          <span className="sdv-agent-legend__card" data-unauthorized="true" aria-hidden="true" /> Thick: an
          unauthorized side effect
        </li>
        <li>
          Both lanes replay the same scripted model, so both agents are fooled the same way. Only the checks
          outside the model differ.
        </li>
        <li>
          Traces are fixtures written for this lesson; no model was called. Cost units are illustrative.
        </li>
      </ul>
      <div className="sdv-trace__log">
        <p className="sdv-trace__log-title">What happened</p>
        {markerEvents.length === 0 && notes.length === 0 && (
          <p className="sdv-trace__empty">Unauthorized side effects and policy decisions appear here.</p>
        )}
        {markerEvents.length > 0 && (
          <ol>
            {markerEvents.map((event, index) => (
              <li key={`${event.tick}-${event.text}`}>
                <span className="sdv-trace__num" aria-hidden="true">
                  {index + 1}
                </span>
                <time>Step {event.tick}</time> {event.text}
              </li>
            ))}
          </ol>
        )}
        {notes.map((event) => (
          <p key={`${event.tick}-${event.text}`} className="sdv-trace__note">
            <time>Step {event.tick}</time> {event.text}
          </p>
        ))}
      </div>
    </SimulationShell>
  );
}
