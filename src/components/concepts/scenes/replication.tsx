import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/replication';
import { lerp, type Vec } from '../../viz/geometry';
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
} from '../parts';
import variants from '../variants/replication';

const L = labelReader(entry.labels);
const SINGLE_HEIGHT = 250;
const REPLICA_HEIGHT = 270;
const NODE_H = 58;
const FAIL_AT = 0.66;

/** One database takes every read and write; its gauge fills, then it fails and every request fails. */
function SingleScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const app = { x: 160, y: 40 };
  const db = { x: 160, y: 196, w: 104, h: 62 };
  const top = app.y + NODE_H / 2 + 6;
  const bottom = db.y - db.h / 2 - 6;
  const tones = ['ok', 'ok', 'warn', 'bad', 'bad'] as const;
  const request = (start: number) => (
    <Dot
      key={start}
      path={[
        [154, top],
        [154, bottom],
      ]}
      at={[start, start + 0.08]}
    />
  );
  const response = (start: number, failed?: boolean) => (
    <Dot
      key={`r${start}`}
      path={[
        [166, bottom],
        [166, top],
      ]}
      at={[start + 0.08, start + 0.16]}
      response
      tone={failed ? 'bad' : undefined}
    />
  );
  const healthy = [0.02, 0.12, 0.22, 0.32, 0.42, 0.52];
  const failing = [0.7, 0.8];
  const dbNode = (status?: 'bad') => (
    <SystemNode
      kind="database"
      x={db.x}
      y={db.y}
      width={db.w}
      height={db.h}
      label={thumb ? '' : L('database')}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={SINGLE_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={[160, top]} to={[160, bottom]} marker={marker} />
          <SystemNode
            kind="client"
            x={app.x}
            y={app.y}
            width={88}
            height={NODE_H}
            label={thumb ? '' : L('app')}
          />
          <Show at={[0, FAIL_AT]}>{dbNode()}</Show>
          <Show at={[FAIL_AT, 1]}>{dbNode('bad')}</Show>
          <g className="sdv-concept__gauge">
            <rect className="sdv-concept__gauge-frame" x={228} y={165} width={24} height={62} rx={4} />
            {tones.map((tone, i) => (
              <Show key={tone + String(i)} at={[0.06 + i * 0.11, 1]}>
                <rect
                  className={`sdv-concept__fill--${tone}`}
                  x={232}
                  y={215 - i * 12}
                  width={16}
                  height={8}
                  rx={2}
                />
              </Show>
            ))}
          </g>
          {[...healthy, ...failing].map(request)}
          {healthy.map((start) => response(start))}
          {failing.map((start) => response(start, true))}
          <Still at={[154, 108]} />
          <Still at={[166, 128]} response tone="bad" />
          <Marker n={1} x={196} y={117} at={0} thumb={thumb} />
          <Marker n={2} x={280} y={196} at={0.28} thumb={thumb} />
          <Marker n={3} x={78} y={196} at={FAIL_AT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const APP: Vec = [160, 32];
const LEADER: Vec = [160, 128];
const LEADER_H = 58;
const FOLLOWER_Y = 230;
const FOLLOWER_X = [64, 256] as const;
const FOLLOWER_W = 104;
const COPY_DONE = 0.28;
const READ_AT = 0.55;

/** Writes go to the leader, which copies them to two followers; the slow follower serves a stale read. */
function ReplicaScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const [left, right] = FOLLOWER_X;
  const followerTop = FOLLOWER_Y - NODE_H / 2 - 6;
  const write: Vec[] = [
    [APP[0], APP[1] + NODE_H / 2 + 6],
    [LEADER[0], LEADER[1] - LEADER_H / 2 - 6],
  ];
  const leaderBottom = LEADER[1] + LEADER_H / 2 + 4;
  const copyLeft: Vec[] = [
    [LEADER[0] - 32, leaderBottom],
    [left + 20, followerTop],
  ];
  const copyRight: Vec[] = [
    [LEADER[0] + 32, leaderBottom],
    [right - 20, followerTop],
  ];
  const readLeft = curve([APP[0] - 50, APP[1]], [left, APP[1]], [left, followerTop]);
  const readRight = curve([APP[0] + 50, APP[1]], [right, APP[1]], [right, followerTop]);
  const follower = (x: number, label: string) => (
    <SystemNode
      kind="database"
      x={x}
      y={FOLLOWER_Y}
      width={FOLLOWER_W}
      height={NODE_H}
      label={thumb ? '' : label}
    />
  );
  const readEdge = (points: Vec[], via: Vec, marker: string) => (
    <Edge from={points[0] as Vec} via={via} to={points[points.length - 1] as Vec} marker={marker} />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={REPLICA_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={write[0] as Vec} to={write[1] as Vec} marker={marker} />
          <Edge from={copyLeft[0] as Vec} to={copyLeft[1] as Vec} marker={marker} />
          <Edge from={copyRight[0] as Vec} to={copyRight[1] as Vec} marker={marker} />
          {readEdge(readLeft, [left, APP[1]], marker)}
          {readEdge(readRight, [right, APP[1]], marker)}
          <SystemNode
            kind="client"
            x={APP[0]}
            y={APP[1]}
            width={88}
            height={NODE_H}
            label={thumb ? '' : L('app')}
          />
          <SystemNode
            kind="database"
            x={LEADER[0]}
            y={LEADER[1]}
            width={100}
            height={LEADER_H}
            label={thumb ? '' : L('leader')}
          />
          {follower(left, L('follower1'))}
          {follower(right, L('follower2'))}
          <Show at={[0, 0.12]}>
            <Note x={228} y={133} text={L('v1')} thumb={thumb} />
          </Show>
          <Show at={[0.12, 1]}>
            <Note x={228} y={133} text={L('v2')} thumb={thumb} />
          </Show>
          <Show at={[0, COPY_DONE]}>
            <Note x={22} y={190} text={L('v1')} thumb={thumb} />
          </Show>
          <Show at={[COPY_DONE, 1]}>
            <Note x={22} y={190} text={L('v2')} thumb={thumb} />
          </Show>
          <Note x={298} y={190} text={L('v1')} thumb={thumb} />
          <Show at={[0.3, 1]}>
            <Note x={160} y={196} text={L('lag')} thumb={thumb} />
          </Show>
          <Dot path={write} at={[0.02, 0.12]} />
          <Dot path={copyLeft} at={[0.14, COPY_DONE]} tone="hit" />
          <Dot path={copyRight} at={[0.15, 0.95]} tone="miss" />
          <Dot path={readLeft} at={[READ_AT, READ_AT + 0.12]} />
          <Dot path={[...readLeft].reverse()} at={[READ_AT + 0.12, READ_AT + 0.24]} response tone="hit" />
          <Dot path={readRight} at={[READ_AT, READ_AT + 0.12]} />
          <Dot path={[...readRight].reverse()} at={[READ_AT + 0.12, READ_AT + 0.24]} response tone="miss" />
          <Still at={lerp(copyRight[0] as Vec, copyRight[1] as Vec, 0.5)} tone="miss" />
          <Still at={readRight[5] as Vec} response tone="miss" />
          <Marker n={1} x={186} y={80} at={0} thumb={thumb} />
          <Marker n={2} x={160} y={224} at={0.14} thumb={thumb} />
          <Marker n={3} x={28} y={110} at={READ_AT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: SingleScene, with: ReplicaScene, variants } satisfies ConceptScene;
