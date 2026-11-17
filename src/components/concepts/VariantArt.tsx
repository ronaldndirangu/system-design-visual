import { labelReader } from '../../data/concepts';
import type { ConceptVariant } from '../../data/concepts/types';
import { ArrowDefs } from '../viz/SystemNode';
import { MINI_H, MINI_W } from './miniParts';
import type { VariantDrawing } from './parts';

/** One small static picture per variant, named and described for screen readers. */
export function VariantArt({
  draw,
  variant,
  idPrefix,
}: {
  draw: VariantDrawing;
  variant: ConceptVariant;
  idPrefix: string;
}) {
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
