import { Arrow, Divider, Label, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const BUCKETS = [40, 58, 76, 94] as const;
const LEAVES = [116, 138, 160, 182] as const;
const ROWS = [34, 50, 66, 82, 98] as const;
const BLOCK = [2, 3];
const SCATTERED = [0, 3];

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Divider />
      <Label x={50} y={22} text={labels('hash')} />
      <g className="sdv-node sdv-node--database">
        {BUCKETS.map((y) => (
          <rect key={y} className="sdv-node__shape" x={58} y={y - 6} width={32} height={12} rx={2} />
        ))}
      </g>
      <Packet at={[16, 67]} />
      <Arrow from={[22, 67]} via={[40, 76]} to={[54, 76]} marker={marker} tone="hit" />
      <rect className="sdv-concept__chip" x={66} y={73} width={16} height={6} rx={2} />
      <Label x={150} y={22} text={labels('tree')} />
      <path className="sdv-edge" d={LEAVES.map((x) => `M150 51L${x} 79`).join('')} />
      <g className="sdv-node sdv-node--database">
        <rect className="sdv-node__shape" x={134} y={38} width={32} height={13} rx={2} />
        {LEAVES.map((x) => (
          <rect key={x} className="sdv-node__shape" x={x - 9} y={79} width={18} height={13} rx={2} />
        ))}
      </g>
      <rect className="sdv-edge sdv-concept__edge--hit" x={126} y={76} width={46} height={19} rx={4} />
      <Arrow from={[132, 104]} to={[168, 104]} marker={marker} tone="hit" />
    </>
  ),
  (marker, labels) => (
    <>
      <Label x={70} y={22} text={labels('last')} />
      <Label x={140} y={22} text={labels('first')} />
      <g className="sdv-node sdv-node--database">
        {ROWS.map((y) => (
          <g key={y}>
            <rect className="sdv-node__shape" x={44} y={y} width={52} height={13} rx={2} />
            <rect className="sdv-node__shape" x={114} y={y} width={52} height={13} rx={2} />
          </g>
        ))}
      </g>
      {BLOCK.map((row) => (
        <rect
          key={row}
          className="sdv-concept__chip"
          x={52}
          y={(ROWS[row] ?? 0) + 4}
          width={36}
          height={5}
          rx={2}
        />
      ))}
      <rect
        className="sdv-edge sdv-concept__edge--hit"
        x={41}
        y={(ROWS[2] ?? 0) - 3}
        width={58}
        height={35}
        rx={4}
      />
      <Arrow from={[14, 66]} to={[36, 66]} marker={marker} tone="hit" />
      {SCATTERED.map((row) => (
        <rect
          key={row}
          className="sdv-edge sdv-concept__edge--miss"
          x={111}
          y={(ROWS[row] ?? 0) - 3}
          width={58}
          height={19}
          rx={4}
        />
      ))}
    </>
  ),
];

export default variants;
