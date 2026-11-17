import { Arrow, Divider, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Arrow from={[42, 64]} to={[64, 64]} marker={marker} />
      <Arrow from={[118, 58]} to={[146, 42]} marker={marker} />
      <Arrow from={[118, 70]} to={[146, 86]} marker={marker} />
      <Mini kind="client" x={24} y={64} w={32} h={24} />
      <Mini kind="loadBalancer" x={92} y={64} w={48} h={26} />
      <Mini kind="server" x={168} y={38} w={36} h={26} />
      <Mini kind="server" x={168} y={90} w={36} h={26} />
      <Packet at={[52, 64]} tone="hit" />
      <Label x={72} y={26} text={labels('key')} />
      <Label x={114} y={26} text={labels('limit')} />
      <rect className="sdv-concept__chip" x={67} y={33} width={10} height={6} rx={2} />
      <rect className="sdv-concept__chip" x={109} y={33} width={10} height={6} rx={2} />
    </>
  ),
  (marker, labels) => (
    <>
      <rect className="sdv-concept__divider" x={4} y={16} width={60} height={78} rx={6} fill="none" />
      <Arrow from={[29, 40]} to={[37, 49]} />
      <Arrow from={[29, 72]} to={[37, 63]} />
      <Arrow from={[61, 56]} to={[76, 56]} marker={marker} />
      <Mini kind="client" x={18} y={34} w={24} h={20} />
      <Mini kind="client" x={18} y={78} w={24} h={20} />
      <Mini kind="loadBalancer" x={48} y={56} w={24} h={22} />
      <Mini kind="server" x={88} y={56} w={20} h={28} />
      <Label x={50} y={112} text={labels('forward')} />
      <Divider />
      <rect className="sdv-concept__divider" x={136} y={16} width={60} height={78} rx={6} fill="none" />
      <Arrow from={[123, 56]} to={[138, 56]} marker={marker} />
      <Arrow from={[165, 51]} to={[171, 42]} />
      <Arrow from={[165, 61]} to={[171, 70]} />
      <Mini kind="client" x={112} y={56} w={20} h={22} />
      <Mini kind="loadBalancer" x={152} y={56} w={24} h={22} />
      <Mini kind="server" x={182} y={34} w={24} h={20} />
      <Mini kind="server" x={182} y={78} w={24} h={20} />
      <Label x={150} y={112} text={labels('reverse')} />
    </>
  ),
];

export default variants;
