import { findLesson } from '../../data/curriculum';
import { lessonHref } from '../../lib/paths';
import { JOURNEY_LESSONS, type JourneyLessonLink } from './CourseJourney';

/** Titles and links for the journey, resolved at build time so the island does not ship the curriculum. */
export const journeyLessons: Record<string, JourneyLessonLink> = Object.fromEntries(
  JOURNEY_LESSONS.flatMap((id) => {
    const lesson = findLesson(id);
    return lesson ? [[id, { title: lesson.title, href: lessonHref(id) }]] : [];
  }),
);
