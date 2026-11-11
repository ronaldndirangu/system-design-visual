import { describe, expect, it } from 'vitest';
import {
  type CartEvent,
  CqrsModel,
  type CqrsScenarioId,
  cartTotal,
  countWrongTotals,
  cqrsScenarios,
  decide,
  foldEvents,
  projectCartPage,
  projectTopItems,
  type WriteState,
} from '../../src/lib/models/cqrs';

const ids: CqrsScenarioId[] = ['normal', 'sale', 'replay'];

function run(id: CqrsScenarioId): CqrsModel {
  const model = new CqrsModel(cqrsScenarios[id]);
  while (!model.done) model.step();
  return model;
}

function play(model: CqrsModel, ticks: number) {
  for (let i = 0; i < ticks; i += 1) model.step();
  return model.checkpoint();
}

const checkouts = (events: readonly CartEvent[]) =>
  events.filter((event) => event.type === 'CheckedOut').length;

describe('CQRS write model', () => {
  const state: WriteState = {
    1: { lines: { mug: 1 }, checkedOut: false },
    2: { lines: { tea: 2 }, checkedOut: true },
  };

  it('turns valid commands into facts', () => {
    expect(decide(state, { type: 'AddItem', cart: 1, item: 'lamp' })).toEqual({
      ok: true,
      fact: { type: 'ItemAdded', cart: 1, item: 'lamp', price: 40 },
    });
    expect(decide(state, { type: 'RemoveItem', cart: 1, item: 'mug' }).ok).toBe(true);
    expect(decide(state, { type: 'Checkout', cart: 1 }).ok).toBe(true);
  });

  it('rejects commands the current facts forbid', () => {
    expect(decide(state, { type: 'RemoveItem', cart: 1, item: 'book' })).toEqual({
      ok: false,
      reason: 'cart 1 has no book',
    });
    expect(decide(state, { type: 'Checkout', cart: 3 })).toEqual({ ok: false, reason: 'cart 3 is empty' });
    expect(decide(state, { type: 'AddItem', cart: 2, item: 'mug' })).toEqual({
      ok: false,
      reason: 'cart 2 is already checked out',
    });
  });

  it('keeps a write state equal to a fold of the log, at every tick', () => {
    for (const id of ids) {
      const model = new CqrsModel(cqrsScenarios[id]);
      while (!model.done) {
        model.step();
        expect(model.writeState).toEqual(foldEvents(model.log));
      }
      expect(model.log.map((event) => event.seq)).toEqual(model.log.map((_, index) => index + 1));
      expect(model.log).toHaveLength(model.totalEvents);
    }
  });
});

describe('CQRS projections', () => {
  it('keeps every event accounted for: appended = applied + still behind, for each consumer', () => {
    for (const id of ids) {
      const model = new CqrsModel(cqrsScenarios[id]);
      while (!model.done) {
        model.step();
        const appended = model.stats.appended;
        expect(model.log).toHaveLength(appended);
        expect(model.cartPage.position + model.lags.cart.events).toBe(appended);
        expect(model.topItems.position + model.lags.top.events).toBe(appended);
        expect(model.emailPosition + model.lags.email.events).toBe(appended);
        const rebuild = model.rebuild;
        if (rebuild) expect(rebuild.position + (model.lags.rebuild?.events ?? 0)).toBe(appended);
      }
    }
  });

  it('keeps each view equal to projecting the events before its position', () => {
    for (const id of ids) {
      const model = new CqrsModel(cqrsScenarios[id]);
      while (!model.done) {
        model.step();
        const { version, position, view } = model.cartPage;
        expect(view).toEqual(projectCartPage(model.log.slice(0, position), version));
        expect(model.cartTruth).toEqual(projectCartPage(model.log.slice(0, position), 'v2'));
        expect(model.topItems.view).toEqual(projectTopItems(model.log.slice(0, model.topItems.position)));
        const rebuild = model.rebuild;
        if (rebuild)
          expect(rebuild.view).toEqual(projectCartPage(model.log.slice(0, rebuild.position), 'v2'));
      }
    }
  });

  it('catches every consumer up by the end, with v2 totals matching the write model', () => {
    for (const id of ids) {
      const model = run(id);
      const length = model.log.length;
      expect(model.cartPage).toMatchObject({ version: 'v2', position: length });
      expect(model.topItems.position).toBe(length);
      expect(model.emailPosition).toBe(length);
      expect(model.cartPage.view).toEqual(projectCartPage(model.log, 'v2'));
      for (const [cart, entry] of Object.entries(model.writeState)) {
        expect(model.cartPage.view[Number(cart)]?.lines).toEqual(entry.lines);
        expect(model.cartPage.view[Number(cart)]?.total).toBe(cartTotal(entry.lines));
      }
    }
  });

  it('rebuilds v2 from position 0 into the same view a live v2 projection would hold', () => {
    const model = new CqrsModel(cqrsScenarios.replay);
    while (model.stats.rebuildEndTick === null) {
      model.step();
      expect(model.cartPage.version).toBe(
        model.rebuild || model.stats.rebuildStartTick === null ? 'v1' : 'v2',
      );
    }
    const { position, view } = model.cartPage;
    expect(view).toEqual(projectCartPage(model.log.slice(0, position), 'v2'));
    expect(model.wrongCarts).toBe(0);
  });

  it('shows v1 totals that drift from v2 only through skipped ItemRemoved events', () => {
    const model = new CqrsModel(cqrsScenarios.replay);
    while (model.ticks < 120) model.step();
    const events = model.log.slice(0, model.cartPage.position);
    const v1 = projectCartPage(events, 'v1');
    const v2 = projectCartPage(events, 'v2');
    expect(model.wrongCarts).toBe(countWrongTotals(v1, v2));
    const removedCarts = new Set(
      events.filter((event) => event.type === 'ItemRemoved').map((event) => event.cart),
    );
    expect(model.wrongCarts).toBe(removedCarts.size);
  });

  it('mails one receipt per checkout, even across the replay', () => {
    for (const id of ids) {
      const model = run(id);
      expect(model.stats.emailsSent).toBe(checkouts(model.log));
    }
  });
});

describe('CQRS playback', () => {
  it('replays a run exactly', () => {
    for (const id of ids) {
      expect(run(id).checkpoint()).toEqual(run(id).checkpoint());
    }
  });

  it('resets to the start by restoring the first checkpoint', () => {
    const model = new CqrsModel(cqrsScenarios.replay);
    const start = model.checkpoint();
    const first = play(model, model.length);
    model.restore(start);
    expect(model.ticks).toBe(0);
    expect(play(model, model.length)).toEqual(first);
  });

  it('resumes from a checkpoint midway, in the same or a fresh model', () => {
    const model = new CqrsModel(cqrsScenarios.replay);
    play(model, 130);
    const saved = model.checkpoint();
    const rest = play(model, 110);

    model.restore(saved);
    expect(play(model, 110)).toEqual(rest);

    const fresh = new CqrsModel(cqrsScenarios.replay);
    fresh.restore(saved);
    expect(play(fresh, 110)).toEqual(rest);
  });

  it('keeps checkpoints independent of later steps', () => {
    const model = new CqrsModel(cqrsScenarios.sale);
    play(model, 80);
    const saved = model.checkpoint();
    const length = saved.log.length;
    play(model, 80);
    expect(saved.log).toHaveLength(length);
  });

  it('feeds the normal and replay scenarios the same commands', () => {
    expect(run('replay').log).toEqual(run('normal').log);
  });

  it('stops after the run length', () => {
    const model = run('normal');
    expect(model.ticks).toBe(240);
    model.step();
    expect(model.ticks).toBe(240);
    expect(model.series.a).toHaveLength(240);
    expect(model.series.b).toHaveLength(240);
  });
});

describe('CQRS illustrative numbers', () => {
  it('pins the normal run the lesson quotes', () => {
    const { stats, log } = run('normal');
    expect(stats).toMatchObject({
      commands: 98,
      appended: 95,
      rejected: 3,
      reads: 95,
      staleReads: 19,
      waitedReads: 19,
      waitTicksTotal: 23,
      waitTicksMax: 2,
      emailsSent: 14,
      peakTopLag: 6,
    });
    expect(checkouts(log)).toBe(14);
  });

  it('pins the flash sale backlog on top items', () => {
    const model = run('sale');
    expect(model.stats).toMatchObject({ appended: 156, peakTopLag: 42, peakTopLagTick: 114, peakCartLag: 9 });
    const texts = model.transcript.map(
      (note) => `${(note.tick * model.tickSeconds).toFixed(1)} ${note.text}`,
    );
    expect(texts).toContain(
      '7.4 Top items falls 24 events behind. Its numbers are 1.0 s old, while the cart page stays current.',
    );
    expect(texts).toContain(
      '18.5 Top items catches up with the log. The backlog drained once the sale traffic stopped.',
    );
  });

  it('pins the replay that fixes the cart totals', () => {
    const model = run('replay');
    expect(model.stats).toMatchObject({
      wrongCartsAtDeploy: 6,
      wrongCartsAtSwap: 7,
      wrongReads: 28,
      receiptsAtRisk: 6,
      replayed: 57,
      rebuildStartTick: 120,
      rebuildEndTick: 148,
      emailsSent: 14,
    });
    const texts = model.transcript.map(
      (note) => `${(note.tick * model.tickSeconds).toFixed(1)} ${note.text}`,
    );
    expect(texts[0]).toBe(
      '0.6 Cart page v1 skips event 3 (ItemRemoved mug, cart 3). Cart 3 now shows $12 too much.',
    );
    expect(model.wrongCarts).toBe(0);
  });

  it('marks 1 in 5 reads stale when pooled across 30 seeds, with single runs swinging widely', () => {
    let stale = 0;
    let reads = 0;
    const shares: number[] = [];
    for (let seed = 1; seed <= 30; seed += 1) {
      const model = new CqrsModel({
        ...cqrsScenarios.normal,
        config: { ...cqrsScenarios.normal.config, seed },
      });
      while (!model.done) model.step();
      stale += model.stats.staleReads;
      reads += model.stats.reads;
      shares.push(model.stats.staleReads / model.stats.reads);
    }
    expect({ stale, reads }).toEqual({ stale: 535, reads: 2693 });
    expect(Math.min(...shares)).toBeGreaterThan(0.09);
    expect(Math.min(...shares)).toBeLessThan(0.1);
    expect(Math.max(...shares)).toBe(0.27);
  });
});
