import { m } from 'motion/react';
import { type ComponentProps, useEffect, useId, useRef, useState } from 'react';
import { findLesson } from '../../data/curriculum';
import {
  canReview,
  EVENTS,
  eventsSoFar,
  FIXES,
  type FixId,
  type FixResult,
  FLAW_COUNT,
  fixResult,
  flagCount,
  ITEM_COUNT,
  initialReview,
  isFlagged,
  itemAt,
  type LessonRef,
  pause,
  pickAt,
  pickFix,
  play,
  REPLAY_MINUTES,
  REVIEW_ITEMS,
  type ReplayEvent,
  type ReviewState,
  reveal,
  reviewScore,
  stepToNextEvent,
  tick,
  toggleFlag,
  type Verdict,
  verdict,
} from '../../lib/models/designReview';
import { lessonHref } from '../../lib/paths';
import { Toggle } from '../sim/controls';
import { MotionRoot } from '../sim/MotionRoot';
import type { StatRow, Tone } from '../sim/StatTable';
import { useHydrated } from '../sim/useHydrated';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { useTicker } from '../sim/useTicker';
import { WidgetFrame } from '../sim/WidgetFrame';
import { DiagramScroll } from '../viz/DiagramScroll';
import { link } from '../viz/geometry';
import { StatusBadge, UiIcon } from '../viz/icons';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';
import './DesignReviewWidget.css';

type NodeKind = ComponentProps<typeof SystemNode>['kind'];

interface DiagramNode {
  key: string;
  kind: NodeKind;
  x: number;
  y: number;
  label: string;
  sublabel: string;
  item: number | null;
}

const NODES: readonly DiagramNode[] = [
  { key: 'shoppers', kind: 'client', x: 72, y: 200, label: 'Shoppers', sublabel: 'flash sale', item: null },
  { key: 'cdn', kind: 'cdn', x: 236, y: 70, label: 'CDN', sublabel: 'images, scripts', item: 7 },
  { key: 'cache', kind: 'cache', x: 404, y: 70, label: 'Product cache', sublabel: 'pages, prices', item: 2 },
  { key: 'replica', kind: 'database', x: 572, y: 70, label: 'Read replica', sublabel: 'reports', item: 8 },
  {
    key: 'lb',
    kind: 'loadBalancer',
    x: 236,
    y: 200,
    label: 'Load balancer',
    sublabel: '1 instance',
    item: 0,
  },
  { key: 'web', kind: 'server', x: 404, y: 200, label: 'Web tier', sublabel: '3 servers', item: 1 },
  {
    key: 'shards',
    kind: 'database',
    x: 572,
    y: 200,
    label: 'Order shards',
    sublabel: '8 shards',
    item: null,
  },
  { key: 'payments', kind: 'server', x: 236, y: 330, label: 'Payments', sublabel: 'provider', item: null },
  { key: 'checkout', kind: 'server', x: 404, y: 330, label: 'Checkout', sublabel: 'orders', item: 6 },
  { key: 'queue', kind: 'queue', x: 572, y: 330, label: 'Event queue', sublabel: 'in memory', item: 5 },
];

const NODE_BY_KEY = new Map(NODES.map((node) => [node.key, node]));

const EDGES: readonly (readonly [string, string])[] = [
  ['shoppers', 'cdn'],
  ['shoppers', 'lb'],
  ['lb', 'web'],
  ['web', 'cache'],
  ['web', 'shards'],
  ['web', 'checkout'],
  ['checkout', 'payments'],
  ['checkout', 'shards'],
  ['checkout', 'queue'],
  ['shards', 'replica'],
];

/** Some edges shift sideways so they clear sublabels and each other's endpoints. */
const EDGE_SHIFT = new Map([
  ['web-cache', 44],
  ['web-checkout', 44],
  ['checkout-shards', 20],
  ['shards-replica', 44],
]);

interface EdgeMarker {
  item: number;
  x: number;
  y: number;
  edge: string;
  flagBelow: boolean;
}

/** Review items that live on a connection rather than on a component. */
const EDGE_MARKERS: readonly EdgeMarker[] = [
  { item: 3, x: 488, y: 182, edge: 'web-shards', flagBelow: false },
  { item: 9, x: 488, y: 218, edge: 'web-shards', flagBelow: true },
  { item: 4, x: 320, y: 312, edge: 'checkout-payments', flagBelow: false },
];

const AXIS = { x0: 40, x1: 604, y: 430 };
const VIEW_HEIGHT = 464;

const FIX_LABEL = new Map<FixId, string>(FIXES.map((fix) => [fix.id, fix.label]));

const VERDICT_VIEW: Record<Verdict, { icon: 'ok' | 'bad' | 'warn' | 'check'; word: string; tone: Tone }> = {
  found: { icon: 'ok', word: 'Found', tone: 'ok' },
  missed: { icon: 'bad', word: 'Missed', tone: 'bad' },
  'false-alarm': { icon: 'warn', word: 'False alarm', tone: 'warn' },
  cleared: { icon: 'check', word: 'Correctly left alone', tone: 'ok' },
};

const DIAGRAM_LABEL =
  'Flash sale design. Shoppers fetch images and scripts from a CDN and send page requests to one load ' +
  'balancer, which spreads them across the web tier. The web tier reads a product cache and 8 order ' +
  'shards and hands orders to checkout. Checkout calls the payment provider, writes its order shard, and ' +
  'publishes events to an event queue. The order shards replicate to read replicas for reports. Numbered ' +
  'markers match the review items listed below, and the timeline at the bottom tracks the replay.';

function minuteX(minute: number): number {
  return AXIS.x0 + (minute / REPLAY_MINUTES) * (AXIS.x1 - AXIS.x0);
}

function itemKey(index: number): string {
  return String((index + 1) % 10);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function flagNote(event: ReplayEvent, flagged: boolean): string {
  if (event.kind === 'incident') return flagged ? 'You flagged this.' : 'You missed this.';
  return flagged ? 'You flagged this, and it held.' : 'You left this alone, and it held.';
}

function pickFeedback(result: FixResult): string {
  switch (result.kind) {
    case 'match':
      return 'It matches the reference fix.';
    case 'none':
      return 'You flagged it without choosing a fix.';
    case 'not-needed':
      return 'This part holds up, so it needs no fix.';
    case 'mismatch':
      return result.reason;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'radio' && target.type !== 'checkbox';
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 21V4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M6 4h11l-3 4.5l3 4.5H6z" fill="currentColor" />
    </svg>
  );
}

function KindChip({ kind }: { kind: ReplayEvent['kind'] }) {
  return kind === 'incident' ? (
    <span className="sdv-review__chip sdv-review__chip--bad">
      <UiIcon name="bad" /> Incident
    </span>
  ) : (
    <span className="sdv-review__chip sdv-review__chip--ok">
      <UiIcon name="ok" /> Held
    </span>
  );
}

function LessonName({ lesson }: { lesson: LessonRef }) {
  if (findLesson(lesson.id)) {
    return <a href={lessonHref(lesson.id)}>{lesson.title}</a>;
  }
  return <>{lesson.title}</>;
}

function ItemMarker({
  index,
  x,
  y,
  flagged,
  flaw,
  flagBelow,
}: {
  index: number;
  x: number;
  y: number;
  flagged: boolean;
  flaw: boolean;
  flagBelow: boolean;
}) {
  const top = flagBelow ? y + 14 : y - 30;
  const bottom = flagBelow ? y + 32 : y - 12;
  const pole = x - 6;
  return (
    <g className={`sdv-review__marker${flagged ? ' is-flagged' : ''}${flaw ? ' is-flaw' : ''}`}>
      {flaw ? <rect x={x - 12} y={y - 12} width={24} height={24} rx={3} /> : <circle cx={x} cy={y} r={12} />}
      <text x={x} y={y} dy="0.35em" textAnchor="middle">
        {index + 1}
      </text>
      {flagged ? (
        <>
          <line className="sdv-review__pole" x1={pole} y1={top} x2={pole} y2={bottom} />
          <path
            className="sdv-review__pennant"
            d={`M${pole} ${top}L${pole + 12} ${top + 4}L${pole} ${top + 8}Z`}
          />
        </>
      ) : null}
    </g>
  );
}

export default function DesignReviewWidget() {
  const [state, setState] = useState<ReviewState>(initialReview);
  const [showQuestions, setShowQuestions] = useState(false);
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);
  const baseId = useId();
  const arrowId = safeId(baseId, 'review-arrow');
  const transcriptId = `${baseId}-transcript`;

  useTicker(state.phase === 'replaying', 2, () => setState((current) => tick(current)), rootRef);

  useEffect(() => {
    if (state.phase !== 'revealed' || !focusResults.current) return;
    focusResults.current = false;
    const frame = requestAnimationFrame(() => resultsRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [state.phase]);

  const { phase } = state;
  const flagging = phase === 'flagging';
  const revealed = phase === 'revealed';
  const canRun = phase === 'replaying' || phase === 'paused' || canReview(state);
  const flags = flagCount(state);
  const events = eventsSoFar(state);
  const latest = revealed ? null : (events.at(-1) ?? null);
  const currentItem = latest?.item ?? null;
  const firedKind = new Map(events.map((event) => [event.item, event.kind]));
  const score = reviewScore(state);
  const currentEdge = EDGE_MARKERS.find((marker) => marker.item === currentItem)?.edge ?? null;

  const onToggle = (index: number) => {
    if (!flagging) return;
    setState((current) => toggleFlag(current, index));
  };
  const onPick = (index: number, value: string) => {
    const fix = FIXES.find((entry) => entry.id === value)?.id ?? null;
    setState((current) => pickFix(current, index, fix));
  };
  const onPlayPause = () => {
    if (!canRun) return;
    setState((current) => (current.phase === 'replaying' ? pause(current) : play(current)));
  };
  const onStep = () => {
    if (!canRun) return;
    const next = stepToNextEvent(state);
    if (next.phase === 'revealed') focusResults.current = true;
    setState(next);
  };
  const onReveal = () => {
    if (!canRun) return;
    focusResults.current = true;
    setState((current) => reveal(current));
  };
  const onReset = () => {
    focusResults.current = false;
    setState(initialReview());
  };

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (/^[0-9]$/.test(key)) {
      if (!flagging) return;
      event.preventDefault();
      onToggle(key === '0' ? 9 : Number(key) - 1);
    } else if (key === 'p' && canRun) {
      event.preventDefault();
      onPlayPause();
    } else if (key === 'n' && canRun) {
      event.preventDefault();
      onStep();
    }
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }, []);

  const incidents = events.filter((event) => event.kind === 'incident').length;
  const held = events.length - incidents;
  const scoreSentence =
    `You found ${score.found} of ${FLAW_COUNT} flaws, with ${plural(score.falseAlarms, 'false alarm')}. ` +
    `Your fixes match ${score.fixesMatched} of the ${FLAW_COUNT} reference fixes.`;

  let summary: string;
  if (flagging) {
    summary = flags === 0 ? 'No items flagged yet.' : `${flags} of ${ITEM_COUNT} items flagged.`;
  } else if (revealed) {
    summary = `Answers revealed. ${scoreSentence}`;
  } else {
    const prefix = phase === 'paused' ? `Paused at minute ${state.minute}. ` : '';
    summary = latest
      ? `${prefix}Minute ${latest.minute}, ${itemAt(latest.item).label}: ${latest.text} ${flagNote(latest, isFlagged(state, latest.item))}`
      : `${prefix}The sale is live. Nothing has failed yet.`;
  }

  const stats: StatRow[] = [
    { label: 'Flags placed', value: `${flags} of ${ITEM_COUNT}` },
    { label: 'Replay minute', value: `${state.minute} of ${REPLAY_MINUTES}`, note: 'Illustrative' },
    { label: 'Incidents so far', value: String(incidents), tone: incidents > 0 ? 'bad' : 'neutral' },
    { label: 'Held so far', value: String(held), tone: held > 0 ? 'ok' : 'neutral' },
  ];
  if (revealed) {
    stats.push(
      {
        label: 'Flaws found',
        value: `${score.found} of ${FLAW_COUNT}`,
        tone: score.found === FLAW_COUNT ? 'ok' : 'warn',
      },
      { label: 'Missed', value: String(score.missed), tone: score.missed > 0 ? 'bad' : 'ok' },
      {
        label: 'False alarms',
        value: String(score.falseAlarms),
        tone: score.falseAlarms > 0 ? 'warn' : 'ok',
      },
      { label: 'Fixes matched', value: `${score.fixesMatched} of ${FLAW_COUNT}` },
    );
  }

  let status: { tone: Tone; text: string };
  if (flagging)
    status = { tone: 'neutral', text: flags === 0 ? 'Flag what looks wrong' : `${flags} flagged` };
  else if (phase === 'replaying') status = { tone: 'warn', text: 'Replaying' };
  else if (phase === 'paused') status = { tone: 'neutral', text: `Paused at minute ${state.minute}` };
  else
    status = {
      tone: score.found === FLAW_COUNT && score.falseAlarms === 0 ? 'ok' : 'warn',
      text: `${score.found} of ${FLAW_COUNT} found`,
    };

  const cursorX = minuteX(state.minute);

  return (
    <div ref={rootRef} className="sdv-review-root">
      <MotionRoot>
        <WidgetFrame
          title="Review the flash sale design"
          instructions="Flag every part you expect to fail during the sale and pick a fix for each flag. Then play the first hour and see what breaks. Keys: 1 to 9 and 0 flag items, P plays or pauses, N jumps to the next event."
          summary={summary}
          stats={stats}
          status={status}
          statsCaption="Review readout"
        >
          <div className="sdv-review">
            <DiagramScroll label="Scrollable diagram">
              <svg viewBox={`0 0 644 ${VIEW_HEIGHT}`} role="img" aria-label={DIAGRAM_LABEL}>
                <ArrowDefs id={arrowId} />
                {EDGES.map(([from, to]) => {
                  const a = NODE_BY_KEY.get(from);
                  const b = NODE_BY_KEY.get(to);
                  if (!a || !b) return null;
                  const line = link(a, b);
                  const shift = EDGE_SHIFT.get(`${from}-${to}`) ?? 0;
                  return (
                    <Edge
                      key={`${from}-${to}`}
                      from={[line.from[0] + shift, line.from[1]]}
                      to={[line.to[0] + shift, line.to[1]]}
                      marker={arrowId}
                      active={currentEdge === `${from}-${to}`}
                    />
                  );
                })}
                {NODES.map((node) => {
                  const kind = node.item === null ? undefined : firedKind.get(node.item);
                  return (
                    <SystemNode
                      key={node.key}
                      kind={node.kind}
                      x={node.x}
                      y={node.y}
                      label={node.label}
                      sublabel={node.sublabel}
                      status={kind === 'incident' ? 'bad' : kind === 'held' ? 'ok' : undefined}
                      highlight={node.item !== null && node.item === currentItem}
                      dim={false}
                    />
                  );
                })}
                {EDGE_MARKERS.map((marker) => {
                  const kind = firedKind.get(marker.item);
                  return kind ? (
                    <StatusBadge
                      key={`badge-${marker.item}`}
                      status={kind === 'incident' ? 'bad' : 'ok'}
                      x={marker.x + 20}
                      y={marker.y}
                    />
                  ) : null;
                })}
                {NODES.map((node) =>
                  node.item === null ? null : (
                    <ItemMarker
                      key={`marker-${node.key}`}
                      index={node.item}
                      x={node.x - 50}
                      y={node.y - 30}
                      flagged={isFlagged(state, node.item)}
                      flaw={revealed && itemAt(node.item).isFlaw}
                      flagBelow={false}
                    />
                  ),
                )}
                {EDGE_MARKERS.map((marker) => (
                  <ItemMarker
                    key={`marker-edge-${marker.item}`}
                    index={marker.item}
                    x={marker.x}
                    y={marker.y}
                    flagged={isFlagged(state, marker.item)}
                    flaw={revealed && itemAt(marker.item).isFlaw}
                    flagBelow={marker.flagBelow}
                  />
                ))}
                <line className="sdv-review__axis" x1={AXIS.x0} y1={AXIS.y} x2={AXIS.x1} y2={AXIS.y} />
                {EVENTS.map((event) => {
                  const x = minuteX(event.minute);
                  const fired = event.minute <= state.minute && !flagging;
                  return (
                    <g key={event.minute}>
                      <text className="sdv-chart__label" x={x} y={AXIS.y - 16} textAnchor="middle">
                        {event.item + 1}
                      </text>
                      {fired && event.kind === 'incident' ? (
                        <rect
                          className="sdv-review__mark--incident"
                          x={x - 6}
                          y={AXIS.y - 6}
                          width={12}
                          height={12}
                        />
                      ) : (
                        <circle
                          className={fired ? 'sdv-review__mark--held' : 'sdv-review__mark--pending'}
                          cx={x}
                          cy={AXIS.y}
                          r={6}
                        />
                      )}
                    </g>
                  );
                })}
                <m.line
                  className="sdv-review__cursor"
                  y1={AXIS.y - 11}
                  y2={AXIS.y + 11}
                  initial={false}
                  animate={{ x1: cursorX, x2: cursorX }}
                  transition={{ duration: reduced ? 0 : 0.45, ease: 'linear' }}
                />
                <text className="sdv-chart__label" x={AXIS.x0} y={AXIS.y + 26} textAnchor="start">
                  0 min
                </text>
                <text className="sdv-chart__label" x={322} y={AXIS.y + 26} textAnchor="middle">
                  First hour of the sale (illustrative toy replay)
                </text>
                <text className="sdv-chart__label" x={AXIS.x1} y={AXIS.y + 26} textAnchor="end">
                  {REPLAY_MINUTES} min
                </text>
              </svg>
            </DiagramScroll>

            <ul className="sdv-legend sdv-review__legend" aria-label="Legend">
              <li>
                <span className="sdv-review__key sdv-review__key--item" aria-hidden="true">
                  1
                </span>
                Review item, matching a card below
              </li>
              <li>
                <span className="sdv-review__key sdv-review__key--flag" aria-hidden="true">
                  <FlagIcon />
                </span>
                Flagged by you
              </li>
              <li>
                <span className="sdv-review__key sdv-review__key--incident" aria-hidden="true" />
                Square: incident during the replay
              </li>
              <li>
                <span className="sdv-review__key sdv-review__key--held" aria-hidden="true" />
                Circle: held under load
              </li>
            </ul>

            {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form section */}
            <div className="sdv-sim__toolbar sdv-review__toolbar" role="group" aria-label="Replay actions">
              <button
                type="button"
                className="sdv-button sdv-button--primary"
                disabled={!hydrated}
                aria-disabled={!canRun}
                aria-keyshortcuts="P"
                onClick={onPlayPause}
              >
                <UiIcon name={phase === 'replaying' ? 'pause' : 'play'} />
                {phase === 'replaying' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Play replay'}
              </button>
              <button
                type="button"
                className="sdv-button"
                disabled={!hydrated}
                aria-disabled={!canRun}
                aria-keyshortcuts="N"
                onClick={onStep}
              >
                <UiIcon name="step" />
                Next event
              </button>
              <button
                type="button"
                className="sdv-button"
                disabled={!hydrated}
                aria-disabled={!canRun}
                onClick={onReveal}
              >
                <UiIcon name="check" />
                Reveal answers
              </button>
              <button type="button" className="sdv-button" disabled={!hydrated} onClick={onReset}>
                <UiIcon name="reset" />
                Reset
              </button>
            </div>

            <div className="sdv-review__now">
              {flagging ? (
                <p>
                  {flags === 0
                    ? 'Flag at least one item to start the replay. Press 1 to 9 or 0, or use the Flag buttons below.'
                    : `${plural(flags, 'item')} flagged. Pick a fix for each flag, then press Play replay.`}
                </p>
              ) : revealed ? (
                <p>
                  The replay is over. Each card below now shows its verdict, the fix, and where to learn it.
                </p>
              ) : latest ? (
                <p>
                  <KindChip kind={latest.kind} /> <strong>Minute {latest.minute}</strong>, item{' '}
                  {latest.item + 1}, {itemAt(latest.item).label}: {latest.text}{' '}
                  {flagNote(latest, isFlagged(state, latest.item))}
                </p>
              ) : (
                <p>
                  <strong>Minute {state.minute}</strong>. The sale is live and nothing has failed yet.
                </p>
              )}
            </div>

            {revealed ? (
              <div className="sdv-review__results">
                <h4 ref={resultsRef} tabIndex={-1}>
                  Review results
                </h4>
                <p>{scoreSentence}</p>
                <p>Read each card for the explanation, the fix, and the lesson that teaches it.</p>
              </div>
            ) : null}

            <Toggle label="Show review questions" checked={showQuestions} onChange={setShowQuestions} />

            <ol className="sdv-review__items" aria-label="Review items">
              {REVIEW_ITEMS.map((item, index) => {
                const flagged = isFlagged(state, index);
                const pick = pickAt(state, index);
                const key = itemKey(index);
                const result = revealed ? verdict(state, index) : null;
                const view = result ? VERDICT_VIEW[result] : null;
                const selectId = `${baseId}-fix-${index}`;
                const classes = ['sdv-review__item'];
                if (flagged) classes.push('is-flagged');
                if (index === currentItem) classes.push('is-current');
                if (result) classes.push(`sdv-review__item--${result}`);
                if (revealed && item.isFlaw) classes.push('is-flaw');
                return (
                  <li key={item.id} className={classes.join(' ')}>
                    <div className="sdv-review__head">
                      <span className="sdv-review__num" aria-hidden="true">
                        {index + 1}
                      </span>
                      <p className="sdv-review__name">
                        <strong>{item.label}</strong>
                      </p>
                      {flagged ? (
                        <span className="sdv-review__tag" aria-hidden="true">
                          <FlagIcon />
                          Flagged
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="sdv-button sdv-review__flag"
                        disabled={!hydrated}
                        aria-disabled={!flagging}
                        aria-pressed={flagged}
                        aria-keyshortcuts={key}
                        aria-label={`Flag ${key}, ${item.label}`}
                        onClick={() => onToggle(index)}
                      >
                        <FlagIcon />
                        Flag <kbd>{key}</kbd>
                      </button>
                    </div>
                    <p className="sdv-review__note">{item.note}</p>
                    {showQuestions ? (
                      <p className="sdv-review__question">
                        <span className="sdv-review__lens">{item.lens}:</span> {item.question}
                      </p>
                    ) : null}
                    {flagging && flagged ? (
                      <div className="sdv-review__fix">
                        <label htmlFor={selectId}>
                          Proposed fix<span className="sdv-visually-hidden"> for {item.label}</span>
                        </label>
                        <select
                          id={selectId}
                          value={pick ?? ''}
                          disabled={!hydrated}
                          onChange={(event) => onPick(index, event.currentTarget.value)}
                        >
                          <option value="">Choose a fix</option>
                          {FIXES.map((fix) => (
                            <option key={fix.id} value={fix.id}>
                              {fix.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {!flagging && flagged ? (
                      <p className="sdv-review__your-fix">
                        <strong>Your fix:</strong> {pick ? FIX_LABEL.get(pick) : 'none chosen'}.
                        {revealed ? ` ${pickFeedback(fixResult(index, pick))}` : ''}
                      </p>
                    ) : null}
                    {view ? (
                      <div className="sdv-review__answer">
                        <p className={`sdv-review__chip sdv-review__chip--${view.tone}`}>
                          <UiIcon name={view.icon} /> {view.word}
                        </p>
                        <p className="sdv-review__verdict-name">
                          <strong>{item.verdictName}</strong>
                        </p>
                        <p>{item.explanation}</p>
                        {item.fixDetail ? (
                          <p>
                            <strong>Fix:</strong> {item.fixDetail}
                          </p>
                        ) : null}
                        {item.lesson ? (
                          <p>
                            <strong>Learn it:</strong> <LessonName lesson={item.lesson} />
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            <div className="sdv-review__transcript">
              <p className="sdv-review__eyebrow" id={transcriptId}>
                Replay transcript
              </p>
              {events.length === 0 ? (
                <p>No events yet. Play the replay or press Next event to fill this log.</p>
              ) : (
                <ol aria-labelledby={transcriptId}>
                  {events.map((event) => (
                    <li key={event.minute}>
                      <KindChip kind={event.kind} /> <strong>Minute {event.minute}</strong>, item{' '}
                      {event.item + 1}, {itemAt(event.item).label}: {event.text}{' '}
                      {flagNote(event, isFlagged(state, event.item))}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </WidgetFrame>
      </MotionRoot>
    </div>
  );
}
