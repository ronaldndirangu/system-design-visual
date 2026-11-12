/** Canvas colors, read from the theme tokens in src/styles/theme.css. */
export interface Palette {
  /** The packet color: requests in flight share it with SVG dots and active edges. */
  request: string;
  ok: string;
  bad: string;
  warn: string;
  /** Glyph ink drawn on top of a status fill, such as the cross on a dropped request. */
  ink: string;
  text: string;
  muted: string;
  line: string;
  surface: string;
  client: string;
  server: string;
  lb: string;
  queue: string;
  font: string;
}

export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const read = (name: string, fallback = 'gray') => style.getPropertyValue(name).trim() || fallback;
  return {
    request: read('--sdv-packet'),
    ok: read('--sdv-ok'),
    bad: read('--sdv-bad'),
    warn: read('--sdv-warn'),
    ink: read('--sdv-ink-on-status', 'black'),
    text: read('--sdv-text-1', 'black'),
    muted: read('--sdv-text-2'),
    line: read('--sl-color-gray-4'),
    surface: read('--sdv-bg', 'white'),
    client: read('--sdv-client'),
    server: read('--sdv-server'),
    lb: read('--sdv-lb'),
    queue: read('--sdv-queue'),
    font: read('--sl-font', 'system-ui, sans-serif'),
  };
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  style: 'filled' | 'ring' | 'cross',
  color: string,
  alpha = 1,
  ink = 'black',
) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (style === 'ring') {
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (style === 'cross') {
    const d = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function hexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const inset = Math.min(14, w / 4);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx - w / 2 + inset, cy - h / 2);
  ctx.lineTo(cx + w / 2 - inset, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx + w / 2 - inset, cy + h / 2);
  ctx.lineTo(cx - w / 2 + inset, cy + h / 2);
  ctx.closePath();
}
