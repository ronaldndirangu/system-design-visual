import type MatterNamespace from 'matter-js';
import {
  type Assignment,
  LANDING_TRANSIT_MS,
  LandingQueue,
  type LandingStats,
} from '../../lib/models/landingQueue';
import { createRng, type Rng } from '../../lib/rng';
import {
  createStepper,
  drawBall,
  hexagon,
  type Matter,
  type Palette,
  type Scene,
  type SceneContext,
} from './runtime';

export type { LandingStats };

type Body = MatterNamespace.Body;

type BallState = 'waiting' | 'flying' | 'queued' | 'served' | 'dropped';

interface Flight {
  x0: number;
  y0: number;
  start: number;
  rejected: boolean;
}

interface Ball {
  id: number;
  body: Body;
  state: BallState;
  target: number;
  offset: number;
  flight: Flight | undefined;
}

interface Bucket {
  cx: number;
  walls: Body[];
}

const RADIUS = 6;
const INNER = 58;
const WALL = 6;
/** Tall enough for the 12 requests a server holds, so a full queue looks full. */
const BUCKET_HEIGHT = 52;
const ARC = 34;
const MAX_BALLS = 260;
const CAT_WALL = 0x1;
const CAT_BALL = 0x2;
const CAT_FLY = 0x4;
const CAT_GHOST = 0x8;
const SOLID = { group: 0, category: CAT_BALL, mask: CAT_WALL | CAT_BALL };
const FLYING = { group: 0, category: CAT_FLY, mask: 0 };
const GHOST = { group: 0, category: CAT_GHOST, mask: 0 };

/**
 * A playful physics toy for the landing page. Users drop requests into a
 * funnel, the load balancer sends each one to the next server, and every
 * server finishes 5 requests per second. A LandingQueue decides every
 * outcome: a request turns red only when the server it was sent to already
 * holds a full queue. The physics animates those decisions and never makes
 * one, so a ball that bounces out of place goes back where the model says it is.
 */
export class LandingScene implements Scene {
  private readonly M: Matter;
  private readonly engine: MatterNamespace.Engine;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly queue: LandingQueue;
  private readonly rng: Rng = createRng(2024);
  private width: number;
  private height: number;
  private palette: Palette;
  private funnel: Body[] = [];
  private neck: Body | undefined;
  private buckets: Bucket[] = [];
  private balls: Ball[] = [];
  private readonly byId = new Map<number, Ball>();
  private readonly byBody = new Map<Body, Ball>();
  private spawnCarry = 0;
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
    this.queue = new LandingQueue(servers);
    this.buildFunnel();
    this.buildBuckets(this.queue.serverCount, this.layout.bucketTop);
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

  /** Resize the pool. Requests on a removed server fly to a survivor instead of vanishing. */
  setServers(count: number): void {
    const moves = this.queue.setServers(count);
    this.buildBuckets(this.queue.serverCount, this.layout.bucketTop);
    for (const move of moves) {
      const ball = this.byId.get(move.id);
      if (ball) this.launch(ball, move);
    }
  }

  stats(): LandingStats {
    return this.queue.stats();
  }

  resize(width: number, height: number): void {
    const previousTop = this.layout.bucketTop;
    const shift = width / 2 - this.width / 2;
    this.width = width;
    this.height = height;
    const { Body, Composite } = this.M;
    Composite.remove(this.engine.world, this.funnel);
    if (this.neck) Composite.remove(this.engine.world, this.neck);
    this.buildFunnel();
    for (const ball of this.balls) {
      if (ball.state === 'waiting') Body.translate(ball.body, { x: shift, y: 0 });
    }
    this.buildBuckets(this.buckets.length, previousTop);
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
    this.byId.clear();
    this.byBody.clear();
    this.M.Composite.clear(this.engine.world, false);
    this.M.Engine.clear(this.engine);
  }

  frame(dtMs: number): void {
    this.spawn(dtMs);
    this.step(dtMs, (ms) => this.M.Engine.update(this.engine, ms));
    for (const done of this.queue.advance(dtMs)) {
      const ball = this.byId.get(done.id);
      if (ball) this.serve(ball);
    }
    this.fly();
    this.recover();
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

  /** Rebuild the server buckets and carry each queued ball along with its bucket. */
  private buildBuckets(count: number, previousTop: number): void {
    const { Bodies, Body, Composite } = this.M;
    const previous = this.buckets;
    for (const bucket of previous) Composite.remove(this.engine.world, bucket.walls);
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
      return { cx, walls };
    });
    for (const ball of this.balls) {
      const before = previous[ball.target];
      const after = this.buckets[ball.target];
      if (ball.state === 'queued' && before && after) {
        Body.translate(ball.body, { x: after.cx - before.cx, y: bucketTop - previousTop });
      }
    }
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

  private entryX(): number {
    const spread = Math.min(100, this.width * 0.22);
    return this.width / 2 + (this.rng() - 0.5) * spread * 2;
  }

  private spawn(dtMs: number): void {
    this.spawnCarry += (this.rate * dtMs) / 1000;
    while (this.spawnCarry >= 1) {
      this.spawnCarry -= 1;
      if (this.balls.length >= MAX_BALLS) continue;
      const body = this.M.Bodies.circle(this.entryX(), this.layout.usersY + 16, RADIUS, {
        restitution: 0.2,
        friction: 0.01,
        frictionAir: 0.004,
        collisionFilter: { ...SOLID },
      });
      this.M.Composite.add(this.engine.world, body);
      const ball: Ball = {
        id: this.queue.arrive(),
        body,
        state: 'waiting',
        target: -1,
        offset: 0,
        flight: undefined,
      };
      this.balls.push(ball);
      this.byId.set(ball.id, ball);
      this.byBody.set(body, ball);
    }
  }

  /** The load balancer: the model picks the server and whether its queue has room. */
  private route(body: Body): void {
    const ball = this.byBody.get(body);
    if (ball?.state !== 'waiting') return;
    const move = this.queue.route(ball.id);
    if (move) this.launch(ball, move);
  }

  private launch(ball: Ball, move: Assignment): void {
    const { x, y } = ball.body.position;
    ball.target = move.server;
    ball.state = 'flying';
    ball.offset = (this.rng() - 0.5) * (INNER - RADIUS * 2 - 6);
    ball.flight = { x0: x, y0: y, start: this.queue.now, rejected: !move.accepted };
    ball.body.collisionFilter = { ...FLYING };
  }

  /**
   * Move each flying ball along an arc that lands exactly when the model says
   * the request reaches its server. A rejected request hits the rim and spills.
   */
  private fly(): void {
    const { Body } = this.M;
    const { bucketTop } = this.layout;
    for (const ball of this.balls) {
      const { flight } = ball;
      if (ball.state !== 'flying' || !flight) continue;
      const bucket = this.buckets[ball.target];
      if (!bucket) {
        if (flight.rejected) this.markDropped(ball, 1);
        continue;
      }
      const u = Math.min(1, (this.queue.now - flight.start) / LANDING_TRANSIT_MS);
      const side = ball.offset < 0 ? -1 : 1;
      const x1 = flight.rejected ? bucket.cx + side * (INNER / 2 + WALL / 2) : bucket.cx + ball.offset;
      const y1 = flight.rejected ? bucketTop - WALL - RADIUS : bucketTop + RADIUS;
      Body.setPosition(ball.body, {
        x: flight.x0 + (x1 - flight.x0) * u,
        y: flight.y0 + (y1 - flight.y0) * u - ARC * 4 * u * (1 - u),
      });
      Body.setVelocity(ball.body, { x: 0, y: 0 });
      if (u < 1) continue;
      ball.flight = undefined;
      if (flight.rejected) {
        this.markDropped(ball, side);
      } else {
        ball.state = 'queued';
        ball.body.collisionFilter = { ...SOLID };
        Body.setVelocity(ball.body, { x: 0, y: 2 });
      }
    }
  }

  private serve(ball: Ball): void {
    const bucket = this.buckets[ball.target];
    const x = ball.state === 'queued' || !bucket ? ball.body.position.x : bucket.cx + ball.offset;
    ball.state = 'served';
    ball.flight = undefined;
    ball.body.collisionFilter = { ...GHOST };
    this.M.Body.setPosition(ball.body, { x, y: this.layout.bucketBottom + WALL + RADIUS + 2 });
    this.M.Body.setVelocity(ball.body, { x: 0, y: 2 });
  }

  private markDropped(ball: Ball, side: number): void {
    ball.state = 'dropped';
    ball.flight = undefined;
    ball.body.collisionFilter = { ...GHOST };
    this.M.Body.setVelocity(ball.body, { x: side * 2.2, y: -2 });
  }

  /** A request the model still holds stays on screen, so only the model can lose one. */
  private recover(): void {
    const { neckY } = this.layout;
    const grabbed = this.mouseConstraint?.body;
    const keep: Ball[] = [];
    for (const ball of this.balls) {
      const { x, y } = ball.body.position;
      const offscreen = y > this.height + 30 || y < -60 || x < -60 || x > this.width + 60;
      if (ball.body !== grabbed) {
        if (ball.state === 'queued') this.keepInBucket(ball);
        else if (ball.state === 'waiting' && y > neckY + 10) this.route(ball.body);
        else if (ball.state === 'waiting' && offscreen) this.reenter(ball);
      }
      if ((ball.state === 'served' || ball.state === 'dropped') && offscreen) {
        this.M.Composite.remove(this.engine.world, ball.body);
        this.byId.delete(ball.id);
        this.byBody.delete(ball.body);
      } else {
        keep.push(ball);
      }
    }
    this.balls = keep;
  }

  private keepInBucket(ball: Ball): void {
    const bucket = this.buckets[ball.target];
    if (!bucket) return;
    const { x, y } = ball.body.position;
    const { bucketTop, bucketBottom } = this.layout;
    const inside =
      Math.abs(x - bucket.cx) <= INNER / 2 + 1 && y < bucketBottom + RADIUS && y > bucketTop - 80;
    if (inside) return;
    this.M.Body.setPosition(ball.body, { x: bucket.cx + ball.offset, y: bucketTop + RADIUS });
    this.M.Body.setVelocity(ball.body, { x: 0, y: 1 });
  }

  private reenter(ball: Ball): void {
    this.M.Body.setPosition(ball.body, { x: this.entryX(), y: this.layout.usersY + 16 });
    this.M.Body.setVelocity(ball.body, { x: 0, y: 0 });
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
      else if (ball.state === 'dropped') drawBall(ctx, x, y, RADIUS, 'cross', palette.bad, 1, palette.ink);
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
