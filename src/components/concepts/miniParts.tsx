import type { Vec } from '../viz/geometry';
import { KindIcon, StatusBadge } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import { Shape } from '../viz/SystemNode';

/** viewBox size of every variant mini diagram. */
export const MINI_W = 200;
export const MINI_H = 120;

type Tone = 'hit' | 'miss';

/** A small component shape with its icon, centred on (x, y). */
export function Mini({
  kind,
  x,
  y,
  w = 40,
  h = 28,
  warn,
  standby,
}: {
  kind: ComponentKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  warn?: boolean;
  standby?: boolean;
}) {
  const cls = `sdv-node sdv-node--${kind}${standby ? ' sdv-node--candidate' : ''}`;
  return (
    <g className={cls} transform={`translate(${x} ${y})`}>
      <Shape kind={kind} w={w} h={h} />
      <KindIcon kind={kind} size={14} x={-7} y={-7} />
      {warn && <StatusBadge status="warn" x={w / 2 - 2} y={-h / 2 + 2} />}
    </g>
  );
}

/** A straight or curved (via) edge; pass the drawing's `marker` for an arrowhead. */
export function Arrow({
  from,
  to,
  via,
  marker,
  tone,
  dashed,
  weight,
}: {
  from: Vec;
  to: Vec;
  via?: Vec;
  marker?: string;
  tone?: Tone;
  dashed?: boolean;
  weight?: 'heavy' | 'light';
}) {
  const classes = ['sdv-edge'];
  if (dashed) classes.push('sdv-edge--dashed');
  if (tone) classes.push(`sdv-concept__edge--${tone}`);
  if (weight) classes.push(`sdv-concept__edge--${weight}`);
  const d = via
    ? `M${from[0]} ${from[1]}Q${via[0]} ${via[1]} ${to[0]} ${to[1]}`
    : `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`;
  return <path className={classes.join(' ')} d={d} markerEnd={marker ? `url(#${marker})` : undefined} />;
}

/** A static request (circle) or response (square). */
export function Packet({ at, tone, response }: { at: Vec; tone?: Tone; response?: boolean }) {
  const cls = tone ? `sdv-dot sdv-dot--${tone}` : 'sdv-dot';
  return response ? (
    <rect className={cls} x={at[0] - 4} y={at[1] - 4} width={8} height={8} rx={2} />
  ) : (
    <circle className={cls} cx={at[0]} cy={at[1]} r={4} />
  );
}

export function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text className="sdv-concept__note" x={x} y={y} textAnchor="middle">
      {text}
    </text>
  );
}

/** A small numbered circle for the order of moves inside one mini diagram. */
export function Step({ n, at }: { n: number; at: Vec }) {
  return (
    <g className="sdv-concept__marker sdv-concept__marker--small" transform={`translate(${at[0]} ${at[1]})`}>
      <circle r={9} />
      <text textAnchor="middle" y={4.5}>
        {n}
      </text>
    </g>
  );
}

/** Vertical line that splits a mini diagram into two 100-wide panels. */
export function Divider() {
  return <path className="sdv-concept__divider" d={`M${MINI_W / 2} 8V${MINI_H - 8}`} />;
}

/** A small horizontal load bar, filled to `share` (0 to 1). */
export function Gauge({ x, y, share, bad }: { x: number; y: number; share: number; bad?: boolean }) {
  return (
    <g>
      <rect className="sdv-concept__gauge-frame" x={x - 13} y={y} width={26} height={7} rx={2} />
      <rect
        className={bad ? 'sdv-concept__fill--bad' : 'sdv-concept__fill--ok'}
        x={x - 12}
        y={y + 1}
        width={24 * share}
        height={5}
        rx={1.5}
      />
    </g>
  );
}
