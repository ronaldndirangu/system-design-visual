import type { ComponentKind } from '../../viz/kinds';
import { Arrow, Label } from '../miniParts';
import type { VariantDrawing } from '../parts';

const KINDS: ComponentKind[] = ['server', 'cache', 'database'];
const LETTERS = ['a', 'b', 'c'] as const;
const POINTS = Array.from({ length: 9 }, (_, i) => i);
const SLOTS = Array.from({ length: 16 }, (_, i) => i);
const TAKEN = [5, 10, 15];
const OWNER_LETTERS = ['a', 'b', 'c', 'd'] as const;
const OWNERS: { kind: ComponentKind; x: number; standby?: boolean }[] = [
  { kind: 'server', x: 34 },
  { kind: 'cache', x: 82 },
  { kind: 'database', x: 130 },
  { kind: 'server', x: 178, standby: true },
];

function ringPoint(deg: number, radius: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [100 + radius * Math.sin(rad), 62 - radius * Math.cos(rad)];
}

function owner(slot: number): number {
  if (slot < 6) return 0;
  return slot < 11 ? 1 : 2;
}

function slotX(slot: number): number {
  return 12 + slot * 11;
}

const variants: VariantDrawing[] = [
  (_marker, labels) => (
    <>
      <circle className="sdv-edge" cx={100} cy={62} r={36} />
      {POINTS.map((i) => {
        const [x, y] = ringPoint(i * 40, 36);
        const [lx, ly] = ringPoint(i * 40, 50);
        return (
          <g key={i}>
            <g className={`sdv-node sdv-node--${KINDS[i % 3]}`}>
              <rect className="sdv-node__shape" x={x - 6} y={y - 6} width={12} height={12} rx={3} />
            </g>
            <Label x={lx} y={ly + 4.5} text={labels(LETTERS[i % 3] ?? 'a')} />
          </g>
        );
      })}
    </>
  ),
  (marker, labels) => (
    <>
      {SLOTS.map((slot) => (
        <g key={slot} className={`sdv-node sdv-node--${KINDS[owner(slot)]}`}>
          <rect className="sdv-node__shape" x={slotX(slot)} y={26} width={9} height={18} rx={2} />
        </g>
      ))}
      {TAKEN.map((slot) => (
        <rect
          key={slot}
          className="sdv-edge sdv-concept__edge--miss"
          x={slotX(slot) - 2}
          y={24}
          width={13}
          height={22}
          rx={3}
        />
      ))}
      <path
        className="sdv-edge sdv-edge--dashed"
        d={`${TAKEN.map((slot) => `M${slotX(slot) + 4.5} 48V58`).join('')}M${slotX(5) + 4.5} 58H${slotX(15) + 4.5}`}
      />
      <Arrow from={[slotX(15) + 4.5, 58]} to={[slotX(15) + 4.5, 76]} marker={marker} dashed />
      {OWNERS.map(({ kind, x, standby }, i) => (
        <g key={x}>
          <g className={`sdv-node sdv-node--${kind}${standby ? ' sdv-node--candidate' : ''}`}>
            <rect className="sdv-node__shape" x={x - 17} y={80} width={34} height={28} rx={4} />
          </g>
          <Label x={x} y={98.5} text={labels(OWNER_LETTERS[i] ?? 'a')} />
        </g>
      ))}
    </>
  ),
];

export default variants;
