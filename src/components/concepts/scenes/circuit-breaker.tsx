import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/circuit-breaker';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { Edge, SystemNode } from '../../viz/SystemNode';
import {
  type ConceptScene,
  Dot,
  Marker,
  Note,
  SceneFrame,
  type SceneProps,
  Show,
  Still,
  type Window,
} from '../parts';
import variants, { type BreakerState, BreakerSwitch } from '../variants/circuit-breaker';

const L = labelReader(entry.labels);
const WITHOUT_HEIGHT = 270;
const WITH_HEIGHT = 252;
const NODE_H = 58;

const go = (l: { from: Vec; to: Vec }): Vec[] => [l.from, l.to];
const back = (l: { from: Vec; to: Vec }): Vec[] => [l.to, l.from];

const GAUGE = { x: 226, y: 107, w: 22, h: 58 };
const WAITING = ['ok', 'ok', 'warn', 'bad', 'bad'] as const;
const QUEUED_AT = [0.14, 0.24, 0.34, 0.44, 0.54];

/** Every call waits on a dead service, so waiting calls fill the app until users get errors too. */
function BreakerWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const users: Positioned = { x: 160, y: 36, w: 96, h: NODE_H };
  const app: Positioned = { x: 160, y: 136, w: 104, h: NODE_H };
  const service: Positioned = { x: 160, y: 236, w: 104, h: NODE_H };
  const userLeg = link(users, app);
  const callLeg = link(app, service);
  const label = (key: string) => (thumb ? '' : L(key));
  const appNode = (status?: 'warn' | 'bad') => (
    <SystemNode
      kind="server"
      x={app.x}
      y={app.y}
      width={app.w}
      height={NODE_H}
      label={label('app')}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={WITHOUT_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...userLeg} marker={marker} />
          <Edge {...callLeg} marker={marker} />
          <SystemNode
            kind="client"
            x={users.x}
            y={users.y}
            width={users.w}
            height={NODE_H}
            label={label('users')}
          />
          <Show at={[0, 0.36]}>{appNode()}</Show>
          <Show at={[0.36, 0.56]}>{appNode('warn')}</Show>
          <Show at={[0.56, 1]}>{appNode('bad')}</Show>
          <SystemNode
            kind="server"
            x={service.x}
            y={service.y}
            width={service.w}
            height={NODE_H}
            label={label('service')}
            status="bad"
          />
          <rect
            className="sdv-concept__gauge-frame"
            x={GAUGE.x}
            y={GAUGE.y}
            width={GAUGE.w}
            height={GAUGE.h}
            rx={3}
          />
          {WAITING.map((tone, i) => (
            <Show key={QUEUED_AT[i]} at={[QUEUED_AT[i] ?? 0, 1]}>
              <rect
                className={`sdv-concept__fill--${tone}`}
                x={GAUGE.x + 3}
                y={GAUGE.y + GAUGE.h - 12 - i * 11}
                width={GAUGE.w - 6}
                height={9}
                rx={1.5}
              />
            </Show>
          ))}
          <Note x={GAUGE.x + GAUGE.w / 2} y={186} text={L('waiting')} thumb={thumb} />
          {[0.02, 0.12, 0.22, 0.32, 0.42, 0.52].flatMap((s) => [
            <Dot key={`u${s}`} path={go(userLeg)} at={[s, s + 0.06]} />,
            <Dot key={`c${s}`} path={go(callLeg)} at={[s + 0.06, s + 0.12]} />,
          ])}
          {[0.6, 0.7, 0.8, 0.9].map((s) => (
            <Dot key={`e${s}`} path={back(userLeg)} at={[s, s + 0.06]} response tone="bad" />
          ))}
          <Still at={lerp(callLeg.from, callLeg.to, 0.5)} />
          <Still at={lerp(userLeg.to, userLeg.from, 0.5)} response tone="bad" />
          <Marker n={1} x={84} y={236} at={0} thumb={thumb} />
          <Marker n={2} x={281} y={136} at={0.14} thumb={thumb} />
          <Marker n={3} x={124} y={86} at={0.56} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

const PILL_H = 28;
const PHASES: { state: BreakerState; at: Window }[] = [
  { state: 'closed', at: [0, 0.3] },
  { state: 'open', at: [0.3, 0.64] },
  { state: 'half', at: [0.64, 0.78] },
  { state: 'closed', at: [0.78, 1] },
];

/** Complement of a state's active windows, so exactly one look of each pill shows at a time. */
function idleWindows(state: BreakerState): Window[] {
  const idle: Window[] = [];
  let from = 0;
  for (const phase of PHASES) {
    if (phase.state !== state) continue;
    if (phase.at[0] > from) idle.push([from, phase.at[0]]);
    from = phase.at[1];
  }
  if (from < 1) idle.push([from, 1]);
  return idle;
}

/** One state of the breaker, filled with the accent while it is the current state. */
function Pill({
  state,
  x,
  y,
  w,
  thumb,
}: {
  state: BreakerState;
  x: number;
  y: number;
  w: number;
  thumb?: boolean;
}) {
  const box = { x: x - w / 2, y: y - PILL_H / 2, width: w, height: PILL_H, rx: PILL_H / 2 };
  const text = L(state);
  return (
    <>
      {PHASES.filter((p) => p.state === state).map((p) => (
        <Show key={p.at[0]} at={p.at}>
          <g className="sdv-node__badge">
            <rect {...box} />
            {!thumb && (
              <text textAnchor="middle" x={x} y={y + 4.5}>
                {text}
              </text>
            )}
          </g>
        </Show>
      ))}
      {idleWindows(state).map((at) => (
        <Show key={at[0]} at={at}>
          <rect className="sdv-concept__gauge-frame" {...box} />
          <Note x={x} y={y + 4.5} text={text} thumb={thumb} />
        </Show>
      ))}
    </>
  );
}

/** Five failures open the breaker; open calls fail fast; after a cooldown one trial call closes it again. */
function BreakerWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const APP_W = 76;
  const SERVICE_W = 92;
  const app: Positioned = { x: 50, y: 48, w: APP_W, h: NODE_H };
  const service: Positioned = { x: 266, y: 48, w: SERVICE_W, h: NODE_H };
  const inLeg = { from: [app.x + APP_W / 2 + 6, 48] as Vec, to: [134, 48] as Vec };
  const outLeg = { from: [186, 48] as Vec, to: [service.x - SERVICE_W / 2 - 6, 48] as Vec };
  const call: Vec[] = [inLeg.from, outLeg.to];
  const label = (key: string) => (thumb ? '' : L(key));
  const serviceNode = (status: 'ok' | 'bad') => (
    <SystemNode
      kind="server"
      x={service.x}
      y={service.y}
      width={service.w}
      height={NODE_H}
      label={label('service')}
      status={status}
    />
  );
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={WITH_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...inLeg} />
          <Edge {...outLeg} marker={marker} />
          <rect className="sdv-concept__gauge-frame" x={126} y={26} width={68} height={44} rx={8} />
          {PHASES.map((p) => (
            <Show key={p.at[0]} at={p.at}>
              <BreakerSwitch x={160} y={48} state={p.state} />
            </Show>
          ))}
          <Note x={160} y={92} text={L('breaker')} thumb={thumb} />
          <SystemNode kind="server" x={app.x} y={app.y} width={app.w} height={NODE_H} label={label('app')} />
          <Show at={[0, 0.6]}>{serviceNode('bad')}</Show>
          <Show at={[0.6, 1]}>{serviceNode('ok')}</Show>

          <Edge from={[116, 146]} to={[210, 146]} marker={marker} />
          <Edge from={[240, 164]} to={[198, 210]} marker={marker} />
          <Edge from={[122, 210]} to={[80, 164]} marker={marker} />
          <Note x={163} y={136} text={L('fails')} thumb={thumb} />
          <Note x={232} y={196} text={L('cooldown')} thumb={thumb} anchor="start" />
          <Note x={88} y={196} text={L('trial')} thumb={thumb} anchor="end" />
          <Pill state="closed" x={68} y={146} w={84} thumb={thumb} />
          <Pill state="open" x={252} y={146} w={72} thumb={thumb} />
          <Pill state="half" x={160} y={228} w={104} thumb={thumb} />

          {[0.02, 0.07, 0.12, 0.17, 0.22].flatMap((s) => [
            <Dot key={`f${s}`} path={call} at={[s, s + 0.04]} />,
            <Dot key={`r${s}`} path={[...call].reverse()} at={[s + 0.04, s + 0.08]} response tone="bad" />,
          ])}
          {[0.34, 0.42, 0.5].flatMap((s) => [
            <Dot key={`q${s}`} path={go(inLeg)} at={[s, s + 0.03]} />,
            <Dot key={`x${s}`} path={back(inLeg)} at={[s + 0.03, s + 0.06]} response tone="bad" />,
          ])}
          <Dot path={call} at={[0.66, 0.71]} />
          <Dot path={[...call].reverse()} at={[0.71, 0.76]} response tone="hit" />
          <Dot path={call} at={[0.84, 0.89]} />
          <Dot path={[...call].reverse()} at={[0.89, 0.94]} response />
          <Still at={lerp(inLeg.from, inLeg.to, 0.4)} response />
          <Marker n={1} x={163} y={166} at={0} thumb={thumb} />
          <Marker n={2} x={110} y={88} at={0.3} thumb={thumb} />
          <Marker n={3} x={238} y={230} at={0.64} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: BreakerWithout, with: BreakerWith, variants } satisfies ConceptScene;
