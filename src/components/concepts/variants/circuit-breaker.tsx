import type { Vec } from '../../viz/geometry';
import { Arrow, Divider, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

export type BreakerState = 'closed' | 'open' | 'half';

/** A knife switch: closed conducts, open is lifted, half-open is lowered partway and dashed. */
export function BreakerSwitch({
  x,
  y,
  state,
  span = 40,
}: {
  x: number;
  y: number;
  state: BreakerState;
  span?: number;
}) {
  const left: Vec = [x - span / 2, y];
  const right: Vec = [x + span / 2, y];
  const tip: Vec =
    state === 'closed'
      ? right
      : state === 'open'
        ? [x + span * 0.2, y - span * 0.5]
        : [x + span * 0.42, y - span * 0.22];
  const classes = [
    'sdv-edge',
    'sdv-concept__edge--heavy',
    `sdv-concept__edge--${state === 'closed' ? 'hit' : 'miss'}`,
  ];
  if (state === 'half') classes.push('sdv-edge--dashed');
  return (
    <g>
      <path className={classes.join(' ')} d={`M${left[0]} ${left[1]}L${tip[0]} ${tip[1]}`} />
      <circle className="sdv-arrowhead" cx={left[0]} cy={left[1]} r={3.5} />
      <circle className="sdv-arrowhead" cx={right[0]} cy={right[1]} r={3.5} />
    </g>
  );
}

/** Recent calls as squares, failures in red, above a tripped breaker. */
function tripPanel(ox: number, label: string, rows: boolean[][]) {
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      {rows.flatMap((calls, r) => {
        const y = 34 + r * 16;
        return calls.map((failed, i) => {
          const x = ox + 17 + i * 14;
          return (
            <rect
              key={`${x},${y}`}
              className={failed ? 'sdv-concept__fill--bad' : 'sdv-concept__fill--ok'}
              x={x}
              y={y}
              width={10}
              height={10}
              rx={2}
            />
          );
        });
      })}
      <BreakerSwitch x={ox + 50} y={100} state="open" span={36} />
    </g>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Arrow from={[52, 40]} to={[76, 40]} marker={marker} />
      <Arrow from={[124, 40]} to={[148, 40]} dashed />
      <Arrow from={[40, 60]} via={[44, 96]} to={[74, 96]} marker={marker} />
      <Mini kind="client" x={32} y={40} w={40} h={28} />
      <BreakerSwitch x={100} y={40} state="open" span={36} />
      <Mini kind="server" x={170} y={40} w={40} h={30} warn />
      <Mini kind="cache" x={100} y={96} w={44} h={28} />
      <Packet at={[56, 82]} tone="hit" response />
      <Label x={156} y={101} text={labels('cached')} />
    </>
  ),
  (_marker, labels) => (
    <>
      {tripPanel(0, labels('count'), [[true, true, true, true, true]])}
      <Divider />
      {tripPanel(100, labels('rate'), [
        [false, true, false, true, true],
        [true, false, false, true, false],
      ])}
    </>
  ),
];

export default variants;
