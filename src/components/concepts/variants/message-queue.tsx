import { Arrow, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const workers = [24, 60, 96];

const variants: VariantDrawing[] = [
  (marker) => (
    <>
      {workers.map((y) => (
        <Arrow key={y} from={[76, 60]} to={[126, y]} marker={marker} />
      ))}
      <Mini kind="queue" x={48} y={60} w={48} h={30} />
      {workers.map((y) => (
        <Mini key={y} kind="server" x={150} y={y} w={40} h={24} />
      ))}
      <Packet at={[100, 42]} />
      <Packet at={[104, 60]} />
      <Packet at={[100, 78]} />
    </>
  ),
  (marker, labels) => (
    <>
      <Arrow from={[60, 44]} to={[90, 44]} marker={marker} />
      <Arrow from={[134, 44]} to={[186, 44]} marker={marker} tone="hit" />
      <Arrow from={[100, 28]} via={[74, 4]} to={[46, 26]} marker={marker} tone="miss" />
      <Arrow from={[112, 60]} to={[112, 80]} marker={marker} tone="miss" />
      <Mini kind="queue" x={36} y={44} w={44} h={28} />
      <Mini kind="server" x={112} y={44} w={40} h={28} warn />
      <Mini kind="queue" x={112} y={96} w={44} h={24} />
      <Packet at={[164, 44]} tone="hit" />
      <Label x={168} y={101} text={labels('dead')} />
    </>
  ),
];

export default variants;
