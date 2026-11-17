import type { ReactNode } from 'react';
import { type ConceptSlug, type ConceptVariant, type LabelReader, labelReader } from '../../data/concepts';
import type { Vec } from '../viz/geometry';
import { KindIcon, StatusBadge } from '../viz/icons';
import type { ComponentKind } from '../viz/kinds';
import { ArrowDefs, Shape } from '../viz/SystemNode';

const MINI_W = 200;
const MINI_H = 120;

type Tone = 'hit' | 'miss';

function Mini({
  kind,
  x,
  y,
  w = 40,
  h = 28,
  warn,
  standby,
}: {
  kind: ComponentKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  warn?: boolean;
  standby?: boolean;
}) {
  const cls = `sdv-node sdv-node--${kind}${standby ? ' sdv-node--candidate' : ''}`;
  return (
    <g className={cls} transform={`translate(${x} ${y})`}>
      <Shape kind={kind} w={w} h={h} />
      <KindIcon kind={kind} size={14} x={-7} y={-7} />
      {warn && <StatusBadge status="warn" x={w / 2 - 2} y={-h / 2 + 2} />}
    </g>
  );
}

function Arrow({
  from,
  to,
  via,
  marker,
  tone,
  dashed,
  weight,
}: {
  from: Vec;
  to: Vec;
  via?: Vec;
  marker?: string;
  tone?: Tone;
  dashed?: boolean;
  weight?: 'heavy' | 'light';
}) {
  const classes = ['sdv-edge'];
  if (dashed) classes.push('sdv-edge--dashed');
  if (tone) classes.push(`sdv-concept__edge--${tone}`);
  if (weight) classes.push(`sdv-concept__edge--${weight}`);
  const d = via
    ? `M${from[0]} ${from[1]}Q${via[0]} ${via[1]} ${to[0]} ${to[1]}`
    : `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`;
  return <path className={classes.join(' ')} d={d} markerEnd={marker ? `url(#${marker})` : undefined} />;
}

function Packet({ at, tone, response }: { at: Vec; tone?: Tone; response?: boolean }) {
  const cls = tone ? `sdv-dot sdv-dot--${tone}` : 'sdv-dot';
  return response ? (
    <rect className={cls} x={at[0] - 4} y={at[1] - 4} width={8} height={8} rx={2} />
  ) : (
    <circle className={cls} cx={at[0]} cy={at[1]} r={4} />
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text className="sdv-concept__note" x={x} y={y} textAnchor="middle">
      {text}
    </text>
  );
}

function Step({ n, at }: { n: number; at: Vec }) {
  return (
    <g className="sdv-concept__marker sdv-concept__marker--small" transform={`translate(${at[0]} ${at[1]})`}>
      <circle r={9} />
      <text textAnchor="middle" y={4.5}>
        {n}
      </text>
    </g>
  );
}

function Divider() {
  return <path className="sdv-concept__divider" d={`M${MINI_W / 2} 8V${MINI_H - 8}`} />;
}

function Gauge({ x, y, share, bad }: { x: number; y: number; share: number; bad?: boolean }) {
  return (
    <g>
      <rect className="sdv-concept__gauge-frame" x={x - 13} y={y} width={26} height={7} rx={2} />
      <rect
        className={bad ? 'sdv-concept__fill--bad' : 'sdv-concept__fill--ok'}
        x={x - 12}
        y={y + 1}
        width={24 * share}
        height={5}
        rx={1.5}
      />
    </g>
  );
}

type Art = (marker: string, labels: LabelReader) => ReactNode;

function turnsPanel(ox: number, label: string, leastBusy: boolean, marker: string) {
  const xs = [18, 50, 82];
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      {xs.map((x, i) => (
        <Arrow
          key={x}
          from={[ox + 50, 53]}
          to={[ox + x, 68]}
          marker={marker}
          weight={leastBusy && i === 1 ? 'light' : 'heavy'}
        />
      ))}
      <Mini kind="loadBalancer" x={ox + 50} y={40} w={44} h={22} />
      {xs.map((x, i) => (
        <Mini key={x} kind="server" x={ox + x} y={84} w={26} h={28} warn={!leastBusy && i === 1} />
      ))}
      {xs.map((x, i) => (
        <Gauge
          key={x}
          x={ox + x}
          y={104}
          share={leastBusy ? 0.6 : i === 1 ? 1 : 0.4}
          bad={!leastBusy && i === 1}
        />
      ))}
    </g>
  );
}

function layerPanel(ox: number, label: string, labels: LabelReader | null, marker: string) {
  const left: Vec = [ox + (labels ? 32 : 26), 84];
  const right: Vec = [ox + (labels ? 80 : 74), 84];
  const lb: Vec = [ox + 50, 40];
  const on = (to: Vec, t: number): Vec => [lb[0] + (to[0] - lb[0]) * t, 53 + (68 - 53) * t];
  return (
    <g>
      <Label x={ox + 50} y={16} text={label} />
      <Arrow from={[lb[0], 53]} to={[left[0], 68]} marker={marker} />
      <Arrow from={[lb[0], 53]} to={[right[0], 68]} marker={marker} />
      <Mini kind="loadBalancer" x={lb[0]} y={lb[1]} w={44} h={22} />
      <Mini kind="server" x={left[0]} y={left[1]} w={32} h={28} />
      <Mini kind="server" x={right[0]} y={right[1]} w={32} h={28} />
      {labels ? (
        <>
          <Packet at={on(left, 0.5)} tone="hit" />
          <Packet at={on(right, 0.5)} />
          <Label x={left[0]} y={114} text={labels('images')} />
          <Label x={right[0]} y={114} text={labels('api')} />
        </>
      ) : (
        <>
          <Packet at={on(left, 0.3)} tone="hit" />
          <Packet at={on(left, 0.75)} />
          <Packet at={on(right, 0.3)} />
          <Packet at={on(right, 0.75)} tone="hit" />
        </>
      )}
    </g>
  );
}

function pairPanel(ox: number, standby: string | null, marker: string) {
  const balancers: [Vec, Vec] = [
    [ox + 30, 46],
    [ox + 72, 46],
  ];
  const servers: [Vec, Vec] = [
    [ox + 30, 96],
    [ox + 72, 96],
  ];
  const live = standby ? [balancers[0]] : balancers;
  return (
    <g>
      {standby && <Label x={ox + 72} y={22} text={standby} />}
      {live.map((b) => (
        <Arrow key={`in${b[0]}`} from={[b[0], 8]} to={[b[0], 29]} marker={marker} />
      ))}
      {live.flatMap((b) =>
        servers.map((s) => (
          <Arrow key={`${b[0]}-${s[0]}`} from={[b[0], 58]} to={[s[0], 77]} marker={marker} />
        )),
      )}
      <Mini kind="loadBalancer" x={balancers[0][0]} y={46} w={40} h={22} />
      <Mini kind="loadBalancer" x={balancers[1][0]} y={46} w={40} h={22} standby={Boolean(standby)} />
      {servers.map((s) => (
        <Mini key={s[0]} kind="server" x={s[0]} y={s[1]} w={30} h={26} />
      ))}
    </g>
  );
}

const art: Record<ConceptSlug, Art[]> = {
  'load-balancer': [
    (marker, labels) => (
      <>
        {turnsPanel(0, labels('turns'), false, marker)}
        <Divider />
        {turnsPanel(100, labels('busy'), true, marker)}
      </>
    ),
    (marker, labels) => (
      <>
        {layerPanel(0, labels('l4'), null, marker)}
        <Divider />
        {layerPanel(100, labels('l7'), labels, marker)}
      </>
    ),
    (marker, labels) => (
      <>
        {pairPanel(0, labels('standby'), marker)}
        <Divider />
        {pairPanel(100, null, marker)}
      </>
    ),
  ],
  cache: [
    (marker) => (
      <>
        <Arrow from={[62, 52]} to={[132, 32]} marker={marker} tone="miss" />
        <Arrow from={[62, 70]} to={[132, 90]} marker={marker} />
        <Arrow from={[52, 40]} via={[90, 2]} to={[134, 20]} marker={marker} tone="hit" />
        <Mini kind="client" x={36} y={60} w={44} h={30} />
        <Mini kind="cache" x={160} y={28} w={44} h={30} />
        <Mini kind="database" x={160} y={94} w={44} h={34} />
        <Step n={1} at={[100, 54]} />
        <Step n={2} at={[100, 92]} />
        <Step n={3} at={[90, 14]} />
      </>
    ),
    (marker) => (
      <>
        <Arrow from={[54, 50]} to={[74, 50]} marker={marker} />
        <Arrow from={[124, 50]} to={[144, 50]} marker={marker} />
        <Arrow from={[170, 72]} via={[100, 124]} to={[34, 74]} marker={marker} tone="hit" />
        <Mini kind="client" x={30} y={50} w={44} h={30} />
        <Mini kind="cache" x={100} y={50} w={44} h={30} />
        <Mini kind="database" x={170} y={50} w={44} h={34} />
        <Packet at={[100, 98]} tone="hit" response />
      </>
    ),
    (marker, labels) => (
      <>
        <Arrow from={[54, 50]} to={[74, 50]} marker={marker} />
        <Arrow from={[124, 50]} to={[144, 50]} marker={marker} dashed />
        <Arrow from={[100, 72]} via={[66, 112]} to={[34, 74]} marker={marker} tone="hit" />
        <Mini kind="client" x={30} y={50} w={44} h={30} />
        <Mini kind="cache" x={100} y={50} w={44} h={30} />
        <Mini kind="database" x={170} y={50} w={44} h={34} />
        <Label x={136} y={24} text={labels('later')} />
        <Packet at={[134, 64]} response />
        <Packet at={[146, 64]} response />
        <Packet at={[66, 94]} tone="hit" response />
      </>
    ),
  ],
  cdn: [
    (marker) => (
      <>
        <Arrow from={[54, 56]} to={[74, 56]} marker={marker} />
        <Arrow from={[126, 56]} to={[146, 56]} marker={marker} tone="miss" />
        <Arrow from={[170, 76]} via={[136, 112]} to={[104, 80]} marker={marker} tone="hit" />
        <Mini kind="client" x={30} y={60} w={44} h={30} />
        <Mini kind="cdn" x={100} y={60} w={48} h={34} />
        <Mini kind="server" x={170} y={60} w={44} h={30} />
        <rect className="sdv-concept__chip" x={110} y={38} width={14} height={9} rx={2} />
      </>
    ),
    (marker, labels) => (
      <>
        <Arrow from={[54, 60]} to={[74, 60]} marker={marker} tone="hit" />
        <Arrow from={[146, 60]} to={[126, 60]} marker={marker} />
        <Mini kind="server" x={30} y={60} w={44} h={30} />
        <Mini kind="cdn" x={100} y={60} w={48} h={34} />
        <Mini kind="client" x={170} y={60} w={44} h={30} />
        <rect className="sdv-concept__chip" x={110} y={38} width={14} height={9} rx={2} />
        <Label x={64} y={30} text={labels('upload')} />
      </>
    ),
  ],
};

/** One small static picture per variant, named and described for screen readers. */
export function VariantArt({
  slug,
  index,
  variant,
  idPrefix,
}: {
  slug: ConceptSlug;
  index: number;
  variant: ConceptVariant;
  idPrefix: string;
}) {
  const draw = art[slug][index];
  if (!draw) throw new Error(`no drawing for ${slug} variant ${index}`);
  const marker = `${idPrefix}-arrow`;
  return (
    <svg
      className="sdv-concept__mini"
      viewBox={`0 0 ${MINI_W} ${MINI_H}`}
      role="img"
      aria-labelledby={`${idPrefix}-title`}
      aria-describedby={`${idPrefix}-desc`}
      focusable="false"
    >
      <title id={`${idPrefix}-title`}>{variant.name}</title>
      <desc id={`${idPrefix}-desc`}>{variant.description}</desc>
      <ArrowDefs id={marker} />
      {draw(marker, labelReader(variant.labels))}
    </svg>
  );
}
