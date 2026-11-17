/**
 * The shape of a core concept page. Every string here shows on screen and counts toward the
 * word budget, except `description` fields (screen readers only) and quiz `why` text (shown after answering).
 * Concept files import only types from here, so scripts/lint-lessons.ts can load them under plain Node.
 */

import type { QuizQuestion } from '../../components/lesson/Quiz';
import type { CourseId } from '../courses';

export type { QuizQuestion } from '../../components/lesson/Quiz';
export type { CourseId } from '../courses';

export type ConceptGroupId = 'basics' | 'traffic' | 'data' | 'speed' | 'communication' | 'reliability';

export interface ConceptGroup {
  id: ConceptGroupId;
  title: string;
}

/** Display order of the groups in the sidebar, the index and the home grid. */
export const CONCEPT_GROUPS: readonly ConceptGroup[] = [
  { id: 'basics', title: 'Basics' },
  { id: 'traffic', title: 'Traffic' },
  { id: 'data', title: 'Data' },
  { id: 'speed', title: 'Speed and consistency' },
  { id: 'communication', title: 'Communication' },
  { id: 'reliability', title: 'Reliability' },
];

export type ConceptStateId = 'without' | 'with';

export interface ConceptState {
  /** Toggle label, free text: "Without", "With", "Scale up", "Polling". */
  label: string;
  /** Accessible name of the drawing. */
  title: string;
  /** Screen reader description of what the drawing shows. */
  description: string;
  /** Exactly three numbered captions, matching the three markers drawn on the scene. */
  captions: string[];
}

export interface ConceptVariant {
  name: string;
  /** At most 12 words. */
  caption: string;
  /** Screen reader description of the mini diagram. */
  description: string;
  /** Text drawn inside the mini diagram, read with `labelReader`. */
  labels: Record<string, string>;
}

export interface ConceptLink {
  course: CourseId;
  /** Deep link into the course, with a `#anchor` when the section has one. */
  href: string;
  /** Section name; the page shows it after the course name. */
  label: string;
}

export interface Concept {
  /** Page lives at /concepts/<slug>/; also the scene registry key. */
  slug: string;
  group: ConceptGroupId;
  title: string;
  /** One sentence, at most 25 words. Also the page's meta description. */
  definition: string;
  /** At most 25 words, shown after "Think of it like". */
  analogy: string;
  /** Lesson id for the "Go deeper" link, such as "scaling/caching". Omit when no lesson fits. */
  lesson?: string;
  /** Diagram or example numbers are illustrative, so the page says so. */
  illustrative: boolean;
  /** Text drawn inside the main diagram, read with `labelReader`. */
  labels: Record<string, string>;
  states: Record<ConceptStateId, ConceptState>;
  /** "How it works": 3 to 5 steps, each at most 20 words, in the order the animation plays them. */
  steps: string[];
  /** Worked example with real arithmetic, at most 60 words across the title and lines. */
  example: { title: string; lines: string[] };
  /** 2 or 3 mini diagrams. */
  variants: ConceptVariant[];
  tradeoffs: { useWhen: string; costs: string; realExample: string; watchOut: string };
  /** Exactly 2 questions with ids "concepts/<slug>/q1" and "concepts/<slug>/q2". */
  quiz: QuizQuestion[];
  /** 2 or 3 links, from different courses where possible. */
  learnMore: ConceptLink[];
}

export type LabelReader = (key: string) => string;
