import type { Concept } from './types';

const failover: Concept = {
  slug: 'failover',
  group: 'reliability',
  title: 'Failover',
  definition:
    'Failover moves work to a standby copy when the primary fails, so the service keeps running after a short pause.',
  analogy: 'a co-pilot who takes the controls the moment the pilot cannot fly, so the flight carries on.',
  lesson: 'scaling/read-replicas',
  illustrative: true,
  labels: {
    app: 'App',
    primary: 'Primary',
    standby: 'Standby',
    promoted: 'New primary',
    heartbeat: 'Heartbeat',
  },
  states: {
    without: {
      label: 'Without',
      title: 'Without failover',
      description:
        'The app sends every request to one primary database. The primary fails, and every request after that fails until someone repairs it.',
      captions: [
        'Every request goes to the primary',
        'The primary fails',
        'Requests fail until someone fixes it',
      ],
    },
    with: {
      label: 'With',
      title: 'With failover',
      description:
        'The app sends requests to the primary database, which sends a regular heartbeat to a standby copy. The primary fails and the heartbeat stops. The standby is promoted to new primary, and the app sends its requests there.',
      captions: [
        'A heartbeat shows the primary is alive',
        'The primary fails and the heartbeat stops',
        'The standby takes over and traffic follows',
      ],
    },
  },
  steps: [
    'The primary serves requests and copies its data to a standby.',
    'A monitor checks for a heartbeat from the primary every second.',
    'After 3 missed heartbeats, the monitor promotes the standby to primary.',
    'Clients reconnect to the new primary, often through an updated DNS name.',
  ],
  example: {
    title: 'Automatic vs manual recovery',
    lines: [
      'Detect: 3\u00a0missed heartbeats, 1\u00a0s apart, take about 3\u00a0s.',
      'Promote and switch: about 7\u00a0s more, so 10\u00a0s of errors in total.',
      'A paged engineer might take 30\u00a0min (1,800\u00a0s): 180\u00a0times longer.',
    ],
  },
  variants: [
    {
      name: 'Active-passive',
      caption: 'One node serves; a standby waits to take over.',
      description:
        'Requests go to one active node. A second node receives its heartbeat and waits, serving nothing until it is promoted.',
      labels: { standby: 'Standby' },
    },
    {
      name: 'Active-active',
      caption: 'Both serve; if one fails, the other takes all traffic.',
      description:
        'Requests are split between two active nodes. When one fails, all requests go to the other, so it needs room for the full load.',
      labels: {},
    },
  ],
  tradeoffs: {
    useWhen: 'an outage costs more than running a spare copy.',
    costs: 'a second machine that mostly waits, and keeping its data current.',
    realExample:
      'Amazon RDS Multi-AZ promotes its standby automatically, typically within 60 to 120 seconds.',
    watchOut: 'a slow network can look like a dead primary, so fence off the old one.',
  },
  quiz: [
    {
      id: 'concepts/failover/q1',
      prompt: 'The primary copies writes to the standby a moment late, then crashes. What can go wrong?',
      options: [
        {
          text: 'The standby refuses reads',
          why: 'A promoted standby serves reads and writes as the new primary.',
        },
        {
          text: 'The newest writes may be lost',
          correct: true,
          why: 'Writes the primary accepted but had not copied yet never reached the standby.',
        },
        {
          text: 'Every earlier write is lost too',
          why: 'The standby holds everything copied before the crash. Only the newest writes are at risk.',
        },
      ],
    },
    {
      id: 'concepts/failover/q2',
      prompt: 'Your monitor fails over after 1 missed heartbeat. What is the risk?',
      options: [
        {
          text: 'A brief blip causes a needless failover',
          correct: true,
          why: 'One late heartbeat is common. Waiting for a few avoids replacing a healthy primary.',
        },
        {
          text: 'Failover takes much longer',
          why: 'A lower threshold makes failover start sooner.',
        },
        {
          text: 'The standby stops receiving data',
          why: 'Copying carries on. The threshold only decides when to switch.',
        },
      ],
    },
  ],
  learnMore: [
    {
      course: 'primer',
      href: 'https://github.com/donnemartin/system-design-primer#fail-over',
      label: 'Fail-over',
    },
    {
      course: 'bytebytego',
      href: 'https://bytebytego.com/guides/a-cheat-sheet-for-designing-fault-tolerant-systems/',
      label: 'Fault-tolerant systems',
    },
    {
      course: 'mit',
      href: 'https://pdos.csail.mit.edu/6.824/notes/l-raft.txt',
      label: 'Raft leader election',
    },
  ],
};

export default failover;
