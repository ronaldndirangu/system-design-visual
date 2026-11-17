import type { Vec } from '../../viz/geometry';
import { Arrow, Divider, Gauge, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

function turnsPanel(ox: number, label: string, leastBusy: boolean, marker: string) {
  const xs = [18, 50, 82];
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      {xs.map((x, i) => (
        <Arrow
          key={x}
          from={[ox + 50, 53]}
          to={[ox + x, 68]}
          marker={marker}
          weight={leastBusy && i === 1 ? 'light' : 'heavy'}
        />
      ))}
      <Mini kind="loadBalancer" x={ox + 50} y={40} w={44} h={22} />
      {xs.map((x, i) => (
        <Mini key={x} kind="server" x={ox + x} y={84} w={26} h={28} warn={!leastBusy && i === 1} />
      ))}
      {xs.map((x, i) => (
        <Gauge
          key={x}
          x={ox + x}
          y={104}
          share={leastBusy ? 0.6 : i === 1 ? 1 : 0.4}
          bad={!leastBusy && i === 1}
        />
      ))}
    </g>
  );
}

function layerPanel(ox: number, label: string, paths: [string, string] | null, marker: string) {
  const left: Vec = [ox + (paths ? 32 : 26), 84];
  const right: Vec = [ox + (paths ? 80 : 74), 84];
  const lb: Vec = [ox + 50, 40];
  const on = (to: Vec, t: number): Vec => [lb[0] + (to[0] - lb[0]) * t, 53 + (68 - 53) * t];
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      <Arrow from={[lb[0], 53]} to={[left[0], 68]} marker={marker} />
      <Arrow from={[lb[0], 53]} to={[right[0], 68]} marker={marker} />
      <Mini kind="loadBalancer" x={lb[0]} y={lb[1]} w={44} h={22} />
      <Mini kind="server" x={left[0]} y={left[1]} w={32} h={28} />
      <Mini kind="server" x={right[0]} y={right[1]} w={32} h={28} />
      {paths ? (
        <>
          <Packet at={on(left, 0.5)} tone="hit" />
          <Packet at={on(right, 0.5)} />
          <Label x={left[0]} y={114} text={paths[0]} />
          <Label x={right[0]} y={114} text={paths[1]} />
        </>
      ) : (
        <>
          <Packet at={on(left, 0.3)} tone="hit" />
          <Packet at={on(left, 0.75)} />
          <Packet at={on(right, 0.3)} />
          <Packet at={on(right, 0.75)} tone="hit" />
        </>
      )}
    </g>
  );
}

function pairPanel(ox: number, standby: string | null, marker: string) {
  const balancers: [Vec, Vec] = [
    [ox + 30, 46],
    [ox + 72, 46],
  ];
  const servers: [Vec, Vec] = [
    [ox + 30, 96],
    [ox + 72, 96],
  ];
  const live = standby ? [balancers[0]] : balancers;
  return (
    <g>
      {standby && <Label x={ox + 72} y={22} text={standby} />}
      {live.map((b) => (
        <Arrow key={`in${b[0]}`} from={[b[0], 8]} to={[b[0], 29]} marker={marker} />
      ))}
      {live.flatMap((b) =>
        servers.map((s) => (
          <Arrow key={`${b[0]}-${s[0]}`} from={[b[0], 58]} to={[s[0], 77]} marker={marker} />
        )),
      )}
      <Mini kind="loadBalancer" x={balancers[0][0]} y={46} w={40} h={22} />
      <Mini kind="loadBalancer" x={balancers[1][0]} y={46} w={40} h={22} standby={Boolean(standby)} />
      {servers.map((s) => (
        <Mini key={s[0]} kind="server" x={s[0]} y={s[1]} w={30} h={26} />
      ))}
    </g>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      {turnsPanel(0, labels('turns'), false, marker)}
      <Divider />
      {turnsPanel(100, labels('busy'), true, marker)}
    </>
  ),
  (marker, labels) => (
    <>
      {layerPanel(0, labels('l4'), null, marker)}
      <Divider />
      {layerPanel(100, labels('l7'), [labels('images'), labels('api')], marker)}
    </>
  ),
  (marker, labels) => (
    <>
      {pairPanel(0, labels('standby'), marker)}
      <Divider />
      {pairPanel(100, null, marker)}
    </>
  ),
];

export default variants;
