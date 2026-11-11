import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allLessons, anchorFor, curriculum, findModule } from '../../src/data/curriculum';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const docsDir = fileURLToPath(new URL('../../src/content/docs/', import.meta.url));
const lessonFile = (id: string) => `${docsDir}${id}.mdx`;
const filesUnder = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/'));

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

  it('has an MDX page for every lesson', () => {
    for (const lesson of allLessons) expect(existsSync(lessonFile(lesson.id)), lesson.id).toBe(true);
  });

  it('lists every page in a module folder in the curriculum', () => {
    const ids = new Set(allLessons.map((lesson) => lesson.id));
    for (const module of curriculum) {
      const folder = `${docsDir}${module.id}`;
      if (!existsSync(folder)) continue;
      for (const file of readdirSync(folder).filter((name) => name.endsWith('.mdx'))) {
        const id = `${module.id}/${file.replace(/\.mdx$/, '')}`;
        expect(ids.has(id), id).toBe(true);
      }
    }
  });

  it('never promises content that is coming soon', () => {
    const offenders = filesUnder(srcDir).filter((file) => /coming soon/i.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
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

  it('keeps cards short', () => {
    for (const lesson of allLessons.filter((item) => item.format === 'card')) {
      expect(lesson.minutes, lesson.id).toBeLessThanOrEqual(10);
    }
  });
});
