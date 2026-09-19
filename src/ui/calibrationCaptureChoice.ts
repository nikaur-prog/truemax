import type { Sex } from "../engine/types.js";

/** A reference choice belongs to this capture attempt, never to browser preferences. */
export function createCalibrationCaptureChoice() {
  let generation = 0;
  let reference: Sex | null = null;
  return {
    begin(pairedReference?: Sex): number {
      generation += 1;
      reference = pairedReference ?? null;
      return generation;
    },
    choose(attempt: number, sex: Sex): boolean {
      if (attempt !== generation) return false;
      reference = sex;
      return true;
    },
    read(attempt = generation): Sex | null {
      return attempt === generation ? reference : null;
    },
    current(attempt: number): boolean {
      return attempt === generation;
    },
    cancel(): void {
      generation += 1;
      reference = null;
    },
  };
}
