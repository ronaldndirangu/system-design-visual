import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/pub-sub';
import { lerp, link, type Positioned, type Vec } from '../../viz/geometry';
import { StatusBadge } from '../../viz/icons';
import { Edge, SystemNode } from '../../viz/SystemNode';
import {
  type ConceptScene,
  Dot,
  Marker,
  SceneFrame,
  type SceneProps,
  Show,
  Still,
  type Window,
} from '../parts';
import variants from '../variants/pub-sub';

const L = labelReader(entry.labels);
const PUB_SUB_HEIGHT = 280;

const NODE_H = 58;
const orders: Positioned = { x: 100, y: 40, w: 92, h: NODE_H };
const rewards: Positioned = { x: 252, y: 40, w: 100, h: NODE_H };
const topic: Positioned = { x: 160, y: 140, w: 104, h: NODE_H };
const subscribers = {
  email: { x: 54, y: 240, w: 88, h: NODE_H },
  stock: { x: 160, y: 240, w: 88, h: NODE_H },
  stats: { x: 266, y: 240, w: 88, h: NODE_H },
} satisfies Record<string, Positioned>;
const names = ['email', 'stock', 'stats'] as const;

const path = (edge: { from: Vec; to: Vec }): Vec[] => [edge.from, edge.to];
const reverse = (edge: { from: Vec; to: Vec }): Vec[] => [edge.to, edge.from];

function Subscribers({ thumb }: { thumb?: boolean }) {
  return (
    <>
      {names.map((name) => (
        <SystemNode
          key={name}
          kind="server"
          x={subscribers[name].x}
          y={subscribers[name].y}
          width={subscribers[name].w}
          height={NODE_H}
          label={thumb ? '' : L(name)}
        />
      ))}
    </>
  );
}

function Orders({ thumb }: { thumb?: boolean }) {
  return (
    <SystemNode
      kind="server"
      x={orders.x}
      y={orders.y}
      width={orders.w}
      height={NODE_H}
      label={thumb ? '' : L('orders')}
    />
  );
}

function Badge({ status, node, at }: { status: 'warn' | 'bad'; node: Positioned; at: Window }) {
  return (
    <Show at={at}>
      <StatusBadge status={status} x={node.x + (node.w ?? 0) / 2 - 4} y={node.y - NODE_H / 2 + 4} />
    </Show>
  );
}

/** Orders calls every service itself, so one outage stalls it and each new service changes it. */
function PubSubWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const calls = names.map((name) => link(orders, subscribers[name]));
  const toRewards = link(orders, rewards);
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={PUB_SUB_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          {calls.map((edge) => (
            <Edge key={edge.to.join()} {...edge} marker={marker} />
          ))}
          <Show at={[0.7, 1]}>
            <g className="sdv-concept__cut">
              <Edge {...toRewards} marker={marker} dashed />
            </g>
            <SystemNode
              kind="server"
              x={rewards.x}
              y={rewards.y}
              width={rewards.w}
              height={NODE_H}
              label={thumb ? '' : L('rewards')}
            />
          </Show>
          <Orders thumb={thumb} />
          <Subscribers thumb={thumb} />
          <Badge status="bad" node={subscribers.stats} at={[0.42, 1]} />
          <Badge status="warn" node={orders} at={[0.5, 1]} />
          {calls.map((edge, i) => (
            <Dot key={edge.to.join()} path={path(edge)} at={[0.02 + i * 0.16, 0.1 + i * 0.16]} />
          ))}
          {calls.slice(0, 2).map((edge, i) => (
            <Dot
              key={`r${edge.to.join()}`}
              path={reverse(edge)}
              at={[0.1 + i * 0.16, 0.18 + i * 0.16]}
              response
              tone="hit"
            />
          ))}
          <Dot path={reverse(calls[2] as { from: Vec; to: Vec })} at={[0.42, 0.5]} response tone="bad" />
          <Still at={lerp(calls[0]?.from as Vec, calls[0]?.to as Vec, 0.5)} />
          <Still at={lerp(calls[2]?.from as Vec, calls[2]?.to as Vec, 0.5)} response tone="bad" />
          <Marker n={1} x={157} y={140} at={0.02} thumb={thumb} />
          <Marker n={2} x={296} y={180} at={0.42} thumb={thumb} />
          <Marker n={3} x={252} y={96} at={0.7} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** Orders publishes once; the topic copies the event to every subscriber, including new ones. */
function PubSubWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const publish = link(orders, topic);
  const fanOut = names.map((name) => link(topic, subscribers[name]));
  const toRewards = link(topic, rewards);
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={PUB_SUB_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Edge {...publish} marker={marker} />
          {fanOut.map((edge) => (
            <Edge key={edge.to.join()} {...edge} marker={marker} />
          ))}
          <Show at={[0.56, 1]}>
            <Edge {...toRewards} marker={marker} />
            <SystemNode
              kind="server"
              x={rewards.x}
              y={rewards.y}
              width={rewards.w}
              height={NODE_H}
              label={thumb ? '' : L('rewards')}
            />
          </Show>
          <Orders thumb={thumb} />
          <SystemNode
            kind="queue"
            x={topic.x}
            y={topic.y}
            width={topic.w}
            height={NODE_H}
            label={thumb ? '' : L('topic')}
          />
          <Subscribers thumb={thumb} />
          <Dot path={path(publish)} at={[0.02, 0.12]} />
          <Dot path={reverse(publish)} at={[0.12, 0.18]} response tone="hit" />
          {fanOut.map((edge) => (
            <Dot key={edge.to.join()} path={path(edge)} at={[0.2, 0.32]} tone="hit" />
          ))}
          <Dot path={path(publish)} at={[0.64, 0.74]} />
          {[...fanOut, toRewards].map((edge) => (
            <Dot key={`n${edge.to.join()}`} path={path(edge)} at={[0.76, 0.88]} tone="hit" />
          ))}
          <Still at={lerp(publish.from, publish.to, 0.5)} />
          {[...fanOut, toRewards].map((edge) => (
            <Still key={edge.to.join()} at={lerp(edge.from, edge.to, 0.5)} tone="hit" />
          ))}
          <Marker n={1} x={104} y={100} at={0.02} thumb={thumb} />
          <Marker n={2} x={236} y={150} at={0.2} thumb={thumb} />
          <Marker n={3} x={300} y={100} at={0.56} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: PubSubWithout, with: PubSubWith, variants } satisfies ConceptScene;
