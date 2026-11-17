import type { Concept } from './types';

const realTime: Concept = {
  slug: 'real-time',
  group: 'communication',
  title: 'Real-time updates',
  definition:
    'Real-time updates get new data to a client within moments, either by asking often (polling) or by keeping a connection open for pushes.',
  analogy:
    'checking your mailbox every five minutes versus a courier who rings the doorbell the moment a letter arrives.',
  lesson: 'foundations/real-time',
  illustrative: true,
  labels: {
    app: 'App',
    friend: 'Friend',
    server: 'Server',
    every: 'Every 5 s',
    empty: 'Empty',
    open: 'Open',
  },
  states: {
    without: {
      label: 'Polling',
      title: 'Polling',
      description:
        'The app asks the server for news every 5 seconds. Most answers come back empty. A friend’s new message reaches the server between two asks and waits there until the next one.',
      captions: [
        'The app asks again every 5 seconds',
        'Most answers are empty',
        'A new message waits for the next ask',
      ],
    },
    with: {
      label: 'WebSocket',
      title: 'A WebSocket',
      description:
        'The app opens one WebSocket connection to the server, and it stays open in both directions. Each time a friend sends a message, the server pushes it to the app at once.',
      captions: [
        'The app opens one connection',
        'It stays open in both directions',
        'The server pushes each message at once',
      ],
    },
  },
  steps: [
    'Polling: the app asks for news on a timer, such as every 5 seconds.',
    'Most polls come back empty, and news waits until the next poll.',
    'WebSocket: the app opens one connection that stays open both ways.',
    'The server pushes each message the moment it arrives.',
  ],
  example: {
    title: 'One hour of chat',
    lines: [
      'Polling every 5 s: 3,600 ÷ 5 = 720 requests per user.',
      'For 10,000 users: 7,200,000 requests, mostly empty.',
      'Each message waits up to 5 s, 2.5 s on average.',
      'WebSockets: 10,000 open connections, and messages arrive at once.',
    ],
  },
  variants: [
    {
      name: 'Long polling',
      caption: 'The server holds each request open until there is news.',
      description:
        'The app sends a request, and the server keeps it waiting. When a message arrives, the server answers, and the app asks again at once.',
      labels: { wait: 'Wait' },
    },
    {
      name: 'Server-sent events',
      caption: 'One long HTTP response streams updates from server to app.',
      description:
        'The app makes one request, and the server keeps the response open, sending updates down it.',
      labels: {},
    },
  ],
  tradeoffs: {
    useWhen: 'users expect updates within a second: chat, live scores, shared docs and dashboards.',
    costs: 'each open connection uses server memory, and load balancers must keep it alive.',
    realExample: 'the Slack app, which keeps a WebSocket open for new messages.',
    watchOut: 'connections drop, so reconnect with backoff and fetch what you missed.',
  },
  quiz: [
    {
      id: 'concepts/real-time/q1',
      prompt: 'An app polls every 10 s. How long does a new message wait, on average?',
      ordered: true,
      options: [
        {
          text: 'About 1 s',
          why: 'Messages arrive at random moments, so most wait much longer than that.',
        },
        {
          text: 'About 5 s',
          correct: true,
          why: 'A message waits anywhere from 0 to 10 s for the next poll, so half the interval on average.',
        },
        {
          text: 'About 10 s',
          why: 'That is the longest wait, for a message that lands just after a poll.',
        },
      ],
    },
    {
      id: 'concepts/real-time/q2',
      prompt: 'A dashboard only receives updates from the server. Which fits best?',
      options: [
        {
          text: 'Polling every second',
          why: 'It works, but it sends 3,600 requests an hour per viewer, most of them empty.',
        },
        {
          text: 'A WebSocket',
          why: 'It works, but the dashboard never uses the app-to-server direction.',
        },
        {
          text: 'Server-sent events',
          correct: true,
          why: 'They push one way over plain HTTP, and the browser reconnects on its own.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#long-polling-websockets-server-sent-events-sse',
      label: 'Long polling, WebSockets, Server-Sent Events (SSE)',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/shortlong-polling-sse-websocket/',
      label: 'Short/long polling, SSE, WebSocket',
    },
  ],
};

export default realTime;
