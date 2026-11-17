import { Arrow, Divider, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Arrow from={[80, 46]} to={[118, 46]} marker={marker} />
      <Mini kind="server" x={56} y={46} w={44} h={30} />
      <Mini kind="database" x={144} y={46} w={44} h={30} />
      <Label x={56} y={84} text={labels('each')} />
      <Label x={144} y={84} text={labels('each')} />
      <Label x={100} y={112} text={labels('total')} />
    </>
  ),
  (marker, labels) => (
    <>
      <Arrow from={[50, 8]} to={[50, 38]} marker={marker} dashed weight="light" />
      <Mini kind="server" x={50} y={56} w={44} h={30} standby warn />
      <Mini kind="database" x={50} y={88} w={30} h={18} standby />
      <Label x={50} y={116} text={labels('zone1')} />
      <Divider />
      <Arrow from={[150, 8]} to={[150, 38]} marker={marker} weight="heavy" />
      <Packet at={[150, 22]} tone="hit" />
      <Mini kind="server" x={150} y={56} w={44} h={30} />
      <Mini kind="database" x={150} y={88} w={30} h={18} />
      <Label x={150} y={116} text={labels('zone2')} />
    </>
  ),
];

export default variants;
