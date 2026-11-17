import type { Concept } from './types';

const reverseProxy: Concept = {
  slug: 'reverse-proxy',
  group: 'traffic',
  title: 'Reverse proxy',
  definition:
    'A reverse proxy is a single front door for your servers that takes every request and forwards it to the right service.',
  analogy: 'a hotel front desk: guests talk to one desk, and staff behind it handle each request.',
  lesson: 'scaling/load-balancing',
  illustrative: true,
  labels: {
    client: 'Client',
    proxy: 'Proxy',
    web: 'Web',
    api: 'API',
    images: 'Images',
    tls: 'TLS',
    cache: 'Cache',
    apiPath: '/api',
    imgPath: '/img',
    private: 'Private',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without a reverse proxy',
      description:
        'The client calls the web, API and image services directly. Each service sets up its own TLS encryption, and every one of them is open to the internet.',
      captions: [
        'The client calls each service directly',
        'Every service handles its own TLS',
        'Every service is open to the internet',
      ],
    },
    with: {
      label: 'With',
      title: 'With a reverse proxy',
      description:
        'The client sends every request to one proxy. The proxy ends TLS, sends /api requests to the API service and /img requests to the image service, and answers a repeat request from its cache. The services sit in a private network.',
      captions: [
        'One address takes every request',
        'The proxy ends TLS and routes by path',
        'It answers repeats from cache; services stay private',
      ],
    },
  },
  steps: [
    'Every request arrives at one public address: the proxy.',
    'The proxy decrypts TLS, so the services skip that work.',
    'It reads the path, such as /api or /img, and forwards to that service.',
    'It answers repeat requests from its cache.',
  ],
  example: {
    title: 'What the proxy saves',
    lines: [
      'Traffic: 1,000 requests a second.',
      'The cache answers 80%: 0.8 × 1,000 = 800 a second.',
      'The other 20% reach the services: 200 a second.',
      'TLS certificates to manage: 1 instead of 3.',
    ],
  },
  variants: [
    {
      name: 'API gateway',
      caption: 'A proxy that also checks keys and limits each client.',
      description:
        'An API gateway sits in front of services like a reverse proxy, and also checks each caller’s API key and applies rate limits before forwarding.',
      labels: { key: 'Key', limit: 'Limit' },
    },
    {
      name: 'Forward vs reverse',
      caption: 'A forward proxy acts for clients; a reverse proxy for servers.',
      description:
        'On the left, a forward proxy sits beside the clients and sends their requests out to the internet. On the right, a reverse proxy sits beside the servers and takes requests coming in.',
      labels: { forward: 'Forward', reverse: 'Reverse' },
    },
  ],
  tradeoffs: {
    useWhen: 'several services need one address, shared TLS, caching or routing by path.',
    costs: 'one extra network hop, and one more system to run.',
    realExample: 'NGINX, HAProxy and Envoy are common reverse proxies.',
    watchOut: 'one proxy is a single point of failure, so run at least two.',
  },
  quiz: [
    {
      id: 'concepts/reverse-proxy/q1',
      prompt: 'Your site runs three services. What do clients gain from a reverse proxy?',
      options: [
        {
          text: 'One address for every service',
          correct: true,
          why: 'The proxy is the single front door and routes each request inward.',
        },
        {
          text: 'An address per service',
          why: 'That is life without a proxy: one exposed address per service.',
        },
        { text: 'No more encryption', why: 'Clients still use TLS. The proxy decrypts it for the services.' },
      ],
    },
    {
      id: 'concepts/reverse-proxy/q2',
      prompt: 'Which one is a forward proxy?',
      options: [
        {
          text: 'An office proxy that filters staff browsing',
          correct: true,
          why: 'It acts for clients going out to the internet, which makes it a forward proxy.',
        },
        { text: 'NGINX in front of web servers', why: 'It acts for the servers, so it is a reverse proxy.' },
        {
          text: 'A load balancer for an API',
          why: 'It takes requests for servers, so it works as a reverse proxy.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#reverse-proxy-web-server',
      label: 'Reverse proxy (web server)',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#reverse-proxy',
      label: 'Reverse Proxy',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/proxy-vs-reverse-proxy/',
      label: 'Proxy vs Reverse Proxy',
    },
  ],
};

export default reverseProxy;
