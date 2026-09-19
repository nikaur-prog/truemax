import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { Report } from "../engine/types.js";

export interface CalibrationCapture {
  front: Report | null;
  side: Report | null;
  frontPhoto: HTMLCanvasElement | null;
  frontLandmarks: NormalizedLandmark[] | null;
  sidePhoto: HTMLCanvasElement | null;
  sidePoints: SidePoints | null;
}

export interface CalibrationVerdictSnapshot {
  hasSide: boolean;
  /** Only a second view may be merged with the primary report. */
  additionalSide: Report | null;
  suspect: number;
  dual: {
    frontPhoto: HTMLCanvasElement;
    frontLandmarks: NormalizedLandmark[];
    sidePhoto: HTMLCanvasElement;
    sidePoints: SidePoints;
  } | null;
}

/** Transfer this capture's export inputs before its editable slots are cleared. */
export function calibrationVerdictSnapshot(primary: Report, capture: CalibrationCapture): CalibrationVerdictSnapshot {
  const additionalSide = capture.front === primary && capture.side && capture.side !== primary
    ? capture.side
    : null;
  const reports = new Set([primary, additionalSide].filter((report): report is Report => report !== null));
  const dual = additionalSide && capture.frontPhoto && capture.frontLandmarks?.length
    && capture.sidePhoto && capture.sidePoints
    ? {
      // Canvases belong to this capture; later captures allocate their own.
      frontPhoto: capture.frontPhoto,
      frontLandmarks: capture.frontLandmarks.map((point) => ({ ...point })),
      sidePhoto: capture.sidePhoto,
      sidePoints: Object.fromEntries(Object.entries(capture.sidePoints).map(([id, point]) => [id, { ...point }])) as SidePoints,
    }
    : null;
  return {
    hasSide: capture.side !== null,
    additionalSide,
    suspect: [...reports].reduce((count, report) => count + report.metrics.filter((metric) => metric.implausible).length, 0),
    dual,
  };
}
