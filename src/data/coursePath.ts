import { hasStarted, isComplete, type ProgressData } from '../lib/progress';
import { allLessons, curriculum, type Lesson } from './curriculum';

export interface CoursePage {
  id: string;
  title: string;
}

/** Orientation pages come before every lesson. */
export const introPages: CoursePage[] = [
  { id: 'start-here', title: 'How this course works' },
  { id: 'curriculum', title: 'Course map' },
  { id: 'visual-language', title: 'Visual language' },
];

/** Case studies sit off the concept path; each one surfaces after the module named by its bestAfter. */
const CASE_MODULE = 'case-studies';

const toPage = (lesson: Lesson): CoursePage => ({ id: lesson.id, title: lesson.title });

/** Concept lessons in module order, without case studies or optional deep dives. */
export const coreLessons: Lesson[] = curriculum
  .filter((module) => module.id !== CASE_MODULE)
  .flatMap((module) => module.lessons.filter((lesson) => !lesson.optional));

/** The one learning path that Next, Previous, and the course start follow. */
export const coursePath: CoursePage[] = [...introPages, ...coreLessons.map(toPage)];

export const firstLesson = coreLessons[0];

/** Cases whose bestAfter names this module, in registry order. */
export function casesAfter(moduleId: string): Lesson[] {
  const cases = curriculum.find((module) => module.id === CASE_MODULE)?.lessons ?? [];
  return cases.filter((lesson) => lesson.bestAfter === moduleId);
}

/** The core lesson that closes a module, where the "Apply it now" card appears. */
export function lastCoreLessonOf(moduleId: string): Lesson | undefined {
  const module = curriculum.find((candidate) => candidate.id === moduleId);
  return module?.lessons.filter((lesson) => !lesson.optional).at(-1);
}

/** The module a core lesson closes, or undefined when another core lesson follows it in its module. */
export function moduleClosedBy(id: string): string | undefined {
  return curriculum.find((module) => module.id !== CASE_MODULE && lastCoreLessonOf(module.id)?.id === id)?.id;
}

export interface ModuleCheckpoint {
  /** Site path without the base, so callers apply withBase. */
  href: string;
  title: string;
}

/** The optional checkpoint quiz for a module, offered where it ends and on the course map. */
export function checkpointFor(moduleId: string): ModuleCheckpoint | undefined {
  const module = curriculum.find((candidate) => candidate.id === moduleId);
  if (!module) return undefined;
  return { href: `/checkpoints/${module.id}/`, title: `Checkpoint ${module.number}: ${module.title}` };
}

export interface PathNeighbours {
  prev?: CoursePage;
  next?: CoursePage;
}

/**
 * Previous and next pages for any page. Path pages use their path neighbours. An optional lesson
 * sits between the core lessons around it. A case study returns to the module it applies and
 * continues with the next concept after that module.
 */
export function pathNeighbours(id: string): PathNeighbours | undefined {
  const index = coursePath.findIndex((page) => page.id === id);
  if (index !== -1) return { prev: coursePath[index - 1], next: coursePath[index + 1] };

  const lesson = allLessons.find((candidate) => candidate.id === id);
  if (!lesson) return undefined;
  const anchor = lesson.bestAfter && !lesson.optional ? lastCoreLessonOf(lesson.bestAfter) : undefined;
  if (anchor) {
    const at = coursePath.findIndex((page) => page.id === anchor.id);
    return { prev: coursePath[at], next: coursePath[at + 1] };
  }

  const position = allLessons.indexOf(lesson);
  const before = allLessons
    .slice(0, position)
    .reverse()
    .find((candidate) => coreLessons.includes(candidate));
  const after = allLessons.slice(position + 1).find((candidate) => coreLessons.includes(candidate));
  return { prev: before && toPage(before), next: after && toPage(after) };
}

/**
 * Where Continue should go. An unfinished lesson the learner opened last comes first, including an
 * elective or case study. Otherwise the next unfinished core lesson along the path, wrapping to
 * earlier skipped ones. Electives and case studies are never assigned.
 */
export function pathContinueTarget(progress: ProgressData): CoursePage | null {
  const { last } = progress;
  if (!hasStarted(progress)) return null;

  const lastLesson = allLessons.find((lesson) => lesson.id === last);
  if (lastLesson && !isComplete(progress, lastLesson.id)) return toPage(lastLesson);

  let start = 0;
  if (lastLesson) {
    const onPath = coreLessons.indexOf(lastLesson);
    const resumeId = onPath === -1 ? pathNeighbours(lastLesson.id)?.next?.id : undefined;
    start =
      onPath !== -1
        ? onPath + 1
        : Math.max(
            0,
            coreLessons.findIndex((lesson) => lesson.id === resumeId),
          );
  }
  for (let offset = 0; offset < coreLessons.length; offset++) {
    const lesson = coreLessons[(start + offset) % coreLessons.length];
    if (lesson && !isComplete(progress, lesson.id)) return toPage(lesson);
  }
  return null;
}
