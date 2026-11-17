import { concept } from '../../data/concepts';
import { lerp, link, type Positioned, type Vec } from '../viz/geometry';
import { Edge, SystemNode } from '../viz/SystemNode';
import { curve, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from './parts';

const entry = concept('cache');
const L = entry.labels;
export const CACHE_HEIGHT = 250;

const NODE_H = 58;
const app: Positioned = { x: 64, y: 48, w: 88, h: NODE_H };
const cache: Positioned = { x: 250, y: 48, w: 92, h: NODE_H };
const database: Positioned = { x: 250, y: 196, w: 104, h: 62 };

const slowFrom: Vec = [64, app.y + NODE_H / 2 + 6];
const slowVia: Vec = [64, database.y];
const slowTo: Vec = [database.x - 104 / 2 - 6, database.y];
const slowPath = curve(slowFrom, slowVia, slowTo);
const backPath = [...slowPath].reverse();

function SlowEdge({ marker }: { marker: string }) {
  return (
    <path
      className="sdv-edge"
      d={`M${slowFrom[0]} ${slowFrom[1]}Q${slowVia[0]} ${slowVia[1]} ${slowTo[0]} ${slowTo[1]}`}
      markerEnd={`url(#${marker})`}
    />
  );
}

function Nodes({ thumb, withCache }: { thumb?: boolean; withCache: boolean }) {
  return (
    <>
      <SystemNode kind="client" x={app.x} y={app.y} width={app.w} height={NODE_H} label={thumb ? '' : L.app} />
      {withCache && (
        <SystemNode kind="cache" x={cache.x} y={cache.y} width={cache.w} height={NODE_H} label={thumb ? '' : L.cache} />
      )}
      <SystemNode
        kind="database"
        x={database.x}
        y={database.y}
        width={database.w}
        height={database.h}
        label={thumb ? '' : L.database}
      />
    </>
  );
}

/** Every read takes the long path to the database. */
export function CacheWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const starts = [0, 0.22, 0.44, 0.66];
  return (
    <SceneFrame idPrefix={idPrefix} thumb={thumb} height={CACHE_HEIGHT} title={state.title} description={state.description}>
      {(marker) => (
        <>
          <SlowEdge marker={marker} />
          <Nodes thumb={thumb} withCache={false} />
          <Note x={124} y={148} text={L.slow} thumb={thumb} />
          {starts.map((s) => (
            <Dot key={s} path={slowPath} at={[s, s + 0.16]} />
          ))}
          {starts.map((s) => (
            <Dot key={`r${s}`} path={backPath} at={[s + 0.16, s + 0.32]} response />
          ))}
          <Still at={slowPath[3]} />
          <Still at={slowPath[6]} response />
          <Marker n={1} x={34} y={120} at={0} thumb={thumb} />
          <Marker n={2} x={170} y={143} at={0.2} thumb={thumb} />
          <Marker n={3} x={250} y={140} at={0.5} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The first read misses and fills the cache; repeat reads hit on the short path. */
export function CacheWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const short = link(app, cache);
  const go: Vec[] = [short.from, short.to];
  const back: Vec[] = [short.to, short.from];
  const hits = [0.56, 0.68, 0.8];
  const counts: [number, number][] = [
    [0, 0.61],
    [0.61, 0.73],
    [0.73, 0.85],
    [0.85, 1],
  ];
  return (
    <SceneFrame idPrefix={idPrefix} thumb={thumb} height={CACHE_HEIGHT} title={state.title} description={state.description}>
      {(marker) => (
        <>
          <Edge {...short} marker={marker} />
          <SlowEdge marker={marker} />
          <Nodes thumb={thumb} withCache />
          <Show at={[0.48, 1]}>
            <rect className="sdv-concept__chip" x={268} y={60} width={16} height={10} rx={2} />
          </Show>
          <Note x={156} y={38} text={L.fast} thumb={thumb} />
          <Note x={124} y={148} text={L.slow} thumb={thumb} />
          {!thumb && (
            <g className="sdv-concept__counter">
              <text className="sdv-concept__note" x={246} y={118} textAnchor="end">
                {L.hits}
              </text>
              {counts.map((at, n) => (
                <Show key={n} at={at}>
                  <text className="sdv-concept__count" x={254} y={118}>
                    {n}
                  </text>
                </Show>
              ))}
            </g>
          )}
          <Dot path={go} at={[0, 0.07]} />
          <Dot path={back} at={[0.07, 0.13]} tone="miss" />
          <Dot path={slowPath} at={[0.13, 0.27]} />
          <Dot path={backPath} at={[0.27, 0.41]} response />
          <Dot path={go} at={[0.41, 0.48]} response tone="hit" />
          {hits.map((s) => (
            <Dot key={s} path={go} at={[s, s + 0.05]} />
          ))}
          {hits.map((s) => (
            <Dot key={`r${s}`} path={back} at={[s + 0.05, s + 0.1]} response tone="hit" />
          ))}
          <Still at={lerp(short.from, short.to, 0.3)} />
          <Still at={lerp(short.from, short.to, 0.7)} response tone="hit" />
          <Marker n={1} x={156} y={84} at={0} thumb={thumb} />
          <Marker n={2} x={298} y={113} at={0.56} thumb={thumb} />
          <Marker n={3} x={250} y={146} at={0.8} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}
