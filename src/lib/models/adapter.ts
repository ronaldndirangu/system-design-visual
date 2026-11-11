/**
 * The contract a teaching model follows so widgets, scripted stories, and
 * tests all drive models the same way. Time moves only through step().
 */
export interface ModelAdapter<Command, Tick, Checkpoint> {
  /** Ticks taken since the model was created. */
  readonly ticks: number;
  /** Changes the model between ticks. The change takes effect from the next step. */
  apply(command: Command): void;
  step(): Tick;
  /** A deep copy of everything that decides future ticks, random streams included. */
  checkpoint(): Checkpoint;
  restore(checkpoint: Checkpoint): void;
}

export interface ScheduledCommand<Command> {
  /** The tick this command lands before. 0 means before the first step. */
  at: number;
  command: Command;
}

/** Applies every command scheduled for the coming tick, then steps once. */
export function stepScheduled<Command, Tick>(
  model: ModelAdapter<Command, Tick, unknown>,
  schedule: readonly ScheduledCommand<Command>[],
): Tick {
  for (const entry of schedule) if (entry.at === model.ticks) model.apply(entry.command);
  return model.step();
}
