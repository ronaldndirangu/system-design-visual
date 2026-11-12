import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { choiceOrder } from '../../src/lib/choiceOrder';

const docsDir = fileURLToPath(new URL('../../src/content/docs/', import.meta.url));
const lessons = readdirSync(docsDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
  .map((entry) => join(entry.parentPath, entry.name));

interface Question {
  file: string;
  id: string | undefined;
  ordered: boolean;
  count: number;
  answer: number;
  corrects: number;
  texts: string[];
}

const evaluate = (source: string | undefined) => new Function(`return ${source}`)();

const quizzes: Question[] = [];
const predicts: Question[] = [];
for (const file of lessons) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('<Quiz')) {
    const block = text.match(/export const quiz = (\[[\s\S]*?\n\]);/);
    if (!block) throw new Error(`${file} renders <Quiz> without an "export const quiz" array`);
    for (const q of evaluate(block[1]) as {
      id?: string;
      ordered?: boolean;
      options: { text: string; correct?: boolean }[];
    }[]) {
      quizzes.push({
        file,
        id: q.id,
        ordered: q.ordered === true,
        count: q.options.length,
        answer: q.options.findIndex((option) => option.correct),
        corrects: q.options.filter((option) => option.correct).length,
        texts: q.options.map((option) => option.text),
      });
    }
  }
  for (const tag of text.matchAll(/<Predict\b([\s\S]*?)\n>/g)) {
    const attrs = tag[1] ?? '';
    const options = attrs.match(/\boptions=\{(\[[\s\S]*?\])\}/);
    const answer = attrs.match(/\banswer=\{(\d+)\}/);
    if (!options || !answer) throw new Error(`${file} has a <Predict> without options or answer`);
    const texts = evaluate(options[1]) as string[];
    predicts.push({
      file,
      id: attrs.match(/\bid="([^"]*)"/)?.[1],
      ordered: /^\s*ordered\s*$/m.test(attrs),
      count: texts.length,
      answer: Number(answer[1]),
      corrects: 1,
      texts,
    });
  }
}

const leadingNumber = (text: string) => {
  const match = text.match(/^(?:about|around|roughly|under|over|~|≈|\$)?\s*(\d[\d,]*(?:\.\d+)?)/i);
  return match ? Number(match[1]?.replaceAll(',', '')) : undefined;
};

// A scale is 3 or more leading numbers in steady order, plus at most one first or last bookend such as "All of them".
function looksLikeScale(texts: string[]) {
  const numbers = texts.map(leadingNumber);
  const inner = numbers.slice(1, -1);
  if (inner.some((value) => value === undefined)) return false;
  const values = numbers.filter((value) => value !== undefined);
  if (values.length < 3 || values.length < texts.length - 1) return false;
  const steps = values.slice(1).map((value, index) => Math.sign(value - (values[index] ?? 0)));
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

const displayedCorrect = (q: Question) => choiceOrder(q.id ?? '', 0, q.count, q.ordered).indexOf(q.answer);

function maxPositionShare(questions: Question[]) {
  const counts = new Map<number, number>();
  for (const q of questions) counts.set(displayedCorrect(q), (counts.get(displayedCorrect(q)) ?? 0) + 1);
  return Math.max(...counts.values()) / questions.length;
}

describe('lesson questions', () => {
  it('finds every quiz question and prediction', () => {
    expect(quizzes.length).toBeGreaterThan(200);
    expect(predicts.length).toBeGreaterThan(80);
  });

  it('gives every question a stable, unique id', () => {
    const all = [...quizzes, ...predicts];
    const missing = all.filter((q) => !q.id).map((q) => q.file);
    expect(missing).toEqual([]);
    for (const q of all) expect(q.id).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)+$/);
    const ids = all.map((q) => q.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('marks exactly one right answer per question', () => {
    for (const q of [...quizzes, ...predicts]) {
      expect(q.corrects, q.id).toBe(1);
      expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answer, q.id).toBeLessThan(q.count);
    }
  });

  it('marks numeric scales as ordered so shuffling never scrambles them', () => {
    const scrambled = [...quizzes, ...predicts]
      .filter((q) => !q.ordered && looksLikeScale(q.texts))
      .map((q) => q.id);
    expect(scrambled).toEqual([]);
  });

  it('spreads right answers so no display position holds more than 40%', () => {
    expect(maxPositionShare(quizzes)).toBeLessThanOrEqual(0.4);
    expect(maxPositionShare(predicts)).toBeLessThanOrEqual(0.4);
  });
});

describe('choiceOrder', () => {
  const ids = [...quizzes, ...predicts].map((q) => q.id ?? '');

  it('returns the same permutation for the same id and attempt', () => {
    for (const id of ids) {
      const order = choiceOrder(id, 0, 4);
      expect(choiceOrder(id, 0, 4)).toEqual(order);
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
    }
  });

  it('shows a different order on every retry', () => {
    for (const id of ids.slice(0, 40)) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const order = choiceOrder(id, attempt, 4);
        expect(order).not.toEqual(choiceOrder(id, attempt - 1, 4));
        expect([...order].sort()).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it('keeps ordered options in sequence and flips direction on retry', () => {
    for (const id of ids.slice(0, 40)) {
      const first = choiceOrder(id, 0, 4, true);
      expect([
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ]).toContainEqual(first);
      expect(choiceOrder(id, 1, 4, true)).toEqual([...first].reverse());
      expect(choiceOrder(id, 2, 4, true)).toEqual(first);
    }
  });

  it('leaves a single option in place', () => {
    expect(choiceOrder('any/q1', 3, 1)).toEqual([0]);
  });
});
