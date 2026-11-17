import { Arrow, Divider, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Divider />
      {[48, 60, 72].map((y) => (
        <Arrow key={y} from={[40, y]} to={[62, y]} marker={marker} />
      ))}
      <Mini kind="client" x={22} y={60} w={32} h={34} />
      <Mini kind="server" x={80} y={60} w={32} h={34} />
      <Label x={50} y={110} text={labels('rest')} />
      <Arrow from={[140, 54]} to={[162, 54]} marker={marker} />
      <Arrow from={[162, 66]} to={[140, 66]} marker={marker} tone="hit" />
      <Mini kind="client" x={122} y={60} w={32} h={34} />
      <Mini kind="server" x={180} y={60} w={32} h={34} />
      <Label x={150} y={110} text={labels('gql')} />
    </>
  ),
  (marker, labels) => (
    <>
      <rect className="sdv-concept__gauge-frame" x={66} y={10} width={68} height={30} rx={4} />
      <Label x={100} y={31} text={labels('schema')} />
      <Arrow from={[70, 40]} to={[48, 58]} dashed />
      <Arrow from={[130, 40]} to={[152, 58]} dashed />
      <Arrow from={[64, 76]} to={[136, 76]} marker={marker} />
      <Arrow from={[136, 90]} to={[64, 90]} marker={marker} tone="hit" />
      <Mini kind="client" x={40} y={82} w={40} h={34} />
      <Mini kind="server" x={160} y={82} w={40} h={34} />
      <Packet at={[100, 76]} />
      <Packet at={[100, 90]} tone="hit" response />
    </>
  ),
];

export default variants;
