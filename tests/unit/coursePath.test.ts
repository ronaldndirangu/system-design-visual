import { describe, expect, it } from 'vitest';
import { casesAfter, coreLessons, coursePath, pathNeighbours } from '../../src/data/coursePath';
import { allLessons, curriculum } from '../../src/data/curriculum';

const pathIds = coursePath.map((page) => page.id);
const optional = allLessons.filter((lesson) => lesson.optional);
const cases = curriculum.find((module) => module.id === 'case-studies')?.lessons ?? [];

describe('course path', () => {
  it('leaves optional deep dives and case studies off the path', () => {
    expect(optional.length).toBeGreaterThan(0);
    for (const lesson of [...optional, ...cases]) expect(pathIds, lesson.id).not.toContain(lesson.id);
  });

  it('lists every core lesson exactly once', () => {
    for (const lesson of coreLessons)
      expect(
        pathIds.filter((id) => id === lesson.id),
        lesson.id,
      ).toHaveLength(1);
  });

  it('surfaces each case study after the module its bestAfter names', () => {
    const surfaced = curriculum.flatMap((module) => casesAfter(module.id).map((lesson) => lesson.id));
    const withBestAfter = cases.filter((lesson) => lesson.bestAfter).map((lesson) => lesson.id);
    expect(surfaced.sort()).toEqual(withBestAfter.sort());
  });

  it('sends optional lessons and case studies back onto the path', () => {
    for (const lesson of [...optional, ...cases]) {
      const neighbours = pathNeighbours(lesson.id);
      expect(neighbours?.next, lesson.id).toBeDefined();
      expect(pathIds, lesson.id).toContain(neighbours?.next?.id);
      expect(pathIds, lesson.id).toContain(neighbours?.prev?.id);
    }
  });

  it('returns a case study to the last core lesson of its module', () => {
    const shortener = pathNeighbours('case-studies/shortener-at-scale');
    expect(shortener?.prev?.id).toBe('scaling/consistent-hashing');
    expect(shortener?.next?.id).toBe('reliability/timeouts');
  });
});
