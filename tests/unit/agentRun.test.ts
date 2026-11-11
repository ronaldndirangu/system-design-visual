import { describe, expect, it } from 'vitest';
import {
  AgentDuel,
  type AgentScenarioId,
  type AgentSummary,
  ALL_GUARDS,
  agentScenarios,
  COST_CAP,
  finishedDuel,
  type GuardId,
  type Guards,
  guardOrder,
  NO_GUARDS,
  RUNAWAY_SEARCHES,
  STEP_CAP,
  scenarioOrder,
  summarizeLane,
} from '../../src/lib/models/agentRun';

function summaries(scenario: AgentScenarioId, guards: Guards = ALL_GUARDS): [AgentSummary, AgentSummary] {
  const [unguarded, guarded] = finishedDuel(scenario, guards).lanes.map(summarizeLane);
  if (!unguarded || !guarded) throw new Error('expected two lanes');
  return [unguarded, guarded];
}

function only(id: GuardId): Guards {
  return { ...NO_GUARDS, [id]: true };
}

function without(id: GuardId): Guards {
  return { ...ALL_GUARDS, [id]: false };
}

const everyGuardMix: Guards[] = Array.from({ length: 2 ** guardOrder.length }, (_, mask) => {
  const guards = { ...NO_GUARDS };
  guardOrder.forEach((id, bit) => {
    guards[id] = (mask & (1 << bit)) !== 0;
  });
  return guards;
});

describe('AgentDuel', () => {
  it('replays the same duel every time', () => {
    for (const scenario of scenarioOrder) {
      const a = finishedDuel(scenario);
      const b = finishedDuel(scenario);
      expect(b.lanes).toEqual(a.lanes);
      expect(b.events).toEqual(a.events);
    }
  });

  it('gives a fresh duel the same result as a finished one, so reset is a rebuild', () => {
    const played = finishedDuel('injected');
    const fresh = new AgentDuel('injected');
    expect(fresh.ticks).toBe(0);
    expect(fresh.lanes.every((lane) => lane.cards.length === 0)).toBe(true);
    while (!fresh.done) fresh.step();
    expect(fresh.lanes).toEqual(played.lanes);
  });

  it('plays one scripted step per tick and stops at the end', () => {
    const duel = new AgentDuel('cancel');
    expect(duel.length).toBe(agentScenarios.cancel.steps.length);
    duel.step();
    expect(duel.ticks).toBe(1);
    expect(duel.lanes.map((lane) => lane.cards.length)).toEqual([1, 1]);
    while (!duel.done) duel.step();
    const events = duel.events.length;
    duel.step();
    expect(duel.ticks).toBe(duel.length);
    expect(duel.events.length).toBe(events);
  });

  it('accounts for every attempted call under every scenario and guard mix', () => {
    for (const scenario of scenarioOrder) {
      for (const guards of everyGuardMix) {
        const duel = new AgentDuel(scenario, guards);
        while (!duel.done) {
          duel.step();
          for (const s of duel.lanes.map(summarizeLane)) {
            expect(s.attempted).toBe(s.executed + s.blocked + s.cancelled + s.pending + s.inFlight);
          }
        }
      }
    }
  });

  it('commits zero unauthorized side effects in every scenario with every guard on', () => {
    for (const scenario of scenarioOrder) {
      const [, guarded] = summaries(scenario);
      expect(guarded.unauthorized).toBe(0);
      expect(guarded.toolCalls).toBeLessThanOrEqual(STEP_CAP);
      expect(guarded.cost).toBeLessThanOrEqual(COST_CAP);
    }
  });

  it('shows a failure in the unguarded lane of every scenario', () => {
    const [injected] = summaries('injected');
    const [runaway] = summaries('runaway');
    const [cancel] = summaries('cancel');
    expect(injected.unauthorized).toBeGreaterThan(0);
    expect(runaway.toolCalls).toBeGreaterThan(STEP_CAP);
    expect(cancel.unauthorized).toBeGreaterThan(0);
  });

  it('stops the injected refund with any one of three guards alone, each with its own reason', () => {
    const expected: [GuardId, string, string][] = [
      ['scoped', 'blocked', 'Blocked: order 1042 belongs to another customer'],
      ['dataOnly', 'blocked', 'Blocked: retrieved text asked for this, and retrieved text is data'],
      ['approval', 'pending', 'Needs approval: a person reviews every refund'],
    ];
    for (const [guard, status, reason] of expected) {
      const guarded = finishedDuel('injected', only(guard)).lanes[1];
      const refund = guarded.cards.find((card) => card.text === 'issue_refund(order 1042, $480)');
      expect(refund).toMatchObject({ status, reason, guard });
      expect(summarizeLane(guarded).unauthorized).toBe(0);
    }
    const [, budgetAndCancelOnly] = summaries('injected', { ...NO_GUARDS, budget: true, cancelToken: true });
    expect(budgetAndCancelOnly.refunds).toBe(2);
    expect(budgetAndCancelOnly.unauthorized).toBe(1);
  });

  it('misleads the model in both lanes, because the guards act only on its calls', () => {
    const duel = finishedDuel('injected');
    for (const lane of duel.lanes) {
      expect(lane.cards.some((card) => card.origin === 'retrieved' && card.kind === 'call')).toBe(true);
    }
  });

  it('lets the runaway loop reach every search when the budget is off', () => {
    const [, guarded] = summaries('runaway', without('budget'));
    expect(guarded.executed).toBe(RUNAWAY_SEARCHES);
  });

  it('ends a budget stop with a handoff to a person', () => {
    const guarded = finishedDuel('runaway').lanes[1];
    expect(guarded.cards.at(-2)).toMatchObject({
      status: 'blocked',
      guard: 'budget',
      reason: `Budget exhausted: ${STEP_CAP} of ${STEP_CAP} tool calls used`,
    });
    expect(guarded.cards.at(-1)?.kind).toBe('answer');
  });

  it('lets the email go out after the customer leaves when cancellation does not reach the tools', () => {
    const [, guarded] = summaries('cancel', without('cancelToken'));
    expect(guarded).toMatchObject({ emails: 1, unauthorized: 1, cancelled: 0 });
    const lane = finishedDuel('cancel').lanes[1];
    expect(lane.cards.find((card) => card.tool === 'search')).toMatchObject({
      status: 'cancelled',
      reason: 'Cancelled: the token reached the search call',
    });
  });

  it('pins the injected ticket numbers the lesson quotes', () => {
    const [unguarded, guarded] = summaries('injected');
    expect(unguarded).toMatchObject({
      attempted: 6,
      executed: 6,
      blocked: 0,
      pending: 0,
      refunds: 2,
      refundTotal: 544,
      emails: 1,
      unauthorized: 1,
      cost: 25,
    });
    expect(guarded).toMatchObject({
      attempted: 6,
      executed: 4,
      blocked: 1,
      pending: 1,
      refunds: 0,
      emails: 1,
      unauthorized: 0,
      cost: 23,
    });
  });

  it('pins the runaway loop numbers the lesson quotes', () => {
    const [unguarded, guarded] = summaries('runaway');
    expect(unguarded).toMatchObject({ attempted: 30, executed: 30, toolCalls: 30, cost: 124 });
    expect(guarded).toMatchObject({ attempted: 9, executed: 8, blocked: 1, toolCalls: 8, cost: 36 });
  });

  it('pins the customer cancels numbers the lesson quotes', () => {
    const [unguarded, guarded] = summaries('cancel');
    expect(unguarded).toMatchObject({
      attempted: 3,
      executed: 3,
      cancelled: 0,
      emails: 1,
      unauthorized: 1,
      cost: 16,
    });
    expect(guarded).toMatchObject({
      attempted: 2,
      executed: 1,
      cancelled: 1,
      emails: 0,
      unauthorized: 0,
      cost: 9,
    });
  });
});
