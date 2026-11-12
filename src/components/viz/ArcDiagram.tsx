import { useId } from 'react';
import { DiagramScroll } from './DiagramScroll';
import { ArrowDefs, Edge, SystemNode, safeId } from './SystemNode';
import './ArcDiagram.css';

export type ArcStage = 'dns' | 'single' | 'scale-out' | 'cache' | 'cdn' | 'replicas' | 'shards';

interface StageInfo {
  title: string;
  users: string;
  description: string;
}

export const arcStages: Record<Exclude<ArcStage, 'dns'>, StageInfo> = {
  single: {
    title: 'One server',
    users: '100 users',
    description: 'A client calls one server, which reads and writes one database.',
  },
  'scale-out': {
    title: 'Load balancer and three servers',
    users: '100K users',
    description:
      'A load balancer spreads client requests across three identical servers that share one database.',
  },
  cache: {
    title: 'Cache',
    users: '1M users',
    description: 'Servers check an in-memory cache before the database, which now sees only cache misses.',
  },
  cdn: {
    title: 'CDN',
    users: '3M users',
    description:
      'Clients reach a CDN edge server near them first. The edge answers cached redirects and assets, and only edge misses travel on to the load balancer.',
  },
  replicas: {
    title: 'Read replicas',
    users: '10M users',
    description: 'Writes go to a primary database, which copies them to two read replicas that serve reads.',
  },
  shards: {
    title: 'Shards',
    users: '100M users',
    description: 'The data splits across three shards, each holding a slice of the short codes.',
  },
};

const order = Object.keys(arcStages) as Exclude<ArcStage, 'dns'>[];

interface Props {
  stage: ArcStage;
  caption?: string;
}

/**
 * The URL shortener as it grows. Each scaling lesson adds one component to
 * the same picture, and the new part is highlighted.
 */
export default function ArcDiagram({ stage, caption }: Props) {
  const arrow = safeId(useId(), 'arc-arrow');
  const multi = stage !== 'single' && stage !== 'dns';
  const withCdn = stage === 'cdn' || stage === 'replicas' || stage === 'shards';
  const serverYs = multi ? [80, 160, 240] : [160];
  const serverX = 336;
  const busX = 414;
  const index = stage === 'dns' ? 0 : order.indexOf(stage);
  const info = stage === 'dns' ? undefined : arcStages[stage];
  const viewWidth = stage === 'dns' ? 610 : 680;
  const description =
    stage === 'dns'
      ? 'A browser asks DNS for the address of sho.rt, then calls the server, which reads the database.'
      : info?.description;

  return (
    <figure className="sdv-figure sdv-arc not-content">
      <DiagramScroll label="Scrollable diagram">
        <svg
          viewBox={stage === 'dns' ? `0 16 ${viewWidth} 192` : `0 0 ${viewWidth} 336`}
          // Renders without hydration, so a static floor keeps 13px sublabels at 12px or larger on phones.
          style={{ minWidth: `${Math.ceil((viewWidth * 12) / 13)}px` }}
          role="img"
          aria-label={`Diagram: ${description}`}
        >
          <ArrowDefs id={arrow} />

          {stage === 'dns' && (
            <>
              <Edge from={[104, 126]} to={[152, 84]} marker={arrow} />
              <SystemNode kind="dns" x={210} y={60} label="DNS resolver" highlight />
            </>
          )}

          {withCdn && (
            <>
              <Edge from={[62, 128]} to={[62, 92]} marker={arrow} />
              <Edge from={[118, 52]} to={[196, 124]} via={[196, 52]} marker={arrow} />
              <SystemNode kind="cdn" x={62} y={52} label="CDN edge" highlight={stage === 'cdn'} />
            </>
          )}

          {multi ? (
            <>
              {!withCdn && <Edge from={[124, 160]} to={[146, 160]} marker={arrow} />}
              {serverYs.map((y) => (
                <Edge key={y} from={[254, 160]} to={[276, y]} marker={arrow} />
              ))}
              {serverYs.map((y) => (
                <Edge key={`bus-${y}`} from={[serverX + 56, y]} to={[busX, y]} />
              ))}
              <Edge from={[busX, 80]} to={[busX, 240]} />
            </>
          ) : (
            <Edge from={[124, 160]} to={[276, 160]} marker={arrow} />
          )}

          <SystemNode kind="client" x={62} y={160} label={stage === 'dns' ? 'Browser' : 'Clients'} />
          {multi && (
            <SystemNode kind="loadBalancer" x={196} y={160} width={124} highlight={stage === 'scale-out'} />
          )}
          {serverYs.map((y, i) => (
            <SystemNode
              key={y}
              kind="server"
              x={serverX}
              y={y}
              label={multi ? `Server ${i + 1}` : 'Server'}
              highlight={stage === 'scale-out' || stage === 'single'}
            />
          ))}

          <DataTier stage={stage} arrow={arrow} busX={busX} />
        </svg>
      </DiagramScroll>
      <figcaption>
        {caption ?? (info ? `The URL shortener at ${info.users}: ${info.title.toLowerCase()}.` : description)}
      </figcaption>
      {stage !== 'dns' && (
        <ol className="sdv-arc__stages" aria-label="Scaling journey">
          {order.map((id, i) => (
            <li key={id} aria-current={i === index ? 'step' : undefined} data-done={i < index || undefined}>
              <span className="sdv-arc__users">{arcStages[id].users}</span>
              <span className="sdv-arc__title">{arcStages[id].title}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

function DataTier({ stage, arrow, busX }: { stage: ArcStage; arrow: string; busX: number }) {
  const withCache = stage === 'cache' || stage === 'cdn' || stage === 'replicas' || stage === 'shards';
  const multi = stage !== 'single' && stage !== 'dns';
  const fromX = multi ? busX : 398;
  return (
    <>
      {withCache && (
        <>
          <Edge from={[busX, 80]} to={[busX, 60]} />
          <Edge from={[busX, 60]} to={[446, 60]} marker={arrow} />
          <SystemNode kind="cache" x={504} y={60} width={104} label="Cache" highlight={stage === 'cache'} />
        </>
      )}

      {(stage === 'single' || stage === 'dns' || stage === 'scale-out') && (
        <>
          <Edge from={[fromX, 160]} to={[478, 160]} marker={arrow} />
          <SystemNode kind="database" x={540} y={160} />
        </>
      )}

      {(stage === 'cache' || stage === 'cdn') && (
        <>
          <Edge from={[busX, 200]} to={[478, 200]} marker={arrow} />
          <SystemNode kind="database" x={540} y={200} sublabel="misses only" />
        </>
      )}

      {stage === 'replicas' && (
        <>
          <Edge from={[busX, 200]} to={[434, 200]} marker={arrow} />
          <Edge from={[538, 196]} to={[566, 158]} marker={arrow} dashed />
          <Edge from={[538, 224]} to={[566, 262]} marker={arrow} dashed />
          <SystemNode kind="database" x={488} y={210} width={96} label="Primary" sublabel="writes" />
          <SystemNode
            kind="database"
            x={620}
            y={140}
            width={100}
            label="Replica 1"
            sublabel="reads"
            highlight
          />
          <SystemNode
            kind="database"
            x={620}
            y={270}
            width={100}
            label="Replica 2"
            sublabel="reads"
            highlight
          />
        </>
      )}

      {stage === 'shards' &&
        [
          { y: 150, label: 'Shard A' },
          { y: 230, label: 'Shard B' },
          { y: 300, label: 'Shard C' },
        ].map(({ y, label }) => (
          <g key={label}>
            <Edge from={[busX, Math.min(y, 240)]} to={[494, y]} marker={arrow} via={[464, y]} />
            <SystemNode kind="database" x={556} y={y} height={56} label={label} highlight />
          </g>
        ))}
    </>
  );
}
