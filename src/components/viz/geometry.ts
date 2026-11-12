export type Vec = [number, number];

export const NODE_W = 112;
export const NODE_H = 64;

export const LABEL_PX = 14;
export const SUBLABEL_PX = 13;

/** Smallest on-screen text size for a semantic diagram label, in px. */
export const MIN_TEXT_PX = 12;
/** Narrowest a diagram may render, as screen px per viewBox unit, before its box scrolls instead. */
export const MIN_SCALE = 0.62;
/** Font size text reaches at MIN_SCALE, so the viewBox always has room for it. */
export const MAX_FONT = MIN_TEXT_PX / MIN_SCALE;

/** viewBox font size that renders at MIN_TEXT_PX for a drawing shown at `scale`, or undefined at full size. */
export function readableFont(scale: number): number | undefined {
  return scale < 1 ? Math.min(MAX_FONT, MIN_TEXT_PX / scale) : undefined;
}

export interface Positioned {
  x: number;
  y: number;
  /** Rendered node size; defaults to NODE_W by NODE_H. */
  w?: number;
  h?: number;
}

/** Point where the line from a toward b leaves a's node box, plus a small gap. */
export function boxExit(a: Positioned, b: Positioned, gap = 6, width = NODE_W, height = NODE_H): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [a.x, a.y];
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : (width / 2 + gap) / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : (height / 2 + gap) / Math.abs(dy),
  );
  return [a.x + dx * scale, a.y + dy * scale];
}

/** The visible segment between two node boxes, using each node's own size. */
export function link(a: Positioned, b: Positioned): { from: Vec; to: Vec } {
  return {
    from: boxExit(a, b, 6, a.w ?? NODE_W, a.h ?? NODE_H),
    to: boxExit(b, a, 6, b.w ?? NODE_W, b.h ?? NODE_H),
  };
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Conservative advance widths, in em, for the semibold UI font labels use. */
function charEm(ch: string): number {
  if ("ijl.,:;!'|".includes(ch)) return 0.28;
  if ('ftr'.includes(ch)) return 0.36;
  if (ch === ' ') return 0.27;
  if (ch === 'm' || ch === 'w') return 0.85;
  if (ch === 'M' || ch === 'W') return 0.9;
  if (ch === '-') return 0.4;
  if (ch >= '0' && ch <= '9') return 0.6;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.58;
}

/** Estimated rendered width of text at the given font size in px. */
export function textWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * px;
}

/** Horizontal room the shape's slanted or rounded sides take from the label, per side. */
const SIDE_INSET: Record<string, number> = {
  loadBalancer: 20,
  server: 16,
  queue: 14,
  model: 14,
  vectorIndex: 16,
};
/** The cloud outline only spans about two thirds of its box at label height. */
const CDN_TEXT_SHARE = 0.66;
/** Labels wrap once a single line would push the node past this width. */
const WRAP_AT = 140;
const LINE_GAP = 1.21;
const ASCENT = 0.97;

export interface NodeBox {
  w: number;
  h: number;
  lines: string[];
  /** Baseline y of each label line, relative to the node center. */
  baselines: number[];
  px: number;
  subPx: number;
  /** Baseline y of the sublabel, relative to the node center. */
  sublabelY: number;
}

function boxWidth(kind: string, textW: number): number {
  if (kind === 'cdn') return Math.ceil(textW / CDN_TEXT_SHARE);
  return Math.ceil(textW + 2 * (SIDE_INSET[kind] ?? 10));
}

/**
 * Node size that keeps its label inside the shape: the given size when the
 * label fits, otherwise wider, wrapped onto two lines, and taller as needed.
 * `minPx` raises both font sizes so text stays legible when the SVG shrinks.
 */
export function nodeSize(kind: string, label: string, minPx = 0, width = NODE_W, height = NODE_H): NodeBox {
  const px = Math.max(LABEL_PX, minPx);
  const subPx = Math.max(SUBLABEL_PX, minPx);
  let lines = [label];
  let w = Math.max(width, boxWidth(kind, textWidth(label, px)));
  const spaces = [...label.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (w > Math.max(width, WRAP_AT) && spaces.length > 0) {
    let best = Number.POSITIVE_INFINITY;
    for (const at of spaces) {
      const pair = [label.slice(0, at), label.slice(at + 1)];
      const widest = Math.max(...pair.map((line) => textWidth(line, px)));
      if (widest < best) {
        best = widest;
        lines = pair;
      }
    }
    w = Math.max(width, boxWidth(kind, best));
  }
  const iconBlock = kind === 'database' ? 38 : 32;
  const bottom = ((kind === 'database' ? 10 : 12) * px) / LABEL_PX;
  const h = Math.max(
    height,
    Math.ceil(iconBlock + bottom + (lines.length - 1) * LINE_GAP * px + ASCENT * px),
  );
  const last = h / 2 - bottom;
  const baselines = lines.map((_, i) => last - (lines.length - 1 - i) * LINE_GAP * px);
  return { w, h, lines, baselines, px, subPx, sublabelY: h / 2 + 3 + subPx };
}
