import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/idempotency';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
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
import variants from '../variants/idempotency';

const L = labelReader(entry.labels);
const IDEMPOTENCY_HEIGHT = 262;

const NODE_H = 58;
const app: Positioned = { x: 52, y: 44, w: 84, h: NODE_H };
const server: Positioned = { x: 250, y: 44, w: 96, h: NODE_H };
const payments: Positioned = { x: 250, y: 190, w: 112, h: NODE_H };
const keys: Positioned = { x: 96, y: 190, w: 96, h: 64 };
const leg = link(app, server);
const payLeg = link(server, payments);
const keyLeg = link(server, keys);
const lostAt = lerp(leg.to, leg.from, 0.5);

type Leg = { from: Vec; to: Vec };
const go = (l: Leg): Vec[] => [l.from, l.to];
const back = (l: Leg): Vec[] => [l.to, l.from];

function Base({ thumb, marker, withKeys }: { thumb?: boolean; marker: string; withKeys?: boolean }) {
  const label = (key: string) => (thumb ? '' : L(key));
  return (
    <>
      <Edge {...leg} marker={marker} />
      <Edge {...payLeg} marker={marker} />
      {withKeys && <Edge {...keyLeg} marker={marker} />}
      <SystemNode kind="client" x={app.x} y={app.y} width={app.w} height={NODE_H} label={label('app')} />
      <SystemNode
        kind="server"
        x={server.x}
        y={server.y}
        width={server.w}
        height={NODE_H}
        label={label('server')}
      />
      <SystemNode
        kind="server"
        x={payments.x}
        y={payments.y}
        width={payments.w}
        height={NODE_H}
        label={label('payments')}
      />
    </>
  );
}

/** A reply lost on its way back to the app, marked where it vanished. */
function LostReply({ at, thumb }: { at: Window; thumb?: boolean }) {
  return (
    <>
      <Dot path={[leg.to, lostAt]} at={at} response tone="bad" />
      <Show at={[at[1], 1]}>
        <Note x={lostAt[0]} y={70} text={L('lost')} thumb={thumb} />
      </Show>
    </>
  );
}

/** Running total charged to the card. */
function Charged({ steps, thumb }: { steps: { key: string; at: Window; bad?: boolean }[]; thumb?: boolean }) {
  if (thumb) return null;
  return (
    <g>
      <text className="sdv-concept__note" x={246} y={250} textAnchor="end">
        {L('charged')}
      </text>
      {steps.map(({ key, at, bad }) => (
        <Show key={key} at={at}>
          <text
            className={bad ? 'sdv-concept__count sdv-concept__fill--bad' : 'sdv-concept__count'}
            x={254}
            y={250}
          >
            {L(key)}
          </text>
        </Show>
      ))}
    </g>
  );
}

/** The retry reaches the card a second time, so the customer pays twice. */
function IdempotencyWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={IDEMPOTENCY_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Base thumb={thumb} marker={marker} />
          <Charged
            thumb={thumb}
            steps={[
              { key: 'once', at: [0.16, 0.58] },
              { key: 'twice', at: [0.58, 1], bad: true },
            ]}
          />
          <Dot path={go(leg)} at={[0, 0.08]} />
          <Dot path={go(payLeg)} at={[0.08, 0.16]} />
          <Dot path={back(payLeg)} at={[0.16, 0.24]} response />
          <LostReply at={[0.25, 0.32]} thumb={thumb} />
          <Dot path={go(leg)} at={[0.42, 0.5]} />
          <Dot path={go(payLeg)} at={[0.5, 0.58]} />
          <Dot path={back(payLeg)} at={[0.58, 0.66]} response />
          <Dot path={back(leg)} at={[0.67, 0.76]} response />
          <Still at={lostAt} response tone="bad" />
          <Still at={lerp(payLeg.from, payLeg.to, 0.5)} />
          <Marker n={1} x={52} y={100} at={0} thumb={thumb} />
          <Marker n={2} x={148} y={94} at={0.25} thumb={thumb} />
          <Marker n={3} x={164} y={245} at={0.5} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The retry carries the same key, so the server replays the saved receipt instead of charging again. */
function IdempotencyWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const keysNode = (badge?: string) => (
    <SystemNode
      kind="database"
      x={keys.x}
      y={keys.y}
      width={keys.w}
      height={keys.h}
      label={thumb ? '' : L('keys')}
      badge={badge}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={IDEMPOTENCY_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Base thumb={thumb} marker={marker} withKeys />
          <Note x={(leg.from[0] + leg.to[0]) / 2} y={32} text={L('key')} thumb={thumb} />
          <Show at={[0, 0.14]}>{keysNode()}</Show>
          <Show at={[0.14, 1]}>{keysNode(thumb ? undefined : L('key'))}</Show>
          <Charged thumb={thumb} steps={[{ key: 'once', at: [0.28, 1] }]} />
          <Dot path={go(leg)} at={[0, 0.07]} />
          <Dot path={go(keyLeg)} at={[0.08, 0.14]} />
          <Dot path={back(keyLeg)} at={[0.14, 0.2]} response />
          <Dot path={go(payLeg)} at={[0.21, 0.28]} />
          <Dot path={back(payLeg)} at={[0.28, 0.35]} response />
          <Dot path={go(keyLeg)} at={[0.36, 0.42]} response />
          <LostReply at={[0.43, 0.49]} thumb={thumb} />
          <Dot path={go(leg)} at={[0.56, 0.63]} />
          <Dot path={go(keyLeg)} at={[0.64, 0.7]} />
          <Dot path={back(keyLeg)} at={[0.7, 0.76]} response tone="hit" />
          <Dot path={back(leg)} at={[0.77, 0.86]} response tone="hit" />
          <Still at={lostAt} response tone="bad" />
          <Still at={lerp(leg.to, leg.from, 0.82)} response tone="hit" />
          <Marker n={1} x={52} y={100} at={0} thumb={thumb} />
          <Marker n={2} x={148} y={94} at={0.43} thumb={thumb} />
          <Marker n={3} x={196} y={128} at={0.64} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: IdempotencyWithout, with: IdempotencyWith, variants } satisfies ConceptScene;
