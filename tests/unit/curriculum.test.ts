import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  allLessons,
  anchorFor,
  curriculum,
  findLesson,
  findModule,
  findModuleForLesson,
  lessonPosition,
  runningExampleFor,
} from '../../src/data/curriculum';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const docsDir = fileURLToPath(new URL('../../src/content/docs/', import.meta.url));
const lessonFile = (id: string) => `${docsDir}${id}.mdx`;
const filesUnder = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).replaceAll('\\', '/'));
const docsRoot = join(docsDir, '/').replaceAll('\\', '/');
const routeOf = (file: string) => {
  const slug = file.slice(docsRoot.length).replace(/\.mdx$/, '');
  return slug === 'index' ? '/' : `/${slug}/`;
};

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

  it('points every relative link in a page at another page', () => {
    const pages = filesUnder(docsDir).filter((file) => file.endsWith('.mdx'));
    const routes = new Set(pages.map(routeOf));
    const broken = pages.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\]\((\.{1,2}\/[^)\s#]*)/g)]
        .map((match) => new URL(match[1] as string, `https://site${routeOf(file)}`).pathname)
        .filter((target) => !routes.has(target))
        .map((target) => `${routeOf(file)} links to missing ${target}`),
    );
    expect(pages.length).toBeGreaterThan(50);
    expect(broken).toEqual([]);
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
      expect(lesson.minutes, lesson.id).toBeLessThanOrEqual(12);
    }
  });

  it('builds only on lessons a learner has already reached', () => {
    for (const module of curriculum) {
      const reachable = module.number;
      for (const lesson of module.lessons) {
        const position = lessonPosition(lesson.id) as number;
        const limit = lesson.bestAfter ? (findModule(lesson.bestAfter)?.number ?? -1) : reachable;
        for (const prerequisite of lesson.buildsOn ?? []) {
          const target = findModuleForLesson(prerequisite);
          expect(findLesson(prerequisite), `${lesson.id} -> ${prerequisite}`).toBeDefined();
          expect(target?.number, `${lesson.id} -> ${prerequisite}`).toBeLessThanOrEqual(limit);
          if (target?.id === module.id) {
            expect(lessonPosition(prerequisite), `${lesson.id} -> ${prerequisite}`).toBeLessThan(position);
          }
        }
      }
    }
  });

  it('links every lesson after the first to something it builds on', () => {
    const [first, ...rest] = allLessons;
    expect(first?.buildsOn).toBeUndefined();
    for (const lesson of rest) expect(lesson.buildsOn?.length, lesson.id).toBeGreaterThan(0);
  });

  it('marks exactly the difficulty 3 lessons as advanced', () => {
    for (const lesson of allLessons) expect(lesson.advanced, lesson.id).toBe(lesson.difficulty === 3);
  });

  it('names a running example only where a module shares one', () => {
    expect(runningExampleFor('scaling/caching')).toBe('URL shortener');
    expect(runningExampleFor('distributed-data/raft')).toBe('Chat');
    expect(runningExampleFor('case-studies/chat')).toBeUndefined();
    expect(runningExampleFor('practice/timed-round')).toBeUndefined();
  });
});
