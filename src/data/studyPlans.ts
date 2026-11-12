export interface StudySession {
  label: string;
  /** Lesson ids from curriculum.ts, in course order. */
  lessons: string[];
}

export interface StudyPlan {
  id: string;
  title: string;
  pace: string;
  audience: string;
  /** Time one sitting names. A unit test keeps every sitting within 1.1 times this. */
  sessionMinutes: number;
  sessions: StudySession[];
}

/**
 * Every plan is closed over `buildsOn`: a lesson's prerequisites appear earlier in the same plan.
 * `tests/unit/studyPlans.test.ts` enforces closure, course order and the sitting budget.
 */
export const studyPlans: StudyPlan[] = [
  {
    id: 'interview-week',
    title: 'Interview in a week',
    pace: 'About 90 minutes a day for seven days',
    audience:
      'You have a system design interview coming up. The week builds every layer an interviewer probes, from sizing to rate limits, idempotency, CAP and quorums, and the last day is a timed rehearsal.',
    sessionMinutes: 90,
    sessions: [
      {
        label: 'Day 1: size the problem',
        lessons: [
          'thinking/anatomy-of-a-web-app',
          'thinking/requirements-and-estimates',
          'thinking/design-checklist',
          'thinking/access-patterns',
          'thinking/slos',
        ],
      },
      {
        label: 'Day 2: the API and the data',
        lessons: [
          'foundations/what-happens-when-you-click',
          'foundations/apis',
          'foundations/data-modeling',
          'foundations/transactions',
        ],
      },
      {
        label: 'Day 3: storage and the load balancer',
        lessons: ['foundations/indexes', 'foundations/storage-engines', 'scaling/load-balancing'],
      },
      {
        label: 'Day 4: cache and scale the database',
        lessons: ['scaling/caching', 'scaling/cdn', 'scaling/read-replicas', 'scaling/sharding'],
      },
      {
        label: 'Day 5: place keys and survive overload',
        lessons: [
          'scaling/consistent-hashing',
          'reliability/timeouts',
          'reliability/queues-and-backpressure',
          'reliability/idempotency',
        ],
      },
      {
        label: 'Day 6: limits and consistency',
        lessons: [
          'reliability/retries',
          'reliability/rate-limiting',
          'distributed-data/consistency-models',
          'distributed-data/cap-and-pacelc',
        ],
      },
      {
        label: 'Day 7: quorums and a rehearsal',
        lessons: ['distributed-data/quorums', 'practice/timed-round', 'practice/design-review'],
      },
    ],
  },
  {
    id: 'weekend',
    title: 'One weekend',
    pace: 'Four sittings of about two and a half hours',
    audience:
      'You want the big picture fast. Saturday grows the URL shortener from one server to a sharded fleet. Sunday keeps it alive under failure and ends with a case study and a practice round.',
    sessionMinutes: 150,
    sessions: [
      {
        label: 'Saturday morning: frame the problem',
        lessons: [
          'thinking/anatomy-of-a-web-app',
          'thinking/requirements-and-estimates',
          'thinking/design-checklist',
          'thinking/access-patterns',
          'thinking/slos',
          'foundations/what-happens-when-you-click',
          'foundations/apis',
        ],
      },
      {
        label: 'Saturday afternoon: data and the first servers',
        lessons: [
          'foundations/data-modeling',
          'foundations/transactions',
          'foundations/indexes',
          'foundations/storage-engines',
          'scaling/load-balancing',
          'scaling/caching',
        ],
      },
      {
        label: 'Sunday morning: grow the fleet',
        lessons: [
          'scaling/cdn',
          'scaling/read-replicas',
          'scaling/sharding',
          'reliability/timeouts',
          'reliability/queues-and-backpressure',
          'reliability/idempotency',
        ],
      },
      {
        label: 'Sunday afternoon: keep it running',
        lessons: [
          'reliability/retries',
          'reliability/rate-limiting',
          'case-studies/news-feed',
          'practice/timed-round',
        ],
      },
    ],
  },
  {
    id: 'two-weeks',
    title: 'Two weeks at 30 minutes a day',
    pace: 'One short sitting a day for fourteen days',
    audience:
      'You prefer a steady habit. One short sitting a day takes you from requirements through caching and the reliability basics, then a practice round.',
    sessionMinutes: 30,
    sessions: [
      { label: 'Day 1', lessons: ['thinking/anatomy-of-a-web-app', 'thinking/requirements-and-estimates'] },
      { label: 'Day 2', lessons: ['thinking/design-checklist', 'thinking/access-patterns'] },
      { label: 'Day 3', lessons: ['thinking/slos'] },
      { label: 'Day 4', lessons: ['foundations/what-happens-when-you-click'] },
      { label: 'Day 5', lessons: ['foundations/apis'] },
      { label: 'Day 6', lessons: ['foundations/data-modeling'] },
      { label: 'Day 7', lessons: ['scaling/load-balancing'] },
      { label: 'Day 8', lessons: ['scaling/caching'] },
      { label: 'Day 9', lessons: ['scaling/cdn', 'scaling/object-storage'] },
      { label: 'Day 10', lessons: ['reliability/timeouts'] },
      { label: 'Day 11', lessons: ['reliability/queues-and-backpressure'] },
      { label: 'Day 12', lessons: ['reliability/idempotency'] },
      { label: 'Day 13', lessons: ['reliability/retries'] },
      { label: 'Day 14', lessons: ['practice/timed-round'] },
    ],
  },
];
