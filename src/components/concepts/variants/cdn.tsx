import { Arrow, Label, Mini } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker) => (
    <>
      <Arrow from={[54, 56]} to={[74, 56]} marker={marker} />
      <Arrow from={[126, 56]} to={[146, 56]} marker={marker} tone="miss" />
      <Arrow from={[170, 76]} via={[136, 112]} to={[104, 80]} marker={marker} tone="hit" />
      <Mini kind="client" x={30} y={60} w={44} h={30} />
      <Mini kind="cdn" x={100} y={60} w={48} h={34} />
      <Mini kind="server" x={170} y={60} w={44} h={30} />
      <rect className="sdv-concept__chip" x={110} y={38} width={14} height={9} rx={2} />
    </>
  ),
  (marker, labels) => (
    <>
      <Arrow from={[54, 60]} to={[74, 60]} marker={marker} tone="hit" />
      <Arrow from={[146, 60]} to={[126, 60]} marker={marker} />
      <Mini kind="server" x={30} y={60} w={44} h={30} />
      <Mini kind="cdn" x={100} y={60} w={48} h={34} />
      <Mini kind="client" x={170} y={60} w={44} h={30} />
      <rect className="sdv-concept__chip" x={110} y={38} width={14} height={9} rx={2} />
      <Label x={64} y={30} text={labels('upload')} />
    </>
  ),
];

export default variants;
