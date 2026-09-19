import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePointId } from "./sideMetrics.js";

/** A retained device hint is not a second observation of the photograph. */
export type SidePointEvidence = "seed" | "whole" | "coarse" | "fine";
export type SidePlacementEvidence = Record<SidePointId, SidePointEvidence>;

export function sidePlacementEvidence(value: SidePointEvidence): SidePlacementEvidence {
  return Object.fromEntries(SIDE_POINTS.map(({ id }) => [id, value])) as SidePlacementEvidence;
}

export function parseSidePlacementEvidence(value: unknown): SidePlacementEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const evidence = {} as SidePlacementEvidence;
  for (const { id } of SIDE_POINTS) {
    const entry = raw[id];
    if (entry !== "seed" && entry !== "whole" && entry !== "coarse" && entry !== "fine") return null;
    evidence[id] = entry;
  }
  return evidence;
}

export function hasSideObservations(evidence: SidePlacementEvidence): boolean {
  return SIDE_POINTS.some(({ id }) => evidence[id] !== "seed");
}
