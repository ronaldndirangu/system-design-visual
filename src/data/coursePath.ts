import { allLessons } from './curriculum';

export interface CoursePage {
  id: string;
  title: string;
}

/** Orientation pages first, then every lesson in course order. */
export const introPages: CoursePage[] = [
  { id: 'start-here', title: 'How this course works' },
  { id: 'curriculum', title: 'Course map' },
  { id: 'visual-language', title: 'Visual language' },
];

export const coursePath: CoursePage[] = [
  ...introPages,
  ...allLessons.map((lesson) => ({ id: lesson.id, title: lesson.title })),
];

export const firstLesson = allLessons[0];
