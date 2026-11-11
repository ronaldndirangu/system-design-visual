import { useCallback, useEffect, useRef, useState } from 'react';
import { ANNOUNCE_GAP_MS, type Announcer, createAnnouncer } from '../../lib/announcer';

/** Long enough for screen readers to notice the empty region before the repeated text returns. */
const REPEAT_DELAY_MS = 50;

export interface LiveAnnouncer {
  /** Text for an `aria-live` region. */
  message: string;
  /** Speaks now. Use for direct learner actions: Step, Reset, Pause, or a new scenario. */
  announce: (text: string) => void;
  /** Speaks at most once per gap; a newer state replaces a queued one. Use for state changes while a simulation runs. */
  push: (text: string) => void;
  /** Speaks at most once per gap and is never replaced. Use for learner actions while a simulation runs, such as a crash. */
  pushEvent: (text: string) => void;
  /** Drops anything `push` or `pushEvent` queued. */
  cancel: () => void;
}

/**
 * Drives one polite live region. Repeating the current text clears the region
 * first, so a second Reset on the same state is still spoken.
 */
export function useAnnouncer(gapMs = ANNOUNCE_GAP_MS): LiveAnnouncer {
  const [message, setMessage] = useState('');
  const messageRef = useRef('');
  const repeatTimer = useRef<number | undefined>(undefined);

  const write = useCallback((text: string) => {
    window.clearTimeout(repeatTimer.current);
    const show = (next: string) => {
      messageRef.current = next;
      setMessage(next);
    };
    if (text !== messageRef.current) {
      show(text);
      return;
    }
    show('');
    repeatTimer.current = window.setTimeout(() => show(text), REPEAT_DELAY_MS);
  }, []);

  const announcerRef = useRef<Announcer | null>(null);
  if (!announcerRef.current) announcerRef.current = createAnnouncer(write, { gapMs });
  const announcer = announcerRef.current;

  useEffect(
    () => () => {
      announcer.cancel();
      window.clearTimeout(repeatTimer.current);
    },
    [announcer],
  );

  return {
    message,
    announce: announcer.flush,
    push: announcer.push,
    pushEvent: announcer.pushEvent,
    cancel: announcer.cancel,
  };
}
