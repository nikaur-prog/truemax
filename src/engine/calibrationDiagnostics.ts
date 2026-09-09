import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SidePoints } from "./sideMetrics.js";
import type { SideSeedMethod } from "./sideFeedbackPayload.js";
import type { Report, Sex } from "./types.js";

export interface CalibrationSideCapture {
  width: number;
  height: number;
  faceDir: number;
  automaticPoints: SidePoints;
  finalPoints: SidePoints;
  seedMethod: SideSeedMethod;
  seedVersion?: string;
  operatorVerified: boolean;
}

/** Local diagnostic record. No photograph, account identifier or inferred demographics. */
export interface CalibrationDiagnostics {
  schemaVersion: 1;
  capturedAt: string;
  build: string;
  referenceGroup: Sex;
  front: {
    width: number;
    height: number;
    coordinateSpace: "normalized-image";
    landmarks: NormalizedLandmark[];
    report: Report;
  } | null;
  side: (CalibrationSideCapture & {
    coordinateSpace: "review-image-pixels";
    reviewKind: "operator-not-expert";
    report: Report;
  }) | null;
}

/** Snapshot at save time: subsequent dragging or retaking cannot rewrite evidence. */
export function snapshotCalibrationDiagnostics(input: {
  build: string;
  referenceGroup: Sex;
  capturedAt?: string;
  front: { width: number; height: number; landmarks: NormalizedLandmark[]; report: Report } | null;
  side: (CalibrationSideCapture & { report: Report }) | null;
}): CalibrationDiagnostics {
  for (const view of [input.front, input.side]) {
    if (view && view.report.sex !== input.referenceGroup) {
      throw new Error("Front and side must use the same reference group before saving.");
    }
  }
  return structuredClone({
    schemaVersion: 1,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    build: input.build,
    referenceGroup: input.referenceGroup,
    front: input.front ? { ...input.front, coordinateSpace: "normalized-image" } : null,
    side: input.side ? { ...input.side, coordinateSpace: "review-image-pixels", reviewKind: "operator-not-expert" } : null,
  });
}
