import { SIDE_POINTS, computeSideMetrics, faceDirFromPoints, sidePointIntegrityIssues } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";
import { analyzeSide } from "./scoring.js";
import type { Report } from "./types.js";

export interface SidePlacementComparison {
  /** An operator correction is a review, not independent anatomical truth. */
  comparisonKind: "automatic-versus-operator";
  automaticDirectionSource: "point-order";
  automaticFaceDir: number;
  automaticReport: Report | null;
  automaticUnscoredReason: string | null;
  pointChanges: Array<{ id: SidePointId; dx: number; dy: number; distancePx: number; imageDiagonalFraction: number }>;
  metricChanges: Array<{
    id: string; automaticValue: number | null; reviewedValue: number | null;
    delta: number | null; automaticScore: number | null; reviewedScore: number | null;
  }>;
}

const finite = (value: number | undefined): number | null => Number.isFinite(value) ? value! : null;

/** Re-score only the retained automatic points, never overwrite the reviewed report. */
export function compareSidePlacement(input: {
  automaticPoints: SidePoints; finalPoints: SidePoints; width: number; height: number; report: Report;
}): SidePlacementComparison {
  const hasDirection = Number.isFinite(input.automaticPoints?.pronasale?.x)
    && Number.isFinite(input.automaticPoints?.tragion?.x);
  // Zero means unavailable; do not invent a left/right result for missing points.
  const automaticFaceDir = hasDirection ? faceDirFromPoints(input.automaticPoints) : 0;
  let automaticReport: Report | null = null;
  let automaticUnscoredReason: string | null = null;
  let automaticValues: Record<string, number> = {};
  try {
    automaticValues = computeSideMetrics(input.automaticPoints, automaticFaceDir);
    if (!(Number.isFinite(input.width) && input.width > 0 && Number.isFinite(input.height) && input.height > 0)) {
      throw new Error("Automatic capture dimensions are unavailable.");
    }
    const issues = sidePointIntegrityIssues(input.automaticPoints, input.width, input.height, automaticFaceDir);
    if (issues.length) throw new Error(`Automatic landmarks need correction: ${issues.join("; ")}`);
    automaticReport = analyzeSide(input.automaticPoints, automaticFaceDir, input.report.sex);
  } catch (error) {
    automaticUnscoredReason = error instanceof Error ? error.message : "Automatic points could not be measured.";
  }
  const automaticMetrics = new Map(automaticReport?.metrics.map((metric) => [metric.def.id, metric]));
  const diagonal = Math.hypot(input.width, input.height);
  const pointChanges = SIDE_POINTS.flatMap(({ id }) => {
    const initial = input.automaticPoints?.[id];
    const reviewed = input.finalPoints?.[id];
    // Malformed retained evidence must neither block a corrected capture nor
    // invent a zero displacement. Its missing point remains in the raw record.
    if (![initial?.x, initial?.y, reviewed?.x, reviewed?.y].every(Number.isFinite)) return [];
    const dx = reviewed.x - initial.x;
    const dy = reviewed.y - initial.y;
    const distancePx = Math.hypot(dx, dy);
    if (![dx, dy, distancePx, diagonal].every(Number.isFinite) || !(diagonal > 0)) return [];
    return [{ id, dx, dy, distancePx, imageDiagonalFraction: distancePx / diagonal }];
  });
  return {
    comparisonKind: "automatic-versus-operator", automaticDirectionSource: "point-order", automaticFaceDir,
    automaticReport, automaticUnscoredReason, pointChanges,
    metricChanges: input.report.metrics.map((metric) => {
      const automaticValue = finite(automaticValues[metric.def.id]);
      const reviewedValue = finite(metric.value);
      const automatic = automaticMetrics.get(metric.def.id);
      return {
        id: metric.def.id, automaticValue, reviewedValue,
        delta: automaticValue !== null && reviewedValue !== null ? reviewedValue - automaticValue : null,
        automaticScore: automatic && !automatic.implausible ? finite(automatic.score) : null,
        reviewedScore: !metric.implausible ? finite(metric.score) : null,
      };
    }),
  };
}
