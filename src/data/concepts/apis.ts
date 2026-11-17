import type { Concept } from './types';

const apis: Concept = {
  slug: 'apis',
  group: 'communication',
  title: 'APIs',
  definition: 'An API is a contract that lists the requests a server accepts and what each one returns.',
  analogy: 'a restaurant menu: it lists what you can order, and the kitchen can change behind it.',
  lesson: 'foundations/apis',
  illustrative: true,
  labels: {
    client: 'Client',
    server: 'Server',
    get: 'GET /users/42',
    ok: '200 + JSON',
    post: 'POST /orders',
    created: '201 Created',
    call: 'getUser(42)',
    user: 'User 42',
    place: 'placeOrder(7)',
    order: 'Order 7',
  },
  states: {
    without: {
      label: 'REST',
      title: 'A REST API',
      description:
        'The client sends GET /users/42 and the server answers 200 with JSON. Then the client sends POST /orders and the server answers 201 Created. Each request names a resource with a URL and acts on it with an HTTP verb.',
      captions: [
        'A URL and a verb name the request',
        'The server replies with a status code and data',
        'Every resource uses the same few verbs',
      ],
    },
    with: {
      label: 'RPC',
      title: 'An RPC API',
      description:
        'The client calls getUser(42) and gets back user 42. Then it calls placeOrder(7) and gets back order 7. Each action is a named function on the server.',
      captions: [
        'Call a server function by name',
        'The result returns like a local call',
        'Each action is its own function',
      ],
    },
  },
  steps: [
    'REST: URLs name resources, and HTTP verbs like GET and POST act on them.',
    'RPC: the client calls named server functions, like getUser(42), as if they were local.',
    'Either way, the server checks the request and replies with data or an error.',
  ],
  example: {
    title: 'A profile with 4 orders',
    lines: [
      'Plain REST: 1 user call + 4 order calls = 5 calls.',
      'One after another at 100 ms each: 5 × 100 = 500 ms.',
      'One GraphQL query, or one RPC built for the screen: about 100 ms.',
    ],
  },
  variants: [
    {
      name: 'GraphQL',
      caption: 'One query asks for exactly the fields a screen needs.',
      description:
        'Left: a client makes three REST calls to fill one screen. Right: a client sends one GraphQL query and gets every field back in one reply.',
      labels: { rest: 'REST', gql: 'GraphQL' },
    },
    {
      name: 'gRPC',
      caption: 'Typed functions from a shared schema, sent as compact binary.',
      description:
        'A client and a server share one .proto schema file, and the client calls the server’s typed functions over HTTP/2.',
      labels: { schema: '.proto' },
    },
  ],
  tradeoffs: {
    useWhen:
      'other programs need your data: REST for public APIs, RPC such as gRPC between your own services.',
    costs: 'a contract to keep stable; REST may need many round trips, and RPC needs shared tooling.',
    realExample: 'the GitHub API, offered as both REST and GraphQL.',
    watchOut: 'version your API; renaming or removing a field breaks older clients.',
  },
  quiz: [
    {
      id: 'concepts/apis/q1',
      prompt: 'Which REST request fetches order 7?',
      options: [
        {
          text: 'POST /getOrder?id=7',
          why: 'REST puts the action in the verb. POST usually creates something, and the URL should name the order.',
        },
        {
          text: 'GET /orders/7',
          correct: true,
          why: 'The URL names the resource, order 7, and GET reads it.',
        },
        {
          text: 'FETCH /order',
          why: 'FETCH is not an HTTP verb, and the URL does not say which order.',
        },
      ],
    },
    {
      id: 'concepts/apis/q2',
      prompt: 'What does GraphQL add over plain REST?',
      options: [
        {
          text: 'Compact binary calls',
          why: 'That describes gRPC. GraphQL usually sends JSON over HTTP.',
        },
        {
          text: 'Server push',
          why: 'Plain GraphQL queries are still request and reply.',
        },
        {
          text: 'One query gets exactly the fields a screen needs',
          correct: true,
          why: 'The client lists the fields it wants, so one round trip replaces several REST calls.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#rpc-and-rest-calls-comparison',
      label: 'RPC and REST calls comparison',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#rest-graphql-grpc',
      label: 'REST, GraphQL, gRPC',
    },
    {
      course: 'kleppmann',
      href: 'https://www.youtube.com/watch?v=S2osKiqQG9s',
      label: '1.3 RPC (Remote Procedure Call)',
    },
  ],
};

export default apis;
