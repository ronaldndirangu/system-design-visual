import { type ReactNode, type RefObject, useEffect } from 'react';
import { usePlayback } from '../sim/playback';
import { Button } from '../ui/Button';
import type { PhysicsStatus } from './runtime';

export interface StagePlayback {
  playing: boolean;
  speed: number;
}

interface PhysicsStageProps {
  physics: { canvasRef: RefObject<HTMLCanvasElement | null>; status: PhysicsStatus; retry: () => void };
  testId: string;
  /** Text and bars with the same data as the canvas, shown in every state. */
  readout: ReactNode;
  /** Reports the shell's run state, which only children of a SimulationShell can read. */
  onPlayback: (state: StagePlayback) => void;
}

/** A physics canvas with its semantic readout and a visible fallback when the animation cannot start. */
export function PhysicsStage({ physics, testId, readout, onPlayback }: PhysicsStageProps) {
  const playback = usePlayback();
  const playing = playback?.playing ?? false;
  const speed = Number(playback?.speed ?? 1);
  useEffect(() => {
    onPlayback({ playing, speed });
  }, [playing, speed, onPlayback]);

  const failed = physics.status === 'failed';
  return (
    <>
      {physics.status !== 'off' && (
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is not focusable; the readout carries the same data
        <canvas
          ref={physics.canvasRef}
          className="sdv-farm__canvas"
          aria-hidden="true"
          hidden={failed}
          data-testid={testId}
        />
      )}
      <div className="sdv-physics__fallback" role="status">
        {failed && (
          <>
            <p>The animation could not start. The bars below show the same numbers.</p>
            <Button icon="reset" onClick={physics.retry}>
              Retry animation
            </Button>
          </>
        )}
      </div>
      {readout}
    </>
  );
}
