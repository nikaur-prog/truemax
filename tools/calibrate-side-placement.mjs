// Offline development experiment. Never imported by the application.
// Training targets and fitted parameters remain in a private ignored directory.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POINT_IDS, canonicalId, validateAssistant, matchCaptures,
  loadOriginalRasters, verifyUnchangedFrame,
} from "./compare-placement-pilot.mjs";

export const PROTOCOL = Object.freeze({
  version: "side-owner-residual-development-v1",
  status: "offline-only-not-a-production-detector",
  targets: Object.freeze(["trichion", "pogonion", "menton", "cervicale", "gonion", "condylion", "tragion"]),
  method: "median owner-minus-automatic residual in an automatic brow-to-nose-base frame; separate seed methods",
  minimumTrainingIdentitiesPerMethod: 6,
  validation: "leave-one-identity-out; all captures of the held-out identity excluded from fitting",
  limitations: [
    "Development identities were previously inspected. This is not an untouched test set.",
    "Operator annotations are supervision, not established anatomical ground truth.",
    "This estimates systematic placement bias; it does not learn to recognize anatomy in image pixels.",
    "The independent assistant annotations are comparison targets only, never fitted targets.",
    "No age, ethnicity, reference sex, attractiveness rating, or score is a model input.",
    "No parameters are promoted into production by this experiment.",
  ],
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const inside = (p, width, height) => finite(p) && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return sorted.length ? (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2 : null;
};
export function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => {
    const i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i - Math.floor(i));
  };
  return { count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    median: sorted.length ? q(.5) : null, p90: sorted.length ? q(.9) : null,
    maximum: sorted.length ? sorted.at(-1) : null };
}

/** This file is explicit audit authorization, not a heuristic identity guess. */
export function selectCaptures(raw, assistant, selection, inputHash, annotationHash) {
  if (selection?.schemaVersion !== 1 || selection.sourceSha256 !== inputHash || selection.annotationSha256 !== annotationHash
    || !Array.isArray(selection.selected) || !Array.isArray(selection.excluded) || !Array.isArray(raw?.faces)) {
    fail("Selection must bind the exact raw export and frozen annotations by SHA-256.");
  }
  const byCapture = new Map();
  for (const face of raw.faces) {
    if (typeof face.id !== "string" || byCapture.has(face.id)) fail("Raw capture IDs must be unique.");
    byCapture.set(face.id, face);
  }
  const byIdentity = new Map(assistant.map((record) => [record.id, record]));
  const seen = new Set(); const identities = new Set(); const audit = [];
  const faces = selection.selected.map((entry) => {
    const face = byCapture.get(entry.captureId); const id = canonicalId(entry.referenceId);
    const reference = byIdentity.get(id);
    if (!face || seen.has(entry.captureId) || !reference || identities.has(id)) fail("Invalid, duplicate or unknown selected capture/identity.");
    const side = face.diagnostics?.side;
    if (side?.imageSource?.originalFileSha256 !== reference.image.sha256) fail(`${id}: selected image fingerprint does not match.`);
    const group = id.startsWith("m") ? "male" : "female";
    if (face.referenceGroup !== group || face.diagnostics?.referenceGroup !== group) fail(`${id}: reference group does not match the explicit corpus identity.`);
    seen.add(entry.captureId); identities.add(id);
    audit.push({ captureId: face.id, originalReferenceId: face.referenceId ?? null, analysisReferenceId: id,
      identityEvidence: "exact-original-file-sha256; no inference from facial appearance" });
    return { ...face, referenceId: id };
  });
  for (const entry of selection.excluded) {
    if (!byCapture.has(entry.captureId) || seen.has(entry.captureId) || typeof entry.reason !== "string" || !entry.reason.trim()) {
      fail("Every exclusion must identify a remaining raw capture and provide a reason.");
    }
    seen.add(entry.captureId);
  }
  if (seen.size !== byCapture.size) fail("Selection must explicitly account for every raw capture.");
  return { data: { ...raw, faces }, audit, excluded: selection.excluded };
}

export function makeRows(assistant, data, rasters) {
  const { matched, excluded } = matchCaptures(assistant, data);
  if (excluded.length) fail("Unmatched selected captures cannot enter calibration.");
  return assistant.filter((record) => matched.has(record.id)).map((record) => {
    const capture = matched.get(record.id);
    const frame = verifyUnchangedFrame(record, capture, rasters.get(record.id));
    const side = capture.side;
    if (!frame.verified) fail(`${record.id}: ${frame.reason}`);
    if (side.operatorVerified !== true || side.landmarkGuideVersion !== record.guideVersion || side.faceDir !== record.faceDir) {
      fail(`${record.id}: review confirmation, landmark guide or facing direction mismatch.`);
    }
    for (const id of POINT_IDS) {
      if (!inside(side.automaticPoints?.[id], side.width, side.height) || !inside(side.finalPoints?.[id], side.width, side.height)) {
        fail(`${record.id}/${id}: complete finite in-frame automatic and reviewed points required.`);
      }
    }
    validateLocalSeed(side, record.id);
    const automaticDirection = Math.sign(side.automaticPoints.pronasale.x - side.automaticPoints.tragion.x);
    if (automaticDirection !== side.faceDir) fail(`${record.id}: corrected facing direction cannot silently become a held-out model input.`);
    return { id: record.id, width: side.width, height: side.height, faceDir: side.faceDir, method: side.seedMethod,
      capturedBuild: capture.face.diagnostics.build, guideVersion: side.landmarkGuideVersion,
      automatic: side.automaticPoints, reviewed: side.finalPoints,
      assistant: Object.fromEntries(POINT_IDS.map((id) => [id, record.points[id]
        ? { x: record.points[id].x * side.width, y: record.points[id].y * side.height } : null])),
      assistantMetadata: record.pointMetadata, priorExposure: record.priorExposure };
  });
}

/** Never pool recovery templates, cloud fusion or missing provenance with local detection. */
export function validateLocalSeed(side, id = "capture") {
  const detail = side?.diagnostics;
  if (!["mesh", "segmentation", "silhouette"].includes(side?.seedMethod)
    || detail?.localMethod !== side.seedMethod || detail?.templateFallback !== false
    || detail?.coordinateSpace !== "review-image-pixels" || !detail?.localAutomaticPoints) {
    fail(`${id}: explicit non-template local seed provenance is required.`);
  }
  for (const key of POINT_IDS) {
    const local = detail.localAutomaticPoints[key]; const automatic = side.automaticPoints?.[key];
    if (!finite(local) || !finite(automatic) || local.x !== automatic.x || local.y !== automatic.y) {
      fail(`${id}: displayed automatic points must equal the captured local seed, without unrecorded fusion or transformation.`);
    }
  }
}

/** Check existing ancestors BEFORE mkdir; no symlink may redirect private artifacts. */
export async function privateOutputPath(repo, outputPath) {
  const privateRoot = resolve(repo, ".calibration-pilot"); const output = resolve(outputPath);
  const rel = relative(privateRoot, output);
  if (!rel || rel.startsWith("..") || resolve(privateRoot, rel) !== output) fail("Output must stay inside the ignored .calibration-pilot directory.");
  if ((await lstat(privateRoot)).isSymbolicLink()
    || await realpath(privateRoot) !== resolve(await realpath(repo), ".calibration-pilot")) {
    fail("The private calibration root must not be a symlink or resolve outside the repository.");
  }
  let ancestor = dirname(output);
  while (ancestor !== privateRoot) {
    let info;
    try { info = await lstat(ancestor); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (info?.isSymbolicLink()) fail("A symlink must not redirect private calibration output.");
    if (info && !info.isDirectory()) fail("Output ancestors must be directories.");
    ancestor = dirname(ancestor);
  }
  return output;
}

/** Crucially uses automatic anchors, never reviewed/held-out target coordinates. */
export function automaticFrame(row) {
  const brow = row.automatic?.glabella; const base = row.automatic?.subnasale;
  if (!finite(brow) || !finite(base) || ![1, -1].includes(row.faceDir)) return null;
  const dx = base.x - brow.x; const dy = base.y - brow.y; const length = Math.hypot(dx, dy);
  if (length < .01 * Math.hypot(row.width, row.height) || length > .7 * Math.hypot(row.width, row.height)) return null;
  const v = { x: dx / length, y: dy / length };
  let u = { x: v.y, y: -v.x };
  if (u.x * row.faceDir < 0) u = { x: -u.x, y: -u.y };
  return { u, v, length };
}

export function fitResiduals(rows) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) fail("Fit requires one capture per independent identity.");
  const groups = {};
  for (const method of new Set(rows.map((row) => row.method))) {
    const training = rows.filter((row) => row.method === method && automaticFrame(row));
    if (training.length < PROTOCOL.minimumTrainingIdentitiesPerMethod) continue;
    groups[method] = {};
    for (const id of PROTOCOL.targets) {
      const residuals = training.filter((row) => finite(row.reviewed[id]) && finite(row.automatic[id])).map((row) => {
        const f = automaticFrame(row); const a = row.automatic[id]; const b = row.reviewed[id];
        const dx = b.x - a.x; const dy = b.y - a.y;
        return { u: (dx * f.u.x + dy * f.u.y) / f.length, v: (dx * f.v.x + dy * f.v.y) / f.length };
      });
      if (residuals.length >= PROTOCOL.minimumTrainingIdentitiesPerMethod) {
        groups[method][id] = { u: median(residuals.map((p) => p.u)), v: median(residuals.map((p) => p.v)), trainingCount: residuals.length };
      }
    }
  }
  return { version: PROTOCOL.version, groups, trainingIdentityCount: rows.length };
}

export function applyResiduals(row, model) {
  const points = structuredClone(row.automatic); const changed = []; const rejected = [];
  const f = automaticFrame(row);
  if (!f) return { points, changed, rejected: ["automatic-frame-unavailable"] };
  for (const id of PROTOCOL.targets) {
    const correction = model.groups[row.method]?.[id];
    if (!correction) continue;
    const a = points[id];
    const candidate = { x: a.x + f.length * (correction.u * f.u.x + correction.v * f.v.x),
      y: a.y + f.length * (correction.u * f.u.y + correction.v * f.v.y) };
    // Failed predictions fall back and stay in the error denominator. No clipping to labels.
    if (!inside(candidate, row.width, row.height)) { rejected.push(id); continue; }
    points[id] = candidate; changed.push(id);
  }
  return { points, changed, rejected };
}

export function evaluate(rows) {
  if (rows.length < 3) fail("At least three independent identities are required.");
  if (new Set(rows.map((row) => row.id)).size !== rows.length) fail("Duplicate identities would leak across folds.");
  const folds = rows.map((heldOut) => {
    const training = rows.filter((row) => row.id !== heldOut.id);
    const model = fitResiduals(training);
    const prediction = applyResiduals(heldOut, model);
    const diagonal = Math.hypot(heldOut.width, heldOut.height);
    const distance = (a, b) => finite(a) && finite(b) ? Math.hypot(a.x - b.x, a.y - b.y) / diagonal : null;
    const points = POINT_IDS.map((id) => ({ id, attempted: prediction.changed.includes(id),
      automaticOwner: distance(heldOut.automatic[id], heldOut.reviewed[id]),
      candidateOwner: distance(prediction.points[id], heldOut.reviewed[id]),
      automaticAssistant: distance(heldOut.automatic[id], heldOut.assistant[id]),
      candidateAssistant: distance(prediction.points[id], heldOut.assistant[id]),
      assistantVisibility: heldOut.assistantMetadata?.[id]?.visibility ?? "not-recorded",
      assistantConfidence: heldOut.assistantMetadata?.[id]?.confidence ?? null,
    }));
    return { id: heldOut.id, method: heldOut.method, priorExposure: heldOut.priorExposure,
      trainingIdentityIds: training.map((row) => row.id), rejected: prediction.rejected, points,
      candidatePoints: prediction.points };
  });
  const stats = (points) => Object.fromEntries(["automaticOwner", "candidateOwner", "automaticAssistant", "candidateAssistant"]
    .map((key) => [key, summary(points.map((p) => p[key]).filter(Number.isFinite))]));
  const all = folds.flatMap((fold) => fold.points);
  const result = { protocol: PROTOCOL, identities: rows.length, unit: "fraction of original image diagonal; disagreement, not anatomical accuracy",
    aggregate: stats(all),
    byMethod: Object.fromEntries([...new Set(rows.map((row) => row.method))].map((method) => [method, stats(folds.filter((f) => f.method === method).flatMap((f) => f.points))])),
    byPoint: Object.fromEntries(POINT_IDS.map((id) => [id, stats(all.filter((p) => p.id === id))])),
    noPriorAssistantExposure: stats(folds.filter((f) => f.priorExposure === "declared-none").flatMap((f) => f.points)),
    regressions: all.filter((p) => p.candidateOwner > p.automaticOwner + 1e-12).length,
    improved: all.filter((p) => p.candidateOwner < p.automaticOwner - 1e-12).length,
    unchanged: all.filter((p) => Math.abs(p.candidateOwner - p.automaticOwner) <= 1e-12).length,
    folds,
    fullDevelopmentFit: fitResiduals(rows),
    releaseDecision: "NOT PROMOTED: a scaled residual template is not image-based anatomy recognition, and this inspected synthetic pilot is not independent deployment validation.",
  };
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5) fail("Usage: node tools/calibrate-side-placement.mjs <frozen-annotations.json> <raw-export.json> <explicit-selection.json> <original-images-directory> <private-output.json>");
  const [annotationsPath, capturesPath, selectionPath, imagesPath, outputPath] = args;
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = await privateOutputPath(repo, outputPath);
  if ([annotationsPath, capturesPath, selectionPath].some((p) => resolve(p) === output)) fail("Never overwrite input evidence.");
  const [annotationsBytes, captureBytes, selectionBytes] = await Promise.all([annotationsPath, capturesPath, selectionPath].map(async (path) => {
    const bytes = await readFile(path); if (bytes.length > 30_000_000) fail("Input exceeds 30 MB safety limit."); return bytes;
  }));
  const annotations = validateAssistant(JSON.parse(annotationsBytes));
  const selected = selectCaptures(JSON.parse(captureBytes), annotations, JSON.parse(selectionBytes), hash(captureBytes), hash(annotationsBytes));
  const rasters = await loadOriginalRasters(annotations, imagesPath);
  const rows = makeRows(annotations, selected.data, rasters);
  if (new Set(rows.map((row) => row.capturedBuild)).size !== 1 || rows.some((row) => !row.capturedBuild)) {
    fail("Compare one explicit capture build at a time; mixed detector versions cannot be pooled silently.");
  }
  const result = evaluate(rows);
  const artifact = { ...result, generatedAt: new Date().toISOString(),
    provenance: { rawCaptureSha256: hash(captureBytes), frozenAnnotationsSha256: hash(annotationsBytes), selectionSha256: hash(selectionBytes),
      implementationSha256: hash(await readFile(fileURLToPath(import.meta.url))), inputFilesModified: false, rawIdentityReconciliation: selected.audit, exclusions: selected.excluded } };
  await mkdir(dirname(output), { recursive: true });
  await privateOutputPath(repo, output);
  // Exclusive create: reruns use a new filename, never erase a previous experiment.
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, identities: result.identities, aggregate: result.aggregate,
    improved: result.improved, regressions: result.regressions, unchanged: result.unchanged, releaseDecision: result.releaseDecision }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
