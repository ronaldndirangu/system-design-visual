import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/rate-limiting';
import type { Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/rate-limiting';

const L = labelReader(entry.labels);
const NODE_H = 58;
const HEIGHT = 190;
const Y = 100;
const CLIENT_X = 40;
const SERVER_X = 272;
const LEFT = CLIENT_X + 36 + 6;
const RIGHT = SERVER_X - 44 - 6;
const BURST = Array.from({ length: 8 }, (_, i) => (40 + i * 45) / 1000);
const TRAVEL = 0.12;

function Client({ thumb }: { thumb?: boolean }) {
  return (
    <SystemNode
      kind="client"
      x={CLIENT_X}
      y={Y}
      width={72}
      height={NODE_H}
      label={thumb ? '' : L('client')}
    />
  );
}

function Server({ status, thumb }: { status?: 'warn' | 'bad'; thumb?: boolean }) {
  return (
    <SystemNode
      kind="server"
      x={SERVER_X}
      y={Y}
      width={88}
      height={NODE_H}
      label={thumb ? '' : L('server')}
      status={status}
    />
  );
}

const line: Vec[] = [
  [LEFT, Y],
  [RIGHT, Y],
];

/** A burst of 8 hits the server at once; its load climbs until it fails for everyone. */
function RateWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const cells = ['ok', 'ok', 'ok', 'ok', 'warn', 'warn', 'bad', 'bad'];
  const warnAt = 0.3;
  const failAt = 0.5;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={line[0] as Vec} to={line[1] as Vec} marker={marker} />
          <Client thumb={thumb} />
          <Show at={[0, warnAt]}>
            <Server thumb={thumb} />
          </Show>
          <Show at={[warnAt, failAt]}>
            <Server status="warn" thumb={thumb} />
          </Show>
          <Show at={[failAt, 1]}>
            <Server status="bad" thumb={thumb} />
          </Show>
          {cells.map((_, i) => (
            <rect
              key={`f${BURST[i]}`}
              className="sdv-concept__gauge-frame"
              x={SERVER_X - 40 + i * 10}
              y={140}
              width={8}
              height={14}
              rx={2}
            />
          ))}
          {cells.map((tone, i) => {
            const at = (BURST[i] ?? 0) + TRAVEL;
            return (
              <Show key={`c${at}`} at={[at, 1]}>
                <rect
                  className={`sdv-concept__fill--${tone}`}
                  x={SERVER_X - 40 + i * 10 + 1.5}
                  y={141.5}
                  width={5}
                  height={11}
                  rx={1}
                />
              </Show>
            );
          })}
          {BURST.map((s) => (
            <Dot key={s} path={line} at={[s, s + TRAVEL]} />
          ))}
          {BURST.slice(0, 3).map((s) => (
            <Dot
              key={`r${s}`}
              path={[...line].reverse()}
              at={[s + TRAVEL + 0.03, s + 2 * TRAVEL + 0.03]}
              response
            />
          ))}
          {[0.52, 0.6, 0.68, 0.76].map((s) => (
            <Dot key={`x${s}`} path={[...line].reverse()} at={[s, s + TRAVEL]} response tone="bad" />
          ))}
          <Still at={[150, Y]} response tone="bad" />
          <Marker n={1} x={152} y={76} at={0} thumb={thumb} />
          <Marker n={2} x={272} y={172} at={warnAt} thumb={thumb} />
          <Marker n={3} x={272} y={50} at={failAt} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const BUCKET_X = 152;
const TOKENS: Vec[] = [
  [BUCKET_X - 6, 128],
  [BUCKET_X + 6, 128],
  [BUCKET_X - 12, 141],
  [BUCKET_X, 141],
  [BUCKET_X + 12, 141],
];
const RETURN_Y = 86;

/** Each request spends a token; when the bucket is empty the extras get 429, then tokens refill. */
function RateWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const crossAt = (s: number) => s + TRAVEL / 2;
  const refillAt = 0.7;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={line[0] as Vec} to={line[1] as Vec} marker={marker} />
          <Show at={[(BURST[5] ?? 0) + 0.05, 1]}>
            <Edge from={[BUCKET_X - 12, RETURN_Y]} to={[LEFT, RETURN_Y]} marker={marker} dashed />
            <Note x={110} y={76} text={L('rejected')} thumb={thumb} />
          </Show>
          <Client thumb={thumb} />
          <Server thumb={thumb} />
          <path
            className="sdv-concept__gauge-frame"
            d={`M${BUCKET_X - 22} 112V146Q${BUCKET_X - 22} 152 ${BUCKET_X - 16} 152H${BUCKET_X + 16}Q${BUCKET_X + 22} 152 ${BUCKET_X + 22} 146V112`}
          />
          {TOKENS.map(([x, y], k) => {
            const spent = crossAt(BURST[k] ?? 0);
            return (
              <g key={`${x}-${y}`}>
                <Show at={[0, spent]}>
                  <circle className="sdv-concept__fill--ok" cx={x} cy={y} r={5.5} />
                </Show>
                <Show at={[refillAt + k * 0.04, 1]}>
                  <circle className="sdv-concept__fill--ok" cx={x} cy={y} r={5.5} />
                </Show>
              </g>
            );
          })}
          <Note x={122} y={146} text={L('bucket')} thumb={thumb} anchor="end" />
          <Note x={184} y={146} text={L('refill')} thumb={thumb} anchor="start" />
          {BURST.slice(0, 5).map((s) => (
            <Dot key={s} path={line} at={[s, s + TRAVEL]} />
          ))}
          {BURST.slice(5).map((s) => [
            <Dot key={`q${s}`} path={[line[0] as Vec, [BUCKET_X - 6, Y]]} at={[s, crossAt(s)]} />,
            <Dot
              key={`r${s}`}
              path={[
                [BUCKET_X - 12, RETURN_Y],
                [LEFT, RETURN_Y],
              ]}
              at={[crossAt(s) + 0.01, crossAt(s) + 0.07]}
              response
              tone="bad"
            />,
          ])}
          <Still at={[196, Y]} />
          <Still at={[110, RETURN_Y]} response tone="bad" />
          <Marker n={1} x={176} y={64} at={0} thumb={thumb} />
          <Marker n={2} x={70} y={50} at={crossAt(BURST[5] ?? 0)} thumb={thumb} />
          <Marker n={3} x={212} y={172} at={refillAt} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: RateWithout, with: RateWith, variants } satisfies ConceptScene;
