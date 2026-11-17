import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/consistency';
import type { Positioned, Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import {
  type ConceptScene,
  Dot,
  Marker,
  Note,
  SceneFrame,
  type SceneProps,
  Show,
  Still,
  type Window,
} from '../parts';
import variants from '../variants/consistency';

const L = labelReader(entry.labels);
const CONSISTENCY_HEIGHT = 250;

const CLIENT_H = 58;
const DB_H = 62;
const writer: Positioned = { x: 64, y: 40, w: 92, h: CLIENT_H };
const reader: Positioned = { x: 256, y: 40, w: 92, h: CLIENT_H };
const leader: Positioned = { x: 64, y: 180, w: 96, h: DB_H };
const replica: Positioned = { x: 256, y: 180, w: 96, h: DB_H };

const top = writer.y + CLIENT_H / 2 + 6;
const bottom = leader.y - DB_H / 2 - 6;
const down = (x: number): Vec[] => [
  [x, top],
  [x, bottom],
];
const up = (x: number): Vec[] => [
  [x, bottom],
  [x, top],
];
const copy: Vec[] = [
  [leader.x + 48 + 6, leader.y],
  [replica.x - 48 - 6, replica.y],
];

function Layout({ thumb, marker }: { thumb?: boolean; marker: string }) {
  return (
    <>
      <Edge from={[writer.x, top]} to={[writer.x, bottom]} marker={marker} />
      <Edge from={[reader.x, top]} to={[reader.x, bottom]} marker={marker} />
      <Edge from={copy[0] as Vec} to={copy[1] as Vec} marker={marker} />
      {(
        [
          [writer, 'writer'],
          [reader, 'reader'],
        ] as const
      ).map(([node, key]) => (
        <SystemNode
          key={key}
          kind="client"
          x={node.x}
          y={node.y}
          width={node.w}
          height={CLIENT_H}
          label={thumb ? '' : L(key)}
        />
      ))}
      {(
        [
          [leader, 'leader'],
          [replica, 'replica'],
        ] as const
      ).map(([node, key]) => (
        <SystemNode
          key={key}
          kind="database"
          x={node.x}
          y={node.y}
          width={node.w}
          height={DB_H}
          label={thumb ? '' : L(key)}
        />
      ))}
      <Note x={160} y={170} text={L('copy')} thumb={thumb} />
    </>
  );
}

/** The value each database holds, written under it; the replica switches when the copy lands. */
function Values({ thumb, landed }: { thumb?: boolean; landed: number }) {
  if (thumb) return null;
  const replicaOld: Window = [0, landed];
  const replicaNew: Window = [landed, 1];
  return (
    <>
      <Show at={[0, 0.14]}>
        <Note x={leader.x} y={238} text={L('old')} />
      </Show>
      <Show at={[0.14, 1]}>
        <Note x={leader.x} y={238} text={L('new')} />
      </Show>
      <Show at={replicaOld}>
        <Note x={replica.x} y={238} text={L('old')} />
      </Show>
      <Show at={replicaNew}>
        <Note x={replica.x} y={238} text={L('new')} />
      </Show>
    </>
  );
}

/** The leader waits for the copy before it confirms, so every later read is fresh. */
function ConsistencyWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={CONSISTENCY_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Layout thumb={thumb} marker={marker} />
          <Values thumb={thumb} landed={0.5} />
          <Show at={[0.62, 1]}>
            <Note x={writer.x + 10} y={114} text={L('slow')} anchor="start" thumb={thumb} />
          </Show>
          <Dot path={down(writer.x)} at={[0.02, 0.14]} />
          <Dot path={copy} at={[0.16, 0.5]} />
          <Dot path={up(writer.x)} at={[0.52, 0.62]} response tone="hit" />
          <Dot path={down(reader.x)} at={[0.7, 0.8]} />
          <Dot path={up(reader.x)} at={[0.8, 0.9]} response tone="hit" />
          <Still at={[160, 180]} />
          <Still at={[writer.x, 96]} response tone="hit" />
          <Still at={[reader.x, 96]} response tone="hit" />
          <Marker n={1} x={160} y={206} at={0.16} thumb={thumb} />
          <Marker n={2} x={40} y={110} at={0.52} thumb={thumb} />
          <Marker n={3} x={284} y={110} at={0.7} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The leader confirms at once; a read that beats the copy gets the old value. */
function ConsistencyWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={CONSISTENCY_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Layout thumb={thumb} marker={marker} />
          <Values thumb={thumb} landed={0.7} />
          <Show at={[0.24, 1]}>
            <Note x={writer.x + 10} y={114} text={L('fast')} anchor="start" thumb={thumb} />
          </Show>
          <Dot path={down(writer.x)} at={[0.02, 0.14]} />
          <Dot path={up(writer.x)} at={[0.14, 0.24]} response tone="hit" />
          <Dot path={copy} at={[0.2, 0.7]} />
          <Dot path={down(reader.x)} at={[0.3, 0.4]} />
          <Dot path={up(reader.x)} at={[0.4, 0.5]} response tone="miss" />
          <Dot path={down(reader.x)} at={[0.76, 0.84]} />
          <Dot path={up(reader.x)} at={[0.84, 0.94]} response tone="hit" />
          <Still at={[160, 180]} />
          <Still at={[writer.x, 96]} response tone="hit" />
          <Still at={[reader.x, 96]} response tone="miss" />
          <Marker n={1} x={40} y={110} at={0.14} thumb={thumb} />
          <Marker n={2} x={284} y={110} at={0.4} thumb={thumb} />
          <Marker n={3} x={160} y={206} at={0.7} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: ConsistencyWithout, with: ConsistencyWith, variants } satisfies ConceptScene;
