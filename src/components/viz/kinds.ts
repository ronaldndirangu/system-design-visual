export type ComponentKind =
  | 'client'
  | 'dns'
  | 'server'
  | 'loadBalancer'
  | 'cache'
  | 'database'
  | 'queue'
  | 'cdn'
  | 'model'
  | 'vectorIndex';

export interface KindInfo {
  name: string;
  shape: string;
  color: string;
  role: string;
}

/** The fixed visual language. CONTRIBUTING.md and the visual language page render from this. */
export const kinds: Record<ComponentKind, KindInfo> = {
  client: {
    name: 'Client',
    shape: 'Rounded rectangle with a screen icon',
    color: 'Blue',
    role: 'A browser or app that starts a request.',
  },
  dns: {
    name: 'DNS',
    shape: 'Card with a folded corner and a globe icon',
    color: 'Teal',
    role: 'Turns a name such as sho.rt into an IP address.',
  },
  server: {
    name: 'Server',
    shape: 'Rack box with side stripes',
    color: 'Violet',
    role: 'Runs your application code.',
  },
  loadBalancer: {
    name: 'Load balancer',
    shape: 'Hexagon with a split arrow',
    color: 'Amber',
    role: 'Spreads requests across servers and skips unhealthy ones.',
  },
  cache: {
    name: 'Cache',
    shape: 'Square with a dashed inner border and a lightning bolt',
    color: 'Rose',
    role: 'Keeps popular answers in memory for fast reads.',
  },
  database: {
    name: 'Database',
    shape: 'Cylinder',
    color: 'Green',
    role: 'Stores data durably on disk.',
  },
  queue: {
    name: 'Queue',
    shape: 'Pill with slots',
    color: 'Cyan',
    role: 'Holds work until a consumer is ready for it.',
  },
  cdn: {
    name: 'CDN',
    shape: 'Cloud',
    color: 'Sky blue',
    role: 'Serves content from locations close to people.',
  },
  model: {
    name: 'Model',
    shape: 'Chip with pins on both sides and a sparkle icon',
    color: 'Fuchsia',
    role: 'A machine learning model, such as a language model, that turns an input into a prediction or text.',
  },
  vectorIndex: {
    name: 'Vector index',
    shape: 'Slanted card with a scatter plot icon',
    color: 'Lime',
    role: 'Finds the stored items whose embeddings sit closest to a query.',
  },
};

export type NodeStatus = 'ok' | 'warn' | 'bad';

export const statusText: Record<NodeStatus, string> = {
  ok: 'Healthy',
  warn: 'Strained',
  bad: 'Down',
};
