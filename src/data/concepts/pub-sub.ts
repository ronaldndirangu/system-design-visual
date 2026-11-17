import type { Concept } from './types';

const pubSub: Concept = {
  slug: 'pub-sub',
  group: 'communication',
  title: 'Pub/sub',
  definition:
    'In pub/sub, a service publishes each event to a topic once, and every subscriber gets its own copy.',
  analogy:
    'a newsletter: the writer sends one issue, and the mailing service delivers a copy to every subscriber.',
  lesson: 'async/logs-and-pubsub',
  illustrative: true,
  labels: {
    orders: 'Orders',
    topic: 'Topic',
    email: 'Email',
    stock: 'Stock',
    stats: 'Stats',
    rewards: 'Rewards',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without pub/sub',
      description:
        'The order service calls the email, stock and stats services one by one. When the stats service is down, the order waits or fails. Adding a new rewards service means changing the order service to call it too.',
      captions: [
        'Orders calls each service itself',
        'If one is down, the order fails or waits',
        'Adding Rewards means changing Orders',
      ],
    },
    with: {
      label: 'With',
      title: 'With pub/sub',
      description:
        'The order service publishes one order placed event to a topic. The topic delivers a copy to the email, stock and stats services. A new rewards service subscribes to the topic and gets copies too, with no change to the order service.',
      captions: [
        'Orders publishes one event',
        'The topic copies it to every subscriber',
        'Rewards subscribes; Orders never changes',
      ],
    },
  },
  steps: [
    'The order service publishes an “order placed” event to a topic and moves on.',
    'The topic delivers a copy to every subscriber.',
    'Each subscriber, like email or stock, handles its copy at its own pace.',
    'A new service just subscribes; the publisher never changes.',
  ],
  example: {
    title: 'Placing one order',
    lines: [
      'Calling Email, Stock and Stats in turn: 3 × 100 ms = 300 ms.',
      'If each is up 99.9% of the time, all three are up 0.999³ ≈ 99.7%.',
      'Publishing once takes about 5 ms, and orders still work while Stats is down.',
    ],
  },
  variants: [
    {
      name: 'Queue or topic',
      caption: 'Queue: one worker per message. Topic: a copy for every subscriber.',
      description:
        'Left: a queue hands each message to one of two workers. Right: a topic sends a copy of each message to both subscribers.',
      labels: { queue: 'Queue', topic: 'Topic' },
    },
    {
      name: 'Log-based',
      caption: 'Events stay stored; each reader keeps its place and can rewind.',
      description:
        'Events sit in order in a stored log. Two readers point at different positions, and one moves back to read old events again.',
      labels: {},
    },
  ],
  tradeoffs: {
    useWhen: 'several services react to one event, and the publisher shouldn’t wait for them.',
    costs: 'harder tracing across services, and subscribers update a moment later.',
    realExample:
      'topics in Amazon SNS or Google Cloud Pub/Sub, which copy each message to every subscription.',
    watchOut: 'events can arrive twice or out of order, so subscribers must handle both.',
  },
  quiz: [
    {
      id: 'concepts/pub-sub/q1',
      prompt: 'A new Rewards service must react to orders. What changes in the order service?',
      options: [
        {
          text: 'Nothing; Rewards subscribes',
          correct: true,
          why: 'The publisher never lists its subscribers, so a new one only needs a subscription.',
        },
        {
          text: 'It calls Rewards too',
          why: 'That is the direct-call design pub/sub replaces.',
        },
        {
          text: 'It waits for Rewards',
          why: 'The publisher moves on as soon as the topic has the event.',
        },
      ],
    },
    {
      id: 'concepts/pub-sub/q2',
      prompt: 'One event reaches a topic with 3 subscribers. How many copies go out?',
      ordered: true,
      options: [
        {
          text: 'None until asked',
          why: 'The topic delivers to each subscription on its own.',
        },
        {
          text: 'One, shared',
          why: 'That is how a queue behaves: one worker gets each message.',
        },
        {
          text: 'Three, one each',
          correct: true,
          why: 'Each subscription gets its own copy of every event.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#publish-subscribe',
      label: 'Publish-Subscribe',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/the-ultimate-kafka-101-you-cannot-miss/',
      label: 'The Ultimate Kafka 101 You Cannot Miss',
    },
  ],
};

export default pubSub;
