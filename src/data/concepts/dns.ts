import type { Concept } from './types';

const dns: Concept = {
  slug: 'dns',
  group: 'basics',
  title: 'DNS',
  definition:
    'The Domain Name System (DNS) turns a name like example.com into the IP address computers use to connect.',
  analogy: 'your phone’s contacts: you tap a name, and the phone finds the number.',
  lesson: 'foundations/what-happens-when-you-click',
  illustrative: false,
  labels: {
    you: 'You',
    server: 'Server',
    oldIp: '203.0.113.7',
    newIp: '198.51.100.4',
    resolver: 'Resolver',
    root: 'Root',
    tld: '.com',
    authority: 'example.com',
    ttl: 'TTL 300 s',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without DNS',
      description:
        'You must type the server’s IP address, 203.0.113.7, to reach it. The server moves to a new address, 198.51.100.4, and your request to the old address fails.',
      captions: [
        'You must type the server’s IP address',
        'The server moves to a new IP',
        'The old address now fails',
      ],
    },
    with: {
      label: 'With',
      title: 'With DNS',
      description:
        'You ask a resolver for example.com. The resolver asks a root server, then the .com server, then example.com’s own server, which returns the IP address. The resolver hands it back to you and caches it for 300 seconds, so the next lookup answers at once.',
      captions: [
        'The resolver asks root, then .com',
        'The domain’s own server returns the IP',
        'The answer is cached for 300 s (TTL)',
      ],
    },
  },
  steps: [
    'You ask a resolver, often your internet provider’s, for example.com.',
    'The resolver asks a root server, which points it to .com.',
    'The .com server points it to example.com’s own server, which returns the IP.',
    'The resolver caches the answer for its time to live (TTL).',
  ],
  example: {
    title: 'Planning a server move',
    lines: [
      'TTL 300 s ÷ 60 = 5 minutes, so caches drop the old IP within 5 minutes.',
      'A TTL of 86,400 s (1 day) can keep the old IP for a day.',
      'So lower the TTL a day before you move.',
    ],
  },
  variants: [
    {
      name: 'Record types',
      caption: 'A gives an IPv4 address, AAAA an IPv6 one, CNAME another name.',
      description:
        'Three DNS records side by side: an A record points a name to an IPv4 address, an AAAA record to an IPv6 address, and a CNAME record to another name.',
      labels: { a: 'A', aaaa: 'AAAA', cname: 'CNAME', v4: 'IPv4', v6: 'IPv6', name: 'Name' },
    },
    {
      name: 'Geo DNS',
      caption: 'Each user gets the IP of the nearest region.',
      description:
        'One name returns different addresses by location: a user in Europe gets the IP of a European server, and a user in the US gets a US one.',
      labels: { eu: 'EU', us: 'US' },
    },
  ],
  tradeoffs: {
    useWhen: 'people should reach you by a name that stays put while servers change.',
    costs: 'a first lookup can add tens of milliseconds; cached repeats are almost instant.',
    realExample: 'public resolvers such as Cloudflare’s 1.1.1.1 and Google’s 8.8.8.8.',
    watchOut: 'if your DNS provider goes down, users cannot find you.',
  },
  quiz: [
    {
      id: 'concepts/dns/q1',
      prompt: 'A record’s TTL is 3,600 s. About how long until most users see a change?',
      ordered: true,
      options: [
        { text: '1 minute', why: 'Caches may keep the old answer for the full 3,600 s.' },
        { text: '1 hour', correct: true, why: '3,600 s ÷ 60 = 60 minutes, so about 1 hour.' },
        { text: '1 day', why: 'That would need a TTL of 86,400 s.' },
      ],
    },
    {
      id: 'concepts/dns/q2',
      prompt: 'You revisit a site 1 minute later; its TTL is 300 s. What does the resolver do?',
      options: [
        { text: 'Asks root again', why: 'The cached answer is still fresh, so there is nothing to look up.' },
        {
          text: 'Answers from its cache',
          correct: true,
          why: '1 minute is under 300 s, so the saved answer is still valid.',
        },
        {
          text: 'Waits for the TTL',
          why: 'The TTL only says how long to keep an answer. It never delays one.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#domain-name-system',
      label: 'Domain name system',
    },
    {
      course: 'karan',
      href: 'https://github.com/karanpratapsingh/system-design#domain-name-system-dns',
      label: 'Domain Name System (DNS)',
    },
  ],
};

export default dns;
