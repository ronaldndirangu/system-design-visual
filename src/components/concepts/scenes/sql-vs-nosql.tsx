import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/sql-vs-nosql';
import { lerp, type Vec } from '../../viz/geometry';
import { Edge, Shape, SystemNode } from '../../viz/SystemNode';
import { type ConceptScene, Dot, Marker, Note, SceneFrame, type SceneProps, Show, Still } from '../parts';
import variants from '../variants/sql-vs-nosql';

const L = labelReader(entry.labels);
const SQL_HEIGHT = 258;
const NOSQL_HEIGHT = 258;

const NODE_H = 58;
const APP_X = 160;
const APP_Y = 34;
const APP_EXIT: Vec = [APP_X, APP_Y + NODE_H / 2 + 6];

function App({ thumb }: { thumb?: boolean }) {
  return (
    <SystemNode kind="client" x={APP_X} y={APP_Y} width={88} height={NODE_H} label={thumb ? '' : L('app')} />
  );
}

const TABLE_W = 120;
const TABLE_TOP = 144;
const ROW_H = 16;
const ROWS = 5;
const NEW_ROW_Y = TABLE_TOP + (ROWS - 1) * ROW_H;
const USERS_X = 28;
const ORDERS_X = 172;

/** A table with a header row and fixed columns; its last row stays empty until the transaction fills it. */
function Table({ x }: { x: number }) {
  const bottom = TABLE_TOP + ROWS * ROW_H;
  const rows = Array.from({ length: ROWS - 1 }, (_, i) => TABLE_TOP + (i + 1) * ROW_H);
  const cols = [x + TABLE_W / 3, x + (2 * TABLE_W) / 3];
  return (
    <g className="sdv-node sdv-node--database">
      <rect className="sdv-node__shape" x={x} y={TABLE_TOP} width={TABLE_W} height={ROWS * ROW_H} rx={3} />
      <g className="sdv-concept__land">
        <path d={`M${x + 1} ${TABLE_TOP + 1}h${TABLE_W - 2}v${ROW_H - 1}h${-(TABLE_W - 2)}Z`} />
      </g>
      <path
        className="sdv-node__detail"
        d={[
          ...rows.map((y) => `M${x} ${y}h${TABLE_W}`),
          ...cols.map((cx) => `M${cx} ${TABLE_TOP}V${bottom}`),
        ].join(' ')}
      />
    </g>
  );
}

function rowBox(x: number, row: number) {
  return { x: x + 2, y: TABLE_TOP + row * ROW_H + 2, width: TABLE_W - 4, height: ROW_H - 4 };
}

/** One database, two tables with fixed columns, a join, and one transaction that writes to both. */
function SqlScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const split: Vec = [APP_X, 112];
  const usersNew: Vec = [USERS_X + TABLE_W / 2, NEW_ROW_Y + ROW_H / 2];
  const ordersNew: Vec = [ORDERS_X + TABLE_W / 2, NEW_ROW_Y + ROW_H / 2];
  const joinFrom: Vec = [ORDERS_X, TABLE_TOP + 2.5 * ROW_H];
  const joinTo: Vec = [USERS_X + TABLE_W, TABLE_TOP + 1.5 * ROW_H];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={SQL_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <g className="sdv-node sdv-node--database" transform="translate(160 172)">
            <Shape kind="database" w={300} h={148} />
          </g>
          <Edge from={APP_EXIT} to={[APP_X, 92]} marker={marker} />
          <App thumb={thumb} />
          <Note x={USERS_X + TABLE_W / 2} y={136} text={L('users')} thumb={thumb} />
          <Note x={ORDERS_X + TABLE_W / 2} y={136} text={L('orders')} thumb={thumb} />
          <Table x={USERS_X} />
          <Table x={ORDERS_X} />
          <Show at={[0.3, 1]}>
            <rect className="sdv-edge sdv-concept__edge--hit" {...rowBox(USERS_X, 1)} rx={2} />
            <rect className="sdv-edge sdv-concept__edge--hit" {...rowBox(ORDERS_X, 2)} rx={2} />
            <path
              className="sdv-edge sdv-concept__edge--hit"
              d={`M${joinFrom[0]} ${joinFrom[1]}C${joinFrom[0] - 14} ${joinFrom[1]} ${joinTo[0] + 14} ${joinTo[1]} ${joinTo[0]} ${joinTo[1]}`}
            />
          </Show>
          <Show at={[0.8, 1]}>
            <rect className="sdv-concept__chip" {...rowBox(USERS_X, ROWS - 1)} rx={2} />
            <rect className="sdv-concept__chip" {...rowBox(ORDERS_X, ROWS - 1)} rx={2} />
          </Show>
          <Dot path={[APP_EXIT, split]} at={[0.6, 0.68]} />
          <Dot path={[split, usersNew]} at={[0.68, 0.8]} tone="hit" />
          <Dot path={[split, ordersNew]} at={[0.68, 0.8]} tone="hit" />
          <Still at={lerp(APP_EXIT, [APP_X, 92], 0.5)} />
          <Marker n={1} x={40} y={130} at={0} thumb={thumb} />
          <Marker n={2} x={160} y={140} at={0.3} thumb={thumb} />
          <Marker n={3} x={196} y={84} at={0.6} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const STORE_Y = 166;
const STORE_W = 84;
const STORE_H = 112;
const STORE_X = [58, 160, 262] as const;
const DOC_Y = [150, 192] as const;
const DOC_W = 50;
const DOC_H = 32;
const READ: Vec[] = [
  [128, 68],
  [72, 104],
];
const WRITE: Vec[] = [
  [160, 70],
  [160, 104],
];
const GROW: Vec[] = [
  [192, 68],
  [248, 104],
];

function Store({ x }: { x: number }) {
  return (
    <g className="sdv-node sdv-node--database" transform={`translate(${x} ${STORE_Y})`}>
      <Shape kind="database" w={STORE_W} h={STORE_H} />
    </g>
  );
}

/** A document card; each line is one field, and documents may hold different fields. */
function Doc({ x, y, fields }: { x: number; y: number; fields: number[] }) {
  const gap = 6;
  const top = -((fields.length - 1) * gap) / 2;
  return (
    <g className="sdv-node sdv-node--dns" transform={`translate(${x} ${y})`}>
      <Shape kind="dns" w={DOC_W} h={DOC_H} />
      <path
        className="sdv-node__detail"
        d={fields.map((length, i) => `M-15 ${top + i * gap}h${length}`).join(' ')}
      />
    </g>
  );
}

/** Documents spread across nodes: one read by key, a document gains a field, and a node joins. */
function NoSqlScene({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const [x1, x2, x3] = STORE_X;
  const [d1, d2] = DOC_Y;
  const back = [...READ].reverse();
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={NOSQL_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge from={READ[0] as Vec} to={READ[1] as Vec} marker={marker} />
          <Edge from={WRITE[0] as Vec} to={WRITE[1] as Vec} marker={marker} />
          <App thumb={thumb} />
          <Store x={x1} />
          <Store x={x2} />
          <Doc x={x1} y={d1} fields={[26, 20, 20, 20]} />
          <Doc x={x1} y={d2} fields={[24, 16]} />
          <Doc x={x2} y={d1} fields={[22, 28]} />
          <Doc x={x2} y={d2} fields={[26, 18]} />
          <Show at={[0.1, 1]}>
            <rect
              className="sdv-edge sdv-concept__edge--hit"
              x={x1 - DOC_W / 2 - 4}
              y={d1 - DOC_H / 2 - 4}
              width={DOC_W + 8}
              height={DOC_H + 8}
              rx={4}
            />
          </Show>
          <Show at={[0.4, 1]}>
            <path className="sdv-edge sdv-concept__edge--hit" d={`M${x2 - 15} ${d2 + 7}h22`} />
          </Show>
          <Note x={x1} y={246} text={L('node1')} thumb={thumb} />
          <Note x={x2} y={246} text={L('node2')} thumb={thumb} />
          <Show at={[0.62, 1]}>
            <Edge from={GROW[0] as Vec} to={GROW[1] as Vec} marker={marker} />
            <Store x={x3} />
            <Note x={x3} y={246} text={L('node3')} thumb={thumb} />
          </Show>
          <Show at={[0.78, 1]}>
            <Doc x={x3} y={d1} fields={[20, 26, 14]} />
          </Show>
          <Dot path={READ} at={[0.04, 0.14]} />
          <Dot path={back} at={[0.14, 0.24]} response tone="hit" />
          <Dot path={WRITE} at={[0.3, 0.4]} />
          <Dot path={GROW} at={[0.68, 0.78]} />
          <Still at={lerp(READ[0] as Vec, READ[1] as Vec, 0.5)} response tone="hit" />
          <Marker n={1} x={40} y={88} at={0} thumb={thumb} />
          <Marker n={2} x={192} y={98} at={0.3} thumb={thumb} />
          <Marker n={3} x={298} y={90} at={0.62} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: SqlScene, with: NoSqlScene, variants } satisfies ConceptScene;
