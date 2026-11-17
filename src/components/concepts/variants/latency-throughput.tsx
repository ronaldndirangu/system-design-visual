import { Label } from '../miniParts';
import type { VariantDrawing } from '../parts';

const BASE = 92;
const BARS = [30, 52, 58, 46, 32, 22, 14, 10, 8, 6, 5, 4, 4, 3, 3].map((h, i) => ({
  h,
  x: 18 + i * 11,
  tail: i >= 14,
}));

const variants: VariantDrawing[] = [
  (_marker, labels) => (
    <>
      <path className="sdv-edge" d={`M14 ${BASE}H190`} />
      {BARS.map(({ h, x, tail }) => (
        <rect
          key={x}
          className={tail ? 'sdv-concept__fill--warn' : 'sdv-concept__fill--ok'}
          x={x}
          y={BASE - h}
          width={8}
          height={h}
          rx={1.5}
        />
      ))}
      <path className="sdv-concept__divider" d={`M55 ${BASE - 70}V${BASE + 4}`} />
      <path className="sdv-concept__divider" d={`M170 ${BASE - 70}V${BASE + 4}`} />
      <Label x={55} y={112} text={labels('p50')} />
      <Label x={170} y={112} text={labels('p99')} />
    </>
  ),
  (_marker, labels) => (
    <>
      <path className="sdv-edge" d="M24 18V92H186" />
      <path className="sdv-concept__divider" d="M164 18V92" />
      <path
        className="sdv-edge sdv-concept__edge--heavy"
        d="M26 86C80 86 120 82 140 70C154 60 160 40 164 22"
      />
      <Label x={24} y={12} text={labels('wait')} />
      <Label x={96} y={112} text={labels('load')} />
      <Label x={164} y={112} text={labels('full')} />
    </>
  ),
];

export default variants;
