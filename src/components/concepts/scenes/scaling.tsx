import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/scaling';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/scaling';

const L = labelReader(entry.labels);
const NODE_H = 58;
const X = 160;

function Users({ y, thumb }: { y: number; thumb?: boolean }) {
  return <SystemNode kind="client" x={X} y={y} width={72} height={NODE_H} label={thumb ? '' : L('users')} />;
}

type Size = { at: [number, number]; w: number; h: number; y: number; sends: number[] };
const SMALL: Size = { at: [0, 0.25], w: 88, h: NODE_H, y: 207, sends: [0.02, 0.12] };
const MEDIUM: Size = { at: [0.25, 0.5], w: 120, h: 70, y: 201, sends: [0.27, 0.33, 0.39] };
const LARGE: Size = { at: [0.5, 1], w: 160, h: 84, y: 194, sends: [0.52, 0.57, 0.62, 0.67] };
const SIZES = [SMALL, MEDIUM, LARGE];
const FAIL_UP = 0.75;
const CEILING = 146;

/** One server grows from small to medium to large, hits the largest size, then fails. */
function ScalingWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const top = 36 + NODE_H / 2 + 6;
  const big = LARGE;
  const node = (size: Size, status?: 'bad') => (
    <SystemNode
      kind="server"
      x={X}
      y={size.y}
      width={size.w}
      height={size.h}
      label={thumb ? '' : L('server')}
      status={status}
    />
  );
  const bottomOf = (size: Size) => size.y - size.h / 2 - 6;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={250}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          {SIZES.map((size) => (
            <Show key={size.w} at={size.at}>
              <Edge from={[X, top]} to={[X, bottomOf(size)]} marker={marker} />
            </Show>
          ))}
          <path className="sdv-concept__divider" d={`M60 ${CEILING}H${X - 12}M${X + 12} ${CEILING}H260`} />
          <Note x={172} y={CEILING - 8} text={L('ceiling')} thumb={thumb} anchor="start" />
          <Users y={36} thumb={thumb} />
          <Show at={SMALL.at}>{node(SMALL)}</Show>
          <Show at={MEDIUM.at}>{node(MEDIUM)}</Show>
          <Show at={[big.at[0], FAIL_UP]}>{node(big)}</Show>
          <Show at={[FAIL_UP, 1]}>{node(big, 'bad')}</Show>
          {SIZES.flatMap((size) =>
            size.sends.map((s) => (
              <Dot
                key={s}
                path={[
                  [X, top],
                  [X, bottomOf(size)],
                ]}
                at={[s, s + 0.08]}
              />
            )),
          )}
          {[0.78, 0.84, 0.9].map((s) => (
            <Dot
              key={s}
              path={[
                [X, top],
                [X, CEILING - 14],
              ]}
              at={[s, s + 0.06]}
              tone="bad"
            />
          ))}
          <Still at={[X, 110]} tone="bad" />
          <Marker n={1} x={60} y={214} at={0} thumb={thumb} />
          <Marker n={2} x={46} y={CEILING} at={big.at[0]} thumb={thumb} />
          <Marker n={3} x={278} y={214} at={FAIL_UP} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

type Key = 'a' | 'b' | 'c' | 'd';
const KEYS: Key[] = ['a', 'b', 'c', 'd'];
const JOIN: Record<Key, number> = { a: 0, b: 0.15, c: 0.3, d: 0.45 };
const FAIL_OUT = 0.65;
const SENDS: [Key, number][] = [
  ['a', 0.02],
  ['a', 0.08],
  ['b', 0.17],
  ['a', 0.22],
  ['b', 0.27],
  ['c', 0.32],
  ['a', 0.36],
  ['b', 0.4],
  ['d', 0.47],
  ['c', 0.51],
  ['b', 0.53],
  ['a', 0.57],
  ['c', 0.68],
  ['d', 0.72],
  ['a', 0.76],
  ['c', 0.8],
  ['d', 0.84],
  ['a', 0.88],
];

/** Servers join behind a balancer one by one; when B fails, A, C and D keep serving. */
function ScalingWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const users: Positioned = { x: X, y: 34, w: 72, h: NODE_H };
  const balancer: Positioned = { x: X, y: 120, w: 112, h: NODE_H };
  const row = 220;
  const servers: Record<Key, Positioned> = {
    a: { x: 46, y: row, w: 64, h: NODE_H },
    b: { x: 122, y: row, w: 64, h: NODE_H },
    c: { x: 198, y: row, w: 64, h: NODE_H },
    d: { x: 274, y: row, w: 64, h: NODE_H },
  };
  const inbound = link(users, balancer);
  const legs = Object.fromEntries(KEYS.map((k) => [k, link(balancer, servers[k])])) as Record<
    Key,
    { from: Vec; to: Vec }
  >;
  const server = (key: Key, status?: 'bad') => (
    <SystemNode
      kind="server"
      x={servers[key].x}
      y={row}
      width={64}
      height={NODE_H}
      label={thumb ? '' : L(key)}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={280}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...inbound} marker={marker} />
          {KEYS.filter((k) => k !== 'b').map((k) => (
            <Show key={k} at={[JOIN[k], 1]}>
              <Edge {...legs[k]} marker={marker} />
            </Show>
          ))}
          <Show at={[JOIN.b, FAIL_OUT + 0.03]}>
            <Edge {...legs.b} marker={marker} />
          </Show>
          <Show at={[FAIL_OUT + 0.03, 1]}>
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
          {KEYS.filter((k) => k !== 'b').map((k) => (
            <Show key={k} at={[JOIN[k], 1]}>
              {server(k)}
            </Show>
          ))}
          <Show at={[JOIN.b, FAIL_OUT]}>{server('b')}</Show>
          <Show at={[FAIL_OUT, 1]}>{server('b', 'bad')}</Show>
          {SENDS.map(([k, s]) => (
            <Dot
              key={`${k}${s}`}
              path={[inbound.from, inbound.to, legs[k].from, legs[k].to]}
              at={[s, s + 0.1]}
            />
          ))}
          <Still at={lerp(inbound.from, inbound.to, 0.5)} />
          <Still at={lerp(legs.c.from, legs.c.to, 0.5)} />
          <Marker n={1} x={84} y={120} at={0} thumb={thumb} />
          <Marker n={2} x={296} y={150} at={JOIN.d} thumb={thumb} />
          <Marker n={3} x={122} y={266} at={FAIL_OUT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: ScalingWithout, with: ScalingWith, variants } satisfies ConceptScene;
