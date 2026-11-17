import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/real-time';
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
import variants from '../variants/real-time';

const L = labelReader(entry.labels);
const REAL_TIME_HEIGHT = 230;

const NODE_H = 58;
const friend = { x: 260, y: 36, w: 92, h: NODE_H } satisfies Positioned;
const app = { x: 60, y: 160, w: 88, h: NODE_H } satisfies Positioned;
const server = { x: 260, y: 160, w: 104, h: NODE_H } satisfies Positioned;

const REQ_Y = 153;
const RES_Y = 167;
const left = app.x + app.w / 2 + 6;
const right = server.x - server.w / 2 - 6;
const ask: Vec[] = [
  [left, REQ_Y],
  [right, REQ_Y],
];
const answer: Vec[] = [
  [right, RES_Y],
  [left, RES_Y],
];
const send: Vec[] = [
  [friend.x, friend.y + NODE_H / 2 + 6],
  [server.x, server.y - NODE_H / 2 - 6],
];
const SEND_MID: Vec = [friend.x, 98];

function Layout({ thumb, marker }: { thumb?: boolean; marker: string }) {
  return (
    <>
      <Edge from={ask[0] as Vec} to={ask[1] as Vec} marker={marker} />
      <Edge from={answer[0] as Vec} to={answer[1] as Vec} marker={marker} />
      <Edge from={send[0] as Vec} to={send[1] as Vec} marker={marker} />
      <SystemNode
        kind="client"
        x={friend.x}
        y={friend.y}
        width={friend.w}
        height={NODE_H}
        label={thumb ? '' : L('friend')}
      />
      <SystemNode
        kind="client"
        x={app.x}
        y={app.y}
        width={app.w}
        height={NODE_H}
        label={thumb ? '' : L('app')}
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

/** The app asks on a timer; most answers are empty and the friend's message waits for the next ask. */
function RealTimeWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const polls = [0, 0.25, 0.5, 0.75];
  const counts: Window[] = [
    [0, 0.16],
    [0.16, 0.41],
    [0.41, 0.91],
    [0.91, 1],
  ];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={REAL_TIME_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Layout thumb={thumb} marker={marker} />
          <Note x={156} y={140} text={L('every')} thumb={thumb} />
          {polls.map((s) => (
            <Dot key={s} path={ask} at={[s, s + 0.08]} />
          ))}
          {polls.map((s) => (
            <Dot
              key={`r${s}`}
              path={answer}
              at={[s + 0.08, s + 0.16]}
              response
              tone={s === 0.5 ? 'hit' : 'miss'}
            />
          ))}
          <Dot path={send} at={[0.28, 0.36]} tone="hit" />
          <Show at={[0.36, 0.58]}>
            <rect className="sdv-concept__chip" x={server.x - 26} y={112} width={16} height={10} rx={2} />
          </Show>
          {!thumb && (
            <g className="sdv-concept__counter">
              <text className="sdv-concept__note" x={150} y={214} textAnchor="end">
                {L('empty')}
              </text>
              {counts.map((at, n) => (
                <Show key={at.join()} at={at}>
                  <text className="sdv-concept__count" x={158} y={214}>
                    {n}
                  </text>
                </Show>
              ))}
            </g>
          )}
          <Still at={SEND_MID} tone="hit" />
          <Still at={[136, REQ_Y]} />
          <Still at={[176, RES_Y]} response tone="miss" />
          <Marker n={1} x={156} y={110} at={0} thumb={thumb} />
          <Marker n={2} x={194} y={208} at={0.16} thumb={thumb} />
          <Marker n={3} x={292} y={98} at={0.36} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** One connection stays open, and the server pushes each message the moment it lands. */
function RealTimeWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const pushes = [0.42, 0.66];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={REAL_TIME_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Show at={[0.18, 1]}>
            <rect
              className="sdv-concept__gauge-frame"
              x={left - 4}
              y={REQ_Y - 13}
              width={right - left + 8}
              height={RES_Y - REQ_Y + 26}
              rx={13}
            />
            <Note x={156} y={134} text={L('open')} thumb={thumb} />
          </Show>
          <Layout thumb={thumb} marker={marker} />
          <Dot path={ask} at={[0.02, 0.1]} />
          <Dot path={answer} at={[0.1, 0.18]} response tone="hit" />
          {pushes.map((s) => (
            <Dot key={s} path={send} at={[s - 0.08, s]} tone="hit" />
          ))}
          {pushes.map((s) => (
            <Dot key={`p${s}`} path={answer} at={[s, s + 0.08]} response tone="hit" />
          ))}
          <Dot path={ask} at={[0.84, 0.92]} />
          <Still at={SEND_MID} tone="hit" />
          <Still at={[136, REQ_Y]} />
          <Still at={[176, RES_Y]} response tone="hit" />
          <Marker n={1} x={60} y={112} at={0.02} thumb={thumb} />
          <Marker n={2} x={156} y={200} at={0.18} thumb={thumb} />
          <Marker n={3} x={292} y={98} at={0.34} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: RealTimeWithout, with: RealTimeWith, variants } satisfies ConceptScene;
