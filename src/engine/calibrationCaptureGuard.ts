import type { CalibrationDiagnostics } from "./calibrationDiagnostics.js";
import type { CalibrationImageSource } from "./calibrationImageSource.js";
import type { RatedFace } from "./calibrationSet.js";
import type { Sex } from "./types.js";

export interface CalibrationFileReference {
  referenceId: string;
  view: "front" | "side";
}

/** Only the documented anonymous file convention is understood, never names or appearance. */
export function calibrationFileReference(filename: string): CalibrationFileReference | undefined {
  const match = /^(m|f|w)(0*[1-9]\d{0,3})[-_](front|side)\.(png|jpe?g|webp)$/i.exec(filename);
  if (!match) return undefined;
  return {
    referenceId: `${match[1].toLowerCase() === "m" ? "m" : "f"}${String(Number(match[2])).padStart(2, "0")}`,
    view: match[3].toLowerCase() as "front" | "side",
  };
}

function pilotReference(value: string | undefined): { id: string; sex: Sex } | undefined {
  const match = /^(m|f|w)(0*[1-9]\d{0,3})(?:[-_]retake(?:[-_]\d+)?)?$/.exec(value ?? "");
  if (!match) return undefined;
  const sex = match[1] === "m" ? "male" : "female";
  return { id: `${sex === "male" ? "m" : "f"}${String(Number(match[2])).padStart(2, "0")}`, sex };
}

export function suggestedCalibrationReference(hints: { front?: CalibrationFileReference; side?: CalibrationFileReference }): string | undefined {
  if (hints.front && hints.side && hints.front.referenceId !== hints.side.referenceId) return undefined;
  return hints.front?.referenceId ?? hints.side?.referenceId;
}

function samePhoto(a: CalibrationImageSource | undefined, b: CalibrationImageSource | undefined): boolean {
  if (!a || !b) return false;
  const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (validHash(a.originalFileSha256) && validHash(b.originalFileSha256) && a.originalFileSha256 === b.originalFileSha256) return true;
  return validHash(a.reviewPixelsSha256) && validHash(b.reviewPixelsSha256)
    && a.reviewPixelsSha256 === b.reviewPixelsSha256 && a.width === b.width && a.height === b.height;
}

export interface CalibrationCaptureWarning { code: string; message: string }
export interface CalibrationCaptureCandidate {
  sex: Sex;
  referenceId?: string;
  diagnostics?: CalibrationDiagnostics;
  fileReferences?: { front?: CalibrationFileReference; side?: CalibrationFileReference };
}

/** Warnings require deliberate review, but never delete prior captures or infer a person's sex. */
export function calibrationCaptureWarnings(candidate: CalibrationCaptureCandidate, saved: RatedFace[]): CalibrationCaptureWarning[] {
  const warnings: CalibrationCaptureWarning[] = [];
  const add = (code: string, message: string) => warnings.push({ code, message });
  const reference = pilotReference(candidate.referenceId);
  const hints = candidate.fileReferences ?? {};
  const hintIds = new Set([hints.front?.referenceId, hints.side?.referenceId].filter(Boolean));
  if (reference && reference.sex !== candidate.sex) {
    add("reference-group", "The Reference ID uses a different pilot group from the selected men/women group. Check both before saving. This check uses the ID, not the face.");
  }
  if (hintIds.size > 1) add("file-pair", "The front and side filenames identify different pilot faces. Go back and check that both photos belong to this face.");
  for (const view of ["front", "side"] as const) {
    const hint = hints[view];
    if (!hint) continue;
    if (hint.view !== view) add(`file-view-${view}`, `The ${view} upload has a filename marked ${hint.view}. Check the photo slot.`);
    if (reference && reference.id !== hint.referenceId) add(`file-reference-${view}`, `The ${view} filename identifies ${hint.referenceId}, which differs from the Reference ID. Check the ID or photo.`);
    if (pilotReference(hint.referenceId)?.sex !== candidate.sex) add(`file-group-${view}`, `The ${view} filename uses a different pilot group from the selected men/women group. Check the group before saving.`);
  }
  const front = candidate.diagnostics?.front?.imageSource;
  const side = candidate.diagnostics?.side?.imageSource;
  if (samePhoto(front, side)) add("same-photo-both-views", "The front and side slots contain the same photo. Check that each slot has the intended view.");
  for (const row of saved) {
    const savedReference = pilotReference(row.referenceId);
    if (candidate.referenceId && row.referenceId && (candidate.referenceId === row.referenceId
      || (reference && savedReference && reference.id === savedReference.id))) {
      add(`reference-reused:${row.id}`, `This Reference ID is already represented by saved row ${row.id}. Check whether this is an intentional repeat rather than a new face.`);
    }
    const existing = [row.diagnostics?.front?.imageSource, row.diagnostics?.side?.imageSource];
    if ([front, side].some((source) => existing.some((previous) => samePhoto(source, previous)))) {
      add(`photo-reused:${row.id}`, `A photo matches saved row ${row.id}${row.sex !== candidate.sex ? " under a different reference group" : ""}. Check whether this is an intentional repeat. A different filename does not make it a new photo.`);
    }
  }
  return warnings;
}

export class CalibrationCaptureReviewRequired extends Error {
  constructor(readonly warnings: CalibrationCaptureWarning[]) {
    super("Check the capture warnings and explicitly confirm an intentional exception before saving.");
    this.name = "CalibrationCaptureReviewRequired";
  }
}
