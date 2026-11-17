import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/availability';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/availability';

const L = labelReader(entry.labels);
const NODE_H = 58;
const users: Positioned = { x: 160, y: 34, w: 72, h: NODE_H };

/** A green or red dot plus the site's status, starting at (x, y). */
function SiteStatus({ up, x, y, thumb }: { up: boolean; x: number; y: number; thumb?: boolean }) {
  return (
    <>
      <circle className={up ? 'sdv-concept__fill--ok' : 'sdv-concept__fill--bad'} cx={x} cy={y - 6} r={5} />
      <Note x={x + 10} y={y} text={L(up ? 'up' : 'down')} thumb={thumb} anchor="start" />
    </>
  );
}
function Users({ thumb }: { thumb?: boolean }) {
  return (
    <SystemNode
      kind="client"
      x={users.x}
      y={users.y}
      width={users.w}
      height={NODE_H}
      label={thumb ? '' : L('users')}
    />
  );
}

/** One server takes every request; when it fails, the whole site goes down. */
function AvailabilityWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const server: Positioned = { x: 160, y: 136, w: 88, h: NODE_H };
  const top: Vec = [160, users.y + NODE_H / 2 + 6];
  const bottom: Vec = [160, server.y - NODE_H / 2 - 6];
  const failAt = 0.45;
  const node = (status?: 'bad') => (
    <SystemNode
      kind="server"
      x={server.x}
      y={server.y}
      width={server.w}
      height={NODE_H}
      label={thumb ? '' : L('server')}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={222}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={top} to={bottom} marker={marker} />
          <Users thumb={thumb} />
          <Show at={[0, failAt]}>{node()}</Show>
          <Show at={[failAt, 1]}>{node('bad')}</Show>
          <Note x={212} y={142} text={L('one')} thumb={thumb} anchor="start" />
          <Show at={[0, failAt]}>
            <SiteStatus up x={126} y={208} thumb={thumb} />
          </Show>
          <Show at={[failAt, 1]}>
            <SiteStatus up={false} x={126} y={208} thumb={thumb} />
          </Show>
          {[0.02, 0.14, 0.26].map((s) => (
            <Dot key={s} path={[top, bottom]} at={[s, s + 0.06]} />
          ))}
          {[0.08, 0.2, 0.32].map((s) => (
            <Dot key={s} path={[bottom, top]} at={[s, s + 0.06]} response />
          ))}
          {[0.5, 0.62, 0.74, 0.86].map((s) => (
            <Dot key={s} path={[top, bottom]} at={[s, s + 0.06]} tone="bad" />
          ))}
          <Still at={lerp(top, bottom, 0.6)} tone="bad" />
          <Marker n={1} x={196} y={86} at={0} thumb={thumb} />
          <Marker n={2} x={96} y={136} at={failAt} thumb={thumb} />
          <Marker n={3} x={100} y={202} at={failAt + 0.05} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}
/** A balancer spreads requests over A and B; when A fails, B keeps the site up. */
function AvailabilityWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const balancer: Positioned = { x: 160, y: 130, w: 112, h: NODE_H };
  const row = 232;
  const servers: Record<'a' | 'b', Positioned> = {
    a: { x: 96, y: row, w: 76, h: NODE_H },
    b: { x: 224, y: row, w: 76, h: NODE_H },
  };
  const inbound = link(users, balancer);
  const legs = { a: link(balancer, servers.a), b: link(balancer, servers.b) };
  const failAt = 0.45;
  const req = (to: 'a' | 'b', start: number) => (
    <Dot
      key={`${to}${start}`}
      path={[inbound.from, inbound.to, legs[to].from, legs[to].to]}
      at={[start, start + 0.1]}
    />
  );
  const res = (from: 'a' | 'b', start: number) => (
    <Dot
      key={`r${from}${start}`}
      path={[legs[from].to, legs[from].from, inbound.to, inbound.from]}
      at={[start, start + 0.1]}
      response
    />
  );
  const server = (key: 'a' | 'b', status?: 'bad') => (
    <SystemNode
      kind="server"
      x={servers[key].x}
      y={row}
      width={76}
      height={NODE_H}
      label={thumb ? '' : L(key)}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={270}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...inbound} marker={marker} />
          <Edge {...legs.b} marker={marker} />
          <Show at={[0, failAt + 0.1]}>
            <Edge {...legs.a} marker={marker} />
          </Show>
          <Show at={[failAt + 0.1, 1]}>
            <g className="sdv-concept__cut">
              <Edge {...legs.a} dashed />
            </g>
          </Show>
          <Users thumb={thumb} />
          <SystemNode
            kind="loadBalancer"
            x={balancer.x}
            y={balancer.y}
            width={balancer.w}
            height={NODE_H}
            label={thumb ? '' : L('balancer')}
          />
          <Show at={[0, failAt]}>{server('a')}</Show>
          <Show at={[failAt, 1]}>{server('a', 'bad')}</Show>
          {server('b')}
          <Note x={60} y={182} text={L('one')} thumb={thumb} />
          <Note x={260} y={182} text={L('one')} thumb={thumb} />
          <Note x={96} y={136} text={L('two')} thumb={thumb} anchor="end" />
          <SiteStatus up x={220} y={36} thumb={thumb} />
          {req('a', 0)}
          {req('b', 0.1)}
          {req('a', 0.2)}
          {req('b', 0.3)}
          {res('a', 0.1)}
          {res('b', 0.2)}
          {res('a', 0.3)}
          {res('b', 0.4)}
          <Dot
            path={[legs.a.from, lerp(legs.a.from, legs.a.to, 0.85)]}
            at={[failAt + 0.03, failAt + 0.09]}
            tone="miss"
          />
          {[0.58, 0.68, 0.78, 0.88].map((s) => req('b', s))}
          {[0.68, 0.78, 0.88].map((s) => res('b', s))}
          <Still at={lerp(inbound.from, inbound.to, 0.5)} />
          <Still at={lerp(legs.b.from, legs.b.to, 0.5)} response />
          <Marker n={1} x={200} y={84} at={0} thumb={thumb} />
          <Marker n={2} x={40} y={row} at={failAt} thumb={thumb} />
          <Marker n={3} x={280} y={row} at={failAt + 0.1} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: AvailabilityWithout, with: AvailabilityWith, variants } satisfies ConceptScene;
