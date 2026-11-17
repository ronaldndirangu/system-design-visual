import type { ReactNode } from 'react';
import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/consistent-hashing';
import type { Vec } from '../../viz/geometry';
import { SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/consistent-hashing';

const L = labelReader(entry.labels);
const MOD_HEIGHT = 252;
const RING_HEIGHT = 262;
const KEYS = Array.from({ length: 12 }, (_, k) => k);

const SERVER_X = [46, 122, 198, 274] as const;
const SERVER_Y = 40;
const SERVER_W = 60;
const NODE_H = 58;
const ROW_Y = [92, 118, 144, 170] as const;
const CHIP_W = 40;
const CHIP_H = 22;
const ADD_AT = 0.4;
const MOVE_AT = 0.42;
const LAND_AT = 0.6;

function slot(key: number, servers: number): Vec {
  return [SERVER_X[key % servers] ?? 0, ROW_Y[Math.floor(key / servers)] ?? 0];
}

/** A key chip centred on the origin; a moved key gets a warning outline. */
function Chip({ k, moved }: { k: number; moved?: boolean }) {
  return (
    <>
      <g className="sdv-node sdv-node--cache">
        <rect
          className="sdv-node__shape"
          x={-CHIP_W / 2}
          y={-CHIP_H / 2}
          width={CHIP_W}
          height={CHIP_H}
          rx={4}
        />
      </g>
      {moved && (
        <rect
          className="sdv-edge sdv-concept__edge--miss"
          x={-CHIP_W / 2 - 2}
          y={-CHIP_H / 2 - 2}
          width={CHIP_W + 4}
          height={CHIP_H + 4}
          rx={5}
        />
      )}
      <text className="sdv-concept__note" y={5} textAnchor="middle">
        {k}
      </text>
    </>
  );
}

function Placed({ at, children }: { at: Vec; children: ReactNode }) {
  return <g transform={`translate(${at[0]} ${at[1]})`}>{children}</g>;
}

/** Keys sit under servers by key mod 3; adding D changes the rule to mod 4 and 9 of 12 keys move. */
function ModScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const servers = [L('a'), L('b'), L('c'), L('d')];
  const server = (i: number) => (
    <SystemNode
      kind="server"
      x={SERVER_X[i] ?? 0}
      y={SERVER_Y}
      width={SERVER_W}
      height={NODE_H}
      label={thumb ? '' : (servers[i] ?? '')}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={MOD_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {() => (
        <>
          {server(0)}
          {server(1)}
          {server(2)}
          <Show at={[ADD_AT, 1]}>{server(3)}</Show>
          {KEYS.map((k) => {
            const before = slot(k, 3);
            const after = slot(k, 4);
            if (before[0] === after[0] && before[1] === after[1]) {
              return (
                <Placed key={k} at={before}>
                  <Chip k={k} />
                </Placed>
              );
            }
            return (
              <g key={k}>
                <Show at={[0, MOVE_AT]}>
                  <Placed at={before}>
                    <Chip k={k} />
                  </Placed>
                </Show>
                <Dot path={[before, after]} at={[MOVE_AT, LAND_AT + 0.02]} tone="miss" />
                <Show at={[LAND_AT, 1]}>
                  <Placed at={after}>
                    <Chip k={k} moved />
                  </Placed>
                </Show>
              </g>
            );
          })}
          <Show at={[0, ADD_AT]}>
            <Note x={160} y={208} text={L('mod3')} thumb={thumb} />
          </Show>
          <Show at={[ADD_AT, 1]}>
            <Note x={160} y={208} text={L('mod4')} thumb={thumb} />
          </Show>
          <Show at={[LAND_AT, 1]}>
            <Note x={160} y={236} text={L('movedMod')} thumb={thumb} />
          </Show>
          <Marker n={1} x={110} y={203} at={0} thumb={thumb} />
          <Marker n={2} x={210} y={203} at={ADD_AT} thumb={thumb} />
          <Marker n={3} x={86} y={231} at={LAND_AT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const CENTER: Vec = [160, 132];
const R = 88;
const KEY_ANGLES = KEYS.map((i) => 15 + i * 30);
const SERVER_DEG = { a: 90, b: 210, c: 330, d: 180 } as const;
const MOVED = [105, 135, 165];
const D_AT = 0.35;
const SHIFT_AT = 0.55;

function onRing(deg: number, radius = R): Vec {
  const rad = (deg * Math.PI) / 180;
  return [CENTER[0] + radius * Math.sin(rad), CENTER[1] - radius * Math.cos(rad)];
}

function arc(from: number, to: number): Vec[] {
  const steps = Math.max(2, Math.round((to - from) / 5));
  return Array.from({ length: steps + 1 }, (_, i) => onRing(from + ((to - from) * i) / steps));
}

function RingServer({ deg, letter, thumb }: { deg: number; letter: string; thumb?: boolean }) {
  const [x, y] = onRing(deg);
  const [lx, ly] = onRing(deg, R + 24);
  return (
    <>
      <g className="sdv-node sdv-node--server" transform={`translate(${x} ${y})`}>
        <rect className="sdv-node__shape" x={-10} y={-10} width={20} height={20} rx={4} />
      </g>
      <Note x={lx} y={ly + 5} text={letter} thumb={thumb} />
    </>
  );
}

/** Keys go clockwise to the next server; D joins and takes only the 3 keys just before it. */
function RingScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const [cx, cy] = CENTER;
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={RING_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {() => (
        <>
          <circle className="sdv-edge" cx={cx} cy={cy} r={R} />
          <g className="sdv-node sdv-node--cache">
            {KEY_ANGLES.map((deg) => {
              const [x, y] = onRing(deg);
              return <circle key={deg} className="sdv-node__shape" cx={x} cy={y} r={6} />;
            })}
          </g>
          <Show at={[SHIFT_AT, 1]}>
            {MOVED.map((deg) => {
              const [x, y] = onRing(deg);
              return <circle key={deg} className="sdv-edge sdv-concept__edge--miss" cx={x} cy={y} r={10} />;
            })}
          </Show>
          <RingServer deg={SERVER_DEG.a} letter={L('a')} thumb={thumb} />
          <RingServer deg={SERVER_DEG.b} letter={L('b')} thumb={thumb} />
          <RingServer deg={SERVER_DEG.c} letter={L('c')} thumb={thumb} />
          <Show at={[D_AT, 1]}>
            <RingServer deg={SERVER_DEG.d} letter={L('d')} thumb={thumb} />
          </Show>
          <Show at={[SHIFT_AT + 0.05, 1]}>
            <Note x={cx} y={cy + 8} text={L('movedRing')} thumb={thumb} />
          </Show>
          <Dot path={arc(45, SERVER_DEG.a)} at={[0.05, 0.25]} tone="hit" />
          {MOVED.map((deg) => (
            <Dot key={deg} path={arc(deg, SERVER_DEG.d)} at={[SHIFT_AT, SHIFT_AT + 0.14]} tone="miss" />
          ))}
          <Still at={onRing(68)} tone="hit" />
          <Marker n={1} x={284} y={78} at={0.05} thumb={thumb} />
          <Marker n={2} x={196} y={246} at={D_AT} thumb={thumb} />
          <Marker n={3} x={cx} y={cy - 24} at={SHIFT_AT} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: ModScene, with: RingScene, variants } satisfies ConceptScene;
