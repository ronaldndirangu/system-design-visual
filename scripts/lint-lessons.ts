import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allLessons, type Lesson } from '../src/data/curriculum.ts';
import {
  arrayQuestionIds,
  computeMinutes,
  corePath,
  lessonStats,
  minutesAgree,
  questionArrays,
} from '../src/lib/minutes.ts';

/**
 * Checks each lesson against the lesson template in CONTRIBUTING.md. Lessons listed in
 * lesson-lint-legacy.json predate the template, so their issues print as warnings. Any
 * other lesson fails the lint, which keeps new lessons on the template from day one.
 */

export type LessonKind = 'lesson' | 'card' | 'case-study' | 'practice';

export interface LintIssue {
  rule: 'order' | 'required' | 'h2' | 'sims' | 'words' | 'minutes' | 'links' | 'ids';
  message: string;
}

type Marker = 'recall' | 'objectives' | 'predict' | 'takeaways' | 'quiz' | 'challenge';

/** Template order. Each marker is the first tag that opens that section. */
const MARKERS: { marker: Marker; label: string; tag: RegExp }[] = [
  { marker: 'recall', label: 'Recall', tag: /<Recall\b/ },
  { marker: 'objectives', label: 'Objectives', tag: /<(?:Objectives\b|Callout\s+variant="objectives")/ },
  { marker: 'predict', label: 'Predict', tag: /<Predict\b/ },
  { marker: 'takeaways', label: 'KeyTakeaways', tag: /<(?:KeyTakeaways\b|Callout\s+variant="takeaways")/ },
  { marker: 'quiz', label: 'Quiz', tag: /<Quiz\b/ },
  { marker: 'challenge', label: 'Challenge', tag: /<(?:Challenge\b|Callout\s+variant="challenge")/ },
];

interface Profile {
  required: Marker[];
  h2?: [number, number];
  maxSims?: number;
  words?: [number, number];
  minLinks: number;
}

const PROFILES: Record<LessonKind, Profile> = {
  lesson: {
    required: ['objectives', 'predict', 'takeaways', 'quiz', 'challenge'],
    h2: [5, 8],
    maxSims: 2,
    words: [1200, 2500],
    minLinks: 3,
  },
  card: { required: ['objectives', 'takeaways', 'quiz'], maxSims: 1, words: [500, 900], minLinks: 1 },
  'case-study': {
    required: ['takeaways', 'quiz', 'challenge'],
    h2: [8, 14],
    maxSims: 4,
    words: [2000, 6000],
    minLinks: 3,
  },
  practice: { required: [], minLinks: 1 },
};

const QUESTION_ID = /^[a-z0-9-]+(\/[a-z0-9-]+)+$/;

export function lessonKind(lesson: Pick<Lesson, 'id' | 'format'>): LessonKind {
  if (lesson.format === 'card') return 'card';
  const module = lesson.id.split('/')[0];
  if (module === 'case-studies') return 'case-study';
  if (module === 'practice') return 'practice';
  return 'lesson';
}

function body(mdx: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(mdx);
  return match ? mdx.slice(match[0].length) : mdx;
}

export function countH2(mdx: string): number {
  let fenced = false;
  let count = 0;
  for (const line of mdx.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) count += 1;
  }
  return count;
}

/** Distinct lessons this page links to, resolved the way the browser resolves the relative link. */
export function linkedLessons(mdx: string, id: string, known: ReadonlySet<string>): string[] {
  const page = `https://lesson.invalid/${id}/`;
  const found = new Set<string>();
  for (const link of mdx.matchAll(/\]\(([^)\s]+)\)|\bhref="([^"]+)"/g)) {
    const href = link[1] ?? link[2] ?? '';
    if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const target = new URL(href, page).pathname.replace(/^\/(?:system-design-visual\/)?|\/$/g, '');
    if (target !== id && known.has(target)) found.add(target);
  }
  return [...found];
}

/** Question ids from the arrays passed to Quiz and Recall, then from Predict tags. */
export function questionIds(mdx: string): string[] {
  const ids = questionArrays(mdx).flatMap(arrayQuestionIds);
  for (const tag of mdx.matchAll(/<Predict\b[\s\S]*?\bid="([^"]*)"/g)) ids.push(tag[1] ?? '');
  return ids;
}

const range = ([low, high]: [number, number]) => `${low} to ${high}`;

export function lintLesson(
  lesson: Lesson,
  mdx: string,
  known: ReadonlySet<string> = new Set(allLessons.map((candidate) => candidate.id)),
): LintIssue[] {
  const issues: LintIssue[] = [];
  const kind = lessonKind(lesson);
  const profile = PROFILES[kind];
  const source = body(mdx);
  const buildsOn = lesson.buildsOn ?? [];

  const found = MARKERS.map((entry) => ({ ...entry, at: source.search(entry.tag) })).filter(
    (entry) => entry.at >= 0,
  );
  const required = new Set<Marker>(profile.required);
  if (buildsOn.length > 0 && (kind === 'lesson' || kind === 'case-study')) required.add('recall');
  for (const entry of MARKERS) {
    if (required.has(entry.marker) && !found.some((hit) => hit.marker === entry.marker)) {
      issues.push({ rule: 'required', message: `add a ${entry.label} section` });
    }
  }
  for (let i = 1; i < found.length; i++) {
    const before = found[i - 1];
    const after = found[i];
    if (before && after && after.at < before.at) {
      issues.push({
        rule: 'order',
        message: `${after.label} comes before ${before.label}; the template order is ${MARKERS.map((entry) => entry.label).join(', ')}`,
      });
    }
  }

  if (profile.h2) {
    const h2 = countH2(source);
    if (h2 < profile.h2[0] || h2 > profile.h2[1]) {
      issues.push({ rule: 'h2', message: `${h2} h2 sections; a ${kind} has ${range(profile.h2)}` });
    }
  }

  const core = lessonStats(corePath(mdx));
  if (profile.maxSims !== undefined && core.sims > profile.maxSims) {
    issues.push({
      rule: 'sims',
      message: `${core.sims} simulations in the core path; a ${kind} has at most ${profile.maxSims}, so move the rest into a "Go deeper" <details>`,
    });
  }
  if (profile.words && (core.words < profile.words[0] || core.words > profile.words[1])) {
    issues.push({
      rule: 'words',
      message: `${core.words} words in the core path; a ${kind} has ${range(profile.words)}`,
    });
  }

  const computed = computeMinutes(mdx, lesson.drillMinutes);
  if (!minutesAgree(lesson.minutes, computed)) {
    issues.push({
      rule: 'minutes',
      message: `curriculum declares ${lesson.minutes} minutes but the page computes ${computed}`,
    });
  }

  const links = linkedLessons(source, lesson.id, known);
  if (links.length < profile.minLinks) {
    issues.push({
      rule: 'links',
      message: `${links.length} links to other lessons; a ${kind} needs at least ${profile.minLinks}`,
    });
  }
  if (buildsOn.length > 0 && !links.some((target) => buildsOn.includes(target))) {
    issues.push({ rule: 'links', message: `link to a lesson it builds on (${buildsOn.join(', ')})` });
  }

  const ids = questionIds(source);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push({ rule: 'ids', message: `question id "${id}" appears twice` });
    seen.add(id);
    if (!QUESTION_ID.test(id) || !id.startsWith(`${lesson.id}/`)) {
      issues.push({ rule: 'ids', message: `question id "${id}" should look like "${lesson.id}/q1"` });
    }
  }

  return issues;
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const legacy = new Set<string>(
    JSON.parse(readFileSync(new URL('./lesson-lint-legacy.json', import.meta.url), 'utf8')),
  );
  const known = new Set(allLessons.map((lesson) => lesson.id));
  let errors = 0;
  let warnings = 0;
  for (const lesson of allLessons) {
    const mdx = readFileSync(new URL(`../src/content/docs/${lesson.id}.mdx`, import.meta.url), 'utf8');
    const issues = lintLesson(lesson, mdx, known);
    const level = legacy.has(lesson.id) ? 'warning' : 'error';
    if (level === 'error') errors += issues.length;
    else warnings += issues.length;
    if (issues.length === 0 && legacy.has(lesson.id) && !quiet) {
      process.stdout.write(
        `note     ${lesson.id}: passes the template, so remove it from lesson-lint-legacy.json\n`,
      );
    }
    if (quiet && level === 'warning') continue;
    for (const issue of issues) {
      process.stdout.write(`${level.padEnd(8)} ${lesson.id} [${issue.rule}] ${issue.message}\n`);
    }
  }
  if (errors > 0 || !quiet) {
    process.stdout.write(
      `Lesson lint: ${errors} errors, ${warnings} warnings in ${allLessons.length} lessons\n`,
    );
  }
  if (errors > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
