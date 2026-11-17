import type { Vec } from '../../viz/geometry';
import { Arrow, Divider, Gauge, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

function pairPanel(ox: number, failed: boolean, marker: string) {
  const client: Vec = [ox + 50, 24];
  const servers: [Vec, Vec] = [
    [ox + 26, 74],
    [ox + 74, 74],
  ];
  return (
    <g>
      {servers.map(([x], i) => {
        const down = failed && i === 0;
        return (
          <Arrow
            key={x}
            from={[client[0] + (i === 0 ? -8 : 8), 38]}
            to={[x, 56]}
            marker={down ? undefined : marker}
            dashed={down}
            weight={failed && !down ? 'heavy' : undefined}
          />
        );
      })}
      <Mini kind="client" x={client[0]} y={client[1]} w={40} h={24} />
      {servers.map(([x, y], i) => (
        <Mini key={x} kind="server" x={x} y={y} w={34} h={30} warn={failed && i === 0} />
      ))}
      {servers.map(([x], i) => (
        <Gauge key={x} x={x} y={96} share={failed ? (i === 0 ? 0 : 1) : 0.5} />
      ))}
    </g>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      <Arrow from={[90, 38]} to={[66, 58]} marker={marker} />
      <Arrow from={[84, 76]} to={[114, 76]} marker={marker} dashed weight="light" />
      <Mini kind="client" x={100} y={24} w={44} h={26} />
      <Mini kind="database" x={60} y={78} w={44} h={36} />
      <Mini kind="database" x={140} y={78} w={44} h={36} standby />
      <Packet at={[78, 48]} />
      <Label x={140} y={114} text={labels('standby')} />
    </>
  ),
  (marker) => (
    <>
      {pairPanel(0, false, marker)}
      <Divider />
      {pairPanel(100, true, marker)}
    </>
  ),
];

export default variants;
