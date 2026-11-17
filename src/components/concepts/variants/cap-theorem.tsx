import { Arrow, Divider, Label, Mini, Packet, Step } from '../miniParts';
import type { VariantDrawing } from '../parts';

const replicas = [36, 100, 164];

const variants: VariantDrawing[] = [
  (marker) => (
    <>
      <Arrow from={[55, 72]} to={[81, 72]} />
      <Arrow from={[119, 72]} to={[145, 72]} />
      <Arrow from={[36, 36]} to={[36, 54]} marker={marker} />
      <Arrow from={[164, 36]} to={[164, 54]} marker={marker} />
      <Mini kind="client" x={36} y={22} w={36} h={24} />
      <Mini kind="client" x={164} y={22} w={36} h={24} />
      {replicas.map((x) => (
        <Mini key={x} kind="database" x={x} y={72} w={34} h={28} />
      ))}
      <Packet at={[48, 45]} tone="hit" />
      <Packet at={[152, 45]} tone="miss" />
      {replicas.map((x) => (
        <g key={x}>
          <rect className="sdv-concept__chip" x={x - 15} y={93} width={14} height={9} rx={2} />
          <rect className="sdv-concept__fill--warn" x={x + 1} y={93} width={14} height={9} rx={2} />
        </g>
      ))}
    </>
  ),
  (marker, labels) => (
    <>
      <Divider />
      <Arrow from={[42, 64]} to={[58, 64]} marker={marker} />
      <Arrow from={[28, 48]} to={[40, 34]} marker={marker} tone="hit" />
      <Mini kind="client" x={50} y={20} w={36} h={22} />
      <Mini kind="database" x={24} y={64} w={32} h={26} />
      <Mini kind="database" x={76} y={64} w={32} h={26} />
      <Step n={1} at={[50, 84]} />
      <Step n={2} at={[16, 32]} />
      <Label x={50} y={113} text={labels('wait')} />
      <Arrow from={[142, 64]} to={[158, 64]} marker={marker} tone="miss" dashed />
      <Arrow from={[128, 48]} to={[140, 34]} marker={marker} tone="hit" />
      <Mini kind="client" x={150} y={20} w={36} h={22} />
      <Mini kind="database" x={124} y={64} w={32} h={26} />
      <Mini kind="database" x={176} y={64} w={32} h={26} />
      <Step n={1} at={[116, 32]} />
      <Step n={2} at={[150, 84]} />
      <Label x={150} y={113} text={labels('fast')} />
    </>
  ),
];

export default variants;
