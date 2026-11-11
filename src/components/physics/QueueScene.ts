import type MatterNamespace from 'matter-js';
import { type QueueTickPair, WORKERS } from '../../lib/models/backpressure';
import { createStepper, drawBall, type Matter, type Palette, type Scene, type SceneContext } from './runtime';

type Body = MatterNamespace.Body;

export interface QueueLaneView {
  label: string;
  detail: string;
  queued: number;
  /** Longest line the server admits: null means no limit, 0 means no line at all. */
  limit: number | null;
  limitLabel: string;
  busy: number;
}

type BallKind = 'queued' | 'served' | 'late' | 'dropped';

interface Ball {
  body: Body;
  kind: BallKind;
  lane: number;
  born: number;
}

interface Carrier {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  duration: number;
  kind: 'queued' | 'rejected' | 'direct';
  lane: number;
}

interface Lane {
  index: number;
  cx: number;
  bodies: Body[];
  view: QueueLaneView;
}

const RADIUS = 5;
const WALL = 6;
const INNER_WIDTH = 110;
const PER_ROW = Math.floor(INNER_WIDTH / (RADIUS * 2));
const TITLE_Y = 16;
const CLIENT_Y = 56;
const BUCKET_TOP = 88;
const BUCKET_HEIGHT = 110;
const FLOOR_Y = BUCKET_TOP + BUCKET_HEIGHT;
const WORKER_Y = FLOOR_Y + WALL + 6;
const WORKER_H = 12;
const SETTLE_MS = 450;
const CARRY_MS = 320;
const RECONCILE_MS = 250;
const MAX_BODIES = 600;
/** Most balls drawn in one line; longer lines show a "not drawn" count. */
const LANE_CAP = 80;
const CAT_WALL = 0x1;
const CAT_BALL = 0x2;
const CAT_GHOST = 0x4;

const blankView: QueueLaneView = { label: '', detail: '', queued: 0, limit: null, limitLabel: '', busy: 0 };

/**
 * Physics picture of a QueueDuel: two lanes, each a waiting line (cyan
 * bucket) above five workers. The model decides every outcome; this scene
 * only turns each tick into balls. Waiting requests pile up in the bucket,
 * requests a worker starts leave under the workers as rings (amber with a
 * slash when the answer will arrive after the client gave up), and requests
 * turned away spill over the rim as crosses. One ball stands for
 * `ballValue` requests.
 */
export class QueueScene implements Scene {
  private readonly M: Matter;
  private readonly engine: MatterNamespace.Engine;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private width: number;
  private height: number;
  private palette: Palette;
  private queueColor: string;
  private lanes: Lane[];
  private balls: Ball[] = [];
  private carriers: Carrier[] = [];
  private carry = new Map<string, number>();
  private clock = 0;
  private sinceReconcile = 0;
  private readonly step = createStepper();

  constructor(
    context: SceneContext,
    private readonly ballValue = 2,
  ) {
    this.M = context.Matter;
    this.ctx = context.ctx;
    this.canvas = context.canvas;
    this.width = context.width;
    this.height = context.height;
    this.palette = context.palette;
    this.queueColor = this.readQueueColor();
    this.engine = this.M.Engine.create({ enableSleeping: false });
    this.engine.gravity.y = 1;
    this.lanes = [this.createLane(0), this.createLane(1)];
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const lane of this.lanes) {
      const dx = this.laneX(lane.index) - lane.cx;
      if (Math.abs(dx) < 0.5) continue;
      for (const body of lane.bodies) {
        this.M.Body.setPosition(body, { x: body.position.x + dx, y: body.position.y });
      }
      for (const ball of this.balls) {
        if (ball.lane === lane.index && ball.kind === 'queued')
          this.M.Body.translate(ball.body, { x: dx, y: 0 });
      }
      for (const carrier of this.carriers) {
        if (carrier.lane !== lane.index) continue;
        carrier.x0 += dx;
        carrier.x1 += dx;
      }
      lane.cx += dx;
    }
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.queueColor = this.readQueueColor();
  }

  clear(): void {
    for (const ball of this.balls) this.M.Composite.remove(this.engine.world, ball.body);
    this.balls = [];
    this.carriers = [];
    this.carry.clear();
    for (const lane of this.lanes) lane.view = blankView;
  }

  destroy(): void {
    this.M.World.clear(this.engine.world, false);
    this.M.Engine.clear(this.engine);
  }

  /** Mirror one model tick. Call after every QueueDuel.step(). */
  applyTick(pair: QueueTickPair, views: readonly [QueueLaneView, QueueLaneView]): void {
    pair.forEach((tick, index) => {
      const lane = this.lanes[index];
      if (!lane) return;
      lane.view = views[index] ?? lane.view;
      // A request that found a free worker starts with a wait of exactly 0 ms.
      const direct = tick.waits.filter((wait) => wait === 0).length;
      this.launch('direct', lane, this.take(`a${index}`, direct));
      this.launch('queued', lane, this.take(`q${index}`, tick.arrived - tick.rejected - direct));
      this.launch('rejected', lane, this.take(`r${index}`, tick.rejected));
      this.leaveLine(lane, this.take(`o${index}`, tick.leftLine - direct));
      this.exit(lane, 'served', this.take(`s${index}`, tick.startedInTime - direct));
      this.exit(lane, 'late', this.take(`l${index}`, tick.startedLate));
      this.exit(lane, 'dropped', this.take(`d${index}`, tick.dropped));
      this.reconcile(lane);
    });
  }

  frame(dtMs: number): void {
    this.clock += dtMs;
    this.advanceCarriers(dtMs);
    this.step(dtMs, (ms) => this.M.Engine.update(this.engine, ms));
    this.cull();
    // Paused or finished runs send no ticks, so trim balls that settled after the last one.
    this.sinceReconcile += dtMs;
    if (this.sinceReconcile >= RECONCILE_MS) {
      this.sinceReconcile = 0;
      for (const lane of this.lanes) this.reconcile(lane);
    }
    this.draw();
  }

  private readQueueColor(): string {
    return getComputedStyle(this.canvas).getPropertyValue('--sdv-queue').trim() || '#22d3ee';
  }

  private laneX(index: number): number {
    return this.width * (0.25 + 0.5 * index);
  }

  private outward(lane: Lane): number {
    return lane.index === 0 ? -1 : 1;
  }

  private slotX(lane: Lane, slot: number): number {
    const width = (INNER_WIDTH - (WORKERS - 1) * 4) / WORKERS;
    return lane.cx - INNER_WIDTH / 2 + slot * (width + 4) + width / 2;
  }

  private fillHeight(requests: number): number {
    const rows = Math.max(1, Math.ceil(Math.ceil(requests / this.ballValue) / PER_ROW));
    return rows * RADIUS * 2.2 + 3;
  }

  private take(key: string, requests: number): number {
    if (requests <= 0) return 0;
    const total = (this.carry.get(key) ?? 0) + requests / this.ballValue;
    const whole = Math.floor(total);
    this.carry.set(key, total - whole);
    return whole;
  }

  private createLane(index: number): Lane {
    const { Bodies, Composite } = this.M;
    const options = {
      isStatic: true,
      friction: 0.05,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
    };
    const cx = this.laneX(index);
    const midY = BUCKET_TOP + BUCKET_HEIGHT / 2;
    const bodies = [
      Bodies.rectangle(cx - INNER_WIDTH / 2 - WALL / 2, midY, WALL, BUCKET_HEIGHT, options),
      Bodies.rectangle(cx + INNER_WIDTH / 2 + WALL / 2, midY, WALL, BUCKET_HEIGHT, options),
      Bodies.rectangle(cx, FLOOR_Y + WALL / 2, INNER_WIDTH + WALL * 2, WALL, options),
    ];
    Composite.add(this.engine.world, bodies);
    return { index, cx, bodies, view: blankView };
  }

  private waitingBalls(lane: Lane): number {
    let count = 0;
    for (const ball of this.balls) if (ball.lane === lane.index && ball.kind === 'queued') count += 1;
    for (const carrier of this.carriers)
      if (carrier.lane === lane.index && carrier.kind === 'queued') count += 1;
    return count;
  }

  private launch(kind: Carrier['kind'], lane: Lane, count: number): void {
    let waiting = kind === 'queued' ? this.waitingBalls(lane) : 0;
    for (let i = 0; i < count; i += 1) {
      if (this.carriers.length + this.balls.length > MAX_BODIES) return;
      if (kind === 'queued') {
        if (waiting >= LANE_CAP) return;
        waiting += 1;
      }
      const spread = (Math.random() - 0.5) * (INNER_WIDTH - RADIUS * 4);
      let x1 = lane.cx + spread;
      let y1 = BUCKET_TOP - 10;
      if (kind === 'rejected') {
        x1 = lane.cx + this.outward(lane) * (INNER_WIDTH / 2 + WALL + 3);
        y1 = BUCKET_TOP - 4;
      } else if (kind === 'direct') {
        x1 = this.slotX(lane, Math.floor(Math.random() * WORKERS));
        y1 = WORKER_Y + WORKER_H / 2;
      }
      this.carriers.push({
        x0: lane.cx + (Math.random() - 0.5) * 30,
        y0: CLIENT_Y + 12,
        x1,
        y1,
        t: -i * 40,
        duration: kind === 'direct' ? CARRY_MS * 1.4 : CARRY_MS,
        kind,
        lane: lane.index,
      });
    }
  }

  private advanceCarriers(dtMs: number): void {
    const remaining: Carrier[] = [];
    for (const carrier of this.carriers) {
      carrier.t += dtMs;
      if (carrier.t < carrier.duration) {
        remaining.push(carrier);
        continue;
      }
      const lane = this.lanes[carrier.lane];
      if (carrier.kind === 'queued') {
        this.addBall(carrier.x1, carrier.y1, 'queued', carrier.lane, { x: 0, y: 2 });
      } else if (carrier.kind === 'rejected') {
        const outward = lane ? this.outward(lane) : 1;
        this.addBall(carrier.x1, carrier.y1, 'dropped', carrier.lane, { x: outward * 1.2, y: -1 });
      } else {
        this.addBall(carrier.x1, WORKER_Y + WORKER_H + RADIUS + 2, 'served', carrier.lane, { x: 0, y: 1.2 });
      }
    }
    this.carriers = remaining;
  }

  private addBall(
    x: number,
    y: number,
    kind: BallKind,
    lane: number,
    velocity: { x: number; y: number },
  ): void {
    const solid = kind === 'queued';
    const body = this.M.Bodies.circle(x, y, RADIUS, {
      restitution: 0.15,
      friction: 0.02,
      frictionAir: solid ? 0.01 : 0.002,
      density: 0.002,
      collisionFilter: solid
        ? { category: CAT_BALL, mask: CAT_WALL | CAT_BALL }
        : { category: CAT_GHOST, mask: 0 },
    });
    this.M.Body.setVelocity(body, velocity);
    this.M.Composite.add(this.engine.world, body);
    this.balls.push({ body, kind, lane, born: this.clock });
  }

  /** The lowest settled balls go to a worker (or get dropped); exit() draws where they went. */
  private leaveLine(lane: Lane, count: number): void {
    if (count <= 0) return;
    const settled = this.balls
      .filter(
        (ball) => ball.lane === lane.index && ball.kind === 'queued' && this.clock - ball.born > SETTLE_MS,
      )
      .sort((a, b) => b.body.position.y - a.body.position.y)
      .slice(0, count);
    this.removeBalls(settled);
  }

  private removeBalls(gone: Ball[]): void {
    if (gone.length === 0) return;
    const set = new Set(gone);
    for (const ball of gone) this.M.Composite.remove(this.engine.world, ball.body);
    this.balls = this.balls.filter((ball) => !set.has(ball));
  }

  private exit(lane: Lane, kind: 'served' | 'late' | 'dropped', count: number): void {
    for (let i = 0; i < count; i += 1) {
      if (this.carriers.length + this.balls.length > MAX_BODIES) return;
      if (kind === 'dropped') {
        const x = lane.cx + (Math.random() - 0.5) * (INNER_WIDTH - RADIUS * 2);
        this.addBall(x, FLOOR_Y + WALL + RADIUS, 'dropped', lane.index, {
          x: this.outward(lane) * 1.4,
          y: 1.5,
        });
        continue;
      }
      const x = this.slotX(lane, Math.floor(Math.random() * WORKERS));
      this.addBall(x, WORKER_Y + WORKER_H + RADIUS + 2, kind, lane.index, {
        x: (Math.random() - 0.5) * 0.4,
        y: 0.8 + Math.random() * 1.2,
      });
    }
  }

  /** Keep the balls in a line in step with the model's line length. */
  private reconcile(lane: Lane): void {
    const target = Math.min(LANE_CAP, Math.round(lane.view.queued / this.ballValue));
    const settled: Ball[] = [];
    let arriving = this.carriers.filter(
      (carrier) => carrier.lane === lane.index && carrier.kind === 'queued',
    ).length;
    for (const ball of this.balls) {
      if (ball.lane !== lane.index || ball.kind !== 'queued') continue;
      if (this.clock - ball.born > SETTLE_MS) settled.push(ball);
      else arriving += 1;
    }
    if (settled.length > target) {
      settled.sort((a, b) => b.body.position.y - a.body.position.y);
      this.removeBalls(settled.slice(0, settled.length - target));
    } else if (settled.length + arriving < target) {
      this.launch('queued', lane, target - settled.length - arriving);
    }
  }

  private cull(): void {
    const keep: Ball[] = [];
    for (const ball of this.balls) {
      const { x, y } = ball.body.position;
      if (y > this.height + 20 || x < -40 || x > this.width + 40) {
        this.M.Composite.remove(this.engine.world, ball.body);
      } else {
        keep.push(ball);
      }
    }
    this.balls = keep;
  }

  private draw(): void {
    const { ctx, palette } = this;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.line;
    for (const lane of this.lanes) {
      ctx.beginPath();
      ctx.moveTo(lane.cx, CLIENT_Y + 12);
      ctx.lineTo(lane.cx, BUCKET_TOP - 8);
      ctx.stroke();
    }

    for (const lane of this.lanes) {
      this.drawClients(lane);
      this.drawWorkers(lane);
      this.drawBucket(lane);
    }

    for (const carrier of this.carriers) {
      if (carrier.t < 0) continue;
      const p = carrier.t / carrier.duration;
      const ease = 1 - (1 - p) * (1 - p);
      const x = carrier.x0 + (carrier.x1 - carrier.x0) * ease;
      const y = carrier.y0 + (carrier.y1 - carrier.y0) * ease - Math.sin(Math.PI * p) * 10;
      const bad = carrier.kind === 'rejected';
      drawBall(ctx, x, y, RADIUS, bad ? 'cross' : 'filled', bad ? palette.bad : palette.request, 0.9);
    }

    for (const ball of this.balls) {
      const { x, y } = ball.body.position;
      if (ball.kind === 'queued') drawBall(ctx, x, y, RADIUS, 'filled', palette.request);
      else if (ball.kind === 'served') drawBall(ctx, x, y, RADIUS, 'ring', palette.ok);
      else if (ball.kind === 'late') this.drawLate(x, y);
      else drawBall(ctx, x, y, RADIUS, 'cross', palette.bad);
    }

    for (const lane of this.lanes) this.drawLabels(lane);
  }

  private drawLate(x: number, y: number): void {
    const { ctx, palette } = this;
    drawBall(ctx, x, y, RADIUS, 'ring', palette.warn);
    const d = RADIUS * 0.75;
    ctx.beginPath();
    ctx.moveTo(x - d, y + d);
    ctx.lineTo(x + d, y - d);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.warn;
    ctx.stroke();
  }

  private drawClients(lane: Lane): void {
    const { ctx, palette } = this;
    const w = 84;
    const h = 24;
    const r = h / 2;
    const left = lane.cx - w / 2;
    const top = CLIENT_Y - h / 2;
    ctx.beginPath();
    ctx.moveTo(left + r, top);
    ctx.arcTo(left + w, top, left + w, top + h, r);
    ctx.arcTo(left + w, top + h, left, top + h, r);
    ctx.arcTo(left, top + h, left, top, r);
    ctx.arcTo(left, top, left + w, top, r);
    ctx.closePath();
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.strokeStyle = palette.client;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.text('Clients', lane.cx, CLIENT_Y + 4, palette.text, 600);
  }

  private drawWorkers(lane: Lane): void {
    const { ctx, palette } = this;
    const width = (INNER_WIDTH - (WORKERS - 1) * 4) / WORKERS;
    ctx.lineWidth = 1.5;
    for (let slot = 0; slot < WORKERS; slot += 1) {
      const x = this.slotX(lane, slot) - width / 2;
      ctx.strokeStyle = palette.server;
      ctx.strokeRect(x, WORKER_Y, width, WORKER_H);
      if (slot < lane.view.busy) {
        ctx.fillStyle = palette.server;
        ctx.fillRect(x + 2.5, WORKER_Y + 2.5, width - 5, WORKER_H - 5);
      }
    }
  }

  private drawBucket(lane: Lane): void {
    const { ctx, palette } = this;
    const left = lane.cx - INNER_WIDTH / 2 - WALL / 2;
    const right = lane.cx + INNER_WIDTH / 2 + WALL / 2;
    const bottom = FLOOR_Y + WALL / 2;
    ctx.strokeStyle = this.queueColor;
    ctx.lineWidth = WALL;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(left, BUCKET_TOP);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right, BUCKET_TOP);
    ctx.stroke();
    ctx.lineCap = 'butt';

    const { limit } = lane.view;
    if (limit === null) return;
    const y = limit === 0 ? FLOOR_Y - 2 : FLOOR_Y - this.fillHeight(limit);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lane.cx - INNER_WIDTH / 2, y);
    ctx.lineTo(lane.cx + INNER_WIDTH / 2, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Drawn after the balls, on plates, so falling balls never hide the text. */
  private drawLabels(lane: Lane): void {
    const { palette } = this;
    const { view } = lane;
    this.plate(lane.cx, TITLE_Y - 12, [view.label, view.detail], 34);
    this.text(view.label, lane.cx, TITLE_Y, palette.text, 600);
    this.text(view.detail, lane.cx, TITLE_Y + 16, palette.muted, 400);

    let note = view.limitLabel;
    let y = BUCKET_TOP + 14;
    if (view.limit === null) {
      const hidden = view.queued - LANE_CAP * this.ballValue;
      if (hidden > 0) note = `+${hidden} more not drawn`;
    } else {
      y = (view.limit === 0 ? FLOOR_Y - 2 : FLOOR_Y - this.fillHeight(view.limit)) - 6;
    }
    if (!note) return;
    this.plate(lane.cx, y - 11, [note], 15);
    this.text(note, lane.cx, y, palette.text, 600);
  }

  private plate(cx: number, top: number, lines: string[], height: number): void {
    const { ctx, palette } = this;
    ctx.font = `600 12px ${palette.font}`;
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 12;
    ctx.fillStyle = palette.surface;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(cx - width / 2, top, width, height);
    ctx.globalAlpha = 1;
  }

  private text(value: string, x: number, y: number, color: string, weight: number): void {
    const { ctx } = this;
    ctx.font = `${weight} 12px ${this.palette.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(value, x, y);
  }
}
