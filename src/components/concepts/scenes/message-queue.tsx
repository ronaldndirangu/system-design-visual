import { labelReader } from '../../../data/concepts';
import entry from '../../../data/concepts/message-queue';
import { link, type Positioned, type Vec } from '../../viz/geometry';
import { StatusBadge } from '../../viz/icons';
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
import variants from '../variants/message-queue';

const L = labelReader(entry.labels);
const QUEUE_HEIGHT = 256;

const NODE_H = 58;
const user = { x: 64, y: 40, w: 88, h: NODE_H } satisfies Positioned;
const web = { x: 64, y: 190, w: 88, h: NODE_H } satisfies Positioned;
const back = { x: 250, y: 190, w: 104, h: NODE_H } satisfies Positioned;
const worker = { x: 250, y: 40, w: 100, h: NODE_H } satisfies Positioned;

const top = user.y + NODE_H / 2 + 6;
const bottom = web.y - NODE_H / 2 - 6;
const down: Vec[] = [
  [user.x, top],
  [user.x, bottom],
];
const up: Vec[] = [
  [user.x, bottom],
  [user.x, top],
];
const side = link(web, back);
const hand: Vec[] = [side.from, side.to];
const handBack: Vec[] = [side.to, side.from];
const pull = link(back, worker);
const take: Vec[] = [pull.from, pull.to];

function Front({ thumb, marker }: { thumb?: boolean; marker: string }) {
  return (
    <>
      <Edge from={[user.x, top]} to={[user.x, bottom]} marker={marker} />
      <Edge {...side} marker={marker} />
      <SystemNode
        kind="client"
        x={user.x}
        y={user.y}
        width={user.w}
        height={NODE_H}
        label={thumb ? '' : L('user')}
      />
      <SystemNode
        kind="server"
        x={web.x}
        y={web.y}
        width={web.w}
        height={NODE_H}
        label={thumb ? '' : L('web')}
      />
    </>
  );
}

function Busy({ at }: { at: Window }) {
  return (
    <Show at={at}>
      <StatusBadge status="warn" x={web.x + web.w / 2 - 4} y={web.y - NODE_H / 2 + 4} />
    </Show>
  );
}

/** The web server sends each email before replying, so a burst piles up. */
function QueueWithout({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.without;
  const burst = [0.62, 0.66, 0.7];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={QUEUE_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Front thumb={thumb} marker={marker} />
          <SystemNode
            kind="server"
            x={back.x}
            y={back.y}
            width={back.w}
            height={NODE_H}
            label={thumb ? '' : L('email')}
          />
          <Busy at={[0.72, 1]} />
          {burst.map((s, i) => (
            <Show key={`p${s}`} at={[s + 0.08, 1]}>
              <rect
                className="sdv-concept__fill--warn"
                x={36 + i * 20}
                y={226}
                width={14}
                height={10}
                rx={2}
              />
            </Show>
          ))}
          <Note x={user.x + 10} y={120} text={L('slow')} anchor="start" thumb={thumb} />
          <Dot path={down} at={[0.02, 0.1]} />
          <Dot path={hand} at={[0.1, 0.18]} />
          <Dot path={handBack} at={[0.42, 0.5]} response tone="hit" />
          <Dot path={up} at={[0.5, 0.58]} response tone="hit" />
          {burst.map((s) => (
            <Dot key={s} path={down} at={[s, s + 0.08]} />
          ))}
          {burst.map((s) => (
            <Dot key={`t${s}`} path={up} at={[s + 0.22, s + 0.3]} response tone="bad" />
          ))}
          <Still at={[user.x, 90]} />
          <Still at={[user.x, 108]} response tone="bad" />
          <Still at={[156, 190]} />
          <Marker n={1} x={156} y={166} at={0.1} thumb={thumb} />
          <Marker n={2} x={40} y={116} at={0.5} thumb={thumb} />
          <Marker n={3} x={110} y={231} at={0.72} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

/** The web server queues a job and replies at once; a worker drains the queue. */
function QueueWith({ idPrefix, thumb }: SceneProps) {
  const state = entry.states.with;
  const burst = [0.5, 0.54, 0.58];
  /** Backlog squares under the queue: each appears when its job lands and leaves when a worker takes it. */
  const backlog: Window[] = [
    [0.16, 0.3],
    [0.6, 0.7],
    [0.64, 1],
    [0.68, 1],
  ];
  const slots = [266, 266, 246, 226];
  return (
    <SceneFrame
      idPrefix={idPrefix}
      thumb={thumb}
      height={QUEUE_HEIGHT}
      title={state.title}
      description={state.description}
    >
      {(marker) => (
        <>
          <Front thumb={thumb} marker={marker} />
          <Edge {...pull} marker={marker} />
          <SystemNode
            kind="queue"
            x={back.x}
            y={back.y}
            width={back.w}
            height={NODE_H}
            label={thumb ? '' : L('queue')}
          />
          <SystemNode
            kind="server"
            x={worker.x}
            y={worker.y}
            width={worker.w}
            height={NODE_H}
            label={thumb ? '' : L('worker')}
          />
          {backlog.map((at, i) => (
            <Show key={at.join()} at={at}>
              <rect className="sdv-concept__chip" x={slots[i]} y={228} width={16} height={10} rx={2} />
            </Show>
          ))}
          <Note x={user.x + 10} y={120} text={L('fast')} anchor="start" thumb={thumb} />
          <Dot path={down} at={[0.02, 0.08]} />
          <Dot path={hand} at={[0.08, 0.16]} />
          <Dot path={up} at={[0.1, 0.16]} response tone="hit" />
          <Dot path={take} at={[0.3, 0.38]} />
          {burst.map((s) => (
            <Dot key={s} path={down} at={[s, s + 0.06]} />
          ))}
          {burst.map((s) => (
            <Dot key={`h${s}`} path={hand} at={[s + 0.06, s + 0.1]} />
          ))}
          {burst.map((s) => (
            <Dot key={`r${s}`} path={up} at={[s + 0.08, s + 0.14]} response tone="hit" />
          ))}
          <Dot path={take} at={[0.7, 0.76]} />
          <Still at={[user.x, 108]} response tone="hit" />
          <Still at={[156, 190]} />
          <Still at={[250, 115]} />
          <Marker n={1} x={156} y={166} at={0.08} thumb={thumb} />
          <Marker n={2} x={40} y={116} at={0.1} thumb={thumb} />
          <Marker n={3} x={300} y={233} at={0.6} thumb={thumb} />
        </>
      )}
    </SceneFrame>
  );
}

export default { without: QueueWithout, with: QueueWith, variants } satisfies ConceptScene;
