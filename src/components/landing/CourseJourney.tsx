import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useHydrated } from '../sim/useHydrated';
import { DiagramScroll } from '../viz/DiagramScroll';
import { link, nodeSize, readableFont } from '../viz/geometry';
import type { ComponentKind, NodeStatus } from '../viz/kinds';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';

type Slot = 'users' | 'balancer' | 'servers' | 'replicas' | 'database' | 'cache' | 'region';

const SLOTS: Record<Slot, { x: number; y: number; kind: ComponentKind }> = {
  users: { x: 70, y: 50, kind: 'client' },
  balancer: { x: 225, y: 50, kind: 'loadBalancer' },
  servers: { x: 380, y: 50, kind: 'server' },
  replicas: { x: 70, y: 150, kind: 'database' },
  database: { x: 225, y: 150, kind: 'database' },
  cache: { x: 380, y: 150, kind: 'cache' },
  region: { x: 225, y: 255, kind: 'server' },
};

interface JourneyNode {
  slot: Slot;
  label: string;
  sublabel?: string;
  status?: NodeStatus;
}

interface Chapter {
  users: string;
  title: string;
  body: string;
  problem: string;
  response: string;
  cost: string;
  lessons: string[];
  nodes: JourneyNode[];
  edges: [Slot, Slot, 'dashed'?][];
}

export const JOURNEY_LESSONS = [
  'thinking/anatomy-of-a-web-app',
  'foundations/what-happens-when-you-click',
  'scaling/load-balancing',
  'scaling/caching',
  'scaling/read-replicas',
  'scaling/sharding',
  'distributed-data/multi-region',
  'distributed-data/cap-and-pacelc',
] as const;

const CHAPTERS: Chapter[] = [
  {
    users: '100',
    title: '100 users: follow one click.',
    body: 'A short link reaches a server and a database. Find out what each box does.',
    problem: 'Every click depends on one server and one database.',
    response: 'Learn what each box does and follow one click end to end.',
    cost: 'Simple and cheap, with no spare capacity.',
    lessons: ['thinking/anatomy-of-a-web-app', 'foundations/what-happens-when-you-click'],
    nodes: [
      { slot: 'users', label: 'Users' },
      { slot: 'servers', label: 'Server', sublabel: 'one machine', status: 'bad' },
      { slot: 'database', label: 'Database' },
    ],
    edges: [
      ['users', 'servers'],
      ['servers', 'database'],
    ],
  },
  {
    users: '10K',
    title: '10,000 users: the link goes viral.',
    body: 'Spread requests. Cache popular answers. Decide how stale an answer can be.',
    problem: 'One server cannot keep up, and the same popular links are read again and again.',
    response: 'Add servers behind a load balancer and cache popular answers.',
    cost: 'More machines to run, and cached answers can be stale.',
    lessons: ['scaling/load-balancing', 'scaling/caching'],
    nodes: [
      { slot: 'users', label: 'Users' },
      { slot: 'balancer', label: 'Balancer' },
      { slot: 'servers', label: 'Servers', sublabel: '3 copies' },
      { slot: 'cache', label: 'Cache' },
      { slot: 'database', label: 'Database', status: 'bad' },
    ],
    edges: [
      ['users', 'balancer'],
      ['balancer', 'servers'],
      ['servers', 'cache'],
      ['servers', 'database'],
    ],
  },
  {
    users: '1M',
    title: '1 million users: the data outgrows one machine.',
    body: 'Copy or partition the data. Handle lag and uneven demand.',
    problem: 'One database can no longer hold the data or absorb every read.',
    response: 'Copy data to read replicas and partition it across shards.',
    cost: 'Replicas lag behind, and some shards get busier than others.',
    lessons: ['scaling/read-replicas', 'scaling/sharding'],
    nodes: [
      { slot: 'users', label: 'Users', sublabel: 'far away', status: 'bad' },
      { slot: 'balancer', label: 'Balancer' },
      { slot: 'servers', label: 'Servers', sublabel: '3 copies' },
      { slot: 'cache', label: 'Cache' },
      { slot: 'database', label: 'Database', sublabel: 'split in shards' },
      { slot: 'replicas', label: 'Replicas' },
    ],
    edges: [
      ['users', 'balancer'],
      ['balancer', 'servers'],
      ['servers', 'cache'],
      ['servers', 'database'],
      ['database', 'replicas'],
    ],
  },
  {
    users: '100M',
    title: '100 million users: distance and failure matter.',
    body: 'Serve people across regions. Decide what stays available when regions cannot talk.',
    problem: 'Users are far from one region, and a region can fail.',
    response: 'Serve from several regions and choose what stays available during a split.',
    cost: 'Cross region traffic is slow, and you trade consistency for availability.',
    lessons: ['distributed-data/multi-region', 'distributed-data/cap-and-pacelc'],
    nodes: [
      { slot: 'users', label: 'Users' },
      { slot: 'balancer', label: 'Balancer' },
      { slot: 'servers', label: 'Servers', sublabel: '3 copies' },
      { slot: 'cache', label: 'Cache' },
      { slot: 'database', label: 'Database', sublabel: 'split in shards' },
      { slot: 'replicas', label: 'Replicas' },
      { slot: 'region', label: 'Region 2' },
    ],
    edges: [
      ['users', 'balancer'],
      ['balancer', 'servers'],
      ['servers', 'cache'],
      ['servers', 'database'],
      ['database', 'replicas'],
      ['database', 'region', 'dashed'],
    ],
  },
];

export interface JourneyLessonLink {
  title: string;
  href: string;
}

/**
 * The course story as four stages the learner steps through. Each stage keeps
 * the earlier boxes in place and adds the ones the new problem calls for.
 */
export default function CourseJourney({ lessons }: { lessons: Record<string, JourneyLessonLink> }) {
  const hydrated = useHydrated();
  const base = useId();
  const arrowId = safeId(base, 'journey-arrow');
  const panelId = safeId(base, 'journey-panel');
  const tabId = (index: number) => safeId(base, `journey-tab-${index}`);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState(0);
  const [summary, setSummary] = useState('');
  const [scale, setScale] = useState(1);
  const minFont = readableFont(scale);
  const chapter = CHAPTERS[active] ?? CHAPTERS[0];
  if (!chapter) return null;
  const before = new Set((CHAPTERS[previous]?.nodes ?? []).map((node) => node.slot));

  const select = (index: number) => {
    if (index === active) return;
    const next = CHAPTERS[index];
    if (!next) return;
    setPrevious(active);
    setActive(index);
    setSummary(`${next.title} ${next.problem}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = CHAPTERS.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowDown: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      ArrowUp: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
    tabs.current[target]?.focus();
  };

  const boxes = new Map(
    chapter.nodes.map((node) => {
      const slot = SLOTS[node.slot];
      const size = nodeSize(slot.kind, node.label, minFont);
      return [node.slot, { x: slot.x, y: slot.y, w: size.w, h: size.h }];
    }),
  );

  const strained = chapter.nodes.find((node) => node.status === 'bad');
  const diagramLabel = `Architecture at ${chapter.users} users: ${chapter.nodes
    .map((node) => (node.sublabel ? `${node.label} (${node.sublabel})` : node.label))
    .join(', ')}.${strained ? ` Under strain: ${strained.label}.` : ''}`;

  return (
    <div className="sdv-journey">
      <div className="sdv-journey__tabs" role="tablist" aria-label="Users">
        {CHAPTERS.map((each, index) => (
          <button
            key={each.users}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(index)}
            className="sdv-journey__tab"
            aria-selected={index === active}
            aria-controls={panelId}
            tabIndex={index === active ? 0 : -1}
            disabled={!hydrated}
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
          >
            <span className="sdv-journey__count">{each.users}</span> users
          </button>
        ))}
      </div>

      <div className="sdv-journey__panel" role="tabpanel" id={panelId} aria-labelledby={tabId(active)}>
        <div className="sdv-journey__copy">
          <h3>{chapter.title}</h3>
          <p>{chapter.body}</p>
          <dl className="sdv-journey__facts">
            <div>
              <dt>Problem</dt>
              <dd>{chapter.problem}</dd>
            </div>
            <div>
              <dt>Response</dt>
              <dd>{chapter.response}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{chapter.cost}</dd>
            </div>
          </dl>
          <ul className="sdv-journey__lessons" aria-label="Lessons for this stage">
            {chapter.lessons.map((id) => {
              const lesson = lessons[id];
              return lesson ? (
                <li key={id}>
                  <a href={lesson.href}>{lesson.title}</a>
                </li>
              ) : null;
            })}
          </ul>
        </div>
        <div className="sdv-journey__diagram">
          <DiagramScroll label="Architecture at this stage" onScale={setScale}>
            <svg className="sdv-journey__svg" viewBox="0 0 450 300" role="img" aria-label={diagramLabel}>
              <ArrowDefs id={arrowId} />
              {chapter.edges.map(([from, to, dashed]) => {
                const a = boxes.get(from);
                const b = boxes.get(to);
                if (!a || !b) return null;
                const line = link(a, b);
                return (
                  <Edge
                    key={`${from}-${to}`}
                    from={line.from}
                    to={line.to}
                    marker={arrowId}
                    dashed={dashed === 'dashed'}
                  />
                );
              })}
              {chapter.nodes.map((node) => {
                const slot = SLOTS[node.slot];
                return (
                  <g
                    key={node.slot}
                    className={before.has(node.slot) || active === previous ? undefined : 'sdv-journey__new'}
                  >
                    <SystemNode
                      kind={slot.kind}
                      x={slot.x}
                      y={slot.y}
                      label={node.label}
                      sublabel={node.sublabel}
                      status={node.status}
                      minFontSize={minFont}
                    />
                  </g>
                );
              })}
            </svg>
          </DiagramScroll>
        </div>
      </div>
      <p className="sdv-visually-hidden" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}
