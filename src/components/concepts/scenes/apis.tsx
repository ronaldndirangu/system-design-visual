import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/apis';
import type { Positioned, Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/apis';

const L = labelReader(entry.labels);
const APIS_HEIGHT = 260;

const NODE_H = 58;
const client: Positioned = { x: 166, y: 36, w: 100, h: NODE_H };
const server: Positioned = { x: 166, y: 224, w: 104, h: NODE_H };

const REQ_X = 158;
const RES_X = 174;
const top = client.y + NODE_H / 2 + 6;
const bottom = server.y - NODE_H / 2 - 6;
const request: Vec[] = [
  [REQ_X, top],
  [REQ_X, bottom],
];
const response: Vec[] = [
  [RES_X, bottom],
  [RES_X, top],
];

/** Two exchanges: each request label sits left of the line, each reply label right of it. */
function Exchange({
  idPrefix,
  thumb,
  state,
  keys,
}: SceneProps & { state: (typeof entry.states)['without']; keys: [string, string, string, string] }) {
  const [ask1, answer1, ask2, answer2] = keys;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={APIS_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={request[0] as Vec} to={request[1] as Vec} marker={marker} />
          <Edge from={response[0] as Vec} to={response[1] as Vec} marker={marker} />
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
          <Show at={[0.02, 1]}>
            <Note x={REQ_X - 10} y={104} text={L(ask1)} anchor="end" thumb={thumb} />
          </Show>
          <Show at={[0.18, 1]}>
            <Note x={RES_X + 10} y={128} text={L(answer1)} anchor="start" thumb={thumb} />
          </Show>
          <Show at={[0.5, 1]}>
            <Note x={REQ_X - 10} y={152} text={L(ask2)} anchor="end" thumb={thumb} />
          </Show>
          <Show at={[0.68, 1]}>
            <Note x={RES_X + 10} y={176} text={L(answer2)} anchor="start" thumb={thumb} />
          </Show>
          <Dot path={request} at={[0.02, 0.16]} />
          <Dot path={response} at={[0.18, 0.32]} response tone="hit" />
          <Dot path={request} at={[0.5, 0.64]} />
          <Dot path={response} at={[0.68, 0.82]} response tone="hit" />
          <Still at={[REQ_X, 120]} />
          <Still at={[RES_X, 150]} response tone="hit" />
          <Marker n={1} x={14} y={98} at={0.02} thumb={thumb} />
          <Marker n={2} x={304} y={122} at={0.18} thumb={thumb} />
          <Marker n={3} x={14} y={146} at={0.5} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** REST: a verb and a URL per resource. */
function ApisWithout({ idPrefix, thumb }: SceneProps) {
  return (
    <Exchange
      idPrefix={idPrefix}
      thumb={thumb}
      state={entry.states.without}
      keys={['get', 'ok', 'post', 'created']}
    />
  );
}

/** RPC: a named server function per action. */
function ApisWith({ idPrefix, thumb }: SceneProps) {
  return (
    <Exchange
      idPrefix={idPrefix}
      thumb={thumb}
      state={entry.states.with}
      keys={['call', 'user', 'place', 'order']}
    />
  );
}

export default { without: ApisWithout, with: ApisWith, variants } satisfies ConceptScene;
