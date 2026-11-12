import { type ReactNode, useId, useRef } from 'react';
import { FENCE_RUN_S, type FenceLane, type FenceMark, type FenceScenario } from '../../lib/models/fencing';
import { SeriesSwatch, type SeriesVariant } from '../sim/TraceChart';
import { useElementWidth } from '../sim/useElementWidth';
import { textWidth } from '../viz/geometry';
import { safeId } from '../viz/SystemNode';

type StaleMark = Extract<FenceMark, { kind: 'stale' }>;
type GrantMark = Extract<FenceMark, { kind: 'grant' }>;

const FONT = 11;
const LABEL_W = 88;
const PAD_RIGHT = 10;
const TOP_BAND = 16;
const ROW_H = 26;
const AXIS_H = 20;
const ROWS = ['Server A', 'Server B', 'Lease service', 'Chat log'] as const;
const HEIGHT = TOP_BAND + ROWS.length * ROW_H + AXIS_H;
const AXIS_STEP_S = 5;

const rowTop = (row: number) => TOP_BAND + row * ROW_H;
const rowText = (row: number) => rowTop(row) + 10;
const rowMid = (row: number) => rowTop(row) + 18;

function fmt(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

function staleLabel(marks: StaleMark[]): string {
  const first = marks[0];
  if (!first) return '';
  const count = marks.length > 1 ? `${marks.length} ` : '';
  return first.accepted
    ? `${count}accepted, token ${first.token}`
    : `${count}rejected, token ${first.token} < ${first.newest}`;
}

/** Plain sentence for screen readers; the transcript below carries the full story. */
export function describeTimeLane(lane: FenceLane, scenario: FenceScenario): string {
  const parts: string[] = [`${lane.label}, 0 to ${FENCE_RUN_S} s.`];
  if (scenario.pause) {
    parts.push(
      `Server A pauses from ${fmt(scenario.pause.at)} to ${fmt(scenario.pause.at + scenario.pause.seconds)}.`,
    );
  }
  if (scenario.slowLink) parts.push(`Server A's link slows from ${fmt(scenario.slowLink.from)}.`);
  if (scenario.lockLinkLostAt !== undefined) {
    parts.push(`Server A loses the lock service at ${fmt(scenario.lockLinkLostAt)}.`);
  }
  for (const mark of lane.marks) {
    if (mark.kind === 'expire')
      parts.push(`The lease service expires token ${mark.token} at ${fmt(mark.t)}.`);
    if (mark.kind === 'grant' && mark.server === 'B') {
      parts.push(`Server B takes token ${mark.token} at ${fmt(mark.t)}.`);
    }
  }
  const stale = lane.marks.filter((mark): mark is StaleMark => mark.kind === 'stale');
  const first = stale[0];
  if (first) {
    const verb = first.accepted ? 'accepts' : 'rejects';
    const writes = stale.length === 1 ? 'a stale write' : `${stale.length} stale writes`;
    parts.push(`The chat log ${verb} ${writes} with token ${first.token}, first at ${fmt(first.t)}.`);
  } else {
    parts.push('No stale write reaches the chat log.');
  }
  return parts.join(' ');
}

function LaneChart({
  lane,
  scenario,
  variant,
  now,
  stepping,
}: {
  lane: FenceLane;
  scenario: FenceScenario;
  variant: SeriesVariant;
  now: number;
  stepping: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hatchId = safeId(useId(), 'fence-hatch');
  const width = useElementWidth(frameRef, 640);
  const plotRight = Math.max(LABEL_W + 1, width - PAD_RIGHT);
  const atX = (t: number) => LABEL_W + (t / FENCE_RUN_S) * (plotRight - LABEL_W);
  const future = (t: number) => (stepping && t > now ? ' is-future' : '');

  /** Places a label at x, flipping to end anchoring when it would run past the plot edge. */
  const label = (x: number, y: number, text: string, className: string, gap = 4) => {
    const fitsRight = x + gap + textWidth(text, FONT) <= plotRight;
    return (
      <text
        x={fitsRight ? x + gap : x - gap}
        y={y}
        textAnchor={fitsRight ? 'start' : 'end'}
        className={className}
      >
        {text}
      </text>
    );
  };

  const bar = (from: number, to: number, row: number, className: string): ReactNode => {
    const x0 = atX(from);
    const x1 = atX(Math.max(from, to));
    const y = rowMid(row) - 3;
    if (!stepping) return <rect x={x0} y={y} width={x1 - x0} height={6} rx={2} className={className} />;
    const doneTo = atX(Math.min(Math.max(from, now), to));
    return (
      <g>
        <rect x={x0} y={y} width={x1 - x0} height={6} rx={2} className={`${className} is-future`} />
        {doneTo > x0 ? (
          <rect x={x0} y={y} width={doneTo - x0} height={6} rx={2} className={className} />
        ) : null}
      </g>
    );
  };

  const grants = lane.marks.filter((mark): mark is GrantMark => mark.kind === 'grant');
  const grantA = grants.find((mark) => mark.server === 'A');
  const grantB = grants.find((mark) => mark.server === 'B');
  const stopA = lane.marks.find((mark) => mark.kind === 'stop' && mark.server === 'A');
  const expire = lane.marks.find((mark) => mark.kind === 'expire');
  const stale = lane.marks.filter((mark): mark is StaleMark => mark.kind === 'stale');
  const firstStale = stale[0];
  const rowsBottom = rowTop(ROWS.length);
  const ticks: number[] = [];
  for (let t = 0; t <= FENCE_RUN_S; t += AXIS_STEP_S) ticks.push(t);

  const { pause, slowLink, lockLinkLostAt, clockRate } = scenario;
  const aNote = pause
    ? { t: pause.at + pause.seconds / 2, text: `paused ${fmt(pause.seconds)}`, middle: true }
    : slowLink
      ? { t: slowLink.from, text: `slow link, +${fmt(slowLink.delay)}`, middle: false }
      : lockLinkLostAt !== undefined
        ? {
            t: lockLinkLostAt,
            text:
              clockRate === undefined
                ? 'lock link lost'
                : `lock link lost, clock at ${Math.round(clockRate * 100)}%`,
            middle: false,
          }
        : null;

  return (
    <div className="sdv-fence__lane">
      <h4 className="sdv-fence__title">
        <SeriesSwatch variant={variant} />
        {lane.label}
      </h4>
      <div className="sdv-fence__frame" ref={frameRef}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={describeTimeLane(lane, scenario)}
        >
          <defs>
            <pattern
              id={hatchId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" className="sdv-fence__hatch-line" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <line key={t} x1={atX(t)} x2={atX(t)} y1={TOP_BAND} y2={rowsBottom} className="sdv-fence__grid" />
          ))}
          {ROWS.map((name, row) => (
            <g key={name}>
              <line
                x1={0}
                x2={plotRight}
                y1={rowTop(row + 1)}
                y2={rowTop(row + 1)}
                className="sdv-fence__rule"
              />
              <text x={0} y={rowMid(row) + 4} className="sdv-fence__row-label">
                {name}
              </text>
            </g>
          ))}

          {grantA ? bar(grantA.t, stopA?.t ?? FENCE_RUN_S, 0, 'sdv-fence__bar sdv-fence__bar--a') : null}
          {pause ? (
            <rect
              x={atX(pause.at)}
              y={rowMid(0) - 6}
              width={atX(pause.at + pause.seconds) - atX(pause.at)}
              height={12}
              fill={`url(#${hatchId})`}
              className={`sdv-fence__pause${future(pause.at)}`}
            />
          ) : null}
          {slowLink ? (
            <line
              x1={atX(slowLink.from)}
              x2={atX(stopA?.t ?? FENCE_RUN_S)}
              y1={rowMid(0) + 6}
              y2={rowMid(0) + 6}
              className={`sdv-fence__slow${future(slowLink.from)}`}
            />
          ) : null}
          {lockLinkLostAt !== undefined ? (
            <path
              d={`M${atX(lockLinkLostAt) - 4} ${rowMid(0) - 4}l8 8m0 -8l-8 8`}
              className={`sdv-fence__cut${future(lockLinkLostAt)}`}
            />
          ) : null}
          {aNote ? (
            <g className={future(aNote.middle && pause ? pause.at : aNote.t).trim() || undefined}>
              {aNote.middle ? (
                <text x={atX(aNote.t)} y={rowText(0)} textAnchor="middle" className="sdv-fence__note">
                  {aNote.text}
                </text>
              ) : (
                label(atX(aNote.t), rowText(0), aNote.text, 'sdv-fence__note', 0)
              )}
            </g>
          ) : null}

          {grantB ? bar(grantB.t, FENCE_RUN_S, 1, 'sdv-fence__bar sdv-fence__bar--b') : null}

          {grantA ? bar(grantA.t, expire?.t ?? FENCE_RUN_S, 2, 'sdv-fence__bar sdv-fence__bar--a') : null}
          {grantA ? (
            <text x={atX(grantA.t)} y={rowText(2)} className="sdv-fence__note">
              A, token {grantA.token}
            </text>
          ) : null}
          {grantB ? bar(grantB.t, FENCE_RUN_S, 2, 'sdv-fence__bar sdv-fence__bar--b') : null}
          {grantB ? (
            <g className={future(grantB.t).trim() || undefined}>
              {label(atX(grantB.t), rowText(2), `B, token ${grantB.token}`, 'sdv-fence__note', 0)}
            </g>
          ) : null}
          {expire ? (
            <g className={`sdv-fence__expire${future(expire.t)}`}>
              <line x1={atX(expire.t)} x2={atX(expire.t)} y1={2} y2={rowsBottom} />
              {label(atX(expire.t), 11, `lease expires, ${fmt(expire.t)}`, 'sdv-fence__note')}
            </g>
          ) : null}

          {lane.entries.map((entry) => (
            <line
              key={`${entry.seq}-${entry.server}-${entry.t}`}
              x1={atX(entry.t)}
              x2={atX(entry.t)}
              y1={rowMid(3) - 4}
              y2={rowMid(3) + 4}
              className={`sdv-fence__write sdv-fence__write--${entry.server === 'A' ? 'a' : 'b'}${future(entry.t)}`}
            />
          ))}
          {stale.map((mark) => {
            const x = atX(mark.t);
            const y = rowMid(3);
            return (
              <g
                key={`${mark.seq}-${mark.t}`}
                className={`sdv-fence__stale sdv-fence__stale--${mark.accepted ? 'accepted' : 'rejected'}${future(mark.sentAt)}`}
              >
                <line x1={atX(mark.sentAt)} y1={rowMid(0)} x2={x} y2={y} className="sdv-fence__flight" />
                <circle cx={atX(mark.sentAt)} cy={rowMid(0)} r={3.5} className="sdv-fence__send" />
                {mark.accepted ? (
                  <path d={`M${x} ${y - 6}l6 11h-12z`} className="sdv-fence__glyph" />
                ) : (
                  <g className="sdv-fence__glyph">
                    <rect x={x - 5} y={y - 5} width={10} height={10} />
                    <path d={`M${x - 3} ${y - 3}l6 6m0 -6l-6 6`} />
                  </g>
                )}
              </g>
            );
          })}
          {firstStale ? (
            <g className={future(firstStale.t).trim() || undefined}>
              {label(
                atX(firstStale.t),
                rowText(3),
                staleLabel(stale),
                'sdv-fence__note sdv-fence__note--strong',
                0,
              )}
            </g>
          ) : null}

          {ticks.map((t, index) => (
            <text
              key={t}
              x={atX(t)}
              y={HEIGHT - 5}
              textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
              className="sdv-trace__tick"
            >
              {fmt(t)}
            </text>
          ))}
          {stepping ? (
            <line x1={atX(now)} x2={atX(now)} y1={TOP_BAND} y2={rowsBottom} className="sdv-fence__now" />
          ) : null}
        </svg>
      </div>
    </div>
  );
}

/**
 * Both policies on one time axis: A's pause, the lease expiry, B's newer token and A's late write line up
 * at the same x in each lane, so only the chat log row differs.
 */
export function FenceTimeLanes({
  lanes,
  scenario,
  variants,
  now,
  stepping,
}: {
  lanes: readonly FenceLane[];
  scenario: FenceScenario;
  variants: readonly SeriesVariant[];
  now: number;
  stepping: boolean;
}) {
  return (
    <div className="sdv-fence">
      <p className="sdv-fence__legend">
        <span>Bar: lease held</span>
        <span>Hatched: paused</span>
        <span>Dashed line: lease expiry</span>
        <span>Triangle: stale write accepted</span>
        <span>Crossed box: stale write rejected</span>
      </p>
      {lanes.map((lane, index) => (
        <LaneChart
          key={lane.policy}
          lane={lane}
          scenario={scenario}
          variant={variants[index] ?? 'a'}
          now={now}
          stepping={stepping}
        />
      ))}
    </div>
  );
}
