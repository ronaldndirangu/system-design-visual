import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/latency-throughput';
import type { Positioned, Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/latency-throughput';

const L = labelReader(entry.labels);
const HEIGHT = 220;

const NODE_H = 58;
const client: Positioned = { x: 56, y: 118, w: 72, h: NODE_H };
const server: Positioned = { x: 262, y: 118, w: 88, h: NODE_H };
const LEFT = client.x + 36 + 6;
const RIGHT = server.x - 44 - 6;
const TRIPS = [0, 0.3, 0.6];
const SLOTS = 9;
const SLOT_X = 116;
const SLOT_Y = 184;
const SLOT_XS = Array.from({ length: SLOTS }, (_, i) => SLOT_X + i * 14);

function lane(y: number): { go: Vec[]; back: Vec[] } {
  return {
    go: [
      [LEFT, y],
      [RIGHT, y],
    ],
    back: [
      [RIGHT, y],
      [LEFT, y],
    ],
  };
}

function Ends({ thumb }: { thumb?: boolean }) {
  return (
    <>
      <SystemNode
        kind="client"
        x={client.x}
        y={client.y}
        width={client.w}
        height={NODE_H}
        label={thumb ? '' : L('client')}
      />
      <SystemNode
        kind="server"
        x={server.x}
        y={server.y}
        width={server.w}
        height={NODE_H}
        label={thumb ? '' : L('server')}
      />
    </>
  );
}

/** A stopwatch that reads the round trip time once the first reply lands. */
function Stopwatch({ thumb }: { thumb?: boolean }) {
  return (
    <>
      <g>
        <rect className="sdv-concept__chip" x={93} y={22} width={6} height={5} rx={1} />
        <circle className="sdv-edge" cx={96} cy={40} r={12} />
        <path className="sdv-edge" d="M96 40V31M96 40l6 4" />
      </g>
      <Note x={116} y={46} text={L('latency')} thumb={thumb} anchor="start" />
      <Show at={[0.27, 1]}>
        <Note x={188} y={46} text={L('time')} thumb={thumb} anchor="start" />
      </Show>
    </>
  );
}

/** Nine slots that fill as round trips finish; `done` lists when each filled slot lights up. */
function Counter({ done, rate, thumb }: { done: number[]; rate: string; thumb?: boolean }) {
  return (
    <>
      <Note x={16} y={SLOT_Y + 12} text={L('throughput')} thumb={thumb} anchor="start" />
      {SLOT_XS.map((x) => (
        <rect key={x} className="sdv-concept__gauge-frame" x={x} y={SLOT_Y} width={10} height={14} rx={2} />
      ))}
      {done.map((at, i) => (
        <Show key={`d${at}`} at={[at, 1]}>
          <rect
            className="sdv-concept__fill--ok"
            x={SLOT_X + i * 14 + 1.5}
            y={SLOT_Y + 1.5}
            width={7}
            height={11}
            rx={1.5}
          />
        </Show>
      ))}
      <Note x={250} y={SLOT_Y + 12} text={rate} thumb={thumb} anchor="start" />
    </>
  );
}

/** One request at a time: each round trip takes 100 ms, so only 10 finish a second. */
function LatencyWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const path = lane(client.y);
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={[LEFT, client.y]} to={[RIGHT, client.y]} marker={marker} />
          <Ends thumb={thumb} />
          <Stopwatch thumb={thumb} />
          <Counter done={TRIPS.map((t) => t + 0.27)} rate={L('slow')} thumb={thumb} />
          {TRIPS.map((t) => (
            <Dot key={t} path={path.go} at={[t, t + 0.12]} />
          ))}
          {TRIPS.map((t) => (
            <Dot key={`r${t}`} path={path.back} at={[t + 0.15, t + 0.27]} response />
          ))}
          <Still at={[128, client.y]} />
          <Still at={[182, client.y]} response />
          <Marker n={1} x={156} y={76} at={0} thumb={thumb} />
          <Marker n={2} x={266} y={40} at={0.27} thumb={thumb} />
          <Marker n={3} x={176} y={164} at={0.57} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** Three requests side by side: each still takes 100 ms, and 30 finish a second. */
function LatencyWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const ys = [client.y - 18, client.y, client.y + 18];
  const trips = TRIPS.flatMap((t) => ys.map((y, j) => ({ y, start: t + j * 0.02 })));
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          {ys.map((y) => (
            <Edge key={y} from={[LEFT, y]} to={[RIGHT, y]} marker={marker} />
          ))}
          <Ends thumb={thumb} />
          <Stopwatch thumb={thumb} />
          <Counter done={trips.map((trip) => trip.start + 0.27)} rate={L('fast')} thumb={thumb} />
          {trips.map(({ y, start }) => (
            <Dot key={`${y}-${start}`} path={lane(y).go} at={[start, start + 0.12]} />
          ))}
          {trips.map(({ y, start }) => (
            <Dot key={`r${y}-${start}`} path={lane(y).back} at={[start + 0.15, start + 0.27]} response />
          ))}
          {ys.map((y, j) => (
            <Still key={y} at={[j === 1 ? 182 : 128, y]} response={j === 1} />
          ))}
          <Marker n={1} x={156} y={76} at={0} thumb={thumb} />
          <Marker n={2} x={266} y={40} at={0.27} thumb={thumb} />
          <Marker n={3} x={176} y={164} at={0.57} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: LatencyWithout, with: LatencyWith, variants } satisfies ConceptScene;
