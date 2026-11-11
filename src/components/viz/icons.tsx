import type { ComponentKind, NodeStatus } from './kinds';

/** 24 by 24 stroke icons, one per component kind. */
const iconPaths: Record<ComponentKind, string> = {
  client: 'M3 5h18v11H3z M8 20h8 M12 16v4',
  dns: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
  loadBalancer: 'M12 21v-8 M12 13L5 6 M12 13l7-7 M5 10V6h4 M19 10V6h-4',
  cache: 'M13 2L4 14h7l-1 8l9-12h-7z',
  database:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3s-3.6 3-8 3s-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  queue: 'M3 7h18v10H3z M8 7v10 M13 7v10 M18 7v10',
  cdn: 'M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.6A4.2 4.2 0 0 0 7 18z',
  model: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z',
  vectorIndex: 'M4 4v16h16 M9 15h.01 M12 10h.01 M15 14h.01 M18 7h.01',
};

export function KindIcon({
  kind,
  size = 18,
  x = 0,
  y = 0,
}: {
  kind: ComponentKind;
  size?: number;
  x?: number;
  y?: number;
}) {
  return (
    <path
      className="sdv-node__icon"
      d={iconPaths[kind]}
      transform={`translate(${x} ${y}) scale(${size / 24})`}
      vectorEffect="non-scaling-stroke"
    />
  );
}

const statusGlyph: Record<NodeStatus, string> = {
  ok: 'M-3.5 0l2.5 2.5l4.5-5',
  warn: 'M0 -4v4.5 M0 3.6v.1',
  bad: 'M-3 -3l6 6 M3 -3l-6 6',
};

export function StatusBadge({ status, x, y }: { status: NodeStatus; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={9} className={`sdv-status--${status}`} />
      <path d={statusGlyph[status]} className="sdv-status__glyph" />
    </g>
  );
}

/** Inline HTML icons for buttons and badges. */
export function UiIcon({
  name,
}: {
  name: 'play' | 'pause' | 'step' | 'reset' | 'ok' | 'warn' | 'bad' | 'check';
}) {
  const paths = {
    play: 'M7 4l13 8l-13 8z',
    pause: 'M7 4h3v16H7z M14 4h3v16h-3z',
    step: 'M5 4l10 8l-10 8z M18 4v16',
    reset: 'M4 4v6h6 M4.5 15a8 8 0 1 0 2-9L4 10',
    ok: 'M5 12l4 4l10-10',
    check: 'M5 12l4 4l10-10',
    warn: 'M12 4v9 M12 18v.5',
    bad: 'M6 6l12 12 M18 6L6 18',
  } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={paths[name]}
        fill={name === 'play' || name === 'pause' || name === 'step' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={name === 'play' || name === 'pause' ? 0 : 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
