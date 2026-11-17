import { Arrow, Divider, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const ROWS: [string, string, number][] = [
  ['a', 'v4', 30],
  ['aaaa', 'v6', 64],
  ['cname', 'name', 98],
];

function nearestPanel(ox: number, nearLeft: boolean, eu: string, us: string, marker: string) {
  const client: [number, number] = [ox + 50, 22];
  const left: [number, number] = [ox + 26, 74];
  const right: [number, number] = [ox + 74, 74];
  const near = nearLeft ? left : right;
  const far = nearLeft ? right : left;
  const toTop = (s: [number, number]): [number, number] => [s[0], s[1] - 18];
  const from: [number, number] = [client[0], client[1] + 14];
  return (
    <g>
      <Arrow from={from} to={toTop(far)} dashed weight="light" />
      <Arrow from={from} to={toTop(near)} marker={marker} tone="hit" weight="heavy" />
      <Packet at={[(from[0] + near[0]) / 2, (from[1] + near[1] - 18) / 2]} tone="hit" />
      <Mini kind="client" x={client[0]} y={client[1]} w={34} h={24} />
      <Mini kind="server" x={left[0]} y={left[1]} w={32} h={26} standby={!nearLeft} />
      <Mini kind="server" x={right[0]} y={right[1]} w={32} h={26} standby={nearLeft} />
      <Label x={left[0]} y={110} text={eu} />
      <Label x={right[0]} y={110} text={us} />
    </g>
  );
}

const variants: VariantDrawing[] = [
  (marker, labels) => (
    <>
      {ROWS.map(([record, target, y]) => (
        <g key={record}>
          <Label x={40} y={y} text={labels(record)} />
          <Arrow from={[78, y - 5]} to={[116, y - 5]} marker={marker} />
          <Label x={152} y={y} text={labels(target)} />
        </g>
      ))}
    </>
  ),
  (marker, labels) => (
    <>
      {nearestPanel(0, true, labels('eu'), labels('us'), marker)}
      <Divider />
      {nearestPanel(100, false, labels('eu'), labels('us'), marker)}
    </>
  ),
];

export default variants;
