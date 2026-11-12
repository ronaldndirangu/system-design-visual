import { describe, expect, it } from 'vitest';
import { findLesson } from '../../src/data/curriculum';
import { glossary } from '../../src/data/glossary';
import { topicGroups } from '../../src/data/topics';

const byTerm = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

describe('glossary', () => {
  it('links every term to a lesson that exists', () => {
    const missing = glossary.filter((entry) => !findLesson(entry.lesson)).map((entry) => entry.term);
    expect(missing).toEqual([]);
  });

  it('lists each term once, in alphabetical order', () => {
    const terms = glossary.map((entry) => entry.term);
    expect(new Set(terms.map((term) => term.toLowerCase())).size).toBe(terms.length);
    expect(terms).toEqual([...terms].sort(byTerm));
  });
});

describe('interview topics', () => {
  const topics = topicGroups.flatMap((group) => group.topics);

  it('points every topic at one or more lessons that exist', () => {
    for (const topic of topics) {
      expect(topic.lessons.length, topic.name).toBeGreaterThan(0);
      for (const id of topic.lessons) expect(findLesson(id), `${topic.name}: ${id}`).toBeDefined();
    }
  });

  it('names each topic once', () => {
    const names = topics.map((topic) => topic.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
