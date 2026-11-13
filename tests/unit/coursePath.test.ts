import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  casesAfter,
  checkpointFor,
  coreLessons,
  coursePath,
  pathContinueTarget,
  pathNeighbours,
} from '../../src/data/coursePath';
import { allLessons, curriculum } from '../../src/data/curriculum';
import { emptyProgress, type ProgressData } from '../../src/lib/progress';

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

describe('module checkpoints', () => {
  it('names a checkpoint page for every module with core lessons', () => {
    for (const module of curriculum.filter((candidate) => candidate.id !== 'case-studies')) {
      const checkpoint = checkpointFor(module.id);
      expect(checkpoint?.href, module.id).toBe(`/checkpoints/${module.id}/`);
      expect(checkpoint?.title, module.id).toContain(module.title);
      expect(existsSync(`src/content/docs/checkpoints/${module.id}.mdx`), module.id).toBe(true);
    }
  });

  it('has no checkpoint for case studies or unknown modules', () => {
    expect(checkpointFor('case-studies')).toBeUndefined();
    expect(checkpointFor('nope')).toBeUndefined();
  });
});

describe('pathContinueTarget', () => {
  const done = (...ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { completedAt: '2025-01-01T00:00:00.000Z' }]));
  const progress = (last: string | undefined, ...completed: string[]): ProgressData => ({
    ...emptyProgress(),
    lessons: done(...completed),
    ...(last ? { last } : {}),
  });
  const target = (data: ProgressData) => pathContinueTarget(data)?.id ?? null;
  const allCore = coreLessons.map((lesson) => lesson.id);

  it('shows nothing before the learner starts', () => {
    expect(target(emptyProgress())).toBeNull();
  });

  it('resumes the lesson opened last while it is unfinished', () => {
    expect(target(progress('scaling/caching'))).toBe('scaling/caching');
  });

  it('follows the core path after a completed lesson and skips optional deep dives', () => {
    expect(target(progress('foundations/unique-ids', 'foundations/unique-ids'))).toBe(
      'foundations/real-time',
    );
  });

  it('resumes an elective the learner opened and has not finished', () => {
    expect(target(progress('foundations/storage-engines', 'foundations/unique-ids'))).toBe(
      'foundations/storage-engines',
    );
  });

  it('returns from a completed elective to the core lesson after it', () => {
    expect(
      target(
        progress('foundations/storage-engines', 'foundations/unique-ids', 'foundations/storage-engines'),
      ),
    ).toBe('foundations/real-time');
  });

  it('returns from a completed case study to the concept after its module', () => {
    expect(target(progress('case-studies/shortener-at-scale', 'case-studies/shortener-at-scale'))).toBe(
      'reliability/timeouts',
    );
  });

  it('picks up an earlier skipped core lesson after the path ends', () => {
    const rest = allCore.filter((id) => id !== 'thinking/slos');
    expect(target(progress(allCore.at(-1), ...rest))).toBe('thinking/slos');
  });

  it('starts the path from the top when the last page is not a lesson', () => {
    expect(target(progress('nope', 'scaling/caching'))).toBe(coreLessons[0]?.id);
  });

  it('never assigns electives or case studies once the core path is done', () => {
    expect(target(progress(allCore.at(-1), ...allCore))).toBeNull();
    expect(
      target(progress('foundations/storage-engines', ...allCore, 'foundations/storage-engines')),
    ).toBeNull();
  });
});
