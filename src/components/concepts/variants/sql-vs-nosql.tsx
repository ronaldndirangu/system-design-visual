import type { Vec } from '../../viz/geometry';
import { Shape } from '../../viz/SystemNode';
import { Arrow, Divider, Label } from '../miniParts';
import type { VariantDrawing } from '../parts';

const KV_ROWS = [46, 72, 98] as const;
const COLUMN_ROWS: number[][] = [
  [0, 1],
  [0, 2, 3],
  [0, 3],
];
const PEOPLE: Vec[] = [
  [124, 48],
  [176, 44],
  [150, 76],
  [122, 102],
  [178, 102],
];
const FRIENDS: [number, number][] = [
  [0, 2],
  [1, 2],
  [2, 3],
  [2, 4],
  [0, 1],
];

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Divider />
      <Label x={50} y={22} text={labels('kv')} />
      {KV_ROWS.map((y) => (
        <g key={y}>
          <g className="sdv-node sdv-node--cache">
            <rect className="sdv-node__shape" x={10} y={y - 7} width={22} height={14} rx={3} />
          </g>
          <Arrow from={[34, y]} to={[52, y]} marker={marker} />
          <g className="sdv-concept__land">
            <path d={`M56 ${y - 8}h34v16h-34Z`} />
          </g>
        </g>
      ))}
      <Label x={150} y={22} text={labels('doc')} />
      <g className="sdv-node sdv-node--dns" transform="translate(150 72)">
        <Shape kind="dns" w={64} h={66} />
        <path className="sdv-node__detail" d="M-22 -18h30M-22 -8h36M-22 2h24M-14 12h28M-14 22h22" />
      </g>
      <path className="sdv-edge sdv-concept__edge--hit" d="M128 64h36" />
    </>
  ),
  (_marker, labels) => (
    <>
      <Divider />
      <Label x={50} y={22} text={labels('columns')} />
      {COLUMN_ROWS.map((filled, row) => {
        const y = 38 + row * 24;
        return (
          <g key={y}>
            {[0, 1, 2, 3].map((col) =>
              filled.includes(col) ? (
                <g key={col} className="sdv-node sdv-node--database">
                  <rect className="sdv-node__shape" x={12 + col * 19} y={y} width={16} height={18} rx={2} />
                </g>
              ) : (
                <rect
                  key={col}
                  className="sdv-concept__gauge-frame"
                  x={12 + col * 19}
                  y={y}
                  width={16}
                  height={18}
                  rx={2}
                  strokeDasharray="2 3"
                />
              ),
            )}
          </g>
        );
      })}
      <Label x={150} y={22} text={labels('graph')} />
      {FRIENDS.map(([a, b]) => {
        const from = PEOPLE[a] as Vec;
        const to = PEOPLE[b] as Vec;
        return <path key={`${a}-${b}`} className="sdv-edge" d={`M${from[0]} ${from[1]}L${to[0]} ${to[1]}`} />;
      })}
      {PEOPLE.map(([x, y]) => (
        <g key={`${x}-${y}`} className="sdv-node sdv-node--client">
          <circle className="sdv-node__shape" cx={x} cy={y} r={8} />
        </g>
      ))}
    </>
  ),
];

export default variants;
