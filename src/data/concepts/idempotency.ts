import type { Concept } from './types';

const idempotency: Concept = {
  slug: 'idempotency',
  group: 'reliability',
  title: 'Idempotency',
  definition:
    'An operation is idempotent when doing it twice has the same effect as doing it once, so retrying it is safe.',
  analogy: 'an elevator button: pressing it five times still brings one elevator.',
  lesson: 'reliability/idempotency',
  illustrative: true,
  labels: {
    app: 'App',
    server: 'Server',
    payments: 'Payments',
    keys: 'Keys',
    key: 'Key k7',
    lost: 'Lost',
    charged: 'Charged',
    once: '$5',
    twice: '$10',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without an idempotency key',
      description:
        'The app asks the server to buy something for 5 dollars. The server charges the card through the payment provider, but the reply is lost on the way back. The app retries, and the server charges the card a second time: 10 dollars in total.',
      captions: [
        'The app sends a $5 purchase',
        'The reply is lost; the app retries',
        'The server charges again: $10',
      ],
    },
    with: {
      label: 'With',
      title: 'With an idempotency key',
      description:
        'The app sends the purchase with key k7. The server claims k7 in its key store, charges 5 dollars, and saves the receipt under k7. The reply is lost, and the app retries with the same key. The server finds k7 and sends back the saved receipt without charging again.',
      captions: [
        'The purchase carries key k7',
        'The reply is lost; the retry reuses k7',
        'The server finds k7 and resends the receipt',
      ],
    },
  },
  steps: [
    'The app sends one random key with every try of a purchase.',
    'The server claims the key, charges the card and saves the receipt under it.',
    'The reply is lost; the retry carries the same key.',
    'The server finds the key and returns the saved receipt, charging nothing.',
  ],
  example: {
    title: 'A $5 purchase, retried 3\u00a0times',
    lines: [
      'Without a key: 4\u00a0tries can mean 4 × $5 = $20.',
      'With a key: 1\u00a0charge of $5, and the same receipt sent back 3 more times.',
    ],
  },
  variants: [
    {
      name: 'Set vs add',
      caption: 'Setting a value twice changes nothing; adding twice doubles it.',
      description:
        'Left: two requests both set a balance to 5, and it ends at 5. Right: two requests both add 5 to a balance of 0, and it ends at 10.',
      labels: { set: 'Set 5', add: 'Add 5', five: '5', ten: '10' },
    },
    {
      name: 'Dedupe messages',
      caption: 'A worker skips any message ID it has already seen.',
      description:
        'A queue delivers message 7 twice. The worker processes the first copy, records its ID in a store, and skips the second copy.',
      labels: { id: '#7' },
    },
  ],
  tradeoffs: {
    useWhen: 'a repeat would do harm, like a second charge or order.',
    costs: 'storing each key and result, plus a lookup per request.',
    realExample: 'Stripe’s API accepts an Idempotency-Key header and replays the saved response.',
    watchOut: 'two copies can arrive at once, so claim the key atomically first.',
  },
  quiz: [
    {
      id: 'concepts/idempotency/q1',
      prompt:
        'A retry arrives while the first try is still charging. The key is claimed. What should the server do?',
      options: [
        {
          text: 'Charge the card again',
          why: 'That is the double charge the key exists to prevent.',
        },
        {
          text: 'Send an empty receipt',
          why: 'There is no receipt yet, because the first payment is still running.',
        },
        {
          text: 'Reply that it is still in progress',
          correct: true,
          why: 'The claimed key shows a payment is running, so the server answers 409 Conflict and the app asks again later.',
        },
      ],
    },
    {
      id: 'concepts/idempotency/q2',
      prompt: 'Which request is idempotent without any key?',
      options: [
        {
          text: 'Set my email to sam@example.com',
          correct: true,
          why: 'Setting the same value twice leaves the same result.',
        },
        { text: 'Add $5 to the balance', why: 'Each repeat adds another $5.' },
        { text: 'Send a welcome email', why: 'Each repeat sends another email.' },
      ],
    },
  ],
  learnMore: [
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#idempotency',
      label: 'Idempotency',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/how-to-avoid-double-payment/',
      label: 'Avoiding double payment',
    },
    {
      course: 'kleppmann',
      href: 'https://www.youtube.com/watch?v=mBUCF1WGI_I',
      label: 'Replication and idempotence',
    },
  ],
};

export default idempotency;
