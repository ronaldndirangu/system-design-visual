import { m } from 'motion/react';
import { useId, useState } from 'react';
import { MotionRoot } from '../sim/MotionRoot';
import { usePrefersReducedMotion } from '../sim/usePrefersReducedMotion';
import { DiagramScroll } from '../viz/DiagramScroll';
import { link } from '../viz/geometry';
import type { ComponentKind } from '../viz/kinds';
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

export interface DiagramStep {
  title: string;
  text: string;
  /** Node ids to light up. Others fade back. */
  nodes: string[];
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
  height?: number;
}

/** Room around each node center for the node and its sublabel. */
const FIT_MARGIN = 72;

/** Walk through a diagram one step at a time with Back and Next. */
export default function StepDiagram({ title, nodes, edges, steps, width, height = 300 }: Props) {
  const [index, setIndex] = useState(0);
  const reduced = usePrefersReducedMotion();
  const arrow = safeId(useId(), 'step-arrow');
  const step = steps[index];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!step) return null;
  const xs = nodes.map((node) => node.x);
  const left = width === undefined ? Math.min(...xs) - FIT_MARGIN : 0;
  const viewWidth = width ?? Math.max(...xs) + FIT_MARGIN - left;

  const segment = (edge: DiagramEdge) => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return undefined;
    return link(a, b);
  };

  return (
    <MotionRoot>
      <figure className="sdv-steps not-content" aria-label={title}>
        <DiagramScroll label="Scrollable diagram">
          <svg
            viewBox={`${left} 0 ${viewWidth} ${height}`}
            role="img"
            aria-label={`${title}. Step ${index + 1}: ${step.text}`}
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
                highlight={step.nodes.includes(node.id)}
                dim={!step.nodes.includes(node.id)}
              />
            ))}
            {step.flows?.map((key) => {
              const [from, to] = key.split('>');
              const points = from && to ? segment({ from, to }) : undefined;
              if (!points) return null;
              if (reduced) {
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
                  transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
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
            <button
              type="button"
              className="sdv-button"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              Back
            </button>
            <button
              type="button"
              className="sdv-button sdv-button--primary"
              disabled={index === steps.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next step
            </button>
          </div>
        </figcaption>
      </figure>
    </MotionRoot>
  );
}
