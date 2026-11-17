import { Arrow, Divider, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const cells = [33, 59, 85, 111, 137, 163];

/** A source on the left feeding two receivers; `both` sends a copy down each arrow. */
function fanPanel(x: number, text: string, both: boolean, marker: string) {
  return (
    <>
      <Arrow from={[x + 38, 52]} to={[x + 64, 34]} marker={marker} />
      <Arrow from={[x + 38, 68]} to={[x + 64, 80]} marker={marker} dashed={!both} />
      <Mini kind="queue" x={x + 22} y={60} w={30} h={26} />
      <Mini kind="server" x={x + 80} y={28} w={30} h={22} />
      <Mini kind="server" x={x + 80} y={86} w={30} h={22} />
      <Packet at={[x + 51, 43]} tone="hit" />
      {both && <Packet at={[x + 51, 74]} tone="hit" />}
      <Label x={x + 50} y={116} text={text} />
    </>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Divider />
      {fanPanel(0, labels('queue'), false, marker)}
      {fanPanel(100, labels('topic'), true, marker)}
    </>
  ),
  (marker) => (
    <>
      {cells.map((x, i) => (
        <rect
          key={x}
          className={i < 5 ? 'sdv-concept__fill--ok' : 'sdv-concept__gauge-frame'}
          x={x - 11}
          y={56}
          width={22}
          height={20}
          rx={3}
        />
      ))}
      <Arrow from={[137, 32]} to={[137, 50]} marker={marker} />
      <Arrow from={[59, 102]} to={[59, 82]} marker={marker} />
      <Arrow from={[109, 50]} via={[85, 26]} to={[63, 48]} marker={marker} tone="miss" />
      <Mini kind="client" x={137} y={18} w={36} h={22} />
      <Mini kind="client" x={59} y={106} w={36} h={22} standby />
    </>
  ),
];

export default variants;
