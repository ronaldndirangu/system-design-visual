import type { CSSProperties } from 'react';
import { HOME_QUEUE_LIMIT, HOME_SERVER_NAMES } from '../../lib/models/homeRouting';
import { ArrowDefs, Edge, SystemNode } from '../viz/SystemNode';

export const ROUTING_VIEW_W = 360;
const VIEW_H = 396;
const COLUMNS = [45, 135, 225, 315];
const CENTER = ROUTING_VIEW_W / 2;
const USERS_Y = 36;
const BALANCER_Y = 130;
const QUEUE_TOP = 201;
const SLOT_H = 16;
const SLOT_STEP = 19;
const SLOT_W = 48;
const SERVER_Y = 310;
const SERVER_W = 80;
const COUNT_Y = 386;
const DROP_FROM: [number, number] = [CENTER, BALANCER_Y + 38];

export interface RoutingDiagramProps {
  capacities: readonly number[];
  rate: number;
  queues: readonly number[];
  sent: readonly number[];
  /** Servers the balancer compared for the latest decision. */
  candidates: ReadonlySet<number>;
  chosen: number | null;
  outcome: 'queued' | 'rejected' | 'failed' | null;
  /** Changes on every decision, so the request dot replays its drop. */
  decisionKey: number;
  minFont?: number;
  arrowId: string;
  label: string;
}

/** Users, a balancer, and up to four servers with their unfinished requests stacked above each one. */
export function LandingRoutingDiagram({
  capacities,
  rate,
  queues,
  sent,
  candidates,
  chosen,
  outcome,
  decisionKey,
  minFont,
  arrowId,
  label,
}: RoutingDiagramProps) {
  const target = chosen === null ? null : COLUMNS[chosen];
  const textStyle = { fontSize: `${Math.max(13, minFont ?? 0)}px` };
  return (
    <svg
      className="sdv-routing__svg"
      viewBox={`0 0 ${ROUTING_VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={label}
    >
      <ArrowDefs id={arrowId} />
      <Edge
        from={[CENTER, USERS_Y + 38]}
        to={[CENTER, BALANCER_Y - 38]}
        marker={arrowId}
        active={chosen !== null}
      />
      {capacities.map((_, id) => (
        <Edge
          key={HOME_SERVER_NAMES[id]}
          from={DROP_FROM}
          to={[COLUMNS[id] ?? 0, QUEUE_TOP - 5]}
          marker={arrowId}
          active={id === chosen}
        />
      ))}
      <SystemNode kind="client" x={CENTER} y={USERS_Y} label="Users" minFontSize={minFont} />
      <text className="sdv-routing__rate" x={CENTER + 66} y={USERS_Y + 5} style={textStyle}>
        {rate}/s average
      </text>
      <SystemNode
        kind="loadBalancer"
        x={CENTER}
        y={BALANCER_Y}
        label="Balancer"
        involved={chosen !== null}
        minFontSize={minFont}
      />
      {COLUMNS.map((x, id) => {
        const capacity = capacities[id];
        const name = HOME_SERVER_NAMES[id] ?? '';
        if (capacity === undefined) {
          return (
            <rect
              key={name}
              className="sdv-routing__spare"
              x={x - SERVER_W / 2}
              y={SERVER_Y - 32}
              width={SERVER_W}
              height={64}
              rx={4}
            />
          );
        }
        const queue = queues[id] ?? 0;
        const turnedAway = id === chosen && outcome === 'rejected';
        const full = queue >= HOME_QUEUE_LIMIT;
        return (
          <g key={name}>
            <g
              className="sdv-routing__slots"
              data-full={full ? '' : undefined}
              data-rejected={turnedAway ? '' : undefined}
            >
              {Array.from({ length: HOME_QUEUE_LIMIT }, (_, slot) => (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positions
                  key={slot}
                  className="sdv-routing__slot"
                  data-filled={slot < queue ? '' : undefined}
                  x={x - SLOT_W / 2}
                  y={QUEUE_TOP + (HOME_QUEUE_LIMIT - 1 - slot) * SLOT_STEP}
                  width={SLOT_W}
                  height={SLOT_H}
                  rx={3}
                />
              ))}
            </g>
            <SystemNode
              kind="server"
              x={x}
              y={SERVER_Y}
              width={SERVER_W}
              label={name}
              sublabel={`${capacity}/s`}
              active={id === chosen}
              involved={id !== chosen && candidates.has(id)}
              status={turnedAway ? 'bad' : full ? 'warn' : undefined}
              minFontSize={minFont}
            />
            <text className="sdv-routing__count" x={x} y={COUNT_Y} textAnchor="middle" style={textStyle}>
              {sent[id] ?? 0} sent
            </text>
          </g>
        );
      })}
      {target !== undefined && target !== null && (
        <circle
          key={decisionKey}
          className={
            outcome === 'rejected' ? 'sdv-dot sdv-dot--bad sdv-routing__dot' : 'sdv-dot sdv-routing__dot'
          }
          cx={target}
          cy={QUEUE_TOP - 12}
          r={6}
          style={
            {
              '--sdv-drop-x': `${DROP_FROM[0] - target}px`,
              '--sdv-drop-y': `${DROP_FROM[1] - (QUEUE_TOP - 12)}px`,
            } as CSSProperties
          }
        />
      )}
    </svg>
  );
}
