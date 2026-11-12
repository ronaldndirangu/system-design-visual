import { type RefObject, useEffect, useState } from 'react';

/**
 * Inverse of how far a drawing `viewWidth` units wide shrinks to `shown` screen px, from 1 up.
 * CSS multiplies SVG text sizes by it, published as `--sdv-dscale`, so labels keep their real pixel size.
 */
export function drawingScale(viewWidth: number, shown: number): number {
  return Math.ceil(Math.max(1, viewWidth / shown) * 100) / 100;
}

/**
 * Sets `--sdv-dscale` on one SVG from its own shrink, which drives the shared
 * `--sdv-text-floor`. Returns the factor, or undefined while the SVG is hidden.
 */
function publishSvgScale(svg: SVGSVGElement): number | undefined {
  const box = svg.viewBox.baseVal;
  const { width, height } = svg.getBoundingClientRect();
  if (!box?.width || !width) return undefined;
  // preserveAspectRatio meets the tighter axis, so the drawing shrinks by the larger ratio.
  const own = Math.max(
    drawingScale(box.width, width),
    box.height && height ? drawingScale(box.height, height) : 1,
  );
  if (svg.style.getPropertyValue('--sdv-dscale') !== String(own)) {
    svg.style.setProperty('--sdv-dscale', String(own));
  }
  return own;
}

/** Ref callback for a drawing that sits outside DiagramScroll and the widget stage. */
export function trackDrawingScale(svg: SVGSVGElement | null) {
  if (!svg || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => publishSvgScale(svg));
  observer.observe(svg);
  publishSvgScale(svg);
  return () => observer.disconnect();
}

/**
 * Publishes `--sdv-dscale` on every drawing in a widget stage, each from its own
 * shrink, and returns the factor of the widest drawing for stage wide rules.
 * It remeasures when the stage resizes or the widget mounts a new drawing.
 */
export function useStageScale(stageRef: RefObject<HTMLElement | null>, resetKey?: string): number {
  const [scale, setScale] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scenario can swap the drawing without resizing the stage
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const root: HTMLElement = stage;
    const resizes = new ResizeObserver(() => measure());
    const mounts = new MutationObserver((records) => {
      const added = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) => node instanceof Element && (node.matches('svg') || node.querySelector('svg')),
        ),
      );
      if (added) measure();
    });
    function measure() {
      let widestViewBox = 0;
      let widestScale = 1;
      for (const svg of root.querySelectorAll<SVGSVGElement>('svg[viewBox]')) {
        const own = publishSvgScale(svg);
        if (own === undefined) continue;
        resizes.observe(svg);
        const viewBoxWidth = svg.viewBox.baseVal.width;
        if (viewBoxWidth > widestViewBox) {
          widestViewBox = viewBoxWidth;
          widestScale = drawingScale(viewBoxWidth, svg.clientWidth || viewBoxWidth);
        }
      }
      setScale((current) => (current === widestScale ? current : widestScale));
    }
    resizes.observe(root);
    mounts.observe(root, { childList: true, subtree: true });
    measure();
    return () => {
      resizes.disconnect();
      mounts.disconnect();
    };
  }, [stageRef, resetKey]);
  return scale;
}
