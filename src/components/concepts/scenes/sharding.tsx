import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/sharding';
import { lerp, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/sharding';

const L = labelReader(entry.labels);
const SINGLE_HEIGHT = 250;
const SHARDED_HEIGHT = 262;
const NODE_H = 58;
const FULL_AT = 0.66;

/** One database holds every user; requests pile on and its storage gauge fills until it is full. */
function SingleScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const app = { x: 160, y: 40 };
  const db = { x: 160, y: 196, w: 120, h: 64 };
  const top = app.y + NODE_H / 2 + 6;
  const bottom = db.y - db.h / 2 - 6;
  const tones = ['ok', 'ok', 'warn', 'bad', 'bad'] as const;
  const request = (start: number) => (
    <Dot
      key={start}
      path={[
        [160, top],
        [160, bottom],
      ]}
      at={[start, start + 0.08]}
    />
  );
  const dbNode = (status?: 'warn') => (
    <SystemNode
      kind="database"
      x={db.x}
      y={db.y}
      width={db.w}
      height={db.h}
      label={thumb ? '' : L('all')}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={SINGLE_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={[160, top]} to={[160, bottom]} marker={marker} />
          <SystemNode
            kind="client"
            x={app.x}
            y={app.y}
            width={88}
            height={NODE_H}
            label={thumb ? '' : L('app')}
          />
          <Show at={[0, FULL_AT]}>{dbNode()}</Show>
          <Show at={[FULL_AT, 1]}>{dbNode('warn')}</Show>
          <g className="sdv-concept__gauge">
            <rect className="sdv-concept__gauge-frame" x={236} y={165} width={24} height={62} rx={4} />
            {tones.map((tone, i) => (
              <Show key={tone + String(i)} at={[0.14 + i * 0.13, 1]}>
                <rect
                  className={`sdv-concept__fill--${tone}`}
                  x={240}
                  y={215 - i * 12}
                  width={16}
                  height={8}
                  rx={2}
                />
              </Show>
            ))}
          </g>
          {[0.02, 0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82].map(request)}
          <Still at={[160, 116]} />
          <Marker n={1} x={80} y={178} at={0} thumb={thumb} />
          <Marker n={2} x={186} y={117} at={0.1} thumb={thumb} />
          <Marker n={3} x={284} y={196} at={FULL_AT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const APP: Vec = [160, 36];
const SHARD_Y = 200;
const SHARD_H = 62;
const SHARD_W = 96;
const SHARD_X = [58, 160, 262] as const;
const GAUGE_Y = 240;

/** Each user goes to the shard that holds their letter range, so each shard carries a third of the load. */
function ShardedScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const exit = APP[1] + NODE_H / 2 + 6;
  const entryY = SHARD_Y - SHARD_H / 2 - 6;
  const legs: Vec[][] = SHARD_X.map((x, i) => [
    [APP[0] + (i - 1) * 24, exit],
    [x + (1 - i) * 10, entryY],
  ]);
  const leg = (i: number) => legs[i] as Vec[];
  const shardLabels = [L('shard1'), L('shard2'), L('shard3')];
  const named = [0.04, 0.24, 0.36];
  const spread = [0.56, 0.62, 0.68, 0.74, 0.8, 0.86];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={SHARDED_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          {legs.map((points) => (
            <Edge key={String(points[1])} from={points[0] as Vec} to={points[1] as Vec} marker={marker} />
          ))}
          <SystemNode
            kind="client"
            x={APP[0]}
            y={APP[1]}
            width={88}
            height={NODE_H}
            label={thumb ? '' : L('app')}
          />
          {SHARD_X.map((x, i) => (
            <SystemNode
              key={x}
              kind="database"
              x={x}
              y={SHARD_Y}
              width={SHARD_W}
              height={SHARD_H}
              label={thumb ? '' : (shardLabels[i] ?? '')}
            />
          ))}
          <Show at={[named[0] ?? 0, 1]}>
            <Note x={92} y={118} text={L('ada')} thumb={thumb} anchor="end" />
          </Show>
          <Show at={[named[1] ?? 0, 1]}>
            <Note x={168} y={122} text={L('mo')} thumb={thumb} anchor="start" />
          </Show>
          <Show at={[named[2] ?? 0, 1]}>
            <Note x={228} y={118} text={L('zoe')} thumb={thumb} anchor="start" />
          </Show>
          {named.map((start, i) => (
            <Dot key={start} path={leg(i)} at={[start, start + 0.14]} />
          ))}
          {spread.map((start, n) => (
            <Dot key={start} path={leg(n % 3)} at={[start, start + 0.12]} />
          ))}
          {SHARD_X.map((x, i) => (
            <g key={x}>
              <rect
                className="sdv-concept__gauge-frame"
                x={x - 20}
                y={GAUGE_Y}
                width={40}
                height={8}
                rx={2}
              />
              <Show at={[(named[i] ?? 0) + 0.14, 1]}>
                <rect
                  className="sdv-concept__fill--ok"
                  x={x - 19}
                  y={GAUGE_Y + 1}
                  width={38 / 3}
                  height={6}
                  rx={1.5}
                />
              </Show>
            </g>
          ))}
          <Still at={lerp(leg(0)[0] as Vec, leg(0)[1] as Vec, 0.5)} />
          <Marker n={1} x={40} y={112} at={0.04} thumb={thumb} />
          <Marker n={2} x={286} y={114} at={0.24} thumb={thumb} />
          <Marker n={3} x={22} y={244} at={0.56} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: SingleScene, with: ShardedScene, variants } satisfies ConceptScene;
