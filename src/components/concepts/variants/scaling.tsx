import { Arrow, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const AXIS = 100;
const trafficAt = (x: number) => 96 - 56 * Math.exp(-(((x - 100) / 40) ** 2));
const TRAFFIC = Array.from({ length: 22 }, (_, i) => {
  const x = 16 + i * 8;
  return `${i === 0 ? 'M' : 'L'}${x} ${trafficAt(x).toFixed(1)}`;
}).join('');

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Arrow from={[90, 28]} to={[62, 42]} marker={marker} />
      <Arrow from={[110, 28]} to={[138, 42]} marker={marker} />
      <Arrow from={[62, 74]} to={[86, 86]} marker={marker} />
      <Arrow from={[138, 74]} to={[114, 86]} marker={marker} />
      <Mini kind="client" x={100} y={16} w={36} h={24} />
      <Mini kind="server" x={50} y={58} />
      <Mini kind="server" x={150} y={58} />
      <Mini kind="database" x={100} y={98} w={40} h={24} />
      <Packet at={[74, 80]} tone="hit" />
      <Packet at={[126, 80]} tone="hit" />
      <Label x={160} y={106} text={labels('store')} />
    </>
  ),
  (_marker, labels) => (
    <>
      <path className="sdv-edge" d={`M12 ${AXIS}H188`} />
      <path className="sdv-edge sdv-concept__edge--heavy" d={TRAFFIC} />
      <path
        className="sdv-edge sdv-concept__edge--hit sdv-concept__edge--heavy"
        d="M16 84H44V58H72V34H128V58H156V84H184"
      />
      <Label x={100} y={24} text={labels('servers')} />
      <Label x={100} y={80} text={labels('traffic')} />
    </>
  ),
];

export default variants;
