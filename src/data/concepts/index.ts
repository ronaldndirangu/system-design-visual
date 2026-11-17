/**
 * Ordered registry of core concept pages. The sidebar, the /concepts/ index, the home grid,
 * scripts/lint-lessons.ts and the e2e specs all read this list, so adding a concept means
 * one import and one array entry here (plus its scene in components/concepts/scenes/index.ts).
 * Imports use the .ts extension so plain Node can load this file for the lint.
 */

import { course } from '../courses.ts';
import { findLesson } from '../curriculum.ts';
import apis from './apis.ts';
import availability from './availability.ts';
import cache from './cache.ts';
import capTheorem from './cap-theorem.ts';
import cdn from './cdn.ts';
import circuitBreaker from './circuit-breaker.ts';
import consistency from './consistency.ts';
import consistentHashing from './consistent-hashing.ts';
import dns from './dns.ts';
import failover from './failover.ts';
import idempotency from './idempotency.ts';
import indexes from './indexes.ts';
import latencyThroughput from './latency-throughput.ts';
import loadBalancer from './load-balancer.ts';
import messageQueue from './message-queue.ts';
import pubSub from './pub-sub.ts';
import rateLimiting from './rate-limiting.ts';
import realTime from './real-time.ts';
import replication from './replication.ts';
import retries from './retries.ts';
import reverseProxy from './reverse-proxy.ts';
import scaling from './scaling.ts';
import sharding from './sharding.ts';
import sqlVsNosql from './sql-vs-nosql.ts';
import { CONCEPT_GROUPS, type Concept, type ConceptGroup, type LabelReader } from './types.ts';

export * from './types.ts';

/** Display order: groups follow CONCEPT_GROUPS, and concepts keep this order inside their group. */
export const concepts: Concept[] = [
  latencyThroughput,
  availability,
  scaling,
  dns,
  loadBalancer,
  reverseProxy,
  cdn,
  rateLimiting,
  sqlVsNosql,
  indexes,
  replication,
  sharding,
  cache,
  consistentHashing,
  capTheorem,
  consistency,
  apis,
  realTime,
  messageQueue,
  pubSub,
  failover,
  retries,
  idempotency,
  circuitBreaker,
];

export const CONCEPT_WORD_BUDGET = 350;
export const DEFINITION_WORD_LIMIT = 25;
export const ANALOGY_WORD_LIMIT = 25;
export const STEP_WORD_LIMIT = 20;
export const STEP_COUNT: [number, number] = [3, 5];
export const EXAMPLE_WORD_LIMIT = 60;
export const VARIANT_CAPTION_WORD_LIMIT = 12;
export const VARIANT_COUNT: [number, number] = [2, 3];
export const QUIZ_COUNT = 2;
export const LEARN_MORE_COUNT: [number, number] = [2, 3];
export const CAPTION_COUNT = 3;
export const ILLUSTRATIVE_NOTE = 'Numbers are illustrative.';

/** Fixed words every concept page shows, shared by the page and the word count. */
export const CONCEPT_COPY = {
  analogy: 'Think of it like',
  steps: 'How it works',
  example: 'Example:',
  useWhen: 'Use it when:',
  costs: 'It costs:',
  realExample: 'Real example:',
  watchOut: 'Watch out:',
  quiz: 'Quick check',
  deeper: 'Go deeper:',
  learnMore: 'Learn more',
} as const;

export function concept(slug: string): Concept {
  const found = concepts.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`unknown concept "${slug}"`);
  return found;
}

/** Groups in display order with their shipped concepts; empty groups are left out. */
export function conceptGroups(): (ConceptGroup & { concepts: Concept[] })[] {
  return CONCEPT_GROUPS.map((group) => ({
    ...group,
    concepts: concepts.filter((entry) => entry.group === group.id),
  })).filter((group) => group.concepts.length > 0);
}

/** Title of the lesson behind "Go deeper", or undefined when the concept has none. */
export function lessonTitle(entry: Concept): string | undefined {
  if (!entry.lesson) return undefined;
  const lesson = findLesson(entry.lesson);
  if (!lesson) throw new Error(`concept "${entry.slug}" links to unknown lesson "${entry.lesson}"`);
  return lesson.title;
}

/** Reads a drawn label by key, so a renamed key fails the build instead of drawing nothing. */
export function labelReader(labels: Record<string, string> = {}): LabelReader {
  return (key) => {
    const text = labels[key];
    if (text === undefined) throw new Error(`missing label "${key}"`);
    return text;
  };
}

/** Every string a concept page shows, apart from its title, for the word budget. */
export function conceptScreenText(entry: Concept): string[] {
  const deeper = lessonTitle(entry);
  return [
    entry.definition,
    CONCEPT_COPY.analogy,
    entry.analogy,
    ...Object.values(entry.labels),
    ...Object.values(entry.states).flatMap((state) => [state.label, ...state.captions]),
    ...(entry.illustrative ? [ILLUSTRATIVE_NOTE] : []),
    CONCEPT_COPY.steps,
    ...entry.steps,
    CONCEPT_COPY.example,
    entry.example.title,
    ...entry.example.lines,
    ...entry.variants.flatMap((variant) => [variant.name, variant.caption, ...Object.values(variant.labels)]),
    CONCEPT_COPY.useWhen,
    entry.tradeoffs.useWhen,
    CONCEPT_COPY.costs,
    entry.tradeoffs.costs,
    CONCEPT_COPY.realExample,
    entry.tradeoffs.realExample,
    CONCEPT_COPY.watchOut,
    entry.tradeoffs.watchOut,
    CONCEPT_COPY.quiz,
    ...entry.quiz.flatMap((question) => [question.prompt, ...question.options.map((option) => option.text)]),
    ...(deeper ? [CONCEPT_COPY.deeper, deeper] : []),
    CONCEPT_COPY.learnMore,
    ...entry.learnMore.flatMap((link) => [course(link.course).name, link.label]),
  ];
}
