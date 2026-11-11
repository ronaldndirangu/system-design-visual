import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allLessons, anchorFor, curriculum, findModule, readyLessons } from '../../src/data/curriculum';

const docsDir = fileURLToPath(new URL('../../src/content/docs/', import.meta.url));
const lessonFile = (id: string) => `${docsDir}${id}.mdx`;

describe('curriculum', () => {
  it('has unique lesson ids and module numbers in order', () => {
    const ids = allLessons.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(curriculum.map((module) => module.number)).toEqual(curriculum.map((_, index) => index));
  });

  it('nests each lesson under its own module folder', () => {
    for (const module of curriculum) {
      for (const lesson of module.lessons) expect(lesson.id.startsWith(`${module.id}/`)).toBe(true);
    }
  });

  it('has an MDX file for every ready lesson', () => {
    expect(readyLessons.length).toBeGreaterThanOrEqual(6);
    for (const lesson of readyLessons) expect(existsSync(lessonFile(lesson.id)), lesson.id).toBe(true);
  });

  it('has no page yet for lessons marked coming soon', () => {
    for (const lesson of allLessons.filter((item) => item.status === 'soon')) {
      expect(existsSync(lessonFile(lesson.id)), lesson.id).toBe(false);
    }
  });

  it('builds URL-safe anchors', () => {
    for (const lesson of allLessons) expect(anchorFor(lesson.id)).toMatch(/^[a-z0-9-]+$/);
  });

  it('points bestAfter at an earlier module', () => {
    for (const module of curriculum) {
      for (const lesson of module.lessons.filter((item) => item.bestAfter)) {
        const prerequisite = findModule(lesson.bestAfter as string);
        expect(prerequisite, lesson.id).toBeDefined();
        expect(prerequisite?.number, lesson.id).toBeLessThan(module.number);
      }
    }
  });

  it('keeps ready cards short', () => {
    for (const lesson of readyLessons.filter((item) => item.format === 'card')) {
      expect(lesson.minutes, lesson.id).toBeLessThanOrEqual(10);
    }
  });
});
