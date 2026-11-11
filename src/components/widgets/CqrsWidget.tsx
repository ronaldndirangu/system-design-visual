import { useId, useReducer, useRef, useState } from 'react';
import {
  type CartEvent,
  CQRS_SECONDS,
  type CqrsActivity,
  CqrsModel,
  type CqrsRead,
  type CqrsScenarioId,
  cartTotal,
  cqrsScenarios,
  factText,
  ITEMS,
  type Lag,
  type Lines,
  TOP_BEHIND_MARK,
} from '../../lib/models/cqrs';
import { type CompareRow, CompareTable } from '../sim/CompareTable';
import { LoadBars } from '../sim/LoadBars';
import { MotionRoot } from '../sim/MotionRoot';
import { ScenarioChips } from '../sim/ScenarioChips';
import { SimulationShell } from '../sim/SimulationShell';
import { type StatRow, StatTable, type Tone, ToneBadge } from '../sim/StatTable';
import { TraceChart } from '../sim/TraceChart';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { type Flow, FlowDots, type Point } from '../viz/FlowDots';
import { link } from '../viz/geometry';
import { UiIcon } from '../viz/icons';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';
import './CqrsWidget.css';

const MS_PER_TICK = 100;
const TRAIL_TICKS = 4;
const STRIP_LENGTH = 30;
const LOG_WINDOW = 8;
const CARD_COUNT = 4;
const MAX_DOTS = 24;
const scenarioIds = Object.keys(cqrsScenarios) as CqrsScenarioId[];

const SHOPPER = { x: 70, y: 150 };
const WRITE = { x: 230, y: 150 };
const LOG = { x: 390, y: 150 };
const CART = { x: 620, y: 50 };
const REBUILD = { x: 620, y: 150 };
const TOP = { x: 620, y: 250 };
const EMAIL = { x: 390, y: 280 };

const toWrite = link(SHOPPER, WRITE);
const toLog = link(WRITE, LOG);
const toCart = link(LOG, CART);
const toRebuild = link(LOG, REBUILD);
const toTop = link(LOG, TOP);
const toEmail = link(LOG, EMAIL);

function curve(from: Point, to: Point, depth: number): { via: [number, number]; points: Point[] } {
  const via: [number, number] = [(from[0] + to[0]) / 2, from[1] + depth];
  const points = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6;
    const u = 1 - t;
    return [
      u * u * from[0] + 2 * u * t * via[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * via[1] + t * t * to[1],
    ] as const;
  });
  return { via, points };
}

const readPath = curve([564, 40], [70, 118], -40);
const readStart = readPath.points[0] as Point;
const readEnd = readPath.points[readPath.points.length - 1] as Point;

interface TrailEntry {
  tick: number;
  activity: CqrsActivity;
}

function buildFlows(trail: readonly TrailEntry[]): Flow[] {
  const flows: Flow[] = [];
  for (const { tick, activity } of trail) {
    activity.accepted.slice(0, 3).forEach((event, i) => {
      flows.push({
        id: `${tick}-w${event.seq}`,
        points: [toWrite.from, toWrite.to, toLog.from, toLog.to],
        tone: 'request',
        duration: 0.7,
        delay: i * 0.04,
      });
    });
    activity.rejected.slice(0, 2).forEach((_, i) => {
      flows.push({
        id: `${tick}-x${i}`,
        points: [toWrite.from, toWrite.to, toWrite.from],
        tone: 'bad',
        duration: 0.7,
        delay: i * 0.04,
      });
    });
    const consumers = [
      { key: 'c', applied: activity.cartApplied, path: toCart },
      { key: 'r', applied: activity.rebuildApplied, path: toRebuild },
      { key: 't', applied: activity.topApplied, path: toTop },
      { key: 'e', applied: activity.emailApplied, path: toEmail },
    ];
    for (const consumer of consumers) {
      if (consumer.applied === 0) continue;
      flows.push({
        id: `${tick}-${consumer.key}`,
        points: [consumer.path.from, consumer.path.to],
        tone: 'hit',
        duration: 0.5,
      });
    }
    activity.reads.slice(0, 2).forEach((read, i) => {
      flows.push({
        id: `${tick}-p${i}`,
        points: readPath.points,
        tone: read.wrong ? 'bad' : read.stale ? 'miss' : 'hit',
        duration: 0.8,
        delay: i * 0.06,
      });
    });
  }
  return flows.slice(-MAX_DOTS);
}

function nounCount(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function wrongCartsText(n: number): string {
  return `${nounCount(n, 'cart shows', 'carts show')} a wrong total`;
}

function lagText(position: number, appended: number, lag: Lag): string {
  if (lag.events === 0) return `applied ${position} of ${appended}, caught up`;
  return `applied ${position} of ${appended}, ${lag.events} behind, oldest waiting ${lag.ms} ms`;
}

function linesText(lines: Lines): string {
  const parts = ITEMS.filter((item) => (lines[item] ?? 0) > 0).map((item) => `${item} ×${lines[item] ?? 0}`);
  return parts.length > 0 ? parts.join(', ') : 'Empty';
}

function recentCarts(log: readonly CartEvent[], count: number): { cart: number; lastSeq: number }[] {
  const seen = new Map<number, number>();
  for (let i = log.length - 1; i >= 0 && seen.size < count; i -= 1) {
    const event = log[i];
    if (event && !seen.has(event.cart)) seen.set(event.cart, event.seq);
  }
  return [...seen].map(([cart, lastSeq]) => ({ cart, lastSeq })).sort((a, b) => a.cart - b.cart);
}

function cardStatus(model: CqrsModel, cart: number, lastSeq: number): { tone: Tone; text: string } {
  const page = model.cartPage.view[cart];
  if (!page) return { tone: 'warn', text: 'Not on the page yet' };
  if (model.cartPage.version === 'v1' && page.total !== model.cartTruth[cart]?.total) {
    return { tone: 'bad', text: 'Wrong total' };
  }
  if (model.cartPage.position < lastSeq) return { tone: 'warn', text: 'Behind' };
  return { tone: 'ok', text: 'Current' };
}

type CellState = 'done' | 'pending' | 'bad' | 'none';

function Cell({ state, text }: { state: CellState; text: string }) {
  return (
    <span className="sdv-cqrs__cell" data-state={state}>
      {state === 'done' && <UiIcon name="check" />}
      {state === 'bad' && <UiIcon name="bad" />}
      {state === 'pending' && <span className="sdv-cqrs__hatch" aria-hidden="true" />}
      {text}
    </span>
  );
}

interface Track {
  key: string;
  label: string;
  kind: 'queue' | 'db' | 'server';
  position: number;
  text: string;
}

function readText(read: CqrsRead): string {
  if (read.wrong) return `Cart ${read.cart}: wrong total`;
  if (read.stale) return `Cart ${read.cart}: stale, missing the change`;
  return `Cart ${read.cart}: fresh`;
}

export default function CqrsWidget({
  title = 'Commands in, events out, views behind',
  instructions = 'Pick a scenario, then press Play. Every scenario replays the same seeded shoppers.',
}: {
  title?: string;
  instructions?: string;
}) {
  const hydrated = useHydrated();
  const arrow = safeId(useId(), 'cqrs-arrow');
  const [scenarioId, setScenarioId] = useState<CqrsScenarioId>('normal');
  const simRef = useRef<CqrsModel | null>(null);
  simRef.current ??= new CqrsModel(cqrsScenarios[scenarioId]);
  const sim = () => simRef.current as CqrsModel;
  const trailRef = useRef<TrailEntry[]>([]);
  const readsRef = useRef<CqrsRead[]>([]);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const pushReads = (reads: readonly CqrsRead[]) => {
    if (reads.length === 0) return;
    readsRef.current = [...readsRef.current, ...reads].slice(-STRIP_LENGTH);
  };
  const restart = (id: CqrsScenarioId) => {
    simRef.current = new CqrsModel(cqrsScenarios[id]);
    trailRef.current = [];
    readsRef.current = [];
    rerender();
  };
  const onTick = () => {
    const model = sim();
    if (model.done) return;
    model.step();
    trailRef.current = [...trailRef.current, { tick: model.ticks, activity: model.activity }].slice(
      -TRAIL_TICKS,
    );
    pushReads(model.activity.reads);
    rerender();
  };
  const skipToEnd = () => {
    const model = sim();
    while (!model.done) {
      model.step();
      pushReads(model.activity.reads);
    }
    trailRef.current = [];
    rerender();
  };
  const chooseScenario = (id: CqrsScenarioId) => {
    setScenarioId(id);
    restart(id);
  };

  const m = sim();
  const st = m.stats;
  const isReplay = m.scenario.id === 'replay';
  const appended = m.log.length;
  const seconds = m.ticks * m.tickSeconds;
  const activity = m.activity;
  const version = m.cartPage.version;
  const rebuild = m.rebuild;
  const lags = m.lags;
  const wrongCarts = m.wrongCarts;
  const flows = buildFlows(trailRef.current);
  const reads = readsRef.current;

  const cartStatus =
    version === 'v1' && wrongCarts > 0
      ? 'bad'
      : lags.cart.events > 0
        ? 'warn'
        : m.ticks > 0
          ? 'ok'
          : undefined;
  const topStatus = lags.top.events >= TOP_BEHIND_MARK ? 'warn' : m.ticks > 0 ? 'ok' : undefined;
  const rebuildSublabel = rebuild
    ? `replaying ${rebuild.position} of ${appended}`
    : st.rebuildEndTick !== null
      ? 'swapped in'
      : `starts at ${m.scenario.config.deployAt ?? 0} s`;
  const commandsThisTick = activity.accepted.length + activity.rejected.length;

  const tracks: Track[] = [
    {
      key: 'log',
      label: 'Event log',
      kind: 'queue',
      position: appended,
      text: `${nounCount(appended, 'event', 'events')} appended`,
    },
    {
      key: 'cart',
      label: `Cart page ${version}`,
      kind: 'db',
      position: m.cartPage.position,
      text: lagText(m.cartPage.position, appended, lags.cart),
    },
  ];
  if (rebuild) {
    tracks.push({
      key: 'rebuild',
      label: 'v2 replay',
      kind: 'db',
      position: rebuild.position,
      text: lagText(rebuild.position, appended, lags.rebuild ?? { events: 0, ms: 0 }),
    });
  }
  tracks.push(
    {
      key: 'top',
      label: 'Top items',
      kind: 'db',
      position: m.topItems.position,
      text: lagText(m.topItems.position, appended, lags.top),
    },
    {
      key: 'email',
      label: 'Email sender',
      kind: 'server',
      position: m.emailPosition,
      text: lagText(m.emailPosition, appended, lags.email),
    },
  );
  const trackTotal = Math.max(1, m.totalEvents);

  const recent = m.log.slice(-LOG_WINDOW);
  const cards = recentCarts(m.log, CARD_COUNT);
  const topCounts = ITEMS.map((item) => m.topItems.view[item]);
  const topMax = Math.max(1, ...topCounts);

  const stats: StatRow[] = [
    { label: 'Commands sent', value: String(st.commands) },
    { label: 'Events appended', value: String(st.appended) },
    {
      label: 'Commands rejected',
      value: String(st.rejected),
      tone: st.rejected > 0 ? 'neutral' : undefined,
      note: st.rejected > 0 ? 'never reach the log' : undefined,
    },
    {
      label: 'Cart page position',
      value: `${m.cartPage.position} of ${appended}`,
      tone: m.ticks === 0 ? undefined : lags.cart.events > 0 ? 'warn' : 'ok',
      note: m.ticks === 0 ? undefined : lags.cart.events > 0 ? `${lags.cart.events} behind` : 'caught up',
    },
    {
      label: 'Top items position',
      value: `${m.topItems.position} of ${appended}`,
      tone: m.ticks === 0 ? undefined : lags.top.events > 0 ? 'warn' : 'ok',
      note: m.ticks === 0 ? undefined : lags.top.events > 0 ? `${lags.top.events} behind` : 'caught up',
    },
    { label: 'Stale page loads', value: `${st.staleReads} of ${st.reads}` },
  ];
  if (isReplay) {
    stats.push(
      {
        label: 'Carts with a wrong total',
        value: String(wrongCarts),
        tone: m.ticks === 0 ? undefined : wrongCarts > 0 ? 'bad' : 'ok',
        note: m.ticks === 0 ? undefined : wrongCarts > 0 ? 'v1 bug' : 'none',
      },
      { label: 'Page loads with a wrong total', value: `${st.wrongReads} of ${st.reads}` },
    );
  }
  stats.push({ label: 'Receipts mailed', value: String(st.emailsSent) });
  if (isReplay) stats.push({ label: 'Events replayed by v2', value: String(st.replayed) });

  const compareRows: CompareRow[] = [
    { label: 'Page loads', values: [st.reads, st.reads] },
    { label: 'Stale pages', values: [st.staleReads, 0], better: 'lower' },
    {
      label: 'Average extra wait (ms)',
      values: [0, st.reads > 0 ? Math.round((st.waitTicksTotal * MS_PER_TICK) / st.reads) : 0],
      better: 'lower',
    },
    { label: 'Worst wait (ms)', values: [0, st.waitTicksMax * MS_PER_TICK], better: 'lower' },
  ];

  const markers = m.transcript.filter((note) => note.marker);
  const notes = m.transcript.filter((note) => !note.marker);

  let summary =
    `${seconds.toFixed(1)} s of ${CQRS_SECONDS} s. ${nounCount(appended, 'event', 'events')} appended. ` +
    `Cart page at ${m.cartPage.position}, ${lags.cart.events} behind. ` +
    `Top items at ${m.topItems.position}, ${lags.top.events} behind. ` +
    `${st.staleReads} of ${st.reads} page loads stale.`;
  if (isReplay) {
    summary += ` ${wrongCartsText(wrongCarts)}.`;
    if (rebuild) summary += ` v2 has replayed ${nounCount(rebuild.position, 'event', 'events')}.`;
  }
  const chartSummary = isReplay
    ? `${wrongCartsText(wrongCarts)} now. v2 has replayed ${nounCount(st.replayed, 'event', 'events')} in total.`
    : `Peak lag so far: cart page ${st.peakCartLag} events, top items ${st.peakTopLag} events.`;
  const status = m.done
    ? ({ tone: 'ok', text: 'Run complete' } as const)
    : m.ticks === 0
      ? ({ tone: 'neutral', text: 'Ready' } as const)
      : ({ tone: 'neutral', text: `${seconds.toFixed(1)} s of ${CQRS_SECONDS} s` } as const);

  return (
    <MotionRoot>
      <SimulationShell
        title={title}
        instructions={instructions}
        onTick={onTick}
        onReset={() => restart(scenarioId)}
        summary={summary}
        status={status}
        finished={m.done}
        resetKey={scenarioId}
        controls={
          <div className="sdv-cqrs__extra">
            <button type="button" className="sdv-button" onClick={skipToEnd} disabled={!hydrated || m.done}>
              Skip to the end
            </button>
          </div>
        }
        readout={
          <>
            <StatTable rows={stats} />
            <CompareTable
              caption="Cart page loads, same run: read now or wait for my event"
              columns={['Read now', 'Wait for my event']}
              rows={compareRows}
            />
          </>
        }
      >
        <div className="sdv-cqrs">
          <ScenarioChips
            label="Scenario"
            value={scenarioId}
            options={scenarioIds.map((id) => ({
              value: id,
              label: cqrsScenarios[id].label,
              diff: cqrsScenarios[id].diff,
            }))}
            onChange={chooseScenario}
          />
          <DiagramScroll label="Scrollable diagram">
            <svg
              viewBox="0 0 720 340"
              role="img"
              aria-label={`The shopper sends commands to the write model, which appends events to the log. The cart page, the top items view${isReplay ? ', the v2 replay' : ''}, and the email sender each read the log at their own position. Page loads read the cart page.`}
            >
              <ArrowDefs id={arrow} />
              <Edge from={toWrite.from} to={toWrite.to} marker={arrow} active={commandsThisTick > 0} />
              <Edge from={toLog.from} to={toLog.to} marker={arrow} active={activity.accepted.length > 0} />
              <Edge from={toCart.from} to={toCart.to} marker={arrow} active={activity.cartApplied > 0} />
              {isReplay && (
                <Edge
                  from={toRebuild.from}
                  to={toRebuild.to}
                  marker={arrow}
                  active={activity.rebuildApplied > 0}
                />
              )}
              <Edge from={toTop.from} to={toTop.to} marker={arrow} active={activity.topApplied > 0} />
              <Edge from={toEmail.from} to={toEmail.to} marker={arrow} active={activity.emailApplied > 0} />
              <Edge
                from={[readStart[0], readStart[1]]}
                to={[readEnd[0], readEnd[1]]}
                via={readPath.via}
                marker={arrow}
                active={activity.reads.length > 0}
                dashed
              />
              <text className="sdv-chart__label" x={317} y={26} textAnchor="middle">
                page loads
              </text>
              <text className="sdv-chart__label" x={LOG.x} y={108} textAnchor="middle">
                {appended} events
              </text>
              <SystemNode
                kind="client"
                x={SHOPPER.x}
                y={SHOPPER.y}
                label="Shopper"
                sublabel={`${st.commands} commands`}
                highlight={commandsThisTick > 0}
              />
              <SystemNode
                kind="server"
                x={WRITE.x}
                y={WRITE.y}
                label="Write model"
                sublabel={`${st.rejected} rejected`}
                highlight={commandsThisTick > 0}
              />
              <SystemNode
                kind="queue"
                x={LOG.x}
                y={LOG.y}
                label="Event log"
                highlight={activity.accepted.length > 0}
              />
              <SystemNode
                kind="database"
                x={CART.x}
                y={CART.y}
                label={`Cart page ${version}`}
                sublabel={`at ${m.cartPage.position} of ${appended}`}
                status={cartStatus}
                highlight={activity.cartApplied > 0}
              />
              {isReplay && (
                <SystemNode
                  kind="database"
                  x={REBUILD.x}
                  y={REBUILD.y}
                  label="Cart page v2"
                  sublabel={rebuildSublabel}
                  highlight={rebuild !== null}
                  dim={rebuild === null}
                />
              )}
              <SystemNode
                kind="database"
                x={TOP.x}
                y={TOP.y}
                label="Top items"
                sublabel={`at ${m.topItems.position} of ${appended}`}
                status={topStatus}
                highlight={activity.topApplied > 0}
              />
              <SystemNode
                kind="server"
                x={EMAIL.x}
                y={EMAIL.y}
                label="Email sender"
                sublabel={`${st.emailsSent} receipts mailed`}
                highlight={activity.emailApplied > 0}
              />
              <FlowDots flows={flows} />
            </svg>
          </DiagramScroll>
          <ul className="sdv-cqrs__legend" aria-label="How to read the diagram">
            <li>
              <span className="sdv-cqrs__line" aria-hidden="true" /> Solid arrows: commands in, events out
            </li>
            <li>
              <span className="sdv-cqrs__line" data-dashed="" aria-hidden="true" /> Dashed arrow: page loads
              read the cart page
            </li>
          </ul>

          <ul className="sdv-cqrs__tracks" aria-label="Where each reader is in the event log">
            {tracks.map((track) => (
              <li key={track.key} className="sdv-cqrs__track" data-kind={track.kind}>
                <span className="sdv-cqrs__track-name">{track.label}</span>
                <span className="sdv-cqrs__track-bar" aria-hidden="true">
                  <span
                    className="sdv-cqrs__track-applied"
                    style={{ width: `${(track.position / trackTotal) * 100}%` }}
                  />
                  <span
                    className="sdv-cqrs__track-gap"
                    style={{ width: `${(Math.max(0, appended - track.position) / trackTotal) * 100}%` }}
                  />
                </span>
                <span className="sdv-cqrs__track-text">{track.text}</span>
              </li>
            ))}
          </ul>
          <ul className="sdv-cqrs__legend" aria-label="How to read the tracks">
            <li>
              <span className="sdv-cqrs__swatch" aria-hidden="true" /> Applied
            </li>
            <li>
              <span className="sdv-cqrs__hatch" aria-hidden="true" /> In the log, still pending (lag)
            </li>
            <li>The full track is the whole run: {m.totalEvents} events</li>
          </ul>

          <div className="sdv-cqrs__views">
            <section className="sdv-cqrs__panel" aria-labelledby={`${arrow}-cards`}>
              <h4 className="sdv-cqrs__heading" id={`${arrow}-cards`}>
                Cart pages ({version}) next to the write model
              </h4>
              {cards.length === 0 ? (
                <p className="sdv-cqrs__empty">Carts appear here once shoppers start.</p>
              ) : (
                <ul className="sdv-cqrs__cards">
                  {cards.map(({ cart, lastSeq }) => {
                    const page = m.cartPage.view[cart];
                    const write = m.writeState[cart];
                    const badge = cardStatus(m, cart, lastSeq);
                    return (
                      <li key={cart} className="sdv-cqrs__card" data-tone={badge.tone}>
                        <p className="sdv-cqrs__card-title">
                          <span>Cart {cart}</span>
                          <span className="sdv-visually-hidden">, </span>
                          <ToneBadge tone={badge.tone}>{badge.text}</ToneBadge>
                          {write?.checkedOut && (
                            <>
                              <span className="sdv-visually-hidden">, </span>
                              <ToneBadge tone="neutral">Checked out</ToneBadge>
                            </>
                          )}
                        </p>
                        <p className="sdv-cqrs__lines">{page ? linesText(page.lines) : 'Not shown yet'}</p>
                        <dl className="sdv-cqrs__totals">
                          <div>
                            <dt>Page total</dt>
                            <dd>{page ? `$${page.total}` : 'none yet'}</dd>
                          </div>
                          <div>
                            <dt>Write model</dt>
                            <dd>${write ? cartTotal(write.lines) : 0}</dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className="sdv-cqrs__panel" aria-labelledby={`${arrow}-top`}>
              <h4 className="sdv-cqrs__heading" id={`${arrow}-top`}>
                Top items view at {m.topItems.position} of {appended}
              </h4>
              <LoadBars
                label="Top items view (times added to a cart)"
                bars={ITEMS.map((item, index) => ({
                  id: item,
                  label: item,
                  fill: (topCounts[index] ?? 0) / topMax,
                  value: `${topCounts[index] ?? 0} added`,
                }))}
                flagFull={false}
              />
            </section>
          </div>

          <div className="sdv-strip">
            <p className="sdv-strip__label" id={`${arrow}-strip`}>
              Last {STRIP_LENGTH} cart page loads, each right after the shopper's own command
            </p>
            <ol className="sdv-strip__items" aria-labelledby={`${arrow}-strip`}>
              {reads.map((read, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: position in a rolling window
                  key={index}
                  className={
                    read.wrong ? 'sdv-strip__bad' : read.stale ? 'sdv-strip__miss' : 'sdv-strip__hit'
                  }
                  title={readText(read)}
                >
                  <span className="sdv-visually-hidden">{readText(read)}</span>
                </li>
              ))}
            </ol>
            <ul className="sdv-legend" aria-label="Legend">
              <li>
                <span className="sdv-strip__hit" aria-hidden="true" /> Fresh
              </li>
              <li>
                <span className="sdv-strip__miss" aria-hidden="true" /> Stale: missing your change
              </li>
              {isReplay && (
                <li>
                  <span className="sdv-strip__bad" aria-hidden="true" /> Wrong total
                </li>
              )}
            </ul>
          </div>

          <DiagramScroll label="Latest events, scrollable">
            <table className="sdv-cqrs__events">
              <caption>Latest events in the log, and which readers have applied each one</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Event</th>
                  <th scope="col">Cart page {version}</th>
                  {rebuild && <th scope="col">v2 replay</th>}
                  <th scope="col">Top items</th>
                  <th scope="col">Email sender</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={rebuild ? 6 : 5}>No events yet. Press Play.</td>
                  </tr>
                ) : (
                  recent.map((event) => {
                    const cartState: CellState =
                      m.cartPage.position < event.seq
                        ? 'pending'
                        : version === 'v1' && event.type === 'ItemRemoved'
                          ? 'bad'
                          : 'done';
                    const topApplied = m.topItems.position >= event.seq;
                    const emailApplied = m.emailPosition >= event.seq;
                    return (
                      <tr key={event.seq}>
                        <th scope="row">{event.seq}</th>
                        <td>{factText(event)}</td>
                        <td>
                          <Cell
                            state={cartState}
                            text={
                              cartState === 'pending'
                                ? 'pending'
                                : cartState === 'bad'
                                  ? 'skipped by bug'
                                  : 'applied'
                            }
                          />
                        </td>
                        {rebuild && (
                          <td>
                            {rebuild.position >= event.seq ? (
                              <Cell state="done" text="applied" />
                            ) : (
                              <Cell state="pending" text="pending" />
                            )}
                          </td>
                        )}
                        <td>
                          {!topApplied ? (
                            <Cell state="pending" text="pending" />
                          ) : event.type === 'ItemAdded' ? (
                            <Cell state="done" text="counted" />
                          ) : (
                            <Cell state="none" text="read, no change" />
                          )}
                        </td>
                        <td>
                          {event.type !== 'CheckedOut' ? (
                            <Cell state="none" text="no email" />
                          ) : emailApplied ? (
                            <Cell state="done" text="receipt sent" />
                          ) : (
                            <Cell state="pending" text="receipt pending" />
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </DiagramScroll>

          <TraceChart
            title={isReplay ? 'Wrong totals and replay progress' : 'How far behind each read model is'}
            series={
              isReplay
                ? [
                    { label: 'Carts showing a wrong total', values: [...m.series.a], variant: 'a' },
                    { label: 'Events v2 still has to replay', values: [...m.series.b], variant: 'b' },
                  ]
                : [
                    { label: 'Cart page lag (events)', values: [...m.series.a], variant: 'a' },
                    { label: 'Top items lag (events)', values: [...m.series.b], variant: 'b' },
                  ]
            }
            length={m.length}
            tickSeconds={m.tickSeconds}
            markers={markers.map((note, index) => ({ tick: note.tick, number: index + 1 }))}
            minMax={10}
            summary={chartSummary}
          />
          <div className="sdv-trace__log">
            <p className="sdv-trace__log-title">What happened</p>
            {markers.length === 0 && notes.length === 0 && (
              <p className="sdv-trace__empty">
                Events appear here, numbered to match the chart, as the run plays.
              </p>
            )}
            {markers.length > 0 && (
              <ol>
                {markers.map((note, index) => (
                  <li key={`${note.tick}-${note.text}`}>
                    <span className="sdv-trace__num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <time>{(note.tick * m.tickSeconds).toFixed(1)} s</time> {note.text}
                  </li>
                ))}
              </ol>
            )}
            {notes.map((note) => (
              <p key={`${note.tick}-${note.text}`} className="sdv-trace__note">
                {note.text}
              </p>
            ))}
          </div>
        </div>
      </SimulationShell>
    </MotionRoot>
  );
}
