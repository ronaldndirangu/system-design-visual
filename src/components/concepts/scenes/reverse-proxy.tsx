import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/reverse-proxy';
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
import variants from '../variants/reverse-proxy';

const L = labelReader(entry.labels);
const NODE_H = 58;
// Summed fractions like 0.02 + 0.1 drift past the window end, which breaks keyframe ordering.
const win = (a: number, b: number): Window => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000];
type Key = 'web' | 'api' | 'images';

function Service({ id, at, thumb }: { id: Key; at: Positioned; thumb?: boolean }) {
  return (
    <SystemNode kind="server" x={at.x} y={at.y} width={at.w} height={NODE_H} label={thumb ? '' : L(id)} />
  );
}

/** The client calls web, API and images directly; each one runs its own TLS and faces the internet. */
function ProxyWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const client: Positioned = { x: 52, y: 130, w: 72, h: NODE_H };
  const services: Record<Key, Positioned> = {
    web: { x: 220, y: 46, w: 96, h: NODE_H },
    api: { x: 220, y: 130, w: 96, h: NODE_H },
    images: { x: 220, y: 214, w: 96, h: NODE_H },
  };
  const keys: Key[] = ['web', 'api', 'images'];
  const legs = Object.fromEntries(keys.map((k) => [k, link(client, services[k])])) as Record<
    Key,
    { from: Vec; to: Vec }
  >;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={260}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          {keys.map((k) => (
            <Edge key={k} {...legs[k]} marker={marker} />
          ))}
          <SystemNode
            kind="client"
            x={client.x}
            y={client.y}
            width={client.w}
            height={NODE_H}
            label={thumb ? '' : L('client')}
          />
          {keys.map((k) => (
            <Service key={k} id={k} at={services[k]} thumb={thumb} />
          ))}
          {keys.map((k) => (
            <Note key={k} x={276} y={services[k].y + 6} text={L('tls')} thumb={thumb} anchor="start" />
          ))}
          {keys.flatMap((k, i) =>
            [0.02, 0.52].map((t) => {
              const s = t + i * 0.1;
              return [
                <Dot key={`q${k}${s}`} path={[legs[k].from, legs[k].to]} at={win(s, s + 0.1)} />,
                <Dot
                  key={`r${k}${s}`}
                  path={[legs[k].to, legs[k].from]}
                  at={win(s + 0.12, s + 0.22)}
                  response
                />,
              ];
            }),
          )}
          <Still at={lerp(legs.web.from, legs.web.to, 0.5)} />
          <Still at={lerp(legs.images.from, legs.images.to, 0.5)} response />
          <Marker n={1} x={104} y={62} at={0} thumb={thumb} />
          <Marker n={2} x={292} y={88} at={0.12} thumb={thumb} />
          <Marker n={3} x={100} y={200} at={0.32} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** One proxy takes every request, ends TLS, routes by path and answers repeats from its cache. */
function ProxyWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const client: Positioned = { x: 160, y: 34, w: 72, h: NODE_H };
  const proxy: Positioned = { x: 160, y: 144, w: 92, h: NODE_H };
  const row = 260;
  const services: Record<Key, Positioned> = {
    api: { x: 60, y: row, w: 72, h: NODE_H },
    web: { x: 160, y: row, w: 72, h: NODE_H },
    images: { x: 258, y: row, w: 96, h: NODE_H },
  };
  const keys: Key[] = ['api', 'web', 'images'];
  const inbound = link(client, proxy);
  const legs = Object.fromEntries(keys.map((k) => [k, link(proxy, services[k])])) as Record<
    Key,
    { from: Vec; to: Vec }
  >;
  const cachedAt = 0.62;
  const sends: [Key, number][] = [
    ['api', 0.02],
    ['images', 0.2],
    ['web', 0.38],
  ];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={304}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <rect className="sdv-concept__divider" x={8} y={204} width={304} height={94} rx={10} fill="none" />
          <Note x={20} y={222} text={L('private')} thumb={thumb} anchor="start" />
          <Edge {...inbound} marker={marker} />
          {keys.map((k) => (
            <Edge key={k} {...legs[k]} marker={marker} />
          ))}
          <SystemNode
            kind="client"
            x={client.x}
            y={client.y}
            width={client.w}
            height={NODE_H}
            label={thumb ? '' : L('client')}
          />
          <SystemNode
            kind="loadBalancer"
            x={proxy.x}
            y={proxy.y}
            width={proxy.w}
            height={NODE_H}
            label={thumb ? '' : L('proxy')}
          />
          {keys.map((k) => (
            <Service key={k} id={k} at={services[k]} thumb={thumb} />
          ))}
          <Note x={104} y={150} text={L('tls')} thumb={thumb} anchor="end" />
          <Note x={102} y={196} text={L('apiPath')} thumb={thumb} anchor="end" />
          <Note x={218} y={196} text={L('imgPath')} thumb={thumb} anchor="start" />
          <Show at={[cachedAt, 1]}>
            <rect
              className="sdv-concept__chip"
              x={proxy.x + 92 / 2 - 12}
              y={proxy.y - NODE_H / 2 - 5}
              width={16}
              height={10}
              rx={2}
            />
            <Note x={214} y={120} text={L('cache')} thumb={thumb} anchor="start" />
          </Show>
          {sends.map(([k, s]) => [
            <Dot
              key={`q${k}`}
              path={[inbound.from, inbound.to, legs[k].from, legs[k].to]}
              at={win(s, s + 0.12)}
            />,
            <Dot
              key={`r${k}`}
              path={[legs[k].to, legs[k].from, inbound.to, inbound.from]}
              at={win(s + 0.12, s + 0.24)}
              response
            />,
          ])}
          {[0.66, 0.82].map((s) => [
            <Dot key={`c${s}`} path={[inbound.from, inbound.to]} at={win(s, s + 0.06)} />,
            <Dot
              key={`h${s}`}
              path={[inbound.to, inbound.from]}
              at={win(s + 0.06, s + 0.12)}
              response
              tone="hit"
            />,
          ])}
          <Still at={lerp(inbound.from, inbound.to, 0.5)} response tone="hit" />
          <Marker n={1} x={200} y={84} at={0} thumb={thumb} />
          <Marker n={2} x={40} y={150} at={0.1} thumb={thumb} />
          <Marker n={3} x={284} y={114} at={cachedAt} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: ProxyWithout, with: ProxyWith, variants } satisfies ConceptScene;
