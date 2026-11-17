import { Arrow, Divider, Label, Mini, Packet, Step } from '../miniParts';
import type { VariantDrawing } from '../parts';

/** Two identical requests hit one stored value; the label under the store is where it ends up. */
function repeatPanel(ox: number, label: string, result: string, marker: string) {
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      <Arrow from={[ox + 24, 38]} to={[ox + 46, 52]} marker={marker} />
      <Arrow from={[ox + 24, 86]} to={[ox + 46, 72]} marker={marker} />
      <Step n={1} at={[ox + 14, 34]} />
      <Step n={2} at={[ox + 14, 90]} />
      <Mini kind="database" x={ox + 68} y={62} w={36} h={34} />
      <Label x={ox + 68} y={110} text={result} />
    </g>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      {repeatPanel(0, labels('set'), labels('five'), marker)}
      <Divider />
      {repeatPanel(100, labels('add'), labels('ten'), marker)}
    </>
  ),
  (marker, labels) => (
    <>
      <Arrow from={[54, 46]} to={[78, 46]} marker={marker} tone="hit" />
      <Arrow from={[122, 46]} to={[146, 46]} marker={marker} />
      <Arrow from={[30, 64]} via={[30, 96]} to={[84, 66]} marker={marker} tone="miss" dashed />
      <Mini kind="queue" x={30} y={46} w={44} h={28} />
      <Mini kind="server" x={100} y={46} w={38} h={32} />
      <Mini kind="database" x={168} y={46} w={40} h={34} />
      <Packet at={[66, 46]} tone="hit" />
      <Packet at={[43, 81]} tone="miss" />
      <Label x={66} y={26} text={labels('id')} />
      <Label x={44} y={108} text={labels('id')} />
      <Label x={168} y={88} text={labels('id')} />
    </>
  ),
];

export default variants;
