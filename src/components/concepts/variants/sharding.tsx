import { Arrow, Divider, Gauge, Label, Mini, Packet } from '../miniParts';
import type { VariantDrawing } from '../parts';

const KEY_X = [14, 28, 42, 56, 70, 84] as const;
const SHARD_X = [20, 50, 80] as const;
const RANGE_TO = [0, 0, 1, 1, 2, 2];
const HASH_TO = [1, 2, 0, 2, 0, 1];

function Keys({ dx }: { dx: number }) {
  return (
    <>
      {KEY_X.map((x, i) => (
        <rect
          key={x}
          className="sdv-concept__chip"
          x={dx + x - 4}
          y={52 - (6 + i * 3)}
          width={8}
          height={6 + i * 3}
          rx={1.5}
        />
      ))}
    </>
  );
}

function Shards({ dx, to }: { dx: number; to: number[] }) {
  return (
    <>
      {KEY_X.map((x, i) => {
        const shard = SHARD_X[to[i] ?? 0] ?? 0;
        return <Arrow key={x} from={[dx + x, 56]} to={[dx + shard, 74]} weight="light" />;
      })}
      {SHARD_X.map((x) => (
        <Mini key={x} kind="database" x={dx + x} y={90} w={26} h={28} />
      ))}
    </>
  );
}

const variants: VariantDrawing[] = [
  (_marker, labels) => (
    <>
      <Divider />
      <Label x={50} y={18} text={labels('range')} />
      <Keys dx={0} />
      <Shards dx={0} to={RANGE_TO} />
      <Label x={150} y={18} text={labels('hash')} />
      <Keys dx={100} />
      <Shards dx={100} to={HASH_TO} />
    </>
  ),
  (marker) => (
    <>
      <Mini kind="client" x={100} y={22} w={44} h={28} />
      <Arrow from={[84, 38]} to={[34, 63]} marker={marker} tone="miss" />
      <Packet at={[74, 43]} tone="miss" />
      <Packet at={[60, 50]} tone="miss" />
      <Arrow from={[100, 38]} to={[100, 62]} marker={marker} weight="light" />
      <Arrow from={[114, 38]} to={[154, 62]} marker={marker} weight="light" />
      <Mini kind="database" x={40} y={80} w={44} h={30} warn />
      <Mini kind="database" x={100} y={80} w={44} h={30} />
      <Mini kind="database" x={160} y={80} w={44} h={30} />
      <Gauge x={40} y={102} share={1} bad />
      <Gauge x={100} y={102} share={0.15} />
      <Gauge x={160} y={102} share={0.15} />
    </>
  ),
];

export default variants;
