import { createContext, useContext } from 'react';
import type { Speed } from '../ui/SpeedControl';

/** The run controls a SimulationShell owns, shared with anything rendered inside it. */
export interface Playback {
  playing: boolean;
  speed: Speed;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  step: () => void;
  reset: () => void;
  setSpeed: (speed: Speed) => void;
}

export const PlaybackContext = createContext<Playback | null>(null);

/** The enclosing simulation's run controls, or null outside a SimulationShell. */
export function usePlayback(): Playback | null {
  return useContext(PlaybackContext);
}
