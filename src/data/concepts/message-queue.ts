import type { Concept } from './types';

const messageQueue: Concept = {
  slug: 'message-queue',
  group: 'communication',
  title: 'Message queue',
  definition:
    'A message queue holds jobs until a worker is free, so the sender replies at once and bursts wait their turn.',
  analogy: 'a kitchen’s order rail: waiters clip tickets and move on, and cooks take the next one when free.',
  lesson: 'reliability/queues-and-backpressure',
  illustrative: true,
  labels: {
    user: 'User',
    web: 'Web',
    email: 'Email',
    queue: 'Queue',
    worker: 'Worker',
    slow: '2 s',
    fast: '50 ms',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without a queue',
      description:
        'A user signs up, and the web server sends the welcome email itself before it replies, so the user waits about 2 seconds. When a burst of sign-ups arrives, requests pile up on the web server and some time out.',
      captions: [
        'The web server sends the email itself',
        'The user waits about 2 s',
        'A burst piles up and times out',
      ],
    },
    with: {
      label: 'With',
      title: 'With a queue',
      description:
        'A user signs up, and the web server adds an email job to a queue and replies in about 50 milliseconds. A worker takes jobs from the queue one at a time and sends the emails. During a burst, extra jobs wait in the queue.',
      captions: [
        'The web server queues a job',
        'The user gets a reply in 50 ms',
        'A worker sends emails; bursts wait in line',
      ],
    },
  },
  steps: [
    'The web server adds a job, like a welcome email, to the queue.',
    'It replies at once, without waiting for the email.',
    'A worker takes the next job and marks it done.',
    'If a worker crashes mid-job, the queue gives the job to another.',
  ],
  example: {
    title: 'A sign-up burst',
    lines: [
      '600 sign-ups in 1 minute, 10 per second; each email takes 2 s.',
      'No queue: 10 × 2 = 20 requests stuck at once.',
      'Queue: replies in 50 ms; 4 workers send 2 emails per second.',
      'The backlog clears in 600 ÷ 2 = 300 s.',
    ],
  },
  variants: [
    {
      name: 'Competing workers',
      caption: 'More workers drain the queue faster; each job goes to one.',
      description: 'One queue feeds three workers. Each job goes to one of them at a time.',
      labels: {},
    },
    {
      name: 'Dead-letter queue',
      caption: 'Jobs that keep failing move aside, so the rest keep flowing.',
      description:
        'A worker fails on one job again and again, so the job moves to a separate queue for failed jobs while the others continue.',
      labels: { dead: 'Failed' },
    },
  ],
  tradeoffs: {
    useWhen: 'slow work can finish after the reply: emails, thumbnails, reports, webhooks.',
    costs: 'another system to run, and results that land after the reply.',
    realExample: 'welcome emails queued on Amazon SQS or RabbitMQ for workers to send.',
    watchOut: 'most queues deliver at least once, so make jobs safe to run twice.',
  },
  quiz: [
    {
      id: 'concepts/message-queue/q1',
      prompt: 'Why is the reply faster with a queue?',
      options: [
        {
          text: 'The email sends faster',
          why: 'Each email still takes as long to send. It just happens later.',
        },
        {
          text: 'The reply comes before the email is sent',
          correct: true,
          why: 'Adding a job takes milliseconds, and a worker sends the email afterwards.',
        },
        {
          text: 'The queue skips the email',
          why: 'Every job still runs. The queue only holds it until a worker is free.',
        },
      ],
    },
    {
      id: 'concepts/message-queue/q2',
      prompt: 'Jobs arrive at 10 per second; workers finish 8. What happens to the queue?',
      options: [
        {
          text: 'It grows by 2 every second',
          correct: true,
          why: '10 in minus 8 out leaves 2 more each second. Add workers or slow the input.',
        },
        {
          text: 'It stays the same',
          why: 'It only stays steady when jobs leave as fast as they arrive.',
        },
        {
          text: 'It empties',
          why: 'It only empties when the workers finish more jobs than arrive.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#message-queues',
      label: 'Message queues',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#message-queues',
      label: 'Message Queues',
    },
  ],
};

export default messageQueue;
