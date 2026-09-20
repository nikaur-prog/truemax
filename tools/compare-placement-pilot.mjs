// Private, offline comparison only. This never fits a detector or scoring model.
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POINT_IDS = Object.freeze([
  "trichion", "glabella", "nasion", "pronasale", "subnasale",
  "labialeSuperius", "labialeInferius", "pogonion", "menton",
  "cervicale", "gonion", "condylion", "tragion",
]);
const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 30_000_000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const dimension = (value) => Number.isSafeInteger(value) && value > 0 && value <= 20_000;
const fraction = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };

export function canonicalId(value) {
  if (typeof value !== "string") return null;
  const match = /^([mfw])0*([1-9]\d?)$/i.exec(value.trim());
  return match ? `${match[1].toLowerCase() === "m" ? "m" : "f"}${match[2].padStart(2, "0")}` : null;
}

function point(value, context, annotated) {
  if (value === undefined || value === null) return null;
  if (!object(value)) fail(`${context}: expected a point or null.`);
  if (annotated) {
    if (!["visible", "estimated", "unobservable"].includes(value.visibility)) fail(`${context}: invalid visibility.`);
    if (!["high", "medium", "low"].includes(value.confidence)) fail(`${context}: invalid confidence.`);
    if (value.visibility === "unobservable") {
      if (value.x !== null || value.y !== null) fail(`${context}: unobservable points must have null x and y.`);
      return null;
    }
  }
  if (!fraction(value.x) || !fraction(value.y)) fail(`${context}: point is outside the normalized image or is not finite.`);
  return { x: value.x, y: value.y, visibility: annotated ? value.visibility : "not-recorded", confidence: annotated ? value.confidence : "not-recorded" };
}

export function validateAssistant(data) {
  const canonicalSchema = object(data) && data.schemaVersion === 1 && data.kind === "independent-assistant-side-placement"
    && data.coordinateSpace === "normalized-original-image";
  const viewerSchema = object(data) && data.schemaVersion === "assistant-side-placement-pilot-v1"
    && data.coordinateSystem === "normalized-original-image" && data.origin === "top-left"
    && data.annotationSource === "assistant-independent-visual-review";
  if ((!canonicalSchema && !viewerSchema) || typeof data.guideVersion !== "string"
    || !data.guideVersion || !Array.isArray(data.records) || data.records.length > 500) {
    fail("Expected the version-1 independent assistant side-placement schema (at most 500 records).");
  }
  const ids = new Set();
  const hashes = new Set();
  return data.records.map((record, index) => {
    const id = canonicalId(record?.id);
    if (!id || ids.has(id)) fail(`Assistant record ${index + 1}: invalid or duplicate identity.`);
    const rawImage = record.image;
    // Viewer paths point from its private HTML directory; never follow that traversal.
    // Only the basename is looked up inside the explicitly chosen images root, then hashed.
    const image = object(rawImage) ? { ...rawImage, file: viewerSchema && typeof rawImage.relativePath === "string" ? basename(rawImage.relativePath) : rawImage.file } : null;
    if (!object(image) || typeof image.file !== "string" || !image.file || !SHA.test(image.sha256)
      || !dimension(image.width) || !dimension(image.height) || image.width * image.height > 40_000_000) {
      fail(`${id}: invalid original-image metadata.`);
    }
    if (hashes.has(image.sha256)) fail(`${id}: the same original image is assigned to multiple identities.`);
    if (record.faceDir !== 1 && record.faceDir !== -1) fail(`${id}: faceDir must be 1 or -1.`);
    if (!object(record.points)) fail(`${id}: points must be an object.`);
    for (const key of Object.keys(record.points)) if (!POINT_IDS.includes(key)) fail(`${id}: unknown landmark ${key}.`);
    const points = Object.fromEntries(POINT_IDS.map((key) => [key, point(record.points[key], `${id}/${key}`, true)]));
    const pointMetadata = Object.fromEntries(POINT_IDS.map((key) => [key, {
      visibility: record.points[key] === undefined || record.points[key] === null ? "not-recorded" : record.points[key].visibility,
      confidence: record.points[key]?.confidence ?? null,
    }]));
    ids.add(id); hashes.add(image.sha256);
    return { id, image, faceDir: record.faceDir, points, pointMetadata, guideVersion: data.guideVersion,
      priorExposure: record.priorExposure === "none" ? "declared-none"
        : typeof record.priorExposure === "string" && record.priorExposure.trim() ? "declared" : "not-declared" };
  });
}

export function displayedRgbaHash(width, height, rgba) {
  if (rgba.length !== width * height * 4) fail("The RGBA byte count does not match the image dimensions.");
  return createHash("sha256").update(`truemax-calibration-rgba8-v1\n${width}x${height}\n`).update(rgba).digest("hex");
}

/** Identity matching is not frame verification. A byte match alone says nothing about a crop. */
export function matchCaptures(assistant, data) {
  if (!object(data) || data.schemaVersion !== 1 || !Array.isArray(data.faces) || data.faces.length > 500) {
    fail("Expected a version-1 all-capture diagnostics export with faces[] (at most 500 records).");
  }
  const byId = new Map(assistant.map((record) => [record.id, record]));
  const byHash = new Map(assistant.map((record) => [record.image.sha256, record]));
  const matched = new Map();
  const excluded = [];
  data.faces.forEach((face, index) => {
    const side = face?.diagnostics?.side;
    if (!side) { excluded.push({ captureIndex: index, reason: "no-side-capture" }); return; }
    const source = side.imageSource;
    const hash = source?.originalFileSha256;
    if (hash !== undefined && !SHA.test(hash)) fail(`Capture ${index}: invalid original-file hash.`);
    // id is a save-order key in this export, never an independent dataset match.
    const explicit = canonicalId(face.referenceId);
    const hashMatch = hash ? byHash.get(hash) : undefined;
    const idMatch = explicit ? byId.get(explicit) : undefined;
    if (hashMatch && explicit && explicit !== hashMatch.id) fail(`Capture ${index}: identity and original-file hash conflict.`);
    if (hash && !hashMatch && idMatch) fail(`Capture ${index}: identity matches but the original image is different.`);
    const record = hashMatch ?? (!hash ? idMatch : undefined);
    if (!record) { excluded.push({ captureIndex: index, reason: "unmatched-identity-or-image" }); return; }
    if (matched.has(record.id)) fail(`${record.id}: multiple side captures match; explicitly select one capture before comparing.`);
    if (!dimension(side.width) || !dimension(side.height) || side.coordinateSpace !== "review-image-pixels") {
      fail(`${record.id}: invalid or unsupported side coordinate frame.`);
    }
    if (side.faceDir !== 1 && side.faceDir !== -1) fail(`${record.id}: invalid side facing direction.`);
    if (source && (source.schemaVersion !== 1 || source.width !== side.width || source.height !== side.height
      || source.pixelFormat !== "rgba8" || source.orientation !== "review-image-as-displayed"
      || !SHA.test(source.reviewPixelsSha256))) fail(`${record.id}: invalid displayed-image metadata.`);
    const normalize = (points, kind) => Object.fromEntries(POINT_IDS.map((key) => {
      const value = points?.[key];
      if (value === undefined || value === null) return [key, null];
      if (!object(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) fail(`${record.id}/${key}: invalid ${kind} coordinate.`);
      return [key, point({ x: value.x / side.width, y: value.y / side.height }, `${record.id}/${key}/${kind}`, false)];
    }));
    matched.set(record.id, { side, face, source, matchedBy: hashMatch ? "original-file-sha256" : "explicit-identity-only",
      system: normalize(side.automaticPoints, "system"), human: normalize(side.finalPoints, "human") });
  });
  return { matched, excluded, totalCaptures: data.faces.length };
}

/** No crop/resize/rotation is guessed. Exact dimensions and displayed pixels must agree. */
export function verifyUnchangedFrame(record, capture, raster) {
  if (!capture.source?.originalFileSha256) return { verified: false, reason: "missing-original-file-hash" };
  if (capture.source.originalFileSha256 !== record.image.sha256) return { verified: false, reason: "different-original-file" };
  if (!raster || raster.sha256 !== record.image.sha256 || raster.width !== record.image.width || raster.height !== record.image.height) {
    return { verified: false, reason: "original-raster-not-verified" };
  }
  if (raster.orientation !== 1) return { verified: false, reason: "original-orientation-needs-explicit-transform" };
  if (capture.side.width !== raster.width || capture.side.height !== raster.height) {
    return { verified: false, reason: "different-raster-dimensions-needs-explicit-transform" };
  }
  if (capture.source.reviewPixelsSha256 !== raster.reviewPixelsSha256) {
    return { verified: false, reason: "displayed-pixels-do-not-match-original-raster" };
  }
  return { verified: true, reason: "exact-original-bytes-dimensions-and-displayed-rgba" };
}

/** Historical pilot exports have recorded identity-frame metadata, not a displayed-pixel digest. */
export function matchHistoricalBaseline(assistant, exportData, rasters) {
  const data = exportData?.data;
  if (!object(data) || data.schemaVersion !== 1 || !Array.isArray(data.records) || data.records.length > 500
    || data.runtime?.localOnly !== true || data.runtime?.ownerPriorUsed !== false || data.runtime?.automaticPointsVerified !== false) {
    fail("Expected a version-1 local pilot baseline wrapped in data, with unverified automatic points and owner priors disabled.");
  }
  const byId = new Map(assistant.map((record) => [record.id, record]));
  const byHash = new Map(assistant.map((record) => [record.image.sha256, record]));
  const matched = new Map();
  const excluded = [];
  for (const [index, historical] of data.records.entries()) {
    if (historical?.view !== "side") continue;
    const source = historical.source;
    const id = canonicalId(historical.personId);
    if (!source || !SHA.test(source.sha256) || !id) fail(`Historical side record ${index}: invalid image hash or identity.`);
    const record = byHash.get(source.sha256);
    if (record && id !== record.id) fail(`Historical side record ${index}: identity and image hash conflict.`);
    if (!record && byId.has(id)) fail(`${id}: historical baseline uses a different original image.`);
    if (!record) { excluded.push({ captureIndex: index, reason: "unmatched-identity-or-image" }); continue; }
    if (matched.has(id)) fail(`${id}: duplicate historical baseline capture.`);
    if (!Array.isArray(historical.points)) fail(`${id}: historical points are missing.`);
    const points = {};
    for (const p of historical.points) {
      if (!POINT_IDS.includes(p?.id) || own(points, p.id)) fail(`${id}: unknown or duplicate historical landmark.`);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !dimension(source.width) || !dimension(source.height)) {
        fail(`${id}/${p.id}: invalid historical pixel coordinates or dimensions.`);
      }
      const normalized = { x: p.x / source.width, y: p.y / source.height };
      if (!fraction(p.normalizedX) || !fraction(p.normalizedY) || Math.abs(normalized.x - p.normalizedX) > 1e-9 || Math.abs(normalized.y - p.normalizedY) > 1e-9) {
        fail(`${id}/${p.id}: historical normalized and pixel coordinates disagree.`);
      }
      points[p.id] = point(normalized, `${id}/${p.id}/historical-system`, false);
    }
    for (const key of POINT_IDS) if (!own(points, key)) points[key] = null;
    const faceDir = historical.diagnostics?.measuredFaceDir;
    if (faceDir !== 1 && faceDir !== -1) fail(`${id}: historical measured facing direction is missing.`);
    const raster = rasters.get(id);
    let reason = null;
    if (!raster || raster.sha256 !== source.sha256 || raster.width !== record.image.width || raster.height !== record.image.height) reason = "original-raster-not-verified";
    else if (raster.orientation !== 1 || source.mirrored !== false
      || source.orientation !== "Browser image decoder applies embedded orientation; no additional rotation, crop or mirror") reason = "historical-orientation-needs-explicit-transform";
    else if (source.nativeWidth !== raster.width || source.nativeHeight !== raster.height || source.width !== raster.width || source.height !== raster.height) reason = "historical-raster-dimensions-needs-explicit-transform";
    matched.set(id, { system: points, faceDir, method: historical.diagnostics?.method ?? null,
      frame: { verified: reason === null, reason: reason ?? "recorded-identity-frame-metadata-and-verified-original-bytes",
        evidenceTier: "recorded-identity-frame-metadata", displayedPixelProof: false },
      guideVersion: null, status: historical.status ?? null });
  }
  return { matched, excluded, totalSideRecords: data.records.filter((record) => record?.view === "side").length,
    provenance: { source: "historical-local-device", build: typeof data.build === "string" ? data.build : null,
      startedAt: typeof data.startedAt === "string" ? data.startedAt : null, completedAt: typeof data.completedAt === "string" ? data.completedAt : null,
      recordedGuideVersion: null, ownerPriorUsed: false, automaticPointsVerified: false,
      limitation: "Historical local-device output, not a fresh production or cloud run. Frame identity is recorded metadata corroborated by original file hashes and dimensions, not independent displayed-pixel proof. No per-landmark origin should be inferred from the overall method." } };
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, mean: null, median: null, p90: null, maximum: null };
  const quantile = (p) => {
    const i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i - Math.floor(i));
  };
  return { count: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: quantile(.5), p90: quantile(.9), maximum: sorted.at(-1) };
}

function distance(a, b, width, height) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) / Math.hypot(width, height);
}

export function comparePilot(assistantData, capturesData = null, rasters = new Map(), baselineData = null) {
  const assistant = validateAssistant(assistantData);
  const { matched, excluded, totalCaptures } = capturesData ? matchCaptures(assistant, capturesData)
    : { matched: new Map(), excluded: [], totalCaptures: 0 };
  const baseline = baselineData ? matchHistoricalBaseline(assistant, baselineData, rasters) : null;
  const pairKinds = [["system", "assistant"], ["system", "human"], ["assistant", "human"]];
  const identities = assistant.map((record) => {
    const capture = matched.get(record.id);
    const frame = capture ? verifyUnchangedFrame(record, capture, rasters.get(record.id)) : { verified: false, reason: "no-matched-capture" };
    const historical = baseline?.matched.get(record.id);
    const hasSystem = baseline ? Boolean(historical) : Boolean(capture);
    const systemFrame = baseline ? historical?.frame ?? { verified: false, reason: "no-matched-historical-baseline" } : frame;
    const systemGuide = baseline ? historical?.guideVersion : capture?.side.landmarkGuideVersion;
    const humanGuide = capture?.side.landmarkGuideVersion;
    const automaticNose = capture?.system.pronasale; const automaticEar = capture?.system.tragion;
    const automaticDirection = automaticNose && automaticEar && automaticNose.x !== automaticEar.x ? (automaticNose.x > automaticEar.x ? 1 : -1) : null;
    const systemDirection = baseline ? historical?.faceDir ?? null : automaticDirection;
    const pairs = Object.fromEntries(pairKinds.map(([a, b]) => {
      const involvesAssistant = a === "assistant" || b === "assistant";
      const involvesSystem = a === "system" || b === "system";
      const involvesHuman = a === "human" || b === "human";
      const eligibility = involvesSystem && !hasSystem ? "no-matched-system-capture"
        : involvesHuman && !capture ? "no-matched-human-capture"
        : involvesSystem && (involvesAssistant || baseline) && !systemFrame.verified ? systemFrame.reason
        : involvesHuman && (involvesAssistant || baseline) && !frame.verified ? frame.reason
        : involvesHuman && capture.side.operatorVerified !== true ? "human-review-not-confirmed"
        : null;
      const guides = { assistant: record.guideVersion, system: systemGuide, human: humanGuide };
      const sameGuide = Boolean(guides[a] && guides[a] === guides[b]);
      const sets = { assistant: record.points, system: baseline ? historical?.system : capture?.system, human: capture?.human };
      const width = involvesAssistant || baseline ? record.image.width : capture?.side.width;
      const height = involvesAssistant || baseline ? record.image.height : capture?.side.height;
      const points = POINT_IDS.map((id) => {
        const first = sets[a]?.[id]; const second = sets[b]?.[id];
        const absence = (rater) => rater === "assistant" && record.pointMetadata[id].visibility === "unobservable" ? "assistant-point-unobservable" : `${rater}-point-missing`;
        const reason = eligibility ?? (!first && !second ? "both-points-missing" : !first ? absence(a) : !second ? absence(b) : null);
        return { id, comparable: reason === null, reason, imageDiagonalFraction: reason === null ? distance(first, second, width, height) : null,
          assistantVisibility: involvesAssistant ? record.pointMetadata[id].visibility : null,
          assistantConfidence: involvesAssistant ? record.pointMetadata[id].confidence : null };
      });
      const comparable = points.filter((p) => p.comparable);
      return [`${a}-vs-${b}`, { eligible: eligibility === null, reason: eligibility, possiblePoints: POINT_IDS.length,
        warnings: [
          ...(!sameGuide && eligibility === null ? ["guide-version-missing-or-different: geometric disagreement only; verify intended landmark definitions, especially hinge and ear notch"] : []),
          ...(involvesSystem && baseline ? ["historical-local-system: recorded identity-frame metadata, not exact displayed-pixel proof or current production/cloud validation"] : []),
        ],
        guideVersionMatches: sameGuide,
        comparablePoints: comparable.length, missingPoints: POINT_IDS.length - comparable.length,
        distance: summary(comparable.map((p) => p.imageDiagonalFraction)), points }];
    }));
    return { id: record.id, priorExposure: record.priorExposure, captureMatched: Boolean(capture), matchedBy: capture?.matchedBy ?? null,
      frame, systemFrame, systemMatched: hasSystem, systemSource: baseline ? "historical-local-device" : "automatic-at-human-capture",
      guideVersionMatches: Boolean(humanGuide && humanGuide === record.guideVersion), humanReviewKind: capture?.side.reviewKind ?? null,
      humanReviewConfirmed: capture?.side.operatorVerified === true,
      systemSeedMethod: baseline ? historical?.method ?? null : capture?.side.seedMethod ?? null,
      systemTemplateFallback: baseline ? null : capture?.side.diagnostics?.templateFallback ?? null,
      systemFacingDirectionSource: baseline ? "historical-measured-direction" : "derived-from-original-automatic-nose-and-ear",
      facingDisagreement: systemFrame.verified && hasSystem && systemDirection !== null ? record.faceDir !== systemDirection : null,
      humanFacingDisagreement: frame.verified && capture?.side.operatorVerified === true ? record.faceDir !== capture.side.faceDir : null, pairs };
  });
  const summarizePairs = (included) => Object.fromEntries(pairKinds.map(([a, b]) => {
    const name = `${a}-vs-${b}`;
    const all = included.flatMap((record) => record.pairs[name].points);
    const comparable = all.filter((p) => p.comparable);
    const reasonCounts = {};
    for (const p of all) if (!p.comparable) reasonCounts[p.reason] = (reasonCounts[p.reason] ?? 0) + 1;
    const strata = (points) => a === "assistant" || b === "assistant" ? {
      byConfidence: Object.fromEntries(["high", "medium", "low", "not-recorded"].map((level) => {
        const group = points.filter((p) => (p.assistantConfidence ?? "not-recorded") === level);
        const usable = group.filter((p) => p.comparable);
        return [level, { possiblePoints: group.length, comparablePoints: usable.length, missingPoints: group.length - usable.length,
          distance: summary(usable.map((p) => p.imageDiagonalFraction)) }];
      })),
      byVisibility: Object.fromEntries(["visible", "estimated", "unobservable", "not-recorded"].map((level) => {
        const group = points.filter((p) => p.assistantVisibility === level); const usable = group.filter((p) => p.comparable);
        return [level, { possiblePoints: group.length, comparablePoints: usable.length, missingPoints: group.length - usable.length,
          distance: summary(usable.map((p) => p.imageDiagonalFraction)) }];
      })),
      visibleNotLowConfidence: summary(points.filter((p) => p.comparable && p.assistantVisibility === "visible"
        && ["high", "medium"].includes(p.assistantConfidence)).map((p) => p.imageDiagonalFraction)),
    } : null;
    const byLandmark = POINT_IDS.map((id) => {
      const points = all.filter((p) => p.id === id);
      const values = points.filter((p) => p.comparable);
      return { id, possible: included.length, comparable: values.length, missing: included.length - values.length,
        distance: summary(values.map((p) => p.imageDiagonalFraction)),
        assistantStrata: strata(points),
        assistantVisibleOnly: a === "assistant" || b === "assistant" ? summary(values.filter((p) => p.assistantVisibility === "visible").map((p) => p.imageDiagonalFraction)) : null };
    });
    return [name, { possibleIdentities: included.length, comparableIdentities: included.filter((record) => record.pairs[name].comparablePoints > 0).length,
      guideUnknownOrDifferentIdentities: included.filter((record) => record.pairs[name].comparablePoints > 0 && !record.pairs[name].guideVersionMatches).length,
      possiblePoints: all.length, comparablePoints: comparable.length, missingPoints: all.length - comparable.length, missingReasons: reasonCounts,
      distance: summary(comparable.map((p) => p.imageDiagonalFraction)), assistantStrata: strata(all), byLandmark }];
  }));
  const primary = identities.filter((record) => record.priorExposure === "declared-none");
  return {
    schemaVersion: 1, kind: "three-rater-side-placement-comparison",
    interpretation: "Pairwise disagreement, not placement accuracy or ground truth. Human corrections are operator annotations. Shared starting points can inflate apparent agreement. This does not fit a detector or repair scoring.",
    distanceUnit: "Euclidean pixel distance divided by that image's diagonal; 0.01 means 1% of the diagonal, not 1% error or 99% accuracy.",
    framePolicy: "Human-capture cross-frame comparisons require exact original-file bytes, dimensions, original orientation and displayed-RGBA hash. Historical system baselines instead use the explicitly labelled recorded-identity-frame metadata tier, corroborated by original bytes and dimensions; no displayed-pixel digest is invented. Automatic and human points from one capture share its review raster. No guessed crop, resize or rotation. Unknown guides are flagged, not treated as equivalent-definition accuracy tests.",
    aggregationCaution: "Equal weight per comparable point, with denominators and missingness shown. Different face size or framing can change normalized distances; this is a controlled pilot, not population validation.",
    landmarkCaution: "condylion is a photographed surface proxy, not the unseen skeletal joint. Historical hinge and tragion wording may differ; inspect these disagreements before interpreting them as detector errors.",
    assistantIdentities: assistant.length, captureRecords: totalCaptures, matchedSideCaptures: matched.size,
    historicalBaseline: baseline ? { ...baseline.provenance, totalSideRecords: baseline.totalSideRecords, matchedSideRecords: baseline.matched.size, excludedRecords: baseline.excluded } : null,
    excludedCaptureRecords: excluded, pairSummaries: summarizePairs(identities),
    primaryBlindedSubset: { interpretation: "Only records explicitly declaring priorExposure: none. This concerns assistant exposure, not whether the human worked without system starting points.",
      includedIds: primary.map((record) => record.id), excludedIds: identities.filter((record) => record.priorExposure !== "declared-none").map((record) => record.id),
      pairSummaries: summarizePairs(primary) }, identities,
  };
}

async function readJson(path) {
  if ((await stat(path)).size > MAX_BYTES) fail("Input exceeds the 30 MB local comparison limit.");
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadOriginalRasters(records, imagesRoot) {
  const root = await realpath(imagesRoot);
  const { default: sharp } = await import("sharp");
  const rasters = new Map();
  for (const record of records) {
    const path = await realpath(resolve(root, record.image.file));
    const rel = relative(root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail(`${record.id}: image file must be within the explicitly supplied images root.`);
    if ((await stat(path)).size > MAX_BYTES) fail(`${record.id}: original image exceeds 30 MB.`);
    const bytes = await readFile(path);
    if (digest(bytes) !== record.image.sha256) fail(`${record.id}: original image file hash does not match the annotation.`);
    const options = { limitInputPixels: 40_000_000 };
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.width !== record.image.width || metadata.height !== record.image.height || (metadata.pages ?? 1) !== 1) {
      fail(`${record.id}: original image dimensions or frame count differ from the annotation.`);
    }
    const { data, info } = await sharp(bytes, options).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width !== metadata.width || info.height !== metadata.height) fail(`${record.id}: unsupported decoded raster.`);
    rasters.set(record.id, { sha256: record.image.sha256, width: info.width, height: info.height,
      orientation: metadata.orientation ?? 1, reviewPixelsSha256: displayedRgbaHash(info.width, info.height, data) });
  }
  return rasters;
}

async function main(args) {
  if (args.includes("--help")) {
    process.stdout.write("Usage: node tools/compare-placement-pilot.mjs --assistant PRIVATE.json --images-root PRIVATE_IMAGES [--captures PRIVATE_DIAGNOSTICS.json] [--baseline PRIVATE_HISTORICAL_PILOT.json]\nOffline, read-only. JSON on stdout contains disagreement summaries, never photos or point coordinates. No scoring or training changes. --baseline explicitly selects historical local automatic placements, not a current production/cloud run.\n");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    if (!["--assistant", "--images-root", "--captures", "--baseline"].includes(key) || !value || value.startsWith("--") || own(options, key)) fail("Invalid or duplicate argument. Use --help.");
    options[key] = value;
  }
  if (!options["--assistant"] || !options["--images-root"]) fail("Supply --assistant and --images-root. Use --help.");
  const data = await readJson(options["--assistant"]);
  const records = validateAssistant(data);
  const rasters = await loadOriginalRasters(records, options["--images-root"]);
  const captures = options["--captures"] ? await readJson(options["--captures"]) : null;
  const baseline = options["--baseline"] ? await readJson(options["--baseline"]) : null;
  process.stdout.write(`${JSON.stringify(comparePilot(data, captures, rasters, baseline), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Placement comparison failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
