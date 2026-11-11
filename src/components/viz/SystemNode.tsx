import './aiKinds.css';
import { KindIcon, StatusBadge } from './icons';
import { type ComponentKind, kinds, type NodeStatus } from './kinds';

export interface SystemNodeProps {
  kind: ComponentKind;
  /** Center of the node. */
  x: number;
  y: number;
  label?: string;
  sublabel?: string;
  status?: NodeStatus;
  highlight?: boolean;
  dim?: boolean;
  width?: number;
  height?: number;
}

/**
 * One component in a diagram. Shape, color, and icon come from its kind, so
 * the same component always looks the same in every lesson. Pure markup with
 * no hooks, so Astro can render it to static HTML.
 */
export function SystemNode({
  kind,
  x,
  y,
  label = kinds[kind].name,
  sublabel,
  status,
  highlight = false,
  dim = false,
  width = 112,
  height = 64,
}: SystemNodeProps) {
  const classes = ['sdv-node', `sdv-node--${kind}`];
  if (highlight) classes.push('sdv-node--highlight');
  if (status === 'bad') classes.push('sdv-node--down');
  if (dim) classes.push('sdv-node--dim');

  return (
    <g className={classes.join(' ')} transform={`translate(${x} ${y})`}>
      <Shape kind={kind} w={width} h={height} />
      <KindIcon kind={kind} size={18} x={-9} y={-height / 2 + (kind === 'database' ? 16 : 10)} />
      <text className="sdv-node__label" textAnchor="middle" y={height / 2 - (kind === 'database' ? 10 : 12)}>
        {label}
      </text>
      {sublabel && (
        <text className="sdv-node__sublabel" textAnchor="middle" y={height / 2 + 16}>
          {sublabel}
        </text>
      )}
      {status && <StatusBadge status={status} x={width / 2 - 4} y={-height / 2 + 4} />}
    </g>
  );
}

function Shape({ kind, w, h }: { kind: ComponentKind; w: number; h: number }) {
  const left = -w / 2;
  const top = -h / 2;
  switch (kind) {
    case 'client':
      return <rect className="sdv-node__shape" x={left} y={top} width={w} height={h} rx={14} />;
    case 'dns': {
      const fold = 14;
      return (
        <>
          <path
            className="sdv-node__shape"
            d={`M${left} ${top}H${-left - fold}L${-left} ${top + fold}V${-top}H${left}Z`}
          />
          <path className="sdv-node__detail" d={`M${-left - fold} ${top}V${top + fold}H${-left}`} />
        </>
      );
    }
    case 'server':
      return (
        <>
          <rect className="sdv-node__shape" x={left} y={top} width={w} height={h} rx={4} />
          <path
            className="sdv-node__detail"
            d={[-12, -4, 4, 12].map((dy) => `M${left + 6} ${dy}h8`).join(' ')}
          />
        </>
      );
    case 'loadBalancer': {
      const inset = 16;
      return (
        <polygon
          className="sdv-node__shape"
          points={`${left},0 ${left + inset},${top} ${-left - inset},${top} ${-left},0 ${-left - inset},${-top} ${left + inset},${-top}`}
        />
      );
    }
    case 'cache':
      return (
        <>
          <rect className="sdv-node__shape" x={left} y={top} width={w} height={h} rx={10} />
          <rect
            className="sdv-node__detail"
            x={left + 5}
            y={top + 5}
            width={w - 10}
            height={h - 10}
            rx={6}
            strokeDasharray="4 3"
          />
        </>
      );
    case 'database': {
      const ry = 8;
      return (
        <>
          <path
            className="sdv-node__shape"
            d={`M${left} ${top + ry}A${w / 2} ${ry} 0 0 1 ${-left} ${top + ry}V${-top - ry}A${w / 2} ${ry} 0 0 1 ${left} ${-top - ry}Z`}
          />
          <path
            className="sdv-node__detail"
            d={`M${left} ${top + ry}A${w / 2} ${ry} 0 0 0 ${-left} ${top + ry}`}
          />
        </>
      );
    }
    case 'queue':
      return (
        <>
          <rect className="sdv-node__shape" x={left} y={top} width={w} height={h} rx={h / 2} />
          <path
            className="sdv-node__detail"
            d={[-0.3, 0.3].map((f) => `M${f * w} ${top + 8}V${-top - 8}`).join(' ')}
          />
        </>
      );
    case 'cdn': {
      const sx = w / 112;
      const sy = h / 64;
      return (
        <path
          className="sdv-node__shape"
          transform={`scale(${sx} ${sy})`}
          d="M-38 30H40A17 17 0 0 0 46 -2A24 24 0 0 0 2 -26A19 19 0 0 0 -32 -12A21 21 0 0 0 -38 30Z"
        />
      );
    }
    case 'model': {
      const pin = 6;
      const rows = [-0.25, 0, 0.25].map((f) => f * h);
      return (
        <>
          <rect className="sdv-node__shape" x={left + pin} y={top} width={w - pin * 2} height={h} rx={8} />
          <path
            className="sdv-node__detail"
            d={rows.map((dy) => `M${left} ${dy}h${pin} M${-left - pin} ${dy}h${pin}`).join(' ')}
          />
        </>
      );
    }
    case 'vectorIndex': {
      const slant = 12;
      return (
        <polygon
          className="sdv-node__shape"
          points={`${left + slant},${top} ${-left},${top} ${-left - slant},${-top} ${left},${-top}`}
        />
      );
    }
  }
}

export interface EdgeProps {
  from: [number, number];
  to: [number, number];
  /** Marker id from ArrowDefs; omit for a plain line. */
  marker?: string;
  active?: boolean;
  dashed?: boolean;
  id?: string;
  /** Bend the line through this control point. */
  via?: [number, number];
}

export function Edge({ from, to, marker, active, dashed, id, via }: EdgeProps) {
  const d = via
    ? `M${from[0]} ${from[1]}Q${via[0]} ${via[1]} ${to[0]} ${to[1]}`
    : `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`;
  const classes = ['sdv-edge'];
  if (active) classes.push('sdv-edge--active');
  if (dashed) classes.push('sdv-edge--dashed');
  return (
    <path id={id} className={classes.join(' ')} d={d} markerEnd={marker ? `url(#${marker})` : undefined} />
  );
}

/** Turns React's useId output into a value that is safe inside url(#...). */
export function safeId(raw: string, prefix: string): string {
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Put once inside each <svg> that uses arrowed edges. */
export function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path className="sdv-arrowhead" d="M0 0L10 5L0 10z" />
      </marker>
    </defs>
  );
}
