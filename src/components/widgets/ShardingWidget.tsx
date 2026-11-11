import { useMemo, useState } from 'react';
import {
  assignKeys,
  countMoved,
  HashRing,
  keyPosition,
  makeShortCodes,
  type Placement,
  summarizeLoad,
} from '../../lib/models/hashing';
import { hashString } from '../../lib/rng';
import { Segmented, Slider } from '../sim/controls';
import { LoadBars } from '../sim/LoadBars';
import type { Tone } from '../sim/StatTable';
import { WidgetFrame } from '../sim/WidgetFrame';

const KEYS = makeShortCodes(240);
const LETTERS = 'ABCDEFGH';
const MIN_SHARDS = 2;
const MAX_SHARDS = LETTERS.length;
const EXAMPLES = KEYS.slice(0, 3);
const RING = { cx: 150, cy: 150, r: 104, keyR: 128 };

const placements: { value: Placement; label: string }[] = [
  { value: 'modulo', label: 'hash mod N' },
  { value: 'ring', label: 'Consistent hashing ring' },
];

function shardsFor(count: number): string[] {
  return Array.from(LETTERS.slice(0, count));
}

function indexOf(shard: string | undefined): number {
  return shard ? LETTERS.indexOf(shard) : 0;
}

function pointAt(position: number, radius: number): [number, number] {
  const angle = position * 2 * Math.PI - Math.PI / 2;
  return [RING.cx + radius * Math.cos(angle), RING.cy + radius * Math.sin(angle)];
}

function arcPath(start: number, end: number): string {
  const [x1, y1] = pointAt(start, RING.r);
  const [x2, y2] = pointAt(end, RING.r);
  const large = end - start > 0.5 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${RING.r} ${RING.r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface Change {
  label: string;
  before: Map<string, string>;
  fromCount: number;
  toCount: number;
}

interface Props {
  placement?: Placement;
  shards?: number;
  virtualNodes?: number;
  /** Let the learner switch placement. Turn off to keep a section focused on one scheme. */
  showPlacement?: boolean;
}

/** Spread 240 short links across shards and count how many move when a shard joins or leaves. */
export default function ShardingWidget({
  placement: initialPlacement = 'modulo',
  shards: initialShards = 4,
  virtualNodes = 1,
  showPlacement = true,
}: Props) {
  const [placement, setPlacement] = useState<Placement>(initialPlacement);
  const [count, setCount] = useState(initialShards);
  const [vnodeExponent, setVnodeExponent] = useState(Math.round(Math.log2(virtualNodes)));
  const [change, setChange] = useState<Change | null>(null);
  const [version, setVersion] = useState(0);

  const vnodes = 2 ** vnodeExponent;
  const shards = shardsFor(count);
  const effectiveVnodes = placement === 'ring' ? vnodes : 1;
  const assignment = useMemo(
    () => assignKeys(KEYS, shardsFor(count), placement, effectiveVnodes),
    [count, placement, effectiveVnodes],
  );
  const ring = useMemo(() => new HashRing(shardsFor(count), effectiveVnodes), [count, effectiveVnodes]);
  const load = summarizeLoad(assignment, shards);
  const moved = change ? countMoved(change.before, assignment) : 0;
  const movedShare = moved / KEYS.length;
  const minimumShare = change
    ? Math.abs(change.toCount - change.fromCount) / Math.max(change.toCount, change.fromCount)
    : 0;

  const resize = (next: number) => {
    setChange({
      label: next > count ? `Added shard ${LETTERS[next - 1]}` : `Removed shard ${LETTERS[count - 1]}`,
      before: assignment,
      fromCount: count,
      toCount: next,
    });
    setCount(next);
    setVersion((v) => v + 1);
  };

  const clearChange = () => setChange(null);

  const status: { tone: Tone; text: string } = !change
    ? { tone: 'neutral', text: 'Add or remove a shard' }
    : movedShare > minimumShare * 2
      ? { tone: 'bad', text: 'Most keys moved' }
      : { tone: 'ok', text: 'Only a fair slice moved' };

  const evenShare = 1 / count;
  const busiest = Math.max(...Object.values(load.counts));
  const scale = Math.max(busiest / KEYS.length, evenShare * 2);

  const scheme =
    placement === 'ring'
      ? `a consistent hashing ring with ${vnodes} virtual ${vnodes === 1 ? 'node' : 'nodes'} per shard`
      : 'hash mod N';
  const summary = change
    ? `${change.label}. ${moved} of ${KEYS.length} keys moved (${Math.round(movedShare * 100)} percent) using ${scheme}. The busiest shard holds ${load.imbalance.toFixed(2)} times an even share.`
    : `${count} shards using ${scheme}. The busiest shard holds ${load.imbalance.toFixed(2)} times an even share.`;

  return (
    <WidgetFrame
      title="Split the links across shards"
      instructions="Each square is one short link, labeled with the shard that stores it. Add a shard and count how many links have to move."
      summary={summary}
      status={status}
      stats={[
        {
          label: 'Links moved by the last change',
          value: change ? `${moved} of ${KEYS.length} (${Math.round(movedShare * 100)}%)` : 'No change yet',
          detail: change ? `the least possible is about ${Math.round(minimumShare * 100)}%` : undefined,
          tone: change ? (movedShare > minimumShare * 2 ? 'bad' : 'ok') : undefined,
        },
        {
          label: 'Busiest shard',
          value: `${load.imbalance.toFixed(2)}× an even share`,
          detail: '1.00× means perfectly even',
          tone: load.imbalance > 1.5 ? 'warn' : undefined,
        },
        {
          label: 'Shards',
          value: String(count),
          detail: `even share: ${Math.round(KEYS.length * evenShare)} links each`,
        },
      ]}
      actions={
        <>
          <button
            type="button"
            className="sdv-button sdv-button--primary"
            onClick={() => resize(count + 1)}
            disabled={count >= MAX_SHARDS}
          >
            Add a shard
          </button>
          <button
            type="button"
            className="sdv-button"
            onClick={() => resize(count - 1)}
            disabled={count <= MIN_SHARDS}
          >
            Remove a shard
          </button>
        </>
      }
      controls={
        <>
          {showPlacement && (
            <Segmented
              label="How to pick a shard"
              value={placement}
              options={placements}
              onChange={(value) => {
                setPlacement(value);
                clearChange();
              }}
            />
          )}
          {placement === 'ring' && (
            <Slider
              label="Virtual nodes per shard"
              value={vnodeExponent}
              min={0}
              max={6}
              format={(v) => String(2 ** v)}
              hint="Each shard takes many small slices of the ring, which evens out the load."
              onChange={(v) => {
                setVnodeExponent(v);
                clearChange();
              }}
            />
          )}
        </>
      }
    >
      <div className="sdv-shards" data-placement={placement}>
        <div className="sdv-shards__scheme">
          {placement === 'ring' ? (
            <svg
              className="sdv-shards__ring"
              viewBox="14 14 272 272"
              role="img"
              aria-label={`Hash ring with ${ring.points.length} points. Each link belongs to the first shard point clockwise from its hash.`}
            >
              <circle className="sdv-shards__track" cx={RING.cx} cy={RING.cy} r={RING.r} />
              {ring.points.map((point, i) => {
                const previous = ring.points[(i - 1 + ring.points.length) % ring.points.length];
                const start = i === 0 ? (previous?.position ?? 0) - 1 : (previous?.position ?? 0);
                if (ring.points.length === 1) return null;
                return (
                  <path
                    key={`${point.shard}-${point.position}`}
                    className="sdv-shards__arc"
                    data-shard={indexOf(point.shard)}
                    d={arcPath(start, point.position)}
                  />
                );
              })}
              {KEYS.map((key) => {
                const [x, y] = pointAt(keyPosition(key), RING.keyR);
                const wasMoved = change !== null && change.before.get(key) !== assignment.get(key);
                return (
                  <circle
                    key={key}
                    className="sdv-shards__key"
                    data-shard={indexOf(assignment.get(key))}
                    data-moved={wasMoved ? 'true' : undefined}
                    cx={x}
                    cy={y}
                    r={wasMoved ? 3.5 : 2.4}
                  />
                );
              })}
              {effectiveVnodes <= 2 &&
                ring.points.map((point) => {
                  const [x, y] = pointAt(point.position, RING.r - 22);
                  return (
                    <text
                      key={`label-${point.shard}-${point.position}`}
                      className="sdv-shards__point-label"
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {point.shard}
                    </text>
                  );
                })}
              <text
                className="sdv-shards__center"
                x={RING.cx}
                y={RING.cy}
                textAnchor="middle"
                dominantBaseline="central"
              >
                clockwise
              </text>
            </svg>
          ) : (
            <div className="sdv-shards__formula">
              <p className="sdv-shards__equation">
                shard = hash(code) mod <strong>{count}</strong>
              </p>
              <ul className="sdv-shards__examples">
                {EXAMPLES.map((key) => {
                  const hash = hashString(key);
                  const owner = assignment.get(key);
                  const previous = change?.before.get(key);
                  return (
                    <li key={key}>
                      <code>{key}</code>: {hash.toLocaleString('en-US')} mod {count} = {hash % count}, so
                      shard <strong>{owner}</strong>
                      {previous && previous !== owner ? (
                        <span className="sdv-shards__was"> (was {previous})</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="sdv-control__hint">Change N and almost every remainder changes with it.</p>
            </div>
          )}
        </div>
        <div className="sdv-shards__keys" aria-hidden="true">
          {KEYS.map((key) => {
            const owner = assignment.get(key);
            const wasMoved = change !== null && change.before.get(key) !== owner;
            return (
              <span
                key={wasMoved ? `${key}-${version}` : key}
                className="sdv-shards__cell"
                data-shard={indexOf(owner)}
                data-moved={wasMoved ? 'true' : undefined}
                title={`${key}: shard ${owner}`}
              >
                {owner}
              </span>
            );
          })}
        </div>
      </div>
      <LoadBars
        label="Links per shard"
        flagFull={false}
        target={{ at: evenShare / scale, label: 'Even share' }}
        bars={shards.map((shard) => {
          const keys = load.counts[shard] ?? 0;
          return {
            id: shard,
            label: `Shard ${shard}`,
            fill: keys / KEYS.length / scale,
            value: `${keys} links`,
            data: { 'data-shard': String(indexOf(shard)) },
          };
        })}
      />
      <p className="sdv-control__hint">
        The thin mark on each bar shows an even share. Outlined squares moved in the last change.
      </p>
    </WidgetFrame>
  );
}
