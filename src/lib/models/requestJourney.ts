/**
 * Where the time goes when a browser opens https://sho.rt/abc123.
 * Each network step costs round trips (RTT); the server adds its own time.
 */
export type Actor = 'browser' | 'dns' | 'server' | 'database';

export type StepId = 'dns' | 'tcp' | 'tls' | 'request' | 'lookup' | 'response';

export interface JourneyStep {
  id: StepId;
  label: string;
  from: Actor;
  to: Actor;
  startMs: number;
  durationMs: number;
  skipped: boolean;
  explanation: string;
}

export interface JourneyInputs {
  /** Round trip time between the browser and the shortener's servers. */
  rttMs: number;
  /** Round trip to the DNS resolver (usually your ISP or a public resolver). */
  dnsRttMs: number;
  dnsCached: boolean;
  connectionReused: boolean;
  tlsVersion: '1.2' | '1.3';
  serverMs: number;
  databaseMs: number;
}

export const distancePresets = [
  { id: 'city', label: 'Same city', rttMs: 10 },
  { id: 'continent', label: 'Same continent', rttMs: 40 },
  { id: 'ocean', label: 'Across an ocean', rttMs: 150 },
] as const;

export const defaultJourneyInputs: JourneyInputs = {
  rttMs: 40,
  dnsRttMs: 30,
  dnsCached: false,
  connectionReused: false,
  tlsVersion: '1.3',
  serverMs: 2,
  databaseMs: 5,
};

export function planJourney(inputs: JourneyInputs): JourneyStep[] {
  const steps: JourneyStep[] = [];
  let clock = 0;
  const add = (step: Omit<JourneyStep, 'startMs'>) => {
    steps.push({ ...step, startMs: clock });
    if (!step.skipped) clock += step.durationMs;
  };

  add({
    id: 'dns',
    label: 'DNS lookup',
    from: 'browser',
    to: 'dns',
    durationMs: inputs.dnsCached ? 0 : inputs.dnsRttMs,
    skipped: inputs.dnsCached,
    explanation: inputs.dnsCached
      ? 'The browser already knows the IP address for sho.rt, so it skips the lookup.'
      : 'The browser asks a DNS resolver which IP address belongs to sho.rt.',
  });
  add({
    id: 'tcp',
    label: 'TCP handshake',
    from: 'browser',
    to: 'server',
    durationMs: inputs.connectionReused ? 0 : inputs.rttMs,
    skipped: inputs.connectionReused,
    explanation: inputs.connectionReused
      ? 'An open connection from an earlier request gets reused, so there is no handshake.'
      : 'SYN, SYN-ACK, ACK: one round trip to agree on a connection.',
  });
  const tlsTrips = inputs.tlsVersion === '1.3' ? 1 : 2;
  add({
    id: 'tls',
    label: `TLS ${inputs.tlsVersion} handshake`,
    from: 'browser',
    to: 'server',
    durationMs: inputs.connectionReused ? 0 : inputs.rttMs * tlsTrips,
    skipped: inputs.connectionReused,
    explanation: inputs.connectionReused
      ? 'The reused connection is already encrypted.'
      : `Agree on encryption keys: ${tlsTrips} round trip${tlsTrips > 1 ? 's' : ''} with TLS ${inputs.tlsVersion}.`,
  });
  add({
    id: 'request',
    label: 'HTTP request',
    from: 'browser',
    to: 'server',
    durationMs: inputs.rttMs / 2 + inputs.serverMs,
    skipped: false,
    explanation: 'GET /abc123 travels to the server (half a round trip), which parses it.',
  });
  add({
    id: 'lookup',
    label: 'Database lookup',
    from: 'server',
    to: 'database',
    durationMs: inputs.databaseMs,
    skipped: false,
    explanation: 'The server looks up the long URL for abc123 in the database.',
  });
  add({
    id: 'response',
    label: 'Redirect response',
    from: 'server',
    to: 'browser',
    durationMs: inputs.rttMs / 2,
    skipped: false,
    explanation: 'The server answers 302 Found with a Location header, and the browser follows it.',
  });
  return steps;
}

export function totalMs(steps: JourneyStep[]): number {
  return steps.reduce((sum, step) => sum + (step.skipped ? 0 : step.durationMs), 0);
}

/** Share of the total spent waiting on the network instead of computing. */
export function networkShare(steps: JourneyStep[], inputs: JourneyInputs): number {
  const total = totalMs(steps);
  if (total === 0) return 0;
  const compute = inputs.serverMs + inputs.databaseMs;
  return (total - compute) / total;
}
