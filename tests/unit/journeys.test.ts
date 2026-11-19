import { describe, expect, it } from 'vitest';
import { conceptMetadata } from '../../src/data/conceptMetadata';
import { concepts } from '../../src/data/concepts';
import {
  guidedContinueTarget,
  journeyProgress,
  journeys,
  learningDone,
  learningPage,
  learningStatus,
  stagePages,
} from '../../src/data/journeys';
import { emptyProgress, parseProgress, questionSetFingerprint } from '../../src/lib/progress';

const existingLearner =
  '{"version":3,"lessons":{"thinking/anatomy-of-a-web-app":{"completedAt":"2026-11-17T18:58:14.161Z"}},"last":"thinking/anatomy-of-a-web-app"}';

describe('guided journeys', () => {
  it('resumes an existing lesson learner without requiring new fields', () => {
    const data = parseProgress(existingLearner);
    expect(guidedContinueTarget(data, conceptMetadata)?.id).toBe('thinking/requirements-and-estimates');
    expect(data.lessons['thinking/anatomy-of-a-web-app']?.completedAt).toBe('2026-11-17T18:58:14.161Z');
    expect(guidedContinueTarget(emptyProgress(), conceptMetadata)).toBeNull();
  });

  it('connects each real scenario to existing concepts and deeper lessons without duplicate milestones', () => {
    expect(journeys.map((journey) => journey.id)).toEqual(['search', 'distributed-storage', 'chat', 'feeds']);
    for (const journey of journeys) {
      const pages = journey.stages.flatMap(stagePages);
      expect(new Set(pages).size).toBe(pages.length);
      expect(pages.slice(0, 3)).toEqual([
        'concepts/latency-throughput',
        'concepts/availability',
        'concepts/scaling',
      ]);
      expect(pages.at(-1)).toMatch(/^case-studies\//);
      for (const page of pages) expect(learningPage(page, conceptMetadata).title).toBeTruthy();
      for (const stage of journey.stages) {
        expect(stage.problem && stage.decision && stage.consequence).toBeTruthy();
        if (stage.deeper) expect(learningPage(stage.deeper, conceptMetadata).format).toBe('Deeper lesson');
      }
    }
  });

  it('shares mastery across systems and progresses from basics to scenario completion', () => {
    const data = parseProgress(existingLearner);
    for (const journey of journeys) {
      data.journey = journey.id;
      data.resume = `journeys/${journey.id}`;
      for (const page of journey.stages.flatMap(stagePages)) {
        if (page.startsWith('concepts/')) {
          const entry = concepts.find((item) => `concepts/${item.slug}` === page);
          if (!entry) throw new Error(page);
          data.lessons[page] = {
            quizLast: { score: 2, total: 2, set: questionSetFingerprint(entry.quiz) },
          };
        } else {
          expect(journeyProgress(journey, data, conceptMetadata).stage).toBe(3);
          expect(guidedContinueTarget(data, conceptMetadata)?.id).toBe(page);
          data.lessons[page] = { completedAt: '2026-11-18T00:00:00Z' };
        }
      }
      expect(journeyProgress(journey, data, conceptMetadata).next).toBeUndefined();
      expect(guidedContinueTarget(data, conceptMetadata)?.id).toBe('journeys');
    }
    expect(data.last).toBe('thinking/anatomy-of-a-web-app');
  });

  it('does not count an old perfect score or a later failed attempt as current mastery', () => {
    const data = emptyProgress();
    const entry = concepts[0];
    if (!entry) throw new Error('Concept registry is empty');
    const id = `concepts/${entry.slug}`;
    data.lessons[id] = {
      quizBest: { score: 2, total: 2, set: 'earlier-questions' },
      quizLast: { score: 2, total: 2, set: 'earlier-questions' },
      completedAt: '2026-11-17T00:00:00Z',
    };
    expect(learningStatus(data, id, conceptMetadata)).toBe('Attempted');
    data.lessons[id].quizLast = { score: 1, total: 2, set: questionSetFingerprint(entry.quiz) };
    expect(learningDone(data, id, conceptMetadata)).toBe(false);
    data.resume = id;
    expect(guidedContinueTarget(data, conceptMetadata)?.id).toBe(id);
    data.lessons[id].quizLast.score = 2;
    expect(guidedContinueTarget(data, conceptMetadata)?.id).toBe('journeys');
  });
});
