import { Arrow, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const replicas = [40, 100, 160];

const variants: VariantDrawing[] = [
  (marker) => (
    <>
      <Arrow from={[50, 36]} to={[50, 60]} marker={marker} />
      <Arrow from={[150, 36]} to={[150, 60]} marker={marker} />
      <Arrow from={[72, 76]} to={[128, 76]} marker={marker} dashed />
      <Mini kind="client" x={50} y={22} w={40} h={26} />
      <Mini kind="client" x={150} y={22} w={40} h={26} />
      <Mini kind="database" x={50} y={78} w={40} h={30} />
      <Mini kind="database" x={150} y={78} w={40} h={30} />
      <Packet at={[50, 48]} tone="hit" response />
      <Packet at={[150, 48]} tone="miss" response />
      <rect className="sdv-concept__chip" x={43} y={99} width={14} height={9} rx={2} />
    </>
  ),
  (_marker, labels) => (
    <>
      <path className="sdv-edge sdv-concept__edge--hit" d="M22 34H118" />
      <path className="sdv-edge" d="M82 90H178" />
      {replicas.map((x) => (
        <Mini key={x} kind="database" x={x} y={64} w={34} h={28} />
      ))}
      <rect className="sdv-concept__chip" x={33} y={39} width={14} height={9} rx={2} />
      <rect className="sdv-concept__chip" x={93} y={39} width={14} height={9} rx={2} />
      <Label x={70} y={25} text={labels('write')} />
      <Label x={130} y={112} text={labels('read')} />
    </>
  ),
];

export default variants;
