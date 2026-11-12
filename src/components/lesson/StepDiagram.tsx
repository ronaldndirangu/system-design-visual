import { m } from 'motion/react';
import { useId, useRef, useState } from 'react';
import { autoplayBudget, useAutoplay } from '../../lib/useAutoplay';
import { MotionRoot } from '../sim/MotionRoot';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { link, MAX_FONT, MIN_SCALE, nodeSize, readableFont, textWidth } from '../viz/geometry';
import { UiIcon } from '../viz/icons';
import { type ComponentKind, kinds } from '../viz/kinds';
import { ArrowDefs, Edge, SystemNode, safeId } from '../viz/SystemNode';

export interface DiagramNode {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  label?: string;
  sublabel?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  dashed?: boolean;
}

export interface StepFocus {
  active: string;
  involved?: string[];
}

export interface DiagramStep {
  title: string;
  text: string;
  /** The one node the step is about (ringed) and the other participants. Everything else fades back. */
  focus: StepFocus;
  /** Edges that carry traffic in this step, written "from>to". */
  flows?: string[];
}

interface Props {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  steps: DiagramStep[];
  /** Overrides the fitted width. By default the diagram hugs its nodes. */
  width?: number;
  /** Ignored: the diagram fits its nodes vertically. */
  height?: number;
  /** `stack` turns a left to right flow into a top to bottom one for narrow screens. */
  layout?: 'flow' | 'stack';
}

const PAD = 16;
/** Stacked rows sit closer than flow columns, so their old y gaps widen into x gaps. */
const STACK_SPREAD = 1.3;
const LOOP_SECONDS = 1.4;
const BUDGET_MS = autoplayBudget(LOOP_SECONDS * 1000);

/** Walk through a diagram one step at a time with Back and Next. */
export default function StepDiagram({ title, nodes: given, edges, steps, width, layout = 'flow' }: Props) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const reduced = usePrefersReducedMotion();
  const figure = useRef<HTMLElement>(null);
  const motion = useAutoplay(figure, { reduced, budgetMs: BUDGET_MS });
  const arrow = safeId(useId(), 'step-arrow');
  const step = steps[index];
  const hasFlows = steps.some((candidate) => (candidate.flows?.length ?? 0) > 0);
  if (!step) return null;
  const nodes = layout === 'stack' ? stack(given) : given;
  const minFont = readableFont(scale);
  const byId = new Map(
    nodes.map((node) => [node.id, { ...node, ...nodeSize(node.kind, labelOf(node), minFont) }]),
  );
  const fit = fitBox(nodes);
  const left = width === undefined ? fit.left : 0;
  const viewWidth = width ?? fit.width;
  const svgStyle = {
    minWidth: `${Math.ceil(viewWidth * MIN_SCALE)}px`,
    ...(layout === 'stack' ? { maxWidth: `${viewWidth}px`, marginInline: 'auto' } : {}),
  };

  const segment = (edge: DiagramEdge) => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return undefined;
    return link(a, b);
  };

  const goTo = (next: number) => {
    setIndex(next);
    motion.restart();
  };

  return (
    <MotionRoot>
      <figure ref={figure} className="sdv-steps not-content" aria-label={title}>
        <DiagramScroll label="Scrollable diagram" onScale={setScale}>
          <svg
            viewBox={`${left} ${fit.top} ${viewWidth} ${fit.height}`}
            role="img"
            aria-label={title}
            style={svgStyle}
          >
            <ArrowDefs id={arrow} />
            {edges.map((edge) => {
              const points = segment(edge);
              if (!points) return null;
              const key = `${edge.from}>${edge.to}`;
              const active = step.flows?.includes(key) ?? false;
              return (
                <Edge
                  key={key}
                  from={points.from}
                  to={points.to}
                  marker={arrow}
                  dashed={edge.dashed}
                  active={active}
                />
              );
            })}
            {nodes.map((node) => (
              <SystemNode
                key={node.id}
                kind={node.kind}
                x={node.x}
                y={node.y}
                label={node.label}
                sublabel={node.sublabel}
                minFontSize={minFont}
                active={step.focus.active === node.id}
                involved={step.focus.involved?.includes(node.id) ?? false}
                dim={step.focus.active !== node.id && !step.focus.involved?.includes(node.id)}
              />
            ))}
            {step.flows?.map((key) => {
              const [from, to] = key.split('>');
              const points = from && to ? segment({ from, to }) : undefined;
              if (!points) return null;
              if (!motion.playing) {
                return (
                  <circle
                    key={`${index}-${key}`}
                    className="sdv-dot"
                    r={6}
                    cx={(points.from[0] + points.to[0]) / 2}
                    cy={(points.from[1] + points.to[1]) / 2}
                  />
                );
              }
              return (
                <m.circle
                  key={`${index}-${key}`}
                  className="sdv-dot"
                  r={6}
                  initial={{ cx: points.from[0], cy: points.from[1], opacity: 0 }}
                  animate={{
                    cx: [points.from[0], points.to[0]],
                    cy: [points.from[1], points.to[1]],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{ duration: LOOP_SECONDS, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
                />
              );
            })}
          </svg>
        </DiagramScroll>
        <figcaption className="sdv-steps__caption">
          <p className="sdv-steps__count">
            Step {index + 1} of {steps.length}
          </p>
          <div aria-live="polite">
            <p className="sdv-steps__title">{step.title}</p>
            <p className="sdv-steps__text">{step.text}</p>
          </div>
          <div className="sdv-steps__nav">
            {hasFlows && (
              <button type="button" className="sdv-button" onClick={motion.toggle}>
                <UiIcon name={motion.wantsMotion ? 'pause' : 'play'} />
                {motion.wantsMotion ? 'Pause' : 'Play'}
              </button>
            )}
            <button
              type="button"
              className="sdv-button"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              Back
            </button>
            <button
              type="button"
              className="sdv-button sdv-button--primary"
              disabled={index === steps.length - 1}
              onClick={() => goTo(index + 1)}
            >
              Next step
            </button>
          </div>
        </figcaption>
      </figure>
    </MotionRoot>
  );
}

const labelOf = (node: DiagramNode) => node.label ?? kinds[node.kind].name;

function stack(nodes: DiagramNode[]): DiagramNode[] {
  return nodes.map((node) => ({ ...node, x: node.y * STACK_SPREAD, y: node.x }));
}

/** ViewBox that holds every node, label and sublabel at the largest font the diagram can use. */
function fitBox(nodes: DiagramNode[]) {
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const box = nodeSize(node.kind, labelOf(node), MAX_FONT);
    const half = Math.max(box.w, node.sublabel ? textWidth(node.sublabel, box.subPx) : 0) / 2;
    x0 = Math.min(x0, node.x - half);
    x1 = Math.max(x1, node.x + half);
    y0 = Math.min(y0, node.y - box.h / 2);
    y1 = Math.max(y1, node.y + (node.sublabel ? box.sublabelY + 0.3 * box.subPx : box.h / 2));
  }
  return {
    left: Math.floor(x0 - PAD),
    top: Math.floor(y0 - PAD),
    width: Math.ceil(x1 - x0 + 2 * PAD),
    height: Math.ceil(y1 - y0 + 2 * PAD),
  };
}
