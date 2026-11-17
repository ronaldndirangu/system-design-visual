import { Arrow, Label, Mini, Packet, Step } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Arrow from={[62, 56]} to={[138, 56]} marker={marker} />
      <Arrow from={[138, 72]} to={[62, 72]} marker={marker} tone="hit" />
      <Arrow from={[160, 12]} to={[160, 44]} marker={marker} />
      <Mini kind="client" x={40} y={64} w={40} h={30} />
      <Mini kind="server" x={160} y={64} w={40} h={30} />
      <Packet at={[100, 72]} tone="hit" response />
      <Step n={1} at={[100, 40]} />
      <Step n={2} at={[140, 26]} />
      <Step n={3} at={[100, 90]} />
      <Label x={160} y={110} text={labels('wait')} />
    </>
  ),
  (marker) => (
    <>
      <Arrow from={[58, 46]} to={[142, 46]} marker={marker} weight="light" />
      <Arrow from={[142, 68]} to={[58, 68]} marker={marker} tone="hit" weight="heavy" />
      <Mini kind="client" x={36} y={58} w={40} h={34} />
      <Mini kind="server" x={164} y={58} w={40} h={34} />
      {[80, 102, 124].map((x) => (
        <Packet key={x} at={[x, 68]} tone="hit" response />
      ))}
    </>
  ),
];

export default variants;
