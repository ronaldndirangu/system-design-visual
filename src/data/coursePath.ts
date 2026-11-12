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
