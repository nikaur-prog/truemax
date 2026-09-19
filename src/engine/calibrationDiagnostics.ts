import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SidePoints } from "./sideMetrics.js";
import type { SideSeedMethod } from "./sideFeedbackPayload.js";
import type { Report, Sex } from "./types.js";
import type { SideCaptureDiagnostics } from "./sideCaptureRecovery.js";
import { compareSidePlacement } from "./sidePlacementComparison.js";
import type { SidePlacementComparison } from "./sidePlacementComparison.js";
import { snapshotCalibrationImageSource } from "./calibrationImageSource.js";
import type { CalibrationImageSource } from "./calibrationImageSource.js";

export interface CalibrationSideCapture {
  width: number;
  height: number;
  faceDir: number;
  automaticPoints: SidePoints;
  finalPoints: SidePoints;
  seedMethod: SideSeedMethod;
  seedVersion?: string;
  /** Guide presented during this review; absent on older captures, never inferred. */
  landmarkGuideVersion?: string;
  operatorVerified: boolean;
  diagnostics?: SideCaptureDiagnostics;
  /** Optional for older captures; hashes match the photo to this review geometry. */
  imageSource?: CalibrationImageSource;
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
    imageSource?: CalibrationImageSource;
  } | null;
  side: (CalibrationSideCapture & {
    coordinateSpace: "review-image-pixels";
    reviewKind: "operator-not-expert";
    report: Report;
    /** Added in the review preparation pass; older stored captures omit it. */
    placementComparison?: SidePlacementComparison;
  }) | null;
}

/** Snapshot at save time: subsequent dragging or retaking cannot rewrite evidence. */
export function snapshotCalibrationDiagnostics(input: {
  build: string;
  referenceGroup: Sex;
  capturedAt?: string;
  front: { width: number; height: number; landmarks: NormalizedLandmark[]; report: Report; imageSource?: CalibrationImageSource } | null;
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
    front: input.front ? {
      ...input.front, coordinateSpace: "normalized-image",
      ...(input.front.imageSource ? { imageSource: snapshotCalibrationImageSource(input.front.imageSource, input.front) } : {}),
    } : null,
    side: input.side ? {
      ...input.side, coordinateSpace: "review-image-pixels", reviewKind: "operator-not-expert",
      placementComparison: compareSidePlacement(input.side),
      ...(input.side.imageSource ? { imageSource: snapshotCalibrationImageSource(input.side.imageSource, input.side) } : {}),
    } : null,
  });
}
