import { describe, expect, it } from 'vitest';
import { allLessons, findLesson } from '../../src/data/curriculum';
import { studyPlans } from '../../src/data/studyPlans';

const courseIndex = (id: string) => allLessons.findIndex((lesson) => lesson.id === id);
const interviewStaples = [
  'reliability/rate-limiting',
  'reliability/idempotency',
  'distributed-data/cap-and-pacelc',
  'distributed-data/quorums',
];

describe('study plans', () => {
  it('has unique plan ids', () => {
    const ids = studyPlans.map((plan) => plan.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the interview staples in the interview plan', () => {
    const plan = studyPlans.find((candidate) => candidate.id === 'interview-week');
    const ids = plan?.sessions.flatMap((session) => session.lessons) ?? [];
    for (const id of interviewStaples) expect(ids, id).toContain(id);
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

      it('teaches every prerequisite earlier in the same plan', () => {
        for (const [index, id] of ids.entries()) {
          for (const prerequisite of findLesson(id)?.buildsOn ?? []) {
            expect(ids.slice(0, index), `${id} builds on ${prerequisite}`).toContain(prerequisite);
          }
        }
      });

      it('keeps every sitting within 10 percent of its named time', () => {
        for (const session of plan.sessions) {
          const minutes = session.lessons.reduce((sum, id) => {
            return sum + (findLesson(id)?.minutes ?? 0);
          }, 0);
          expect(minutes, session.label).toBeLessThanOrEqual(plan.sessionMinutes * 1.1);
        }
      });
    });
  }
});
