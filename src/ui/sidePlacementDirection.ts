import { faceDirFromPoints } from "../engine/sideMetrics.js";
import type { SidePoints } from "../engine/sideMetrics.js";

/** Keep direction hints in the same coordinate frame as the current points. */
export function withPointDerivedSideDirection<T extends { points: SidePoints; faceDir: number }>(
  seed: T,
): Omit<T, "faceDir"> & { faceDir: 1 | -1 } {
  // A detector's direction can disagree with its placed points, and fusion
  // can replace the ear point. Derive the hint exactly as final measurement
  // does, without changing or mirroring any point here.
  return { ...seed, faceDir: faceDirFromPoints(seed.points) < 0 ? -1 : 1 };
}
