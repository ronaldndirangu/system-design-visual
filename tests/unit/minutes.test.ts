import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allLessons } from '../../src/data/curriculum';
import {
  computeMinutes,
  corePath,
  lessonStats,
  minutesAgree,
  minutesFor,
  questionArrays,
} from '../../src/lib/minutes';

const docsDir = fileURLToPath(new URL('../../src/content/docs/', import.meta.url));

describe('lesson minutes', () => {
  it('keeps every declared estimate within 25% of the computed time', () => {
    const drift = allLessons
      .map((lesson) => {
        const mdx = readFileSync(`${docsDir}${lesson.id}.mdx`, 'utf8');
        return {
          id: lesson.id,
          declared: lesson.minutes,
          computed: computeMinutes(mdx, lesson.drillMinutes),
        };
      })
      .filter(({ declared, computed }) => !minutesAgree(declared, computed))
      .map(({ id, declared, computed }) => `${id}: declares ${declared}, computes ${computed}`);
    expect(drift).toEqual([]);
  });

  it('counts prose and text-like strings, and skips frontmatter, imports and identifiers', () => {
    const mdx = [
      '---',
      'title: Ten words in the title never count toward reading time',
      '---',
      "import Quiz from '../../components/lesson/Quiz';",
      "import CacheWidget from '../../components/widgets/CacheWidget';",
      '',
      'One two three four.',
      '',
      '<CacheWidget mode="lru" label="five six seven" />',
      '',
      "export const quiz = [{ id: 'q1', question: 'eight nine ten?' }];",
      '',
      '<Quiz questions={quiz} />',
    ].join('\n');
    expect(lessonStats(mdx)).toEqual({ words: 10, sims: 1, questions: 1, predicts: 0 });
  });

  it('adds sim and check time to reading time', () => {
    expect(minutesFor({ words: 2000, sims: 2, questions: 4, predicts: 2 })).toBe(10 + 6 + 6);
    expect(minutesFor({ words: 0, sims: 0, questions: 0, predicts: 0 })).toBe(1);
  });

  it('counts each Quiz and Recall question, and skips other exported arrays', () => {
    const mdx = [
      "export const nodes = [{ id: 'a' }, { id: 'b' }];",
      'export const quiz = [',
      "  { id: 'm/x/q1', options: [{ text: 'A ] B' }] },",
      "  { id: 'm/x/q2', options: [] },",
      '];',
      "export const recall = [{ id: 'm/y/q1' }];",
      '<StepDiagram nodes={nodes} />',
      '<Recall questions={recall} />',
      '<Quiz questions={quiz} />',
    ].join('\n');
    expect(questionArrays(mdx)).toHaveLength(2);
    expect(lessonStats(mdx).questions).toBe(3);
  });

  it('skips Go deeper details blocks', () => {
    const deeper = `<details>\n<summary>Go deeper</summary>\n\n${'word '.repeat(600)}\n</details>`;
    expect(corePath('a <details>b <details>c</details> d</details> e')).toBe('a  e');
    expect(computeMinutes(`Read this.\n\n${deeper}`)).toBe(computeMinutes('Read this.'));
  });

  it('adds fixed drill time on top of the computed time', () => {
    expect(computeMinutes('Read this.', 20)).toBe(21);
  });

  it('tolerates a 25% gap and no more', () => {
    expect(minutesAgree(25, 20)).toBe(true);
    expect(minutesAgree(15, 20)).toBe(true);
    expect(minutesAgree(26, 20)).toBe(false);
    expect(minutesAgree(14, 20)).toBe(false);
  });
});
