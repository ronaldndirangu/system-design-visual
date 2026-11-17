import type { ComponentType, ReactNode } from 'react';
import type { ConceptStateId, LabelReader } from '../../data/concepts/types';
import type { Vec } from '../viz/geometry';
import { ArrowDefs } from '../viz/SystemNode';
import { keepNumbersWithWords } from './text';

/** Width of every concept drawing's viewBox; CSS keys its text scale to this. */
export const SCENE_W = 320;

export interface SceneProps {
  /** Unique per rendered figure, so ids never collide when a page repeats a scene. */
  idPrefix: string;
  /** A small card picture: no text, no numbered markers, hidden from assistive tech. */
  thumb?: boolean;
}

/** Draws one variant inside a 200 by 120 viewBox; `marker` is the arrowhead id for `markerEnd`. */
export type VariantDrawing = (marker: string, labels: LabelReader) => ReactNode;

/** What every `scenes/<slug>.tsx` default-exports: one drawing per state, plus one per variant in data order. */
export type ConceptScene = Record<ConceptStateId, ComponentType<SceneProps>> & {
  variants: VariantDrawing[];
};

export interface SceneFrameProps extends SceneProps {
  height: number;
  title?: string;
  description?: string;
  children: (marker: string) => ReactNode;
}

/** The svg shell: accessible name and description, arrow marker, namespaced ids. */
export function SceneFrame({ idPrefix, thumb, height, title, description, children }: SceneFrameProps) {
  const marker = `${idPrefix}-arrow`;
  const viewBox = `0 0 ${SCENE_W} ${height}`;
  const body = (
    <>
      <ArrowDefs id={marker} />
      {children(marker)}
    </>
  );
  if (thumb || !title) {
    return (
      <svg className="sdv-concept__svg" viewBox={viewBox} aria-hidden="true" focusable="false">
        {body}
      </svg>
    );
  }
  return (
    <svg
      className="sdv-concept__svg"
      viewBox={viewBox}
      role="img"
      aria-labelledby={`${idPrefix}-title`}
      aria-describedby={description ? `${idPrefix}-desc` : undefined}
      focusable="false"
    >
      <title id={`${idPrefix}-title`}>{title}</title>
      {description && <desc id={`${idPrefix}-desc`}>{keepNumbersWithWords(description)}</desc>}
      {body}
    </svg>
  );
}

/** Loop fractions, start and end, of one moving or appearing element. */
export type Window = [number, number];

type Tone = 'hit' | 'miss' | 'bad';

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function Packet({ tone, response }: { tone?: Tone; response?: boolean }) {
  const cls = tone ? `sdv-dot sdv-dot--${tone}` : 'sdv-dot';
  return response ? (
    <rect className={cls} x={-4.5} y={-4.5} width={9} height={9} rx={2} />
  ) : (
    <circle className={cls} r={5} />
  );
}

/** A request (circle) or response (square) that travels along `path` during `at`. Hidden at rest. */
export function Dot({
  path,
  at,
  tone,
  response,
}: {
  path: Vec[];
  at: Window;
  tone?: Tone;
  response?: boolean;
}) {
  return (
    <g
      className="sdv-concept__dot"
      data-path={path.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}
      data-at={at.join(' ')}
    >
      <Packet tone={tone} response={response} />
    </g>
  );
}

/** A dot drawn only at rest, so the still picture shows where traffic flows. */
export function Still({ at, tone, response }: { at: Vec; tone?: Tone; response?: boolean }) {
  return (
    <g className="sdv-concept__still" transform={`translate(${fmt(at[0])} ${fmt(at[1])})`}>
      <Packet tone={tone} response={response} />
    </g>
  );
}

/**
 * Content visible during `at` of each loop. The resting picture is the final frame,
 * so anything that ends before the loop does starts hidden.
 */
export function Show({ at, children }: { at: Window; children: ReactNode }) {
  return (
    <g className="sdv-concept__show" data-show={at.join(' ')} data-off={at[1] < 1 ? '' : undefined}>
      {children}
    </g>
  );
}

/** Numbered step marker that matches a caption below the drawing. */
export function Marker({
  n,
  x,
  y,
  at,
  thumb,
}: {
  n: number;
  x: number;
  y: number;
  at: number;
  thumb?: boolean;
}) {
  if (thumb) return null;
  return (
    <g className="sdv-concept__marker" data-show={`${at} 1`} transform={`translate(${x} ${y})`}>
      <circle r={11} />
      <text textAnchor="middle" y={4.5}>
        {n}
      </text>
    </g>
  );
}

/** Small text on the drawing, such as a latency. Omitted from thumbnails. */
export function Note({
  x,
  y,
  text,
  thumb,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  text: string;
  thumb?: boolean;
  anchor?: 'start' | 'middle' | 'end';
}) {
  if (thumb) return null;
  return (
    <text className="sdv-concept__note" x={x} y={y} textAnchor={anchor}>
      {text}
    </text>
  );
}

export function pointAt(path: Vec[], index: number): Vec {
  const point = path[index];
  if (!point) throw new Error(`no point ${index} on a path of ${path.length}`);
  return point;
}

/** Points along a quadratic curve, for dots that follow a bent edge. */
export function curve(from: Vec, via: Vec, to: Vec, steps = 8): Vec[] {
  const points: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * from[0] + 2 * u * t * via[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * via[1] + t * t * to[1],
    ]);
  }
  return points;
}
