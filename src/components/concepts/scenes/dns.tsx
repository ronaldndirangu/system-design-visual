import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/dns';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/dns';

const L = labelReader(entry.labels);
const NODE_H = 58;

const reverse = (path: { from: Vec; to: Vec }): Vec[] => [path.to, path.from];
const forward = (path: { from: Vec; to: Vec }): Vec[] => [path.from, path.to];

/** You type the server's IP; when the server moves, requests to the old IP fail. */
function DnsWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const you: Positioned = { x: 52, y: 124, w: 64, h: NODE_H };
  const old: Positioned = { x: 232, y: 70, w: 88, h: NODE_H };
  const moved: Positioned = { x: 232, y: 184, w: 88, h: NODE_H };
  const trip = link(you, old);
  const moveAt = 0.4;
  const failAt = 0.45;
  const server = (at: Positioned, status?: 'bad') => (
    <SystemNode
      kind="server"
      x={at.x}
      y={at.y}
      width={at.w}
      height={NODE_H}
      label={thumb ? '' : L('server')}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={248}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...trip} marker={marker} />
          <Show at={[moveAt, 1]}>
            <Edge
              from={[old.x, old.y + NODE_H / 2 + 6]}
              to={[moved.x, moved.y - NODE_H / 2 - 6]}
              marker={marker}
              dashed
            />
          </Show>
          <SystemNode
            kind="client"
            x={you.x}
            y={you.y}
            width={you.w}
            height={NODE_H}
            label={thumb ? '' : L('you')}
          />
          <Show at={[0, moveAt]}>{server(old)}</Show>
          <Show at={[moveAt, 1]}>{server(old, 'bad')}</Show>
          <Show at={[moveAt, 1]}>{server(moved)}</Show>
          <Note x={old.x} y={26} text={L('oldIp')} thumb={thumb} />
          <Show at={[moveAt, 1]}>
            <Note x={moved.x} y={236} text={L('newIp')} thumb={thumb} />
          </Show>
          {[0.02, 0.2].map((s) => (
            <Dot key={s} path={forward(trip)} at={[s, s + 0.1]} />
          ))}
          {[0.12, 0.3].map((s) => (
            <Dot key={s} path={reverse(trip)} at={[s, s + 0.1]} response />
          ))}
          {[0.5, 0.65, 0.8].map((s) => (
            <Dot key={s} path={forward(trip)} at={[s, s + 0.1]} tone="bad" />
          ))}
          <Still at={lerp(trip.from, trip.to, 0.75)} tone="bad" />
          <Marker n={1} x={120} y={72} at={0} thumb={thumb} />
          <Marker n={2} x={296} y={128} at={moveAt - 0.05} thumb={thumb} />
          <Marker n={3} x={130} y={150} at={failAt + 0.05} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The resolver walks root, .com and example.com for the IP, then caches it for 300 s. */
function DnsWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const you: Positioned = { x: 44, y: 56, w: 64, h: NODE_H };
  const resolver: Positioned = { x: 170, y: 56, w: 92, h: NODE_H };
  const row = 190;
  const root: Positioned = { x: 44, y: row, w: 64, h: NODE_H };
  const tld: Positioned = { x: 136, y: row, w: 64, h: NODE_H };
  const authority: Positioned = { x: 250, y: row, w: 124, h: NODE_H };
  const ask = link(you, resolver);
  const legs = [link(resolver, root), link(resolver, tld), link(resolver, authority)];
  const cachedAt = 0.66;
  const name = (at: Positioned, key: 'resolver' | 'root' | 'tld' | 'authority') => (
    <SystemNode kind="dns" x={at.x} y={at.y} width={at.w} height={NODE_H} label={thumb ? '' : L(key)} />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={236}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...ask} marker={marker} />
          {legs.map((leg) => (
            <Edge key={leg.to[0]} {...leg} marker={marker} />
          ))}
          <SystemNode
            kind="client"
            x={you.x}
            y={you.y}
            width={you.w}
            height={NODE_H}
            label={thumb ? '' : L('you')}
          />
          {name(resolver, 'resolver')}
          {name(root, 'root')}
          {name(tld, 'tld')}
          {name(authority, 'authority')}
          <Show at={[cachedAt, 1]}>
            <rect
              className="sdv-concept__chip"
              x={resolver.x + 92 / 2 - 12}
              y={resolver.y - NODE_H / 2 - 5}
              width={16}
              height={10}
              rx={2}
            />
            <Note x={228} y={62} text={L('ttl')} thumb={thumb} anchor="start" />
          </Show>
          <Dot path={forward(ask)} at={[0, 0.08]} />
          {legs.map((leg, i) => {
            const t = 0.1 + i * 0.2;
            return [
              <Dot key={`q${t}`} path={forward(leg)} at={[t, t + 0.08]} />,
              <Dot
                key={`a${t}`}
                path={reverse(leg)}
                at={[t + 0.08, t + 0.16]}
                response
                tone={i === 2 ? 'hit' : undefined}
              />,
            ];
          })}
          <Dot path={reverse(ask)} at={[0.68, 0.76]} response tone="hit" />
          <Dot path={forward(ask)} at={[0.82, 0.86]} />
          <Dot path={reverse(ask)} at={[0.86, 0.9]} response tone="hit" />
          <Still at={lerp(ask.from, ask.to, 0.5)} response tone="hit" />
          <Marker n={1} x={64} y={110} at={0.1} thumb={thumb} />
          <Marker n={2} x={300} y={140} at={0.5} thumb={thumb} />
          <Marker n={3} x={262} y={30} at={cachedAt} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: DnsWithout, with: DnsWith, variants } satisfies ConceptScene;
