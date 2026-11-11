import type MatterNamespace from 'matter-js';
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

export interface LandingStats {
  arrivedPerSecond: number;
  servedPerSecond: number;
  droppedPerSecond: number;
  servers: number;
}

type BallState = 'flying' | 'queued' | 'served' | 'dropped';

interface Ball {
  body: Body;
  state: BallState;
  target: number;
  born: number;
}

interface Bucket {
  cx: number;
  walls: Body[];
  nextDrain: number;
}

const RADIUS = 6;
const INNER = 58;
const WALL = 6;
const BUCKET_HEIGHT = 74;
const DRAIN_PER_SECOND = 5;
const WINDOW_MS = 4000;
const CAT_WALL = 0x1;
const CAT_BALL = 0x2;
const CAT_FLY = 0x4;
const CAT_GHOST = 0x8;

/**
 * A playful, self-contained physics toy for the landing page: users drop
 * requests into a funnel, a load balancer throws each one at the next server,
 * and every server drains a fixed number per second. When arrivals beat
 * capacity, buckets fill and requests spill over the rim.
 */
export class LandingScene implements Scene {
  private readonly M: Matter;
  private readonly engine: MatterNamespace.Engine;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private width: number;
  private height: number;
  private palette: Palette;
  private funnel: Body[] = [];
  private neck: Body | undefined;
  private buckets: Bucket[] = [];
  private balls: Ball[] = [];
  private cursor = 0;
  private clock = 0;
  private spawnCarry = 0;
  private events: { time: number; kind: 'arrived' | 'served' | 'dropped' }[] = [];
  private mouseConstraint: MatterNamespace.MouseConstraint | undefined;
  private readonly step = createStepper();
  rate = 8;

  constructor(context: SceneContext, servers: number) {
    this.M = context.Matter;
    this.ctx = context.ctx;
    this.canvas = context.canvas;
    this.width = context.width;
    this.height = context.height;
    this.palette = context.palette;
    this.engine = this.M.Engine.create();
    this.buildFunnel();
    this.setServers(servers);
    this.enableDragging();
    this.M.Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const other =
          pair.bodyA === this.neck ? pair.bodyB : pair.bodyB === this.neck ? pair.bodyA : undefined;
        if (other) this.route(other);
      }
    });
  }

  get layout() {
    const top = Math.max(150, this.height * 0.5);
    return { usersY: 26, neckY: 112, bucketTop: top, bucketBottom: top + BUCKET_HEIGHT };
  }

  setServers(count: number): void {
    const { Bodies, Composite } = this.M;
    for (const bucket of this.buckets) Composite.remove(this.engine.world, bucket.walls);
    const { bucketTop } = this.layout;
    const slot = this.width / count;
    const options = {
      isStatic: true,
      friction: 0.02,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL | CAT_FLY },
    };
    this.buckets = Array.from({ length: count }, (_, index) => {
      const cx = slot * (index + 0.5);
      const midY = bucketTop + BUCKET_HEIGHT / 2;
      const walls = [
        Bodies.rectangle(cx - INNER / 2 - WALL / 2, midY, WALL, BUCKET_HEIGHT, options),
        Bodies.rectangle(cx + INNER / 2 + WALL / 2, midY, WALL, BUCKET_HEIGHT, options),
        Bodies.rectangle(cx, bucketTop + BUCKET_HEIGHT + WALL / 2, INNER + WALL * 2, WALL, options),
      ];
      Composite.add(this.engine.world, walls);
      return { cx, walls, nextDrain: this.clock + 1000 / DRAIN_PER_SECOND };
    });
    this.cursor = 0;
    // Requests that were waiting in removed buckets, or now sit in the wrong place, fall away.
    for (const ball of this.balls) {
      if (ball.state === 'queued' || ball.state === 'flying') this.markDropped(ball);
    }
  }

  stats(): LandingStats {
    const cutoff = this.clock - WINDOW_MS;
    this.events = this.events.filter((event) => event.time > cutoff);
    const seconds = Math.min(this.clock, WINDOW_MS) / 1000 || 1;
    const count = (kind: string) => this.events.filter((event) => event.kind === kind).length / seconds;
    return {
      arrivedPerSecond: count('arrived'),
      servedPerSecond: count('served'),
      droppedPerSecond: count('dropped'),
      servers: this.buckets.length,
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const { Composite } = this.M;
    Composite.remove(this.engine.world, this.funnel);
    if (this.neck) Composite.remove(this.engine.world, this.neck);
    this.buildFunnel();
    this.setServers(this.buckets.length || 1);
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
  }

  destroy(): void {
    if (this.mouseConstraint) {
      this.M.Mouse.clearSourceEvents(this.mouseConstraint.mouse);
      const mouse = this.mouseConstraint.mouse as MatterNamespace.Mouse & Record<string, EventListener>;
      for (const [name, handler] of [
        ['mousemove', 'mousemove'],
        ['mousedown', 'mousedown'],
        ['mouseup', 'mouseup'],
      ] as const) {
        const listener = mouse[handler];
        if (listener) this.canvas.removeEventListener(name, listener);
      }
    }
    this.M.Composite.clear(this.engine.world, false);
    this.M.Engine.clear(this.engine);
  }

  frame(dtMs: number): void {
    this.clock += dtMs;
    this.spawn(dtMs);
    this.drain();
    this.step(dtMs, (ms) => this.M.Engine.update(this.engine, ms));
    this.updateStates();
    this.draw();
  }

  private buildFunnel(): void {
    const { Bodies, Composite } = this.M;
    const { neckY } = this.layout;
    const cx = this.width / 2;
    const options = {
      isStatic: true,
      friction: 0,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL | CAT_FLY },
    };
    const halfTop = Math.min(120, this.width * 0.28);
    const gap = RADIUS * 2.6;
    const funnelTop = 52;
    const makeWall = (x1: number, y1: number, x2: number, y2: number) => {
      const length = Math.hypot(x2 - x1, y2 - y1);
      return Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, length, 5, {
        ...options,
        angle: Math.atan2(y2 - y1, x2 - x1),
      });
    };
    this.funnel = [
      makeWall(cx - halfTop, funnelTop, cx - gap, neckY - 18),
      makeWall(cx + halfTop, funnelTop, cx + gap, neckY - 18),
    ];
    this.neck = Bodies.rectangle(cx, neckY, gap * 2.4, 10, {
      isStatic: true,
      isSensor: true,
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
    });
    Composite.add(this.engine.world, [...this.funnel, this.neck]);
  }

  private enableDragging(): void {
    const { Mouse, MouseConstraint, Composite } = this.M;
    const mouse = Mouse.create(this.canvas);
    mouse.pixelRatio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    // Keep page scrolling and touch gestures working over the canvas.
    const raw = mouse as MatterNamespace.Mouse & Record<string, EventListener>;
    for (const [name, handler] of [
      ['wheel', 'mousewheel'],
      ['touchmove', 'mousemove'],
      ['touchstart', 'mousedown'],
      ['touchend', 'mouseup'],
    ] as const) {
      const listener = raw[handler];
      if (listener) this.canvas.removeEventListener(name, listener);
    }
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse,
      constraint: { stiffness: 0.2, render: { visible: false } },
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL | CAT_FLY },
    });
    Composite.add(this.engine.world, this.mouseConstraint);
  }

  private spawn(dtMs: number): void {
    this.spawnCarry += (this.rate * dtMs) / 1000;
    const cx = this.width / 2;
    const spread = Math.min(100, this.width * 0.22);
    while (this.spawnCarry >= 1) {
      this.spawnCarry -= 1;
      if (this.balls.length > 260) continue;
      const body = this.M.Bodies.circle(
        cx + (Math.random() - 0.5) * spread * 2,
        this.layout.usersY + 16,
        RADIUS,
        {
          restitution: 0.2,
          friction: 0.01,
          frictionAir: 0.004,
          collisionFilter: { category: CAT_BALL, mask: CAT_WALL | CAT_BALL },
        },
      );
      this.M.Composite.add(this.engine.world, body);
      this.balls.push({ body, state: 'queued', target: -1, born: this.clock });
      this.events.push({ time: this.clock, kind: 'arrived' });
    }
  }

  /** The load balancer: throw the ball on an arc that lands in the next bucket. */
  private route(body: Body): void {
    const ball = this.balls.find((candidate) => candidate.body === body);
    if (!ball || ball.target !== -1 || this.buckets.length === 0) return;
    const index = this.cursor % this.buckets.length;
    this.cursor += 1;
    const bucket = this.buckets[index];
    if (!bucket) return;
    ball.target = index;
    ball.state = 'flying';
    body.collisionFilter = { group: 0, category: CAT_FLY, mask: 0 };
    body.frictionAir = 0;
    const g = this.engine.gravity.y * this.engine.gravity.scale * (1000 / 60) ** 2;
    const vy = -3.2;
    const dy = this.layout.bucketTop - 8 - body.position.y;
    const steps = (-vy + Math.sqrt(vy * vy + 2 * g * dy)) / g;
    const vx = (bucket.cx - body.position.x) / steps;
    this.M.Body.setPosition(body, { x: this.width / 2, y: body.position.y });
    this.M.Body.setVelocity(body, { x: vx, y: vy });
  }

  private drain(): void {
    for (const [index, bucket] of this.buckets.entries()) {
      if (this.clock < bucket.nextDrain) continue;
      bucket.nextDrain = this.clock + 1000 / DRAIN_PER_SECOND;
      const inside = this.balls.filter(
        (ball) => ball.state === 'queued' && ball.target === index && this.inBucket(ball, bucket),
      );
      if (inside.length === 0) continue;
      const lowest = inside.reduce((a, b) => (a.body.position.y > b.body.position.y ? a : b));
      lowest.state = 'served';
      lowest.body.collisionFilter = { group: 0, category: CAT_GHOST, mask: 0 };
      this.M.Body.setPosition(lowest.body, {
        x: lowest.body.position.x,
        y: this.layout.bucketBottom + WALL + RADIUS + 2,
      });
      this.M.Body.setVelocity(lowest.body, { x: 0, y: 2 });
      this.events.push({ time: this.clock, kind: 'served' });
    }
  }

  private inBucket(ball: Ball, bucket: Bucket): boolean {
    const { x, y } = ball.body.position;
    const { bucketTop, bucketBottom } = this.layout;
    return Math.abs(x - bucket.cx) < INNER / 2 + 2 && y > bucketTop - RADIUS && y < bucketBottom + 2;
  }

  private markDropped(ball: Ball): void {
    if (ball.state === 'dropped' || ball.state === 'served') return;
    ball.state = 'dropped';
    ball.body.collisionFilter = { group: 0, category: CAT_GHOST, mask: 0 };
    this.events.push({ time: this.clock, kind: 'dropped' });
  }

  private updateStates(): void {
    const { bucketTop, bucketBottom } = this.layout;
    const keep: Ball[] = [];
    for (const ball of this.balls) {
      const { x, y } = ball.body.position;
      if (ball.state === 'flying') {
        const bucket = this.buckets[ball.target];
        if (bucket && y > bucketTop - RADIUS && Math.abs(x - bucket.cx) < INNER / 2) {
          ball.state = 'queued';
          ball.body.collisionFilter = { group: 0, category: CAT_BALL, mask: CAT_WALL | CAT_BALL };
          ball.body.frictionAir = 0.004;
        } else if (y > bucketTop + 10) {
          this.markDropped(ball);
        }
      } else if (ball.state === 'queued' && ball.target >= 0 && y > bucketTop + 4) {
        const bucket = this.buckets[ball.target];
        if (!bucket || !this.inBucket(ball, bucket)) this.markDropped(ball);
      } else if (ball.state === 'queued' && ball.target === -1 && y > bucketBottom) {
        this.markDropped(ball);
      }
      if (y > this.height + 30 || x < -60 || x > this.width + 60) {
        if (ball.state === 'queued' || ball.state === 'flying') this.markDropped(ball);
        this.M.Composite.remove(this.engine.world, ball.body);
      } else {
        keep.push(ball);
      }
    }
    this.balls = keep;
  }

  private draw(): void {
    const { ctx, palette } = this;
    const { usersY, neckY, bucketTop, bucketBottom } = this.layout;
    const cx = this.width / 2;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.font = `600 12px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = palette.client;
    ctx.fillText('Users', cx, usersY);

    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const wall of this.funnel) {
      const [a, , c] = wall.vertices;
      const [, b, , d] = wall.vertices;
      if (!a || !b || !c || !d) continue;
      ctx.beginPath();
      ctx.moveTo((a.x + d.x) / 2, (a.y + d.y) / 2);
      ctx.lineTo((b.x + c.x) / 2, (b.y + c.y) / 2);
      ctx.stroke();
    }

    hexagon(ctx, cx, neckY + 4, 112, 30);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.strokeStyle = palette.lb;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = palette.text;
    ctx.fillText('Load balancer', cx, neckY + 8);

    for (const bucket of this.buckets) {
      const left = bucket.cx - INNER / 2 - WALL / 2;
      const right = bucket.cx + INNER / 2 + WALL / 2;
      const bottom = bucketBottom + WALL / 2;
      ctx.strokeStyle = palette.server;
      ctx.lineWidth = WALL;
      ctx.beginPath();
      ctx.moveTo(left, bucketTop);
      ctx.lineTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.lineTo(right, bucketTop);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    for (const ball of this.balls) {
      const { x, y } = ball.body.position;
      if (ball.state === 'served') drawBall(ctx, x, y, RADIUS, 'ring', palette.ok);
      else if (ball.state === 'dropped') drawBall(ctx, x, y, RADIUS, 'cross', palette.bad);
      else drawBall(ctx, x, y, RADIUS, 'filled', palette.request);
    }

    for (const [index, bucket] of this.buckets.entries()) {
      const label = `Server ${index + 1}`;
      const bottom = bucketBottom + WALL / 2;
      const plate = ctx.measureText(label).width + 12;
      ctx.fillStyle = palette.surface;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(bucket.cx - plate / 2, bottom + 9, plate, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.text;
      ctx.fillText(label, bucket.cx, bottom + 22);
    }
  }
}
