import type { QualityCheck } from "./quality.js";

/** Pose is a measurement boundary, not a cosmetic photo-quality preference. */
export function creatorFrontViewIssue(quality: Pick<QualityCheck, "faceFound" | "frontal" | "yawDeg" | "pitchDeg">): "turned" | "tilted" | null {
  if (!quality.faceFound || quality.frontal) return null;
  return Math.abs(quality.yawDeg) > 28 ? "turned" : "tilted";
}
