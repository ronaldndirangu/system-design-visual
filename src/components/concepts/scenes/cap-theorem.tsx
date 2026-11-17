import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/cap-theorem';
import type { Positioned, Vec } from '../../viz/geometry';
import { StatusBadge } from '../../viz/icons';
import { Edge, SystemNode } from '../../viz/SystemNode';
import {
  type ConceptScene,
  curve,
  Dot,
  Marker,
  Note,
  SceneFrame,
  type SceneProps,
  Show,
  Still,
  type Window,
} from '../parts';
import variants from '../variants/cap-theorem';

const L = labelReader(entry.labels);
const CAP_HEIGHT = 250;

const CLIENT_H = 58;
const DB_H = 62;
const SPLIT_X = 200;
const alice: Positioned = { x: 140, y: 36, w: 88, h: CLIENT_H };
const bob: Positioned = { x: 264, y: 36, w: 84, h: CLIENT_H };
const replicas = {
  paris: { x: 52, y: 150, w: 64, h: DB_H },
  rome: { x: 140, y: 150, w: 68, h: DB_H },
  lima: { x: 264, y: 150, w: 64, h: DB_H },
} satisfies Record<string, Positioned>;
type Place = keyof typeof replicas;

const top = alice.y + CLIENT_H / 2 + 6;
const bottom = replicas.rome.y - DB_H / 2 - 6;
const down = (x: number): Vec[] => [
  [x, top],
  [x, bottom],
];
const up = (x: number): Vec[] => [
  [x, bottom],
  [x, top],
];

/** Paris and Rome share a short link that dips under both drums. */
const pairFrom: Vec = [replicas.paris.x, replicas.paris.y + DB_H / 2 + 6];
const pairVia: Vec = [96, 222];
const pairTo: Vec = [replicas.rome.x, replicas.rome.y + DB_H / 2 + 6];
const romeToParis = curve(pairTo, pairVia, pairFrom);
const romeEdge = replicas.rome.x + replicas.rome.w / 2 + 6;
const limaEdge = replicas.lima.x - replicas.lima.w / 2 - 6;
const span: Vec[] = [
  [romeEdge, 150],
  [limaEdge, 150],
];
const spanBack: Vec[] = [
  [limaEdge, 150],
  [romeEdge, 150],
];
const toSplit: Vec[] = [
  [limaEdge, 150],
  [SPLIT_X + 10, 150],
];

/** A square above a replica for each write it holds: green for Alice, amber for Bob. */
function Chip({ place, writer, at }: { place: Place; writer: 'alice' | 'bob'; at: Window }) {
  return (
    <Show at={at}>
      <rect
        className={writer === 'alice' ? 'sdv-concept__chip' : 'sdv-concept__fill--warn'}
        x={replicas[place].x + (writer === 'alice' ? 6 : 22)}
        y={104}
        width={14}
        height={10}
        rx={2}
      />
    </Show>
  );
}

function Split({ at, healed }: { at: Window; healed?: boolean }) {
  return (
    <Show at={at}>
      <g className={healed ? 'sdv-concept__cut' : undefined}>
        <path className="sdv-edge sdv-edge--dashed sdv-concept__edge--miss" d={`M${SPLIT_X} 84V214`} />
      </g>
      {!healed && <StatusBadge status="bad" x={SPLIT_X} y={150} />}
    </Show>
  );
}

function Span({ at, cut }: { at: Window; cut?: boolean }) {
  const edge = <Edge from={[romeEdge, 150]} to={[limaEdge, 150]} dashed={cut} />;
  return <Show at={at}>{cut ? <g className="sdv-concept__cut">{edge}</g> : edge}</Show>;
}

function Layout({ thumb, marker, limaWarn }: { thumb?: boolean; marker: string; limaWarn?: Window }) {
  return (
    <>
      <path
        className="sdv-edge"
        d={`M${pairFrom[0]} ${pairFrom[1]}Q${pairVia[0]} ${pairVia[1]} ${pairTo[0]} ${pairTo[1]}`}
      />
      <Edge from={[alice.x, top]} to={[alice.x, bottom]} marker={marker} />
      <Edge from={[bob.x, top]} to={[bob.x, bottom]} marker={marker} />
      {[alice, bob].map((client, i) => (
        <SystemNode
          key={client.x}
          kind="client"
          x={client.x}
          y={client.y}
          width={client.w}
          height={CLIENT_H}
          label={thumb ? '' : L(i === 0 ? 'alice' : 'bob')}
        />
      ))}
      {(['paris', 'rome', 'lima'] as const).map((place) => (
        <SystemNode
          key={place}
          kind="database"
          x={replicas[place].x}
          y={replicas[place].y}
          width={replicas[place].w}
          height={DB_H}
          label={thumb ? '' : L(place)}
        />
      ))}
      {limaWarn && (
        <Show at={limaWarn}>
          <StatusBadge
            status="warn"
            x={replicas.lima.x + replicas.lima.w / 2 - 4}
            y={replicas.lima.y - DB_H / 2 + 4}
          />
        </Show>
      )}
      <Note x={96} y={240} text={L('majority')} thumb={thumb} />
      <Note x={replicas.lima.x} y={240} text={L('minority')} thumb={thumb} />
    </>
  );
}

/** The split isolates Lima; the majority side keeps writing and Lima refuses Bob. */
function CapWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={CAP_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Span at={[0, 0.14]} />
          <Span at={[0.14, 1]} cut />
          <Layout thumb={thumb} marker={marker} limaWarn={[0.7, 1]} />
          <Split at={[0.14, 1]} />
          <Dot path={span} at={[0.02, 0.12]} />
          <Dot path={down(alice.x)} at={[0.22, 0.32]} />
          <Chip place="rome" writer="alice" at={[0.32, 1]} />
          <Dot path={romeToParis} at={[0.32, 0.42]} tone="hit" />
          <Chip place="paris" writer="alice" at={[0.42, 1]} />
          <Dot path={up(alice.x)} at={[0.42, 0.52]} response tone="hit" />
          <Dot path={down(bob.x)} at={[0.56, 0.66]} />
          <Dot path={toSplit} at={[0.66, 0.72]} tone="miss" />
          <Dot path={up(bob.x)} at={[0.74, 0.84]} response tone="bad" />
          <Still at={[alice.x, 84]} />
          <Still at={[alice.x, 100]} response tone="hit" />
          <Still at={[bob.x, 84]} />
          <Still at={[bob.x, 100]} response tone="bad" />
          <Marker n={1} x={SPLIT_X} y={68} at={0.14} thumb={thumb} />
          <Marker n={2} x={80} y={36} at={0.32} thumb={thumb} />
          <Marker n={3} x={304} y={84} at={0.7} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** Both sides keep accepting writes during the split, then swap them when the link heals. */
function CapWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={CAP_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Span at={[0, 0.14]} />
          <Span at={[0.14, 0.62]} cut />
          <Span at={[0.62, 1]} />
          <Layout thumb={thumb} marker={marker} />
          <Split at={[0.14, 0.62]} />
          <Split at={[0.62, 1]} healed />
          <Dot path={span} at={[0.02, 0.12]} />
          <Dot path={down(alice.x)} at={[0.22, 0.32]} />
          <Dot path={down(bob.x)} at={[0.22, 0.32]} />
          <Chip place="rome" writer="alice" at={[0.32, 1]} />
          <Chip place="lima" writer="bob" at={[0.32, 1]} />
          <Dot path={romeToParis} at={[0.32, 0.42]} tone="hit" />
          <Chip place="paris" writer="alice" at={[0.42, 1]} />
          <Dot path={up(alice.x)} at={[0.36, 0.46]} response tone="hit" />
          <Dot path={up(bob.x)} at={[0.36, 0.46]} response tone="hit" />
          <Dot path={span} at={[0.64, 0.74]} tone="hit" />
          <Dot path={spanBack} at={[0.64, 0.74]} tone="miss" />
          <Chip place="lima" writer="alice" at={[0.74, 1]} />
          <Chip place="rome" writer="bob" at={[0.74, 1]} />
          <Dot path={romeToParis} at={[0.74, 0.84]} tone="miss" />
          <Chip place="paris" writer="bob" at={[0.84, 1]} />
          <Still at={[alice.x, 84]} />
          <Still at={[alice.x, 100]} response tone="hit" />
          <Still at={[bob.x, 84]} />
          <Still at={[bob.x, 100]} response tone="hit" />
          <Marker n={1} x={SPLIT_X} y={68} at={0.14} thumb={thumb} />
          <Marker n={2} x={80} y={36} at={0.32} thumb={thumb} />
          <Marker n={3} x={SPLIT_X} y={180} at={0.64} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: CapWithout, with: CapWith, variants } satisfies ConceptScene;
