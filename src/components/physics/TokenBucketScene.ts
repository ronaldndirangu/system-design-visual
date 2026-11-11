import type MatterNamespace from 'matter-js';
import type { RateLimitTick } from '../../lib/models/rateLimit';
import { createStepper, drawBall, type Matter, type Palette, type Scene, type SceneContext } from './runtime';

type Body = MatterNamespace.Body;

const CAT_WALL = 0x1;
const CAT_TOKEN = 0x2;
const CAT_REJECT = 0x4;
const BALL_R = 5;
const TOKEN_R = 6;
const MAX_REJECTS = 30;
const REJECT_LIFE_MS = 4000;
const FLIGHT_MS = 520;

interface Point {
  x: number;
  y: number;
}

interface Flight {
  kind: 'toGate' | 'toServer';
  admitted: boolean;
  t: number;
  from: Point;
  to: Point;
}

interface Reject {
  body: Body;
  age: number;
}

interface Layout {
  client: Point;
  gate: Point;
  server: Point;
  bucketX: number;
  bucketWidth: number;
  bucketTop: number;
  floor: number;
  trayX: number;
  trayWidth: number;
}

/**
 * Token bucket as a physics toy: tokens are squares that drip into a bucket,
 * each admitted request takes one, and requests that find it empty bounce
 * into the 429 tray. The token count always matches the model.
 */
export class TokenBucketScene implements Scene {
  private readonly M: Matter;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly engine: MatterNamespace.Engine;
  private width: number;
  private height: number;
  private palette: Palette;
  private layout: Layout;
  private walls: Body[] = [];
  private tokens: Body[] = [];
  private pendingTokens = 0;
  private dripTimer = 0;
  private rejects: Reject[] = [];
  private flights: Flight[] = [];
  private served = 0;
  private limited = 0;
  private burst = 20;
  private readonly step = createStepper();

  constructor(context: SceneContext, burst: number) {
    this.M = context.Matter;
    this.ctx = context.ctx;
    this.width = context.width;
    this.height = context.height;
    this.palette = context.palette;
    this.burst = burst;
    this.engine = this.M.Engine.create({ enableSleeping: false });
    this.engine.gravity.y = 1;
    this.layout = this.measure();
    this.buildWalls();
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.layout = this.measure();
    this.M.Composite.remove(this.engine.world, this.walls);
    this.buildWalls();
    const count = this.tokens.length;
    this.removeTokens(count);
    this.pendingTokens += count;
    for (const reject of this.rejects) this.M.Composite.remove(this.engine.world, reject.body);
    this.rejects = [];
  }

  setPalette(palette: Palette) {
    this.palette = palette;
  }

  /** Mirrors one model tick: new requests take off, and the bucket matches the model's whole tokens. */
  applyTick(tick: RateLimitTick, burst: number) {
    const admitted = tick.admitted;
    const total = admitted + tick.rejections;
    for (let i = 0; i < total; i += 1) {
      this.flights.push({
        kind: 'toGate',
        admitted: i < admitted,
        t: -i * 40,
        from: this.layout.client,
        to: this.layout.gate,
      });
    }
    this.setTokens(Math.floor(tick.allowance[0] ?? 0), burst);
  }

  setTokens(count: number, burst: number) {
    this.burst = burst;
    const target = Math.max(0, count);
    const current = this.tokens.length + this.pendingTokens;
    if (target > current) {
      this.pendingTokens += target - current;
    } else if (target < current) {
      let excess = current - target;
      const fromPending = Math.min(this.pendingTokens, excess);
      this.pendingTokens -= fromPending;
      excess -= fromPending;
      this.removeTokens(excess);
    }
  }

  /** Jumps the counters to the model's totals, dropping requests still in flight, for example after a skip. */
  syncCounts(served: number, rejected: number) {
    this.flights = [];
    this.served = served;
    this.limited = rejected;
  }

  clear() {
    this.removeTokens(this.tokens.length);
    this.pendingTokens = 0;
    for (const reject of this.rejects) this.M.Composite.remove(this.engine.world, reject.body);
    this.rejects = [];
    this.flights = [];
    this.served = 0;
    this.limited = 0;
  }

  frame(dtMs: number) {
    this.advanceFlights(dtMs);
    this.drip(dtMs);
    this.step(dtMs, (ms) => this.M.Engine.update(this.engine, ms));
    this.ageRejects(dtMs);
    this.draw();
  }

  destroy() {
    this.M.World.clear(this.engine.world, false);
    this.M.Engine.clear(this.engine);
  }

  private measure(): Layout {
    const w = this.width;
    const h = this.height;
    const client = { x: Math.max(42, w * 0.09), y: h * 0.26 };
    const server = { x: w - Math.max(42, w * 0.09), y: h * 0.26 };
    const bucketX = w * 0.52;
    const bucketWidth = Math.min(160, Math.max(96, w * 0.24));
    const bucketTop = h * 0.46;
    const floor = h - 14;
    const gap = bucketX - bucketWidth / 2 - client.x;
    const trayWidth = Math.min(110, Math.max(56, gap * 0.8));
    const trayX = client.x + gap / 2;
    return {
      client,
      gate: { x: bucketX, y: bucketTop - 18 },
      server,
      bucketX,
      bucketWidth,
      bucketTop,
      floor,
      trayX,
      trayWidth,
    };
  }

  private buildWalls() {
    const { Bodies, Composite } = this.M;
    const { bucketX, bucketWidth, bucketTop, floor, trayX, trayWidth } = this.layout;
    const wall = (x: number, y: number, w: number, h: number) =>
      Bodies.rectangle(x, y, w, h, {
        isStatic: true,
        friction: 0.05,
        collisionFilter: { category: CAT_WALL, mask: CAT_TOKEN | CAT_REJECT },
      });
    const bucketHeight = floor - bucketTop;
    const trayHeight = 46;
    this.walls = [
      wall(bucketX - bucketWidth / 2 - 4, bucketTop + bucketHeight / 2, 8, bucketHeight),
      wall(bucketX + bucketWidth / 2 + 4, bucketTop + bucketHeight / 2, 8, bucketHeight),
      wall(bucketX, floor + 4, bucketWidth + 16, 8),
      wall(trayX - trayWidth / 2 - 4, floor - trayHeight / 2, 8, trayHeight),
      wall(trayX + trayWidth / 2 + 4, floor - trayHeight / 2, 8, trayHeight),
      wall(trayX, floor + 4, trayWidth + 16, 8),
    ];
    Composite.add(this.engine.world, this.walls);
  }

  private drip(dtMs: number) {
    this.dripTimer -= dtMs;
    if (this.pendingTokens <= 0 || this.dripTimer > 0) return;
    this.dripTimer = 45;
    this.pendingTokens -= 1;
    const { bucketX, bucketWidth, bucketTop } = this.layout;
    const spread = (bucketWidth - TOKEN_R * 4) / 2;
    const body = this.M.Bodies.polygon(
      bucketX + (Math.random() * 2 - 1) * spread,
      bucketTop - 4,
      4,
      TOKEN_R,
      {
        restitution: 0.1,
        friction: 0.1,
        frictionAir: 0.02,
        density: 0.002,
        angle: Math.PI / 4,
        collisionFilter: { category: CAT_TOKEN, mask: CAT_WALL | CAT_TOKEN },
      },
    );
    this.M.Body.setVelocity(body, { x: 0, y: 2 });
    this.M.Composite.add(this.engine.world, body);
    this.tokens.push(body);
  }

  /** Takes the top tokens first, the ones a request would grab. */
  private removeTokens(count: number) {
    if (count <= 0) return;
    const sorted = [...this.tokens].sort((a, b) => a.position.y - b.position.y);
    const gone = new Set(sorted.slice(0, count));
    for (const body of gone) this.M.Composite.remove(this.engine.world, body);
    this.tokens = this.tokens.filter((body) => !gone.has(body));
  }

  private advanceFlights(dtMs: number) {
    const next: Flight[] = [];
    for (const flight of this.flights) {
      flight.t += dtMs;
      if (flight.t < FLIGHT_MS) {
        next.push(flight);
        continue;
      }
      if (flight.kind === 'toGate' && flight.admitted) {
        next.push({ kind: 'toServer', admitted: true, t: 0, from: this.layout.gate, to: this.layout.server });
      } else if (flight.kind === 'toGate') {
        this.limited += 1;
        this.launchReject();
      } else {
        this.served += 1;
      }
    }
    this.flights = next;
  }

  private launchReject() {
    const { gate, trayX } = this.layout;
    const body = this.M.Bodies.circle(gate.x, gate.y, BALL_R, {
      restitution: 0.45,
      friction: 0.02,
      frictionAir: 0.004,
      density: 0.002,
      collisionFilter: { category: CAT_REJECT, mask: CAT_WALL | CAT_REJECT },
    });
    this.M.Body.setVelocity(body, { x: (trayX - gate.x) / 42 + (Math.random() - 0.5) * 0.4, y: -3 });
    this.M.Composite.add(this.engine.world, body);
    this.rejects.push({ body, age: 0 });
    while (this.rejects.length > MAX_REJECTS) {
      const oldest = this.rejects.shift();
      if (oldest) this.M.Composite.remove(this.engine.world, oldest.body);
    }
  }

  private ageRejects(dtMs: number) {
    const keep: Reject[] = [];
    for (const reject of this.rejects) {
      reject.age += dtMs;
      const off = reject.body.position.y > this.height + 40 || reject.body.position.x < -40;
      if (reject.age > REJECT_LIFE_MS || off) this.M.Composite.remove(this.engine.world, reject.body);
      else keep.push(reject);
    }
    this.rejects = keep;
  }

  private draw() {
    const { ctx, palette, layout } = this;
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawPath(layout.client, layout.gate);
    this.drawPath(layout.gate, layout.server);

    this.drawBox(layout.client, palette.client, 'Client A', true);
    this.drawBox(layout.server, palette.server, 'Server', false);

    ctx.strokeStyle = palette.lb;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(layout.bucketX - layout.bucketWidth / 2, layout.bucketTop);
    ctx.lineTo(layout.bucketX - layout.bucketWidth / 2, layout.floor);
    ctx.lineTo(layout.bucketX + layout.bucketWidth / 2, layout.floor);
    ctx.lineTo(layout.bucketX + layout.bucketWidth / 2, layout.bucketTop);
    ctx.stroke();

    ctx.strokeStyle = palette.bad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(layout.trayX - layout.trayWidth / 2, layout.floor - 46);
    ctx.lineTo(layout.trayX - layout.trayWidth / 2, layout.floor);
    ctx.lineTo(layout.trayX + layout.trayWidth / 2, layout.floor);
    ctx.lineTo(layout.trayX + layout.trayWidth / 2, layout.floor - 46);
    ctx.stroke();

    ctx.fillStyle = palette.lb;
    for (const token of this.tokens) {
      const vertices = token.vertices;
      const first = vertices[0];
      if (!first) continue;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const vertex of vertices.slice(1)) ctx.lineTo(vertex.x, vertex.y);
      ctx.closePath();
      ctx.fill();
    }

    for (const reject of this.rejects) {
      const fade = Math.min(1, (REJECT_LIFE_MS - reject.age) / 600);
      drawBall(ctx, reject.body.position.x, reject.body.position.y, BALL_R, 'cross', palette.bad, fade);
    }

    for (const flight of this.flights) {
      if (flight.t < 0) continue;
      const p = Math.min(1, flight.t / FLIGHT_MS);
      const eased = 1 - (1 - p) ** 2;
      const x = flight.from.x + (flight.to.x - flight.from.x) * eased;
      const y = flight.from.y + (flight.to.y - flight.from.y) * eased - Math.sin(Math.PI * p) * 14;
      if (flight.kind === 'toServer') drawBall(ctx, x, y, BALL_R, 'ring', palette.ok);
      else drawBall(ctx, x, y, BALL_R, 'filled', palette.request);
    }

    const whole = this.tokens.length + this.pendingTokens;
    this.label(layout.bucketX, layout.bucketTop - 40, `Token bucket: ${whole} of ${this.burst}`, 600);
    this.label(layout.trayX, layout.floor - 58, `429: ${this.limited}`, 600);
    this.label(layout.server.x, layout.server.y + 34, `served ${this.served}`, 400);
  }

  private drawPath(from: Point, to: Point) {
    const { ctx, palette } = this;
    ctx.save();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Client: rounded rectangle. Server: rack box with side stripes. */
  private drawBox(at: Point, color: string, text: string, isClient: boolean) {
    const { ctx, palette } = this;
    const w = 66;
    const h = 30;
    ctx.fillStyle = palette.surface;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(at.x - w / 2, at.y - h / 2, w, h, isClient ? 8 : 2);
    ctx.fill();
    ctx.stroke();
    if (!isClient) {
      ctx.beginPath();
      ctx.moveTo(at.x - w / 2 + 5, at.y - h / 2 + 4);
      ctx.lineTo(at.x - w / 2 + 5, at.y + h / 2 - 4);
      ctx.moveTo(at.x + w / 2 - 5, at.y - h / 2 + 4);
      ctx.lineTo(at.x + w / 2 - 5, at.y + h / 2 - 4);
      ctx.stroke();
    }
    ctx.fillStyle = palette.text;
    ctx.font = `600 12px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x, at.y);
  }

  private label(x: number, y: number, text: string, weight: number) {
    const { ctx, palette } = this;
    ctx.font = `${weight} 12px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 10;
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = palette.surface;
    ctx.fillRect(x - width / 2, y - 9, width, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.text;
    ctx.fillText(text, x, y);
  }
}
