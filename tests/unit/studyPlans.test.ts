import { describe, expect, it } from 'vitest';
import { allLessons, findLesson } from '../../src/data/curriculum';
import { plannedMinutes, studyPlans } from '../../src/data/studyPlans';

const courseIndex = (id: string) => allLessons.findIndex((lesson) => lesson.id === id);

describe('study plans', () => {
  it('has unique plan ids', () => {
    const ids = studyPlans.map((plan) => plan.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const plan of studyPlans) {
    describe(plan.id, () => {
      const ids = plan.sessions.flatMap((session) => session.lessons);

      it('lists only lessons from the course map, once each', () => {
        for (const id of ids) expect(findLesson(id), id).toBeDefined();
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('keeps lessons in course order', () => {
        const positions = ids.map(courseIndex);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      });

      it('fits every session inside its time budget', () => {
        for (const session of plan.sessions) {
          const minutes = session.lessons.reduce((sum, id) => {
            const lesson = findLesson(id);
            return lesson ? sum + plannedMinutes(lesson) : sum;
          }, 0);
          expect(minutes, session.label).toBeLessThanOrEqual(plan.sessionMinutes);
        }
      });
    });
  }
});
