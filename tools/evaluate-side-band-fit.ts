// Offline, read-only replay. Output may contain private capture identifiers.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SIDE_METRICS, computeSideMetrics, sidePointIntegrityIssues } from "../src/engine/sideMetrics.js";
import type { SidePoints } from "../src/engine/sideMetrics.js";
import { distFor } from "../src/engine/metrics.js";
import { analyzeSide, mergeReports, scoreSideMeasurements, toleranceOf } from "../src/engine/scoring.js";
import { evaluateSideBandFit, SIDE_BAND_FIT_VERSION } from "../src/engine/sideBandFit.js";
import { reliabilityOf } from "../src/engine/reliability.js";
import type { CalibrationDiagnostics } from "../src/engine/calibrationDiagnostics.js";
import type { Sex } from "../src/engine/types.js";

interface CaptureRow {
  id: string;
  referenceId?: string;
  referenceGroup?: Sex;
  rating?: number | null;
  diagnostics?: CalibrationDiagnostics;
}

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MAX_SCORE_INPUT_BYTES = 30_000_000;
const IMPLEMENTATION_FILES = [
  "tools/evaluate-side-band-fit.ts",
  "src/engine/sideBandFit.ts",
  "src/engine/scoring.ts",
  "src/engine/sideMetrics.ts",
  "src/engine/geometry.ts",
  "src/engine/metrics.ts",
  "src/engine/calibration/pipelineBias.ts",
  "src/engine/reliability.ts",
  "src/engine/reliabilitySeed.ts",
  "src/engine/aggNorm.ts",
] as const;
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Hash the executable mapping and its numeric dependencies, not just a version label. */
export function scoreImplementationProvenance(repo = REPOSITORY) {
  const implementationFiles = Object.fromEntries(IMPLEMENTATION_FILES.map((path) => [path, sha256(readFileSync(resolve(repo, path)))]));
  return { implementationSha256: sha256(JSON.stringify(implementationFiles)), implementationFiles };
}

export function readBoundedScoreInput(path: string): Buffer {
  const info = statSync(path);
  if (!info.isFile()) throw new Error("Input must be a regular diagnostic file.");
  if (info.size > MAX_SCORE_INPUT_BYTES) throw new Error("Input exceeds 30 MB safety limit.");
  const bytes = readFileSync(path);
  // Check again if the file changed between stat and read.
  if (bytes.byteLength > MAX_SCORE_INPUT_BYTES) throw new Error("Input exceeds 30 MB safety limit.");
  return bytes;
}

/** Reject redirects before creating any directories or writing private data. */
export function privateScoreOutputPath(repo: string, outputPath: string): string {
  const privateRoot = resolve(repo, ".calibration-pilot");
  const output = resolve(outputPath);
  const rel = relative(privateRoot, output);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Output must stay inside the ignored .calibration-pilot directory.");
  }
  const rootInfo = lstatSync(privateRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()
    || realpathSync(privateRoot) !== resolve(realpathSync(repo), ".calibration-pilot")) {
    throw new Error("The private calibration root must be a real repository directory, not a symlink.");
  }
  let ancestor = output;
  while (ancestor !== privateRoot) {
    let info;
    try { info = lstatSync(ancestor); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (info?.isSymbolicLink()) throw new Error("A symlink must not redirect private score output.");
    if (info && ancestor !== output && !info.isDirectory()) throw new Error("An output ancestor is not a directory.");
    ancestor = dirname(ancestor);
  }
  return output;
}

export function writePrivateScoreArtifact(repo: string, outputPath: string, value: unknown): void {
  const output = privateScoreOutputPath(repo, outputPath);
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  // Check again after creating parents; existing symlinks are never followed.
  privateScoreOutputPath(repo, output);
  writeFileSync(output, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

function scoreSnapshot(points: SidePoints, faceDir: number, sex: Sex) {
  const issues = sidePointIntegrityIssues(points, undefined, undefined, faceDir);
  const measurements = computeSideMetrics(points, faceDir);
  const legacy = scoreSideMeasurements(measurements, sex);
  return {
    measurements,
    integrityIssues: issues,
    legacySideScore: legacy.overall,
    candidate: evaluateSideBandFit(measurements, sex),
  };
}

/** Does not fit anything or trust rating/source fields as training labels. */
export function evaluateCaptureDiagnostics(input: unknown, excludeRows: ReadonlySet<string> = new Set()) {
  if (!input || typeof input !== "object" || !Array.isArray((input as { faces?: unknown }).faces)) {
    throw new Error("Expected an all-capture diagnostic export with a faces array.");
  }
  const faces = (input as { faces: CaptureRow[] }).faces;
  const ids = new Set<string>();
  for (const row of faces) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error("Missing or duplicate capture row ID.");
    ids.add(row.id);
  }
  for (const id of excludeRows) if (!ids.has(id)) throw new Error(`Excluded row does not exist: ${id}`);
  const seenPhotos = new Map<string, string>();
  const rows = faces.filter((row) => !excludeRows.has(row.id)).map((row) => {
    const d = row.diagnostics;
    if (!d?.side) throw new Error(`${row.id}: side capture diagnostics are required, not corpus-only measurements.`);
    const sex = d.referenceGroup;
    if (sex !== "male" && sex !== "female") throw new Error(`${row.id}: explicit reference group missing.`);
    if (row.referenceGroup && row.referenceGroup !== sex) throw new Error(`${row.id}: reference group mismatch.`);
    if (d.side.report.sex !== sex || (d.front && d.front.report.sex !== sex)) throw new Error(`${row.id}: report group mismatch.`);
    if (d.side.operatorVerified !== true) throw new Error(`${row.id}: final points were not operator confirmed.`);
    if (d.side.faceDir !== -1 && d.side.faceDir !== 1) throw new Error(`${row.id}: facing direction must be -1 or 1.`);
    const photo = d.side.imageSource?.reviewPixelsSha256 ?? d.side.imageSource?.originalFileSha256;
    if (!photo) throw new Error(`${row.id}: an exact side-image fingerprint is required for deduplication.`);
    const prior = seenPhotos.get(photo);
    if (prior) throw new Error(`Duplicate side image in ${prior} and ${row.id}; reconcile explicitly before evaluation.`);
    seenPhotos.set(photo, row.id);
    const finalReport = analyzeSide(d.side.finalPoints, d.side.faceDir, sex);
    const automatic = scoreSnapshot(d.side.automaticPoints, d.side.faceDir, sex);
    const reviewed = scoreSnapshot(d.side.finalPoints, d.side.faceDir, sex);
    let legacyMerged: { automatic: number; reviewed: number } | null = null;
    if (d.front) {
      const front = d.front.report;
      if (!Number.isFinite(front.overallZ)) throw new Error(`${row.id}: invalid stored front aggregate.`);
      legacyMerged = {
        automatic: mergeReports(front, scoreSideMeasurements(automatic.measurements, sex)).overall,
        reviewed: mergeReports(front, finalReport).overall,
      };
    }
    return {
      captureId: row.id,
      enteredReferenceId: row.referenceId ?? null,
      identityNote: "Entered ID retained, not inferred or verified by this score-only replay.",
      referenceGroup: sex,
      sideImageFingerprint: photo,
      capturedBuild: d.build,
      guideVersion: d.side.landmarkGuideVersion ?? null,
      storedSideScore: d.side.report.overall,
      replayDelta: finalReport.overall - d.side.report.overall,
      automatic, reviewed,
      legacyMerged,
      candidateMerged: null,
    };
  });
  const candidateWeights = evaluateSideBandFit({}, "male").metrics;
  const definitions = SIDE_METRICS.map((def, index) => ({
    ...def, effectiveReliabilityWeight: reliabilityOf(def.id), effectiveTolerance: toleranceOf(def),
    effectiveOverallWeight: candidateWeights[index].overallWeight,
  }));
  const fullIdealVectors = (["male", "female"] as const).map((sex) => {
    const raw = Object.fromEntries(SIDE_METRICS.map((def) => [def.id, distFor(def, sex).ideal ?? distFor(def, sex).mean]));
    return {
      referenceGroup: sex,
      legacyFullSideCeiling: scoreSideMeasurements(raw, sex).overall,
      candidateFullBandFit: evaluateSideBandFit(raw, sex).overall.score,
    };
  });
  const range = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)] : null;
  return {
    schemaVersion: 1,
    purpose: "offline-side-scale-comparison-not-attractiveness-validation",
    candidateVersion: SIDE_BAND_FIT_VERSION,
    releaseStatus: "not-enabled-in-production",
    notice: "Fit scores describe the existing bands only. Neither these scores nor the placement pilot establish attractiveness ratings, population percentiles, or accuracy.",
    inputRows: faces.length,
    evaluatedRows: rows.length,
    excludedRowIds: [...excludeRows],
    ratingFieldsIgnored: faces.filter((row) => row.rating != null).length,
    modelDefinitionSha256: createHash("sha256").update(JSON.stringify({ definitions, version: SIDE_BAND_FIT_VERSION })).digest("hex"),
    ...scoreImplementationProvenance(),
    fullIdealVectors,
    ranges: {
      legacyReviewed: range(rows.map((row) => row.reviewed.legacySideScore)),
      candidateReviewed: range(rows.flatMap((row) => row.reviewed.candidate.overall.score == null ? [] : [row.reviewed.candidate.overall.score])),
    },
    rows,
  };
}

function main() {
  const args = process.argv.slice(2);
  const options = new Map<string, string[]>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!["--input", "--out", "--exclude-row"].includes(key) || !args[i + 1]) throw new Error("Use --input FILE --out IGNORED_FILE [--exclude-row CAPTURE_ID].");
    options.set(key, [...(options.get(key) ?? []), args[i + 1]]);
  }
  if (options.get("--input")?.length !== 1 || options.get("--out")?.length !== 1) throw new Error("Provide one --input and one --out.");
  const input = resolve(options.get("--input")![0]);
  const out = privateScoreOutputPath(REPOSITORY, options.get("--out")![0]);
  if (input === out) throw new Error("Never overwrite the source export.");
  // Private captures never become public fixtures accidentally.
  try { execFileSync("git", ["check-ignore", "--quiet", "--", out], { cwd: REPOSITORY, stdio: "ignore" }); }
  catch { throw new Error("Output must be inside a gitignored private directory in this repository."); }
  const bytes = readBoundedScoreInput(input);
  const result = {
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    ...evaluateCaptureDiagnostics(JSON.parse(bytes.toString("utf8")), new Set(options.get("--exclude-row") ?? [])),
  };
  // Exclusive creation preserves every earlier experiment.
  writePrivateScoreArtifact(REPOSITORY, out, result);
  console.log(JSON.stringify({ output: out, evaluatedRows: result.evaluatedRows, releaseStatus: result.releaseStatus, ranges: result.ranges }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
