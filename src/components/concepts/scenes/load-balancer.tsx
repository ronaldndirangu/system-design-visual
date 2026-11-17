import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/load-balancer';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/load-balancer';

const L = labelReader(entry.labels);
const LB_HEIGHT = 280;

const NODE_H = 58;
const users: Positioned = { x: 160, y: 32, w: 96, h: NODE_H };

/** One server takes every request; its gauge fills and the extras get dropped. */
function LoadBalancerWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const server: Positioned = { x: 160, y: 200, w: 104, h: NODE_H };
  const top = users.y + NODE_H / 2 + 6;
  const bottom = server.y - NODE_H / 2 - 6;
  const req = (start: number) => (
    <Dot
      key={start}
      path={[
        [154, top],
        [154, bottom],
      ]}
      at={[start, start + 0.1]}
    />
  );
  const res = (start: number) => (
    <Dot
      key={start}
      path={[
        [166, bottom],
        [166, top],
      ]}
      at={[start, start + 0.1]}
      response
    />
  );
  const dropAt: Vec = [154, 150];
  const drop = (start: number) => [
    <Dot key={`a${start}`} path={[[154, top], dropAt]} at={[start, start + 0.06]} />,
    <Dot
      key={`b${start}`}
      path={[dropAt, [118, 152], [86, 178]]}
      at={[start + 0.06, start + 0.12]}
      tone="bad"
    />,
  ];
  const tones = ['ok', 'ok', 'warn', 'bad', 'bad'] as const;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={LB_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={[160, top]} to={[160, bottom]} marker={marker} />
          <SystemNode
            kind="client"
            x={users.x}
            y={users.y}
            width={users.w}
            height={NODE_H}
            label={thumb ? '' : L('users')}
          />
          <Show at={[0, 0.46]}>
            <SystemNode
              kind="server"
              x={server.x}
              y={server.y}
              width={server.w}
              height={NODE_H}
              label={thumb ? '' : L('server')}
            />
          </Show>
          <Show at={[0.46, 1]}>
            <SystemNode
              kind="server"
              x={server.x}
              y={server.y}
              width={server.w}
              height={NODE_H}
              label={thumb ? '' : L('server')}
              status="warn"
            />
          </Show>
          <g className="sdv-concept__gauge">
            <rect className="sdv-concept__gauge-frame" x={224} y={169} width={24} height={62} rx={4} />
            {tones.map((tone, i) => (
              <Show key={tone + String(i)} at={[0.06 + i * 0.1, 1]}>
                <rect
                  className={`sdv-concept__fill--${tone}`}
                  x={228}
                  y={219 - i * 12}
                  width={16}
                  height={8}
                  rx={2}
                />
              </Show>
            ))}
          </g>
          {[0.02, 0.1, 0.18, 0.26, 0.34].map(req)}
          {[0.12, 0.2, 0.28, 0.36].map(res)}
          {[0.46, 0.54, 0.62, 0.7, 0.78, 0.86].flatMap(drop)}
          <Still at={[154, 108]} />
          <Still at={[166, 128]} response />
          <Still at={[96, 170]} tone="bad" />
          <Marker n={1} x={196} y={108} at={0} thumb={thumb} />
          <Marker n={2} x={276} y={200} at={0.3} thumb={thumb} />
          <Marker n={3} x={62} y={150} at={0.5} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The balancer spreads requests over A, B and C, then routes around B once it fails. */
function LoadBalancerWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const balancer: Positioned = { x: 160, y: 134, w: 112, h: NODE_H };
  const row = 242;
  const servers: Record<'a' | 'b' | 'c', Positioned> = {
    a: { x: 58, y: row, w: 76, h: NODE_H },
    b: { x: 160, y: row, w: 76, h: NODE_H },
    c: { x: 262, y: row, w: 76, h: NODE_H },
  };
  const inbound = link(users, balancer);
  const legs = {
    a: link(balancer, servers.a),
    b: link(balancer, servers.b),
    c: link(balancer, servers.c),
  };
  const req = (to: 'a' | 'b' | 'c', start: number) => (
    <Dot
      key={`${to}${start}`}
      path={[inbound.from, inbound.to, legs[to].from, legs[to].to]}
      at={[start, start + 0.1]}
    />
  );
  const res = (from: 'a' | 'b' | 'c', start: number) => (
    <Dot
      key={`r${from}${start}`}
      path={[legs[from].to, legs[from].from, inbound.to, inbound.from]}
      at={[start, start + 0.1]}
      response
    />
  );
  const mid = (leg: { from: Vec; to: Vec }, t: number): Vec => lerp(leg.from, leg.to, t);
  const server = (key: 'a' | 'b' | 'c', status?: 'bad') => (
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
      height={LB_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...inbound} marker={marker} />
          <Edge {...legs.a} marker={marker} />
          <Edge {...legs.c} marker={marker} />
          <Show at={[0, 0.55]}>
            <Edge {...legs.b} marker={marker} />
          </Show>
          <Show at={[0.55, 1]}>
            <g className="sdv-concept__cut">
              <Edge {...legs.b} dashed />
            </g>
          </Show>
          <SystemNode
            kind="client"
            x={users.x}
            y={users.y}
            width={users.w}
            height={NODE_H}
            label={thumb ? '' : L('users')}
          />
          <SystemNode
            kind="loadBalancer"
            x={balancer.x}
            y={balancer.y}
            width={balancer.w}
            height={NODE_H}
            label={thumb ? '' : L('balancer')}
          />
          {server('a')}
          {server('c')}
          <Show at={[0, 0.45]}>{server('b')}</Show>
          <Show at={[0.45, 1]}>{server('b', 'bad')}</Show>
          {req('a', 0)}
          {req('b', 0.1)}
          {req('c', 0.2)}
          {req('a', 0.28)}
          {req('b', 0.37)}
          {res('a', 0.1)}
          {res('b', 0.2)}
          {res('c', 0.3)}
          {res('a', 0.38)}
          <Show at={[0.47, 0.56]}>
            <circle className="sdv-dot sdv-dot--bad" cx={legs.b.to[0]} cy={legs.b.to[1]} r={5} />
          </Show>
          <Dot path={[legs.b.from, mid(legs.b, 0.85)]} at={[0.5, 0.56]} tone="miss" />
          {req('a', 0.58)}
          {req('c', 0.66)}
          {req('a', 0.74)}
          {req('c', 0.82)}
          {req('a', 0.9)}
          {res('a', 0.68)}
          {res('c', 0.76)}
          {res('a', 0.84)}
          <Still at={mid(inbound, 0.5)} />
          <Still at={mid(legs.a, 0.5)} />
          <Still at={mid(legs.c, 0.5)} response />
          <Marker n={1} x={60} y={134} at={0} thumb={thumb} />
          <Marker n={2} x={186} y={178} at={0.45} thumb={thumb} />
          <Marker n={3} x={262} y={134} at={0.55} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: LoadBalancerWithout, with: LoadBalancerWith, variants } satisfies ConceptScene;
