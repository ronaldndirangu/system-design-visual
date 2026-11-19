import { questionSetFingerprint } from '../lib/progress';
import { concepts } from './concepts';
import type { ConceptMetadata } from './journeys';

/** Serialize from Astro/MDX so browsers receive titles and fingerprints without all quiz content. */
export const conceptMetadata: ConceptMetadata = Object.fromEntries(
  concepts.map((entry) => [
    `concepts/${entry.slug}`,
    { title: entry.title, set: questionSetFingerprint(entry.quiz) },
  ]),
);
