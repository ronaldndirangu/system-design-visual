import { Arrow, Label, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const LINE = 94;
const TOKENS: [number, number][] = [
  [86, 90],
  [100, 90],
  [114, 90],
  [93, 77],
  [107, 77],
];

type Fill = 'ok' | 'warn' | 'bad';

function Timeline({ first, second }: { first: Fill; second: Fill }) {
  return (
    <>
      <path
        className="sdv-edge"
        d={`M14 ${LINE}H186M20 ${LINE - 5}V${LINE + 5}M180 ${LINE - 5}V${LINE + 5}`}
      />
      <rect className={`sdv-concept__fill--${first}`} x={80} y={52} width={14} height={LINE - 52} rx={2} />
      <rect className={`sdv-concept__fill--${second}`} x={106} y={52} width={14} height={LINE - 52} rx={2} />
    </>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Label x={100} y={16} text={labels('refill')} />
      <Arrow from={[100, 22]} to={[100, 52]} marker={marker} />
      <path className="sdv-concept__gauge-frame" d="M72 56V96Q72 102 78 102H122Q128 102 128 96V56" />
      {TOKENS.map(([x, y]) => (
        <circle key={`${x}-${y}`} className="sdv-concept__fill--ok" cx={x} cy={y} r={6} />
      ))}
      <Arrow from={[132, 90]} to={[184, 90]} marker={marker} weight="heavy" />
      <Packet at={[150, 90]} tone="hit" />
      <Packet at={[166, 90]} tone="hit" />
    </>
  ),
  (_marker, labels) => (
    <>
      <Timeline first="warn" second="warn" />
      <path className="sdv-concept__divider" d={`M100 22V${LINE + 6}`} />
      <Label x={70} y={42} text={labels('count')} />
      <Label x={130} y={42} text={labels('count')} />
      <Label x={100} y={114} text={labels('edge')} />
    </>
  ),
  (_marker, labels) => (
    <>
      <rect
        className="sdv-concept__divider"
        x={50}
        y={30}
        width={100}
        height={LINE - 22}
        rx={4}
        fill="none"
      />
      <Timeline first="ok" second="bad" />
      <Label x={100} y={114} text={labels('window')} />
    </>
  ),
];

export default variants;
