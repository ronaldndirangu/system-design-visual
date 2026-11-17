import type { ReactNode } from 'react';
import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/indexes';
import { lerp, type Vec } from '../../viz/geometry';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/indexes';

const L = labelReader(entry.labels);
const SCAN_HEIGHT = 250;
const TREE_HEIGHT = 252;

const TABLE_X = 40;
const TABLE_W = 240;
const TABLE_TOP = 38;
const ROW_H = 18;
const SHOWN_ROWS = 7;
const GAP_H = 22;
const LAST_ROW_Y = TABLE_TOP + SHOWN_ROWS * ROW_H + GAP_H;
const EMAIL_W = [74, 58, 86, 66, 80, 52, 70];
const SCAN_START = 0.08;
const SCAN_END = 0.8;

function DbGroup({ children }: { children: ReactNode }) {
  return <g className="sdv-node sdv-node--database">{children}</g>;
}

/** One table row: an email cell and a data cell, with a bar standing in for each value. */
function Row({ y, email }: { y: number; email: number }) {
  return (
    <>
      <rect className="sdv-node__shape" x={TABLE_X} y={y} width={TABLE_W} height={ROW_H} />
      <path className="sdv-node__detail" d={`M${TABLE_X + 8} ${y + ROW_H / 2}h${email}`} />
      <path className="sdv-node__detail" d={`M${TABLE_X + 128} ${y + ROW_H / 2}h${48 + (email % 30)}`} />
      <path className="sdv-node__detail" d={`M${TABLE_X + 120} ${y}v${ROW_H}`} />
    </>
  );
}

/** No index: the database checks row after row until it has read all of them. */
function ScanScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const scanned = SHOWN_ROWS * ROW_H;
  const span = LAST_ROW_Y - TABLE_TOP;
  const reach = (row: number) => SCAN_START + ((SCAN_END - SCAN_START) * row * ROW_H) / span;
  const counts = Array.from({ length: SHOWN_ROWS }, (_, row) => ({
    text: String(row + 1),
    at: [reach(row), row + 1 < SHOWN_ROWS ? reach(row + 1) : SCAN_END] as [number, number],
  }));
  const highlight = { x: TABLE_X - 3, width: TABLE_W + 6, height: ROW_H + 2, rx: 3 };
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={SCAN_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {() => (
        <>
          <Note x={160} y={22} text={L('find')} thumb={thumb} />
          <DbGroup>
            {EMAIL_W.map((email, row) => (
              <Row key={email} y={TABLE_TOP + row * ROW_H} email={email} />
            ))}
            <Row y={LAST_ROW_Y} email={62} />
            {[-12, 0, 12].map((dx) => (
              <circle
                key={dx}
                className="sdv-node__shape"
                cx={160 + dx}
                cy={TABLE_TOP + scanned + GAP_H / 2}
                r={2.5}
              />
            ))}
          </DbGroup>
          <g
            className="sdv-concept__dot"
            data-path={`0,0 0,${scanned} 0,${span}`}
            data-at={`${SCAN_START} ${SCAN_END}`}
          >
            <rect className="sdv-edge sdv-concept__edge--miss" y={TABLE_TOP - 1} {...highlight} />
          </g>
          <Show at={[SCAN_END, 1]}>
            <rect className="sdv-edge sdv-concept__edge--miss" y={LAST_ROW_Y - 1} {...highlight} />
          </Show>
          {!thumb && (
            <g className="sdv-concept__counter">
              {counts.map(({ text, at }) => (
                <Show key={text} at={at}>
                  <text x={132} y={234} textAnchor="end">
                    {text}
                  </text>
                </Show>
              ))}
              <Show at={[SCAN_END, 1]}>
                <text x={132} y={234} textAnchor="end">
                  {L('total')}
                </text>
              </Show>
              <text x={140} y={234}>
                {L('checked')}
              </text>
            </g>
          )}
          <Marker n={1} x={60} y={17} at={0} thumb={thumb} />
          <Marker n={2} x={22} y={TABLE_TOP + ROW_H / 2} at={SCAN_START} thumb={thumb} />
          <Marker n={3} x={24} y={229} at={SCAN_END} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const ROOT: Vec = [160, 26];
const BRANCH_Y = 82;
const BRANCH_X = [64, 160, 256] as const;
const KEY_W = 64;
const KEY_H = 24;
const LEAF_Y = 136;
const LEAF_W = 26;
const LEAF_H = 22;
const LEAF_X = BRANCH_X.flatMap((x) => [x - 32, x, x + 32]);
const CELL_Y = 190;
const CELL_H = 22;
const CELL_X = Array.from({ length: 7 }, (_, i) => 94 + i * 32);
const FOUND_CELL = 2;
const NEW_CELL = 6;
const NEW_LEAF = 8;

function KeyBox({ at, w, h, slots }: { at: Vec; w: number; h: number; slots: number }) {
  const left = at[0] - w / 2;
  const top = at[1] - h / 2;
  const dividers = Array.from(
    { length: slots - 1 },
    (_, i) => `M${left + ((i + 1) * w) / slots} ${top}v${h}`,
  );
  return (
    <>
      <rect className="sdv-node__shape" x={left} y={top} width={w} height={h} rx={3} />
      {dividers.length > 0 && <path className="sdv-node__detail" d={dividers.join(' ')} />}
    </>
  );
}

function at(list: readonly number[], i: number): number {
  const value = list[i];
  if (value === undefined) throw new Error(`no item ${i}`);
  return value;
}

/** A B-tree over the email column: root, branch, leaf, then the row. A new row updates a leaf too. */
function TreeScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const rootBottom = ROOT[1] + KEY_H / 2;
  const branchTop = BRANCH_Y - KEY_H / 2;
  const branchBottom = BRANCH_Y + KEY_H / 2;
  const leafTop = LEAF_Y - LEAF_H / 2;
  const leafBottom = LEAF_Y + LEAF_H / 2;
  const ada = at(LEAF_X, 1);
  const found = at(CELL_X, FOUND_CELL);
  const newCell = at(CELL_X, NEW_CELL);
  const newLeaf = at(LEAF_X, NEW_LEAF);
  const toBranch: Vec[] = [
    [ROOT[0] - 20, rootBottom],
    [at(BRANCH_X, 0), branchTop],
  ];
  const toLeaf: Vec[] = [
    [ada, branchBottom],
    [ada, leafTop],
  ];
  const toRow: Vec[] = [
    [ada, leafBottom + 1],
    [found - 2, CELL_Y - 4],
  ];
  const walk: Vec[] = [...toBranch, ...toLeaf, ...toRow];
  const update: Vec[] = [
    [newCell, CELL_Y],
    [newLeaf, leafBottom],
  ];
  const links = [
    ...BRANCH_X.map((x, i) => `M${ROOT[0] + (i - 1) * 20} ${rootBottom}L${x} ${branchTop}`),
    ...BRANCH_X.flatMap((x) =>
      [-1, 0, 1].map((side) => `M${x + side * 16} ${branchBottom}L${x + side * 32} ${leafTop}`),
    ),
  ];
  const hit = 'sdv-edge sdv-concept__edge--hit';
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={TREE_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <path className="sdv-edge" d={links.join(' ')} />
          <DbGroup>
            <KeyBox at={ROOT} w={KEY_W} h={KEY_H} slots={2} />
            {BRANCH_X.map((x) => (
              <KeyBox key={x} at={[x, BRANCH_Y]} w={KEY_W} h={KEY_H} slots={3} />
            ))}
            {LEAF_X.map((x) => (
              <KeyBox key={x} at={[x, LEAF_Y]} w={LEAF_W} h={LEAF_H} slots={1} />
            ))}
            {CELL_X.slice(0, NEW_CELL).map((x) => (
              <KeyBox key={x} at={[x, CELL_Y + CELL_H / 2]} w={28} h={CELL_H} slots={1} />
            ))}
          </DbGroup>
          <Note x={70} y={31} text={L('tree')} thumb={thumb} />
          <Note x={40} y={CELL_Y + 16} text={L('table')} thumb={thumb} />
          <Show at={[0.12, 1]}>
            <path className={hit} d={`M${toBranch[0]?.join(' ')}L${toBranch[1]?.join(' ')}`} />
          </Show>
          <Show at={[0.24, 1]}>
            <path className={hit} d={`M${toLeaf[0]?.join(' ')}L${toLeaf[1]?.join(' ')}`} />
          </Show>
          <Show at={[0.36, 1]}>
            <path
              className={hit}
              d={`M${toRow[0]?.join(' ')}L${toRow[1]?.join(' ')}`}
              markerEnd={`url(#${marker})`}
            />
            <rect className={hit} x={found - 16} y={CELL_Y - 2} width={32} height={CELL_H + 4} rx={4} />
          </Show>
          <Show at={[0.62, 1]}>
            <rect
              className="sdv-concept__chip"
              x={newCell - 14}
              y={CELL_Y}
              width={28}
              height={CELL_H}
              rx={3}
            />
            <Note x={304} y={236} text={L('write')} thumb={thumb} anchor="end" />
          </Show>
          <Show at={[0.82, 1]}>
            <rect
              className="sdv-concept__chip"
              x={newLeaf - 8}
              y={LEAF_Y - 5}
              width={16}
              height={10}
              rx={2}
            />
          </Show>
          <Show at={[0.36, 1]}>
            <Note x={16} y={236} text={L('steps')} thumb={thumb} anchor="start" />
          </Show>
          <Dot path={walk} at={[0, 0.36]} />
          <Dot path={update} at={[0.68, 0.82]} tone="hit" />
          <Still at={lerp(toRow[0] as Vec, toRow[1] as Vec, 0.5)} />
          <Marker n={1} x={216} y={26} at={0} thumb={thumb} />
          <Marker n={2} x={113} y={110} at={0.12} thumb={thumb} />
          <Marker n={3} x={300} y={168} at={0.62} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: ScanScene, with: TreeScene, variants } satisfies ConceptScene;
