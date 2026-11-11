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
  /** Time available in one session. A unit test keeps every session inside it. */
  sessionMinutes: number;
  sessions: StudySession[];
}

export const studyPlans: StudyPlan[] = [
  {
    id: 'interview-week',
    title: 'Interview in a week',
    pace: 'About an hour a day for seven days',
    audience:
      'You have a system design interview coming up. Each day covers one layer of a typical answer, and the last day is a timed rehearsal.',
    sessionMinutes: 60,
    sessions: [
      {
        label: 'Day 1: size the problem',
        lessons: ['thinking/requirements-and-estimates', 'thinking/design-checklist', 'thinking/slos'],
      },
      {
        label: 'Day 2: the request path and the data',
        lessons: ['foundations/what-happens-when-you-click', 'foundations/apis', 'foundations/data-modeling'],
      },
      { label: 'Day 3: spread the load', lessons: ['scaling/load-balancing', 'scaling/caching'] },
      { label: 'Day 4: scale the database', lessons: ['scaling/read-replicas', 'scaling/sharding'] },
      {
        label: 'Day 5: survive overload',
        lessons: ['reliability/queues-and-backpressure', 'reliability/retries'],
      },
      {
        label: 'Day 6: consistency and a full case',
        lessons: ['distributed-data/consistency-models', 'case-studies/news-feed'],
      },
      { label: 'Day 7: rehearse', lessons: ['practice/timed-round', 'practice/design-review'] },
    ],
  },
  {
    id: 'weekend',
    title: 'One weekend',
    pace: 'Two sittings of about three hours',
    audience:
      'You want the big picture fast. Saturday grows the URL shortener from one server to a sharded fleet. Sunday keeps it alive under failure and ends with a practice round.',
    sessionMinutes: 180,
    sessions: [
      {
        label: 'Saturday: scale the URL shortener',
        lessons: [
          'thinking/requirements-and-estimates',
          'thinking/design-checklist',
          'thinking/access-patterns',
          'foundations/what-happens-when-you-click',
          'foundations/data-modeling',
          'scaling/load-balancing',
          'scaling/caching',
          'scaling/read-replicas',
          'scaling/sharding',
        ],
      },
      {
        label: 'Sunday: keep it running',
        lessons: [
          'reliability/timeouts',
          'reliability/queues-and-backpressure',
          'reliability/idempotency',
          'reliability/retries',
          'distributed-data/consistency-models',
          'case-studies/news-feed',
          'practice/timed-round',
        ],
      },
    ],
  },
  {
    id: 'two-weeks',
    title: 'Two weeks at 30 minutes a day',
    pace: 'One lesson a day for fourteen days',
    audience:
      'You prefer a steady habit. One short sitting a day takes you through the core path, one case study, and a practice round.',
    sessionMinutes: 30,
    sessions: [
      { label: 'Day 1', lessons: ['thinking/requirements-and-estimates', 'thinking/design-checklist'] },
      { label: 'Day 2', lessons: ['foundations/what-happens-when-you-click'] },
      { label: 'Day 3', lessons: ['foundations/apis'] },
      { label: 'Day 4', lessons: ['foundations/data-modeling'] },
      { label: 'Day 5', lessons: ['scaling/load-balancing'] },
      { label: 'Day 6', lessons: ['scaling/caching'] },
      { label: 'Day 7', lessons: ['scaling/read-replicas'] },
      { label: 'Day 8', lessons: ['scaling/sharding'] },
      { label: 'Day 9', lessons: ['reliability/timeouts'] },
      { label: 'Day 10', lessons: ['reliability/queues-and-backpressure'] },
      { label: 'Day 11', lessons: ['reliability/idempotency'] },
      { label: 'Day 12', lessons: ['reliability/retries'] },
      { label: 'Day 13', lessons: ['case-studies/news-feed'] },
      { label: 'Day 14', lessons: ['practice/timed-round'] },
    ],
  },
];
