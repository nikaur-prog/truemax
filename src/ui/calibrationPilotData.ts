import { AGG_NORM } from "../engine/aggNorm.js";
import { CURRENT_SCORE_VERSION } from "../engine/history.js";
import { LM, POSE_CALIBRATION } from "../engine/geometry.js";
import { METRICS, directionFor, distFor } from "../engine/metrics.js";
import { metricRead } from "../engine/metricReads.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";
import { CENTRE, SCORE_SCALE, SHRINK, mergeReports, regionIsScored, toleranceOf } from "../engine/scoring.js";
import { SHAPE_MODEL } from "../engine/shapeModel.js";
import { EXPERIMENTAL_SIDE_METRIC_IDS, SIDE_METRICS, SIDE_POINTS } from "../engine/sideMetrics.js";
import type { MetricDef, Report, Sex, View } from "../engine/types.js";

export const PILOT_SCHEMA_VERSION = 1;
export const PILOT_MAX_IMAGE_DIM = 2160;
export const PILOT_NOTICE = "Synthetic adult test images. Automatic points are unverified, not ground truth. Scores are diagnostic outputs, not validated attractiveness ratings. No norms are fitted or changed.";

export interface PilotIdentity { personId: string; sex: Sex; view: View; key: string }
export interface PilotFile { name: string }

/** Sex is a declared generation stratum in the filename, never inferred from pixels. */
export function parsePilotFilename(name: string): PilotIdentity | null {
  const match = /^([fm])(0[1-9]|10)-(front|side)\.(png|jpe?g|webp)$/i.exec(name);
  if (!match) return null;
  const personId = `${match[1].toLowerCase()}${match[2]}`;
  const view = match[3].toLowerCase() as View;
  return { personId, sex: match[1].toLowerCase() === "f" ? "female" : "male", view, key: `${personId}-${view}` };
}

export function pilotManifest<T extends PilotFile>(files: readonly T[]) {
  const rejected: Array<{ filename: string; reason: string }> = [];
  const grouped = new Map<string, T[]>();
  for (const file of files) {
    const identity = parsePilotFilename(file.name);
    if (!identity) { rejected.push({ filename: file.name, reason: "Expected f01..f10 or m01..m10, followed by -front or -side and an image extension" }); continue; }
    grouped.set(identity.key, [...(grouped.get(identity.key) ?? []), file]);
  }
  const slots = ["f", "m"].flatMap((prefix) => Array.from({ length: 10 }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`))
    .flatMap((id) => (["front", "side"] as const).map((view) => {
      const identity = parsePilotFilename(`${id}-${view}.png`)!;
      const candidates = grouped.get(identity.key) ?? [];
      return { ...identity, file: candidates.length === 1 ? candidates[0] : null, filenames: candidates.map((f) => f.name),
        status: candidates.length === 0 ? "missing" as const : candidates.length > 1 ? "duplicate" as const : "queued" as const };
    }));
  return { slots, rejected };
}

export function referenceFor(def: MetricDef, sex: Sex) {
  const distribution = distFor(def, sex);
  return { ...distribution, direction: directionFor(def, sex), toleranceSD: toleranceOf(def), toleranceUnits: toleranceOf(def) * distribution.sd };
}

export function pilotReferenceSnapshot() {
  return {
    scoreVersion: CURRENT_SCORE_VERSION,
    scoreScale: SCORE_SCALE, aggregateCentre: CENTRE, aggregateShrink: SHRINK,
    regionReliableMinimum: RELIABLE_MIN, poseCalibration: POSE_CALIBRATION,
    frontLandmarkNames: LM, sideLandmarkDefinitions: SIDE_POINTS,
    metricDefinitions: [...METRICS.filter((m) => m.view === "front"), ...SIDE_METRICS].map((def) => ({
      ...def, reliability: reliabilityOf(def.id), selectedReferences: { female: referenceFor(def, "female"), male: referenceFor(def, "male") },
    })),
    heldOutSideMetricIds: [...EXPERIMENTAL_SIDE_METRIC_IDS],
    heldOutReason: "Computed for research but excluded from current production scores; no active rating or ideal is assigned",
    aggregateNormalizationTables: AGG_NORM,
    shapeReference: SHAPE_MODEL,
    sourceSnapshotNote: "Exact scoring and construction sources accompany this export, including non-exported blend weights and seed templates. These references are existing engine parameters, not estimates from this pilot.",
  };
}

export function pilotReportSnapshot(report: Report) {
  return {
    ...report,
    metrics: report.metrics.map((m) => ({
      ...m, selectedReference: referenceFor(m.def, report.sex), reliability: reliabilityOf(m.def.id),
      effectiveWeight: m.implausible ? 0 : m.def.weight * reliabilityOf(m.def.id),
      measurementStatus: !Number.isFinite(m.value) ? "unavailable" : m.implausible ? "rejected-placement" : "measured-unverified",
      reading: metricRead(m, report.sex),
    })),
    regions: report.regions.map(({ metrics, ...region }) => ({
      ...region, displayedAsScored: regionIsScored(region), metricIds: metrics.map((m) => m.def.id),
    })),
  };
}
export type PilotReport = ReturnType<typeof pilotReportSnapshot>;

export interface PilotRecord extends PilotIdentity {
  filenames: string[];
  status: "missing" | "duplicate" | "queued" | "processing" | "complete" | "failed" | "cancelled";
  failure: string | null;
  warnings: string[];
  source?: { filename: string; sha256: string; bytes: number; mimeType: string; nativeWidth: number; nativeHeight: number; width: number; height: number; mirrored: false; orientation: string };
  points?: Array<{ id: string; label?: string; x: number; y: number; normalizedX: number; normalizedY: number; z?: number; corrected?: { x: number; y: number } }>;
  rawMeasurements?: Record<string, number>;
  diagnostics?: Record<string, unknown>;
  report?: PilotReport;
}

/** Never replace a missing or rejected view with a neutral score. */
export function pilotPairs(records: readonly PilotRecord[], reports: ReadonlyMap<string, Report>) {
  return records.filter((r) => r.view === "front").map((front) => {
    const side = records.find((r) => r.personId === front.personId && r.view === "side");
    const frontReport = reports.get(front.key);
    const sideReport = reports.get(`${front.personId}-side`);
    const report = frontReport && sideReport ? pilotReportSnapshot(mergeReports(frontReport, sideReport)) : null;
    return { personId: front.personId, sex: front.sex, pairing: "declared-filename-pair; identity consistency not verified", automaticPointsVerified: false,
      status: report ? "diagnostic-unverified" : "unavailable", frontStatus: front.status, sideStatus: side?.status ?? "missing",
      warnings: [...front.warnings, ...(side?.warnings ?? [])],
      reason: report ? null : "Both views must produce a report; missing or failed views are not imputed", report };
  });
}

/** Keep missing and non-finite values explicit instead of JSON dropping/coercing them. */
export function pilotJson(value: unknown): string {
  const nonFiniteValues: Array<{ path: string; reason: string }> = [];
  function clean(item: unknown, path: string): unknown {
    if (item === undefined) {
      nonFiniteValues.push({ path, reason: "not supplied or unavailable" });
      return null;
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      nonFiniteValues.push({ path, reason: Number.isNaN(item) ? "not measured or unavailable" : "non-finite bound or result" });
      return null;
    }
    if (Array.isArray(item)) return item.map((child, i) => clean(child, `${path}[${i}]`));
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, clean(child, path ? `${path}.${key}` : key)]));
    return item;
  }
  const data = clean(value, "");
  return JSON.stringify({ data, nonFiniteValues }, null, 2);
}
