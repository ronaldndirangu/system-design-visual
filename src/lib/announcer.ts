/** Shortest gap between two live region messages while a simulation runs. */
export const ANNOUNCE_GAP_MS = 600;

export interface Announcer {
  /** Queues a state message. It goes out now if the gap has passed, otherwise when it does; the latest queued state wins. */
  push(text: string): void;
  /** Queues an event message, such as a crash. Queued events all go out, ahead of the queued state. */
  pushEvent(text: string): void;
  /** Sends a message now and drops anything queued. Use for direct learner actions such as Step or Reset. */
  flush(text: string): void;
  /** Drops anything queued. */
  cancel(): void;
}

export interface AnnouncerOptions {
  gapMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** Rate limits live region messages so a running simulation never speaks more than once per gap. */
export function createAnnouncer(emit: (text: string) => void, options: AnnouncerOptions = {}): Announcer {
  const gapMs = options.gapMs ?? ANNOUNCE_GAP_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let lastSent = Number.NEGATIVE_INFINITY;
  let events: string[] = [];
  let state: string | null = null;
  let timer: unknown = null;

  const send = (text: string) => {
    lastSent = now();
    emit(text);
  };
  const take = () => {
    const text = [...events, ...(state === null ? [] : [state])].join(' ');
    events = [];
    state = null;
    return text;
  };
  const schedule = () => {
    const wait = lastSent + gapMs - now();
    if (wait <= 0 && timer === null) {
      send(take());
      return;
    }
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      const text = take();
      if (text) send(text);
    }, wait);
  };
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    events = [];
    state = null;
  };

  return {
    push(text) {
      state = text;
      schedule();
    },
    pushEvent(text) {
      events.push(text);
      schedule();
    },
    flush(text) {
      cancel();
      send(text);
    },
    cancel,
  };
}
