import { mergeReports } from "./scoring.js";
import type { Report } from "./types.js";

/** A score's source and what it describes are separate pieces of evidence. */
export type CalibrationRatingTarget = "front" | "side" | "combined" | "external-overall";
export interface CalibrationCaptureScores {
  front?: number;
  side?: number;
  combined?: number;
}

export const CALIBRATION_TARGET_LABELS: Record<CalibrationRatingTarget, string> = {
  front: "Front only",
  side: "Side only",
  combined: "Front + side",
  "external-overall": "Another app's total",
};

export function isCalibrationRatingTarget(value: unknown): value is CalibrationRatingTarget {
  return value === "front" || value === "side" || value === "combined" || value === "external-overall";
}

export function calibrationRatingOptions(hasFront: boolean, hasSide: boolean): string {
  const defaultTarget = hasFront && hasSide ? "combined" : hasFront ? "front" : "side";
  const targets: CalibrationRatingTarget[] = [
    ...(hasFront ? ["front" as const] : []),
    ...(hasSide ? ["side" as const] : []),
    ...(hasFront && hasSide ? ["combined" as const] : []),
    "external-overall",
  ];
  return targets.map((target) => `<option value="${target}"${target === defaultTarget ? " selected" : ""}>${CALIBRATION_TARGET_LABELS[target]}</option>`).join("");
}

/** Freeze each view's number without changing the legacy primary/front score. */
export function calibrationCaptureScores(front: Report | null, side: Report | null): CalibrationCaptureScores {
  const scores: CalibrationCaptureScores = {};
  if (front && Number.isFinite(front.overall)) scores.front = front.overall;
  if (side && Number.isFinite(side.overall)) scores.side = side.overall;
  if (front && side) {
    const merged = mergeReports(front, side);
    if (merged.views && Number.isFinite(merged.overall)) scores.combined = merged.overall;
  }
  return scores;
}

export interface CalibrationScoreComparison {
  view: "front" | "side" | "combined" | "legacy-primary" | "unavailable";
  score: number | null;
  difference: number | null;
  /** Scope agreement is not evidence that either product's rating is accurate. */
  sameScope: boolean;
}

/** Never infer what an old unlabelled rating meant from the views it happens to carry. */
export function calibrationScoreComparison(face: {
  rating: number | null;
  scored: number;
  ratingTarget?: CalibrationRatingTarget;
  captureScores?: CalibrationCaptureScores;
}): CalibrationScoreComparison {
  const { ratingTarget: target, captureScores: scores = {} } = face;
  if (!isCalibrationRatingTarget(target)) {
    return { view: "legacy-primary", score: Number.isFinite(face.scored) ? face.scored : null, difference: null, sameScope: false };
  }
  const view = target === "external-overall"
    ? Number.isFinite(scores.combined) ? "combined" : Number.isFinite(scores.front) ? "front" : "side"
    : target;
  const score = scores[view];
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return { view: "unavailable", score: null, difference: null, sameScope: false };
  }
  return {
    view,
    score,
    difference: typeof face.rating === "number" && Number.isFinite(face.rating) ? score - face.rating : null,
    sameScope: target !== "external-overall",
  };
}

export function calibrationScoreViewLabel(view: CalibrationScoreComparison["view"]): string {
  return view === "legacy-primary" ? "Primary score (legacy)"
    : view === "unavailable" ? "No matching view score"
    : CALIBRATION_TARGET_LABELS[view];
}
