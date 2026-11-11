import type MatterNamespace from 'matter-js';
import type { FarmTick } from '../../lib/models/serverFarm';
import {
  createStepper,
  drawBall,
  hexagon,
  type Matter,
  type Palette,
  type Scene,
  type SceneContext,
} from './runtime';

type Body = MatterNamespace.Body;

export interface BucketView {
  id: number;
  label: string;
  detail: string;
  up: boolean;
  inPool: boolean;
  draining: boolean;
  queueLength: number;
}

type BallKind = 'queued' | 'served' | 'dropped';

interface Ball {
  body: Body;
  kind: BallKind;
  home: number | null;
  born: number;
}

interface Carrier {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  duration: number;
  kind: 'queued' | 'rejected' | 'failed';
  home: number;
}

interface Bucket {
  id: number;
  cx: number;
  walls: Body[];
  floor: Body;
  floorOn: boolean;
  view: BucketView;
}

const RADIUS = 5;
const WALL = 6;
const INNER_WIDTH = 60;
const LB_Y = 36;
const BUCKET_TOP = 112;
const SETTLE_MS = 450;
const CARRY_MS = 320;
const MAX_BODIES = 700;
const CAT_WALL = 0x1;
const CAT_BALL = 0x2;
const CAT_GHOST = 0x4;

/**
 * Physics picture of a ServerFarm. The model decides every outcome; this
 * scene turns each tick into balls: queued requests sit in a server's bucket,
 * served ones leave through the floor as rings, and rejected or failed ones
 * spill out marked with a cross. One ball stands for `ballValue` requests.
 */
export class FarmScene implements Scene {
  private readonly M: Matter;
  private readonly engine: MatterNamespace.Engine;
  private readonly ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private palette: Palette;
  private readonly bucketHeight: number;
  private buckets = new Map<number, Bucket>();
  private balls: Ball[] = [];
  private carriers: Carrier[] = [];
  private carry = new Map<string, number>();
  private clock = 0;
  private readonly step = createStepper();

  constructor(
    context: SceneContext,
    private readonly ballValue: number,
    queueLimit: number,
  ) {
    this.M = context.Matter;
    this.ctx = context.ctx;
    this.width = context.width;
    this.height = context.height;
    this.palette = context.palette;
    this.engine = this.M.Engine.create({ enableSleeping: false });
    this.engine.gravity.y = 1;
    const perRow = Math.floor(INNER_WIDTH / (RADIUS * 2));
    const rows = Math.ceil(Math.ceil(queueLimit / ballValue) / perRow);
    this.bucketHeight = Math.max(56, rows * RADIUS * 2.6 + 14);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.layout();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
  }

  clear(): void {
    for (const ball of this.balls) this.M.Composite.remove(this.engine.world, ball.body);
    this.balls = [];
    this.carriers = [];
    this.carry.clear();
  }

  destroy(): void {
    this.M.World.clear(this.engine.world, false);
    this.M.Engine.clear(this.engine);
  }

  /** Mirror one model tick. Call after every ServerFarm.step(). */
  applyTick(tick: FarmTick, views: BucketView[]): void {
    this.syncBuckets(views);

    let routedRejections = 0;
    for (const server of tick.servers) {
      const bucket = this.buckets.get(server.id);
      routedRejections += server.rejected;
      if (!bucket) continue;
      if (!server.up) {
        this.launch('failed', bucket, this.take(`f${server.id}`, server.assigned));
        continue;
      }
      const accepted = server.assigned - server.rejected - server.failed;
      this.launch('queued', bucket, this.take(`q${server.id}`, accepted));
      this.launch('rejected', bucket, this.take(`r${server.id}`, server.rejected));
    }

    const unrouted = this.take('unrouted', tick.rejected - routedRejections);
    for (let i = 0; i < unrouted; i += 1) {
      this.addBall(this.width / 2 + (Math.random() - 0.5) * 40, LB_Y + 20, 'dropped', null, {
        x: (Math.random() - 0.5) * 3,
        y: 1,
      });
    }

    for (const bucket of this.buckets.values()) this.reconcile(bucket);
  }

  frame(dtMs: number): void {
    this.clock += dtMs;
    this.advanceCarriers(dtMs);
    this.step(dtMs, (ms) => this.M.Engine.update(this.engine, ms));
    this.cull();
    this.draw();
  }

  private take(key: string, requests: number): number {
    if (requests <= 0) return 0;
    const total = (this.carry.get(key) ?? 0) + requests / this.ballValue;
    const whole = Math.floor(total);
    this.carry.set(key, total - whole);
    return whole;
  }

  private syncBuckets(views: BucketView[]): void {
    const seen = new Set<number>();
    let changed = false;
    for (const view of views) {
      seen.add(view.id);
      let bucket = this.buckets.get(view.id);
      if (!bucket) {
        bucket = this.createBucket(view);
        this.buckets.set(view.id, bucket);
        changed = true;
      }
      bucket.view = view;
      if (!view.up && bucket.floorOn) {
        this.M.Composite.remove(this.engine.world, bucket.floor);
        bucket.floorOn = false;
        for (const ball of this.balls) {
          if (ball.home === bucket.id && ball.kind === 'queued') this.ghost(ball, 'dropped');
        }
      } else if (view.up && !bucket.floorOn) {
        this.M.Composite.add(this.engine.world, bucket.floor);
        bucket.floorOn = true;
      }
    }
    for (const bucket of [...this.buckets.values()]) {
      if (seen.has(bucket.id)) continue;
      this.M.Composite.remove(this.engine.world, bucket.walls);
      if (bucket.floorOn) this.M.Composite.remove(this.engine.world, bucket.floor);
      for (const ball of this.balls)
        if (ball.home === bucket.id && ball.kind === 'queued') this.ghost(ball, 'served');
      this.carriers = this.carriers.filter((carrier) => carrier.home !== bucket.id);
      this.buckets.delete(bucket.id);
      changed = true;
    }
    if (changed) this.layout();
  }

  private createBucket(view: BucketView): Bucket {
    const { Bodies, Composite } = this.M;
    const options = {
      isStatic: true,
      friction: 0.05,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
    };
    const midY = BUCKET_TOP + this.bucketHeight / 2;
    const cx = this.width / 2;
    const walls = [
      Bodies.rectangle(cx - INNER_WIDTH / 2 - WALL / 2, midY, WALL, this.bucketHeight, options),
      Bodies.rectangle(cx + INNER_WIDTH / 2 + WALL / 2, midY, WALL, this.bucketHeight, options),
    ];
    const floor = Bodies.rectangle(
      cx,
      BUCKET_TOP + this.bucketHeight + WALL / 2,
      INNER_WIDTH + WALL * 2,
      WALL,
      options,
    );
    Composite.add(this.engine.world, [...walls, floor]);
    return { id: view.id, cx, walls, floor, floorOn: true, view };
  }

  private layout(): void {
    const ordered = [...this.buckets.values()].sort((a, b) => a.id - b.id);
    const slot = this.width / Math.max(1, ordered.length);
    ordered.forEach((bucket, index) => {
      const cx = slot * (index + 0.5);
      const dx = cx - bucket.cx;
      if (Math.abs(dx) < 0.5) return;
      for (const body of [...bucket.walls, bucket.floor]) {
        this.M.Body.setPosition(body, { x: body.position.x + dx, y: body.position.y });
      }
      for (const ball of this.balls) {
        if (ball.home === bucket.id && ball.kind === 'queued')
          this.M.Body.translate(ball.body, { x: dx, y: 0 });
      }
      for (const carrier of this.carriers) if (carrier.home === bucket.id) carrier.x1 += dx;
      bucket.cx = cx;
    });
  }

  private launch(kind: Carrier['kind'], bucket: Bucket, count: number): void {
    for (let i = 0; i < count; i += 1) {
      if (this.carriers.length + this.balls.length > MAX_BODIES) return;
      const spread = (Math.random() - 0.5) * (INNER_WIDTH - RADIUS * 4);
      const side = Math.random() < 0.5 ? -1 : 1;
      this.carriers.push({
        x0: this.width / 2 + (Math.random() - 0.5) * 30,
        y0: LB_Y + 14,
        x1: kind === 'rejected' ? bucket.cx + side * (INNER_WIDTH / 2 + WALL + 2) : bucket.cx + spread,
        y1: BUCKET_TOP - 14,
        t: -i * 40,
        duration: CARRY_MS,
        kind,
        home: bucket.id,
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
      if (carrier.kind === 'queued') {
        this.addBall(carrier.x1, carrier.y1, 'queued', carrier.home, { x: 0, y: 2 });
      } else if (carrier.kind === 'rejected') {
        const bucket = this.buckets.get(carrier.home);
        const outward = bucket && carrier.x1 < bucket.cx ? -1 : 1;
        this.addBall(carrier.x1, carrier.y1, 'dropped', carrier.home, { x: outward * 1.6, y: -1.5 });
      } else {
        this.addBall(carrier.x1, carrier.y1, 'dropped', carrier.home, { x: 0, y: 2 });
      }
    }
    this.carriers = remaining;
  }

  private addBall(
    x: number,
    y: number,
    kind: BallKind,
    home: number | null,
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
    this.balls.push({ body, kind, home, born: this.clock });
  }

  private ghost(ball: Ball, kind: 'served' | 'dropped'): void {
    ball.kind = kind;
    ball.body.collisionFilter = { group: 0, category: CAT_GHOST, mask: 0 };
  }

  /** Keep the number of balls in a bucket in line with the model's queue. */
  private reconcile(bucket: Bucket): void {
    if (!bucket.view.up) return;
    const target = Math.round(bucket.view.queueLength / this.ballValue);
    const settled: Ball[] = [];
    let arriving = this.carriers.filter(
      (carrier) => carrier.home === bucket.id && carrier.kind === 'queued',
    ).length;
    for (const ball of this.balls) {
      if (ball.home !== bucket.id || ball.kind !== 'queued') continue;
      if (this.clock - ball.born > SETTLE_MS) settled.push(ball);
      else arriving += 1;
    }
    if (settled.length > target) {
      settled.sort((a, b) => b.body.position.y - a.body.position.y);
      for (const ball of settled.slice(0, settled.length - target)) {
        this.M.Body.setPosition(ball.body, {
          x: bucket.cx + (Math.random() - 0.5) * INNER_WIDTH * 0.6,
          y: BUCKET_TOP + this.bucketHeight + WALL + RADIUS + 2,
        });
        this.M.Body.setVelocity(ball.body, { x: 0, y: 2.5 });
        this.ghost(ball, 'served');
      }
    } else if (settled.length + arriving < target) {
      this.launch('queued', bucket, target - settled.length - arriving);
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
    const buckets = [...this.buckets.values()];

    ctx.lineWidth = 1.5;
    for (const bucket of buckets) {
      ctx.setLineDash(bucket.view.inPool ? [] : [4, 4]);
      ctx.strokeStyle = palette.line;
      ctx.beginPath();
      ctx.moveTo(this.width / 2, LB_Y + 20);
      ctx.lineTo(bucket.cx, BUCKET_TOP - 22);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    hexagon(ctx, this.width / 2, LB_Y, 132, 40);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.strokeStyle = palette.lb;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.text('Load balancer', this.width / 2, LB_Y + 4, palette.text, 600);

    for (const bucket of buckets) this.drawBucket(bucket);

    for (const carrier of this.carriers) {
      if (carrier.t < 0) continue;
      const p = carrier.t / carrier.duration;
      const ease = 1 - (1 - p) * (1 - p);
      const x = carrier.x0 + (carrier.x1 - carrier.x0) * ease;
      const y = carrier.y0 + (carrier.y1 - carrier.y0) * ease - Math.sin(Math.PI * p) * 14;
      const bad = carrier.kind !== 'queued';
      drawBall(ctx, x, y, RADIUS, bad ? 'cross' : 'filled', bad ? palette.bad : palette.request, 0.9);
    }

    for (const ball of this.balls) {
      const { x, y } = ball.body.position;
      if (ball.kind === 'queued') drawBall(ctx, x, y, RADIUS, 'filled', palette.request);
      else if (ball.kind === 'served') drawBall(ctx, x, y, RADIUS, 'ring', palette.ok);
      else drawBall(ctx, x, y, RADIUS, 'cross', palette.bad);
    }

    for (const bucket of buckets) this.drawBucketLabels(bucket);
  }

  private drawBucket(bucket: Bucket): void {
    const { ctx, palette } = this;
    const { view } = bucket;
    const left = bucket.cx - INNER_WIDTH / 2 - WALL / 2;
    const right = bucket.cx + INNER_WIDTH / 2 + WALL / 2;
    const bottom = BUCKET_TOP + this.bucketHeight + WALL / 2;
    ctx.globalAlpha = view.draining ? 0.55 : 1;
    ctx.strokeStyle = palette.server;
    ctx.lineWidth = WALL;
    ctx.lineCap = 'round';
    ctx.setLineDash(view.up ? [] : [8, 7]);
    ctx.beginPath();
    ctx.moveTo(left, BUCKET_TOP);
    ctx.lineTo(left, bottom);
    if (bucket.floorOn) ctx.lineTo(right, bottom);
    else ctx.moveTo(right, bottom);
    ctx.lineTo(right, BUCKET_TOP);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  /** Drawn after the balls, on a plate, so falling balls never hide the text. */
  private drawBucketLabels(bucket: Bucket): void {
    const { ctx, palette } = this;
    const { view } = bucket;
    const bottom = BUCKET_TOP + this.bucketHeight + WALL / 2;
    const status = !view.up ? '✕ Down' : view.draining ? 'Draining' : !view.inPool ? 'Out of pool' : '';
    ctx.globalAlpha = view.draining ? 0.55 : 1;
    ctx.font = `600 12px ${palette.font}`;
    const plateWidth = Math.max(ctx.measureText(view.label).width, ctx.measureText(view.detail).width) + 12;
    ctx.fillStyle = palette.surface;
    ctx.globalAlpha *= 0.88;
    ctx.fillRect(bucket.cx - plateWidth / 2, bottom + 7, plateWidth, 34);
    ctx.globalAlpha = view.draining ? 0.55 : 1;
    this.text(view.label, bucket.cx, bottom + 20, palette.text, 600);
    this.text(view.detail, bucket.cx, bottom + 36, palette.muted, 400);
    if (status) this.text(status, bucket.cx, BUCKET_TOP - 28, view.up ? palette.warn : palette.bad, 700);
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
