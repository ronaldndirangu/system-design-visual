import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/cdn';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import {
  type ConceptScene,
  curve,
  Dot,
  Marker,
  Note,
  pointAt,
  SceneFrame,
  type SceneProps,
  Show,
  Still,
} from '../parts';
import variants from '../variants/cdn';

const L = labelReader(entry.labels);
const CDN_HEIGHT = 250;

const NODE_H = 58;
const origin: Positioned = { x: 70, y: 56, w: 92, h: NODE_H };
const users: Positioned = { x: 250, y: 196, w: 92, h: NODE_H };
const edge: Positioned = { x: 250, y: 92, w: 100, h: NODE_H };

const farFrom: Vec = [users.x - 92 / 2 - 6, users.y];
const farVia: Vec = [origin.x, users.y];
const farTo: Vec = [origin.x, origin.y + NODE_H / 2 + 6];
const farPath = curve(farFrom, farVia, farTo);
const farBack = [...farPath].reverse();

/** Two rough landmasses, enough to read as "far apart" without pretending to be a map. */
function World() {
  return (
    <g className="sdv-concept__land">
      <path d="M18 30C40 6 112 4 138 30C152 46 132 84 112 104C96 120 90 150 70 166C58 140 34 120 22 92C10 70 6 48 18 30Z" />
      <path d="M204 70C232 52 290 56 306 84C318 110 312 150 300 182C290 214 270 240 248 248C232 230 222 204 206 182C190 158 186 96 204 70Z" />
    </g>
  );
}

function Places({ thumb }: { thumb?: boolean }) {
  return (
    <>
      <World />
      <SystemNode
        kind="server"
        x={origin.x}
        y={origin.y}
        width={origin.w}
        height={NODE_H}
        label={thumb ? '' : L('origin')}
      />
      <SystemNode
        kind="client"
        x={users.x}
        y={users.y}
        width={users.w}
        height={NODE_H}
        label={thumb ? '' : L('users')}
      />
      <Note x={origin.x} y={18} text={L('virginia')} thumb={thumb} />
      <Note x={users.x} y={244} text={L('nairobi')} thumb={thumb} />
    </>
  );
}

/** Every user in Nairobi fetches the file from Virginia. */
function CdnWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const starts = [0, 0.24, 0.48, 0.72];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={CDN_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Places thumb={thumb} />
          <path
            className="sdv-edge"
            d={`M${farFrom[0]} ${farFrom[1]}Q${farVia[0]} ${farVia[1]} ${farTo[0]} ${farTo[1]}`}
            markerEnd={`url(#${marker})`}
          />
          <Note x={128} y={150} text={L('far')} thumb={thumb} />
          {starts.map((s) => (
            <Dot key={s} path={farPath} at={[s, s + 0.14]} />
          ))}
          {starts.map((s) => (
            <Dot key={`r${s}`} path={farBack} at={[s + 0.14, s + 0.28]} response />
          ))}
          <Still at={pointAt(farPath, 2)} />
          <Still at={pointAt(farPath, 6)} response />
          <Marker n={1} x={250} y={140} at={0} thumb={thumb} />
          <Marker n={2} x={176} y={140} at={0.14} thumb={thumb} />
          <Marker n={3} x={150} y={56} at={0.5} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The first request fills a nearby edge; later users get the file from it. */
function CdnWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const near = link(users, edge);
  const far = link(edge, origin);
  const later = [0.52, 0.66, 0.8];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={CDN_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Places thumb={thumb} />
          <Edge {...near} marker={marker} />
          <Edge {...far} marker={marker} />
          <SystemNode
            kind="cdn"
            x={edge.x}
            y={edge.y}
            width={edge.w}
            height={NODE_H}
            label={thumb ? '' : L('edge')}
          />
          <Show at={[0.38, 1]}>
            <rect className="sdv-concept__chip" x={266} y={76} width={16} height={10} rx={2} />
          </Show>
          <Note x={162} y={56} text={L('far')} thumb={thumb} />
          <Note x={264} y={150} text={L('near')} thumb={thumb} anchor="start" />
          <Dot path={[near.from, near.to]} at={[0, 0.06]} />
          <Dot path={[far.from, far.to]} at={[0.06, 0.22]} tone="miss" />
          <Dot path={[far.to, far.from]} at={[0.22, 0.38]} response />
          <Dot path={[near.to, near.from]} at={[0.38, 0.44]} response />
          {later.map((s) => (
            <Dot key={s} path={[near.from, near.to]} at={[s, s + 0.05]} />
          ))}
          {later.map((s) => (
            <Dot key={`r${s}`} path={[near.to, near.from]} at={[s + 0.05, s + 0.1]} response tone="hit" />
          ))}
          <Still at={lerp(near.from, near.to, 0.25)} />
          <Still at={lerp(near.from, near.to, 0.75)} response tone="hit" />
          <Marker n={1} x={150} y={110} at={0} thumb={thumb} />
          <Marker n={2} x={292} y={40} at={0.38} thumb={thumb} />
          <Marker n={3} x={222} y={146} at={0.52} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: CdnWithout, with: CdnWith, variants } satisfies ConceptScene;
