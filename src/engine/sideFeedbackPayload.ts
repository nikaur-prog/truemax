import { SIDE_POINTS } from "./sideMetrics.js";
import type { SidePointId, SidePoints } from "./sideMetrics.js";

export const SIDE_FEEDBACK_CONSENT_VERSION = "side-landmark-feedback-v1";
export const SIDE_FEEDBACK_RETENTION_DAYS = 90;

export type SideSeedMethod = "mesh" | "silhouette" | "segmentation" | "vision" | "fused" | "existing";

const SEED_METHODS: ReadonlySet<string> = new Set(["mesh", "silhouette", "segmentation", "vision", "fused", "existing"]);

export interface SideFeedbackReview {
  /** The answer about the automatic placement, not expert annotation. */
  verificationAnswer: "yes" | "no" | "unknown";
  /** Whether the person accepted the final points after any corrections. */
  finalPlacementVerified: boolean;
}

export interface SideFeedbackIntent {
  scanId: string;
  submissionId: string;
  consentVersion: typeof SIDE_FEEDBACK_CONSENT_VERSION;
  automaticPoints: SidePoints;
  seedMethod: SideSeedMethod;
  seedVersion?: string;
  review?: SideFeedbackReview;
}

export interface SideFeedbackMetadata {
  scanId: string;
  submissionId: string;
  consentVersion: typeof SIDE_FEEDBACK_CONSENT_VERSION;
  faceDir: 1 | -1;
  width: number;
  height: number;
  seedMethod: SideSeedMethod;
  seedVersion?: string;
  automaticPoints: SidePoints;
  correctedPoints: SidePoints;
  review?: SideFeedbackReview;
}

export function cloneSidePoints(points: SidePoints): SidePoints {
  const copy = {} as SidePoints;
  for (const { id } of SIDE_POINTS) copy[id] = { x: points[id].x, y: points[id].y };
  return copy;
}

/** A correction asks once; an earlier No must remain a no-upload decision. */
export function shouldAskSideCorrectionConsent(
  automatic: boolean,
  consentAnswer: boolean | null,
  movedPointCount: number,
): boolean {
  return !automatic && consentAnswer === null && movedPointCount > 0;
}

// The only function that turns a consent choice into uploadable state. A No
// returns null, so the calling flow has no payload to persist and no network
// function it can accidentally invoke later.
export function createSideFeedbackIntent(
  consented: boolean,
  scanId: string,
  submissionId: string,
  automaticPoints: SidePoints,
  seedMethod: SideSeedMethod,
  seedVersion?: string,
  review?: SideFeedbackReview,
): SideFeedbackIntent | null {
  if (!consented) return null;
  return {
    scanId,
    submissionId,
    consentVersion: SIDE_FEEDBACK_CONSENT_VERSION,
    automaticPoints: cloneSidePoints(automaticPoints),
    seedMethod,
    seedVersion: validSeedVersion(seedVersion) ? seedVersion : undefined,
    review: review ? { ...review } : undefined,
  };
}

export function sideFeedbackMetadataIssues(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["Feedback metadata is missing"];
  const m = value as Partial<SideFeedbackMetadata>;
  const issues: string[] = [];
  if (!uuid(m.scanId)) issues.push("Scan ID is invalid");
  if (!uuid(m.submissionId)) issues.push("Submission ID is invalid");
  if (m.consentVersion !== SIDE_FEEDBACK_CONSENT_VERSION) issues.push("Consent version is invalid");
  if (m.faceDir !== 1 && m.faceDir !== -1) issues.push("Face direction is invalid");
  if (!dimension(m.width) || !dimension(m.height)) issues.push("Image dimensions are invalid");
  if (typeof m.seedMethod !== "string" || !SEED_METHODS.has(m.seedMethod)) {
    issues.push("Seed method is invalid");
  }
  if (m.seedVersion !== undefined && !validSeedVersion(m.seedVersion)) issues.push("Seed version is invalid");
  if (m.review !== undefined && !validReview(m.review)) issues.push("Placement review is invalid");
  if (dimension(m.width) && dimension(m.height)) {
    issues.push(...pointIssues(m.automaticPoints, m.width, m.height, "Automatic"));
    issues.push(...pointIssues(m.correctedPoints, m.width, m.height, "Corrected"));
  }
  return issues.slice(0, 6);
}

export function sideFeedbackIntentIssues(value: unknown, width: number, height: number): string[] {
  if (!value || typeof value !== "object") return ["Feedback intent is missing"];
  const intent = value as Partial<SideFeedbackIntent>;
  const issues: string[] = [];
  if (!uuid(intent.scanId)) issues.push("Scan ID is invalid");
  if (!uuid(intent.submissionId)) issues.push("Submission ID is invalid");
  if (intent.consentVersion !== SIDE_FEEDBACK_CONSENT_VERSION) issues.push("Consent version is invalid");
  if (typeof intent.seedMethod !== "string" || !SEED_METHODS.has(intent.seedMethod)) {
    issues.push("Seed method is invalid");
  }
  if (intent.seedVersion !== undefined && !validSeedVersion(intent.seedVersion)) issues.push("Seed version is invalid");
  if (intent.review !== undefined && !validReview(intent.review)) issues.push("Placement review is invalid");
  issues.push(...pointIssues(intent.automaticPoints, width, height, "Automatic"));
  return issues.slice(0, 6);
}

/** Small, photo-free provenance stored with the existing private consent event. */
export function sideFeedbackProvenance(metadata: SideFeedbackMetadata) {
  const correctedPointIds = movedSidePointIds(metadata.automaticPoints, metadata.correctedPoints);
  const answer = metadata.review?.verificationAnswer ?? "unknown";
  const finalVerified = metadata.review?.finalPlacementVerified ?? null;
  return {
    source: "explicit_consent_upload",
    provenanceVersion: "side-review-v1",
    verificationAnswer: answer,
    finalPlacementVerified: finalVerified,
    labelSource: finalVerified === false ? "unverified"
      : finalVerified === true && correctedPointIds.length > 0 ? "user_corrected"
      : finalVerified === true && answer === "yes" ? "user_confirmed" : "unknown",
    seedMethod: metadata.seedMethod,
    seedVersion: metadata.seedVersion ?? null,
    correctedPointIds,
    geometryFrame: { space: "upright-photo-fractions", width: metadata.width, height: metadata.height, faceDir: metadata.faceDir },
  };
}

/** User approval cannot grant expert review; a rejected final seed is excluded. */
export function initialSideFeedbackReviewStatus(metadata: Pick<SideFeedbackMetadata, "review">): "new" | "rejected" {
  return metadata.review?.finalPlacementVerified === false ? "rejected" : "new";
}

export function normalizedSidePoints(points: SidePoints, width: number, height: number) {
  const result: Record<SidePointId, { x: number; y: number }> = {} as Record<
    SidePointId,
    { x: number; y: number }
  >;
  for (const { id } of SIDE_POINTS) {
    result[id] = {
      x: +(points[id].x / width).toFixed(6),
      y: +(points[id].y / height).toFixed(6),
    };
  }
  return result;
}

export function movedSidePointIds(
  automatic: SidePoints,
  corrected: SidePoints,
  thresholdPx = 1,
): SidePointId[] {
  return SIDE_POINTS
    .map(({ id }) => id)
    .filter((id) => Math.hypot(
      corrected[id].x - automatic[id].x,
      corrected[id].y - automatic[id].y,
    ) > thresholdPx);
}

function pointIssues(
  value: unknown,
  width: number,
  height: number,
  label: string,
): string[] {
  if (!value || typeof value !== "object") return [`${label} points are missing`];
  const points = value as Partial<Record<SidePointId, { x?: unknown; y?: unknown }>>;
  const issues: string[] = [];
  for (const { id } of SIDE_POINTS) {
    const p = points[id];
    if (!p || !finite(p.x) || !finite(p.y)) {
      issues.push(`${label} point ${id} is invalid`);
    } else if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
      issues.push(`${label} point ${id} is outside the image`);
    }
  }
  return issues;
}

function dimension(value: unknown): value is number {
  return finite(value) && value >= 1 && value <= 1600;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSeedVersion(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 80 && /^[a-z0-9._-]+$/i.test(value);
}

function validReview(value: unknown): value is SideFeedbackReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const review = value as Partial<SideFeedbackReview>;
  return ["yes", "no", "unknown"].includes(review.verificationAnswer ?? "")
    && typeof review.finalPlacementVerified === "boolean";
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
