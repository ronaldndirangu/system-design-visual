export type Vec = [number, number];

export const NODE_W = 112;
export const NODE_H = 64;

interface Positioned {
  x: number;
  y: number;
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

/** The visible segment between two node boxes. */
export function link(a: Positioned, b: Positioned): { from: Vec; to: Vec } {
  return { from: boxExit(a, b), to: boxExit(b, a) };
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
