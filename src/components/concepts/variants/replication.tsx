import { Arrow, Divider, Label, Mini, Packet, Step } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Divider />
      <Label x={50} y={18} text={labels('sync')} />
      <Arrow from={[41, 66]} to={[59, 66]} marker={marker} />
      <Arrow from={[59, 80]} to={[41, 80]} marker={marker} tone="hit" />
      <Arrow from={[24, 56]} to={[24, 42]} marker={marker} tone="hit" />
      <Mini kind="database" x={24} y={73} w={30} h={30} />
      <Mini kind="database" x={76} y={73} w={30} h={30} />
      <Packet at={[24, 36]} response tone="hit" />
      <Step n={1} at={[50, 52]} />
      <Step n={2} at={[50, 98]} />
      <Step n={3} at={[40, 33]} />
      <Label x={150} y={18} text={labels('async')} />
      <Arrow from={[141, 73]} to={[159, 73]} marker={marker} dashed />
      <Arrow from={[124, 56]} to={[124, 42]} marker={marker} tone="hit" />
      <Mini kind="database" x={124} y={73} w={30} h={30} />
      <Mini kind="database" x={176} y={73} w={30} h={30} warn />
      <Packet at={[124, 36]} response tone="hit" />
      <Step n={1} at={[140, 33]} />
      <Step n={2} at={[150, 98]} />
    </>
  ),
  (marker, labels) => (
    <>
      <Label x={46} y={26} text={labels('us')} />
      <Label x={154} y={26} text={labels('eu')} />
      <Arrow from={[70, 50]} via={[100, 38]} to={[130, 50]} marker={marker} />
      <Arrow from={[130, 74]} via={[100, 86]} to={[70, 74]} marker={marker} />
      <Mini kind="database" x={46} y={62} w={44} h={32} warn />
      <Mini kind="database" x={154} y={62} w={44} h={32} warn />
      <Arrow from={[46, 106]} to={[46, 82]} marker={marker} />
      <Arrow from={[154, 106]} to={[154, 82]} marker={marker} />
      <Packet at={[46, 108]} />
      <Packet at={[154, 108]} />
    </>
  ),
];

export default variants;
