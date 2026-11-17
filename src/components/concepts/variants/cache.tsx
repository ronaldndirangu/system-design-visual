import { Arrow, Label, Mini, Packet, Step } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker) => (
    <>
      <Arrow from={[62, 52]} to={[132, 32]} marker={marker} tone="miss" />
      <Arrow from={[62, 70]} to={[132, 90]} marker={marker} />
      <Arrow from={[52, 40]} via={[90, 2]} to={[134, 20]} marker={marker} tone="hit" />
      <Mini kind="client" x={36} y={60} w={44} h={30} />
      <Mini kind="cache" x={160} y={28} w={44} h={30} />
      <Mini kind="database" x={160} y={94} w={44} h={34} />
      <Step n={1} at={[100, 54]} />
      <Step n={2} at={[100, 92]} />
      <Step n={3} at={[90, 14]} />
    </>
  ),
  (marker) => (
    <>
      <Arrow from={[54, 50]} to={[74, 50]} marker={marker} />
      <Arrow from={[124, 50]} to={[144, 50]} marker={marker} />
      <Arrow from={[170, 72]} via={[100, 124]} to={[34, 74]} marker={marker} tone="hit" />
      <Mini kind="client" x={30} y={50} w={44} h={30} />
      <Mini kind="cache" x={100} y={50} w={44} h={30} />
      <Mini kind="database" x={170} y={50} w={44} h={34} />
      <Packet at={[100, 98]} tone="hit" response />
    </>
  ),
  (marker, labels) => (
    <>
      <Arrow from={[54, 50]} to={[74, 50]} marker={marker} />
      <Arrow from={[124, 50]} to={[144, 50]} marker={marker} dashed />
      <Arrow from={[100, 72]} via={[66, 112]} to={[34, 74]} marker={marker} tone="hit" />
      <Mini kind="client" x={30} y={50} w={44} h={30} />
      <Mini kind="cache" x={100} y={50} w={44} h={30} />
      <Mini kind="database" x={170} y={50} w={44} h={34} />
      <Label x={136} y={24} text={labels('later')} />
      <Packet at={[134, 64]} response />
      <Packet at={[146, 64]} response />
      <Packet at={[66, 94]} tone="hit" response />
    </>
  ),
];

export default variants;
