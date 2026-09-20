import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POINT_IDS, canonicalId, validateAssistant, matchCaptures, displayedRgbaHash, verifyUnchangedFrame, comparePilot, loadOriginalRasters } from "./compare-placement-pilot.mjs";

// Constructed geometric fixtures, never pilot photographs or annotations.
const fileHash = "a".repeat(64);
const pixelHash = "b".repeat(64);
const guideVersion = "side-surface-guide-2";
const assistant = () => ({ schemaVersion: 1, kind: "independent-assistant-side-placement", guideVersion,
  coordinateSpace: "normalized-original-image", records: [{ id: "m01", image: { file: "synthetic.png", sha256: fileHash, width: 600, height: 800 }, faceDir: 1,
    points: Object.fromEntries(POINT_IDS.map((id, i) => [id, { x: .2 + i * .02, y: .25 + i * .01, visibility: "visible", confidence: "medium" }])) }] });
const captures = () => ({ schemaVersion: 1, faces: [{ id: "m1", referenceId: "m01", diagnostics: { side: {
  coordinateSpace: "review-image-pixels", width: 600, height: 800, faceDir: 1, landmarkGuideVersion: guideVersion,
  operatorVerified: true, reviewKind: "operator-not-expert", seedMethod: "mesh",
  imageSource: { schemaVersion: 1, originalFileSha256: fileHash, reviewPixelsSha256: pixelHash, width: 600, height: 800, pixelFormat: "rgba8", orientation: "review-image-as-displayed" },
  automaticPoints: Object.fromEntries(POINT_IDS.map((id, i) => [id, { x: (.2 + i * .02) * 600, y: (.25 + i * .01) * 800 }])),
  finalPoints: Object.fromEntries(POINT_IDS.map((id, i) => [id, { x: (.2 + i * .02) * 600 + 10, y: (.25 + i * .01) * 800 }])),
} } }] });
const rasters = () => new Map([["m01", { sha256: fileHash, width: 600, height: 800, orientation: 1, reviewPixelsSha256: pixelHash }]]);
const compare = (a = assistant(), c = captures(), r = rasters()) => comparePilot(a, c, r);
const historical = () => ({ data: { schemaVersion: 1, build: "dev", startedAt: "2026-09-09T00:00:00Z", completedAt: "2026-09-09T00:01:00Z",
  runtime: { localOnly: true, ownerPriorUsed: false, automaticPointsVerified: false }, records: [{ personId: "m01", view: "side", key: "m01-side", status: "complete",
    source: { filename: "synthetic.png", sha256: fileHash, nativeWidth: 600, nativeHeight: 800, width: 600, height: 800, mirrored: false,
      orientation: "Browser image decoder applies embedded orientation; no additional rotation, crop or mirror" },
    points: POINT_IDS.map((id, i) => ({ id, x: (.2 + i * .02) * 600, y: (.25 + i * .01) * 800, normalizedX: .2 + i * .02, normalizedY: .25 + i * .01 })),
    diagnostics: { method: "mesh", measuredFaceDir: 1, automaticPointsVerified: false, ownerPriorUsed: false },
  }] }, nonFiniteValues: [] });

test("identity aliases are explicit and do not infer identity from appearance", () => {
  for (const [value, id] of [["m1", "m01"], ["m01", "m01"], ["w1", "f01"], ["w01", "f01"], ["f01", "f01"], ["F10", "f10"]]) assert.equal(canonicalId(value), id);
  for (const invalid of ["male1", "m00", "f-1", null, 1, "name@example.com"]) assert.equal(canonicalId(invalid), null);
});

test("all thirteen current guide landmarks are pinned", () => {
  const source = readFileSync(new URL("../src/engine/sideMetrics.ts", import.meta.url), "utf8");
  const block = source.split("export const SIDE_POINTS = [")[1].split("] as const;")[0];
  assert.deepEqual([...block.matchAll(/id: "([A-Za-z]+)"/g)].map((match) => match[1]), POINT_IDS);
  assert.match(source, new RegExp(`SIDE_LANDMARK_GUIDE_VERSION = "${guideVersion}"`));
});

test("all three pair distances use actual image aspect ratio and diagonal", () => {
  const result = compare();
  assert.ok(result.pairSummaries["system-vs-assistant"].distance.maximum < 1e-12);
  assert.ok(Math.abs(result.pairSummaries["assistant-vs-human"].distance.mean - .01) < 1e-12);
  assert.ok(Math.abs(result.pairSummaries["system-vs-human"].distance.mean - .01) < 1e-12);
  assert.equal(result.pairSummaries["assistant-vs-human"].possiblePoints, 13);
  assert.equal(result.pairSummaries["assistant-vs-human"].comparablePoints, 13);
  assert.equal(result.identities[0].frame.verified, true);
});

test("missing and unobservable assistant points retain all denominators", () => {
  const a = assistant();
  a.records[0].points.trichion = null;
  a.records[0].points.condylion = { x: null, y: null, visibility: "unobservable", confidence: "low" };
  delete a.records[0].points.tragion;
  const result = compare(a);
  const pair = result.pairSummaries["assistant-vs-human"];
  assert.equal(pair.possiblePoints, 13); assert.equal(pair.comparablePoints, 10); assert.equal(pair.missingPoints, 3);
  assert.equal(pair.missingReasons["assistant-point-missing"], 2);
  assert.equal(pair.missingReasons["assistant-point-unobservable"], 1);
  assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 13);
});

test("estimated landmarks are reported separately from the visible-only subset", () => {
  const a = assistant(); a.records[0].points.condylion.visibility = "estimated";
  const result = compare(a);
  const landmark = result.pairSummaries["assistant-vs-human"].byLandmark.find((p) => p.id === "condylion");
  assert.equal(landmark.distance.count, 1); assert.equal(landmark.assistantVisibleOnly.count, 0);
  assert.equal(landmark.assistantStrata.byVisibility.estimated.comparablePoints, 1);
  assert.equal(landmark.assistantStrata.byConfidence.medium.comparablePoints, 1);
  assert.equal(result.pairSummaries["assistant-vs-human"].assistantStrata.byVisibility.visible.comparablePoints, 12);
  assert.equal(result.identities[0].pairs["assistant-vs-human"].points.find((p) => p.id === "condylion").assistantConfidence, "medium");
});

test("invalid, out-of-frame, unknown and false-observability coordinates fail closed", () => {
  for (const value of [{ x: NaN, y: .5 }, { x: 1.01, y: .5 }, { x: .5, y: -.1 }, { x: null, y: .5 }]) {
    const a = assistant(); Object.assign(a.records[0].points.trichion, value); assert.throws(() => validateAssistant(a));
  }
  const a = assistant(); a.records[0].points.trichion.visibility = "unobservable"; assert.throws(() => validateAssistant(a), /must have null/);
  const b = assistant(); b.records[0].points.unknown = null; assert.throws(() => validateAssistant(b), /unknown landmark/);
  const c = captures(); c.faces[0].diagnostics.side.finalPoints.trichion.x = 601; assert.throws(() => compare(undefined, c), /outside/);
});

test("duplicate canonical identities and shared image hashes are rejected", () => {
  const a = assistant(); a.records.push(structuredClone(a.records[0])); a.records[1].id = "m1";
  assert.throws(() => validateAssistant(a), /duplicate identity/);
  a.records[1].id = "m02"; assert.throws(() => validateAssistant(a), /multiple identities/);
});

test("hash matching accepts an explicit reference while ignoring the storage-order id", () => {
  const c = captures(); c.faces[0].id = "m8";
  assert.equal(compare(undefined, c).matchedSideCaptures, 1);
  c.faces[0].referenceId = "custom-anonymous-id";
  assert.equal(compare(undefined, c).identities[0].matchedBy, "original-file-sha256");
});

test("identity versus hash conflicts and different photographs are rejected", () => {
  const c = captures(); c.faces[0].referenceId = "m02";
  assert.throws(() => compare(undefined, c), /conflict/);
  c.faces[0].referenceId = "m01"; c.faces[0].diagnostics.side.imageSource.originalFileSha256 = "c".repeat(64);
  assert.throws(() => compare(undefined, c), /original image is different/);
});

test("duplicate matching side captures require an explicit user selection", () => {
  const c = captures(); c.faces.push(structuredClone(c.faces[0]));
  assert.throws(() => compare(undefined, c), /explicitly select/);
});

test("missing original hash does not turn matching IDs into verified image geometry", () => {
  const c = captures(); delete c.faces[0].diagnostics.side.imageSource.originalFileSha256;
  const result = compare(undefined, c);
  assert.equal(result.identities[0].matchedBy, "explicit-identity-only");
  assert.equal(result.pairSummaries["assistant-vs-human"].comparablePoints, 0);
  assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 13);
});

test("resizes, crops, mirrors and orientation changes are never guessed", () => {
  for (const change of ["resize", "pixels", "orientation", "absent-original"]) {
    const c = captures(); const r = rasters();
    if (change === "resize") { c.faces[0].diagnostics.side.width = 1200; c.faces[0].diagnostics.side.imageSource.width = 1200; }
    if (change === "pixels") c.faces[0].diagnostics.side.imageSource.reviewPixelsSha256 = "c".repeat(64);
    if (change === "orientation") r.get("m01").orientation = 6;
    if (change === "absent-original") r.clear();
    const result = compare(undefined, c, r);
    assert.equal(result.pairSummaries["assistant-vs-human"].comparablePoints, 0, change);
    assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 13, change);
  }
});

test("different or missing guide versions preserve geometric comparisons with explicit warnings", () => {
  for (const version of [undefined, "side-surface-guide-1"]) {
    const c = captures(); c.faces[0].diagnostics.side.landmarkGuideVersion = version;
    const result = compare(undefined, c);
    assert.equal(result.pairSummaries["assistant-vs-human"].comparablePoints, 13);
    assert.match(result.identities[0].pairs["system-vs-assistant"].warnings[0], /guide-version-missing-or-different/);
    assert.equal(result.identities[0].guideVersionMatches, false);
    assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 13);
  }
});

test("unconfirmed human drafts are not promoted into reviewed labels", () => {
  const c = captures(); c.faces[0].diagnostics.side.operatorVerified = false;
  const result = compare(undefined, c);
  assert.equal(result.pairSummaries["assistant-vs-human"].comparablePoints, 0);
  assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 0);
  assert.equal(result.pairSummaries["system-vs-assistant"].comparablePoints, 13);
});

test("missing captures and unmatched rows are explicitly accounted for", () => {
  const c = captures(); c.faces.push({ id: "m02", diagnostics: null });
  const other = structuredClone(c.faces[0]); other.referenceId = "m03"; other.diagnostics.side.imageSource.originalFileSha256 = "d".repeat(64); c.faces.push(other);
  const result = compare(undefined, c);
  assert.equal(result.captureRecords, 3); assert.equal(result.matchedSideCaptures, 1); assert.equal(result.excludedCaptureRecords.length, 2);
  const absent = compare(assistant(), null);
  assert.equal(absent.pairSummaries["assistant-vs-human"].possiblePoints, 13);
  assert.equal(absent.pairSummaries["assistant-vs-human"].comparablePoints, 0);
  assert.equal(absent.pairSummaries["assistant-vs-human"].distance.mean, null);
});

test("malformed source dimensions and unsupported coordinate space fail closed", () => {
  const c = captures(); c.faces[0].diagnostics.side.imageSource.width = 601;
  assert.throws(() => compare(undefined, c), /displayed-image metadata/);
  c.faces[0].diagnostics.side.imageSource.width = 600; c.faces[0].diagnostics.side.coordinateSpace = "normalized-image";
  assert.throws(() => compare(undefined, c), /unsupported side coordinate/);
});

test("facing direction and exposure are reported rather than normalized away", () => {
  const a = assistant(); a.records[0].priorExposure = "Earlier screenshot was visible."; a.records[0].faceDir = -1;
  const result = compare(a);
  assert.equal(result.identities[0].facingDisagreement, false);
  assert.equal(result.identities[0].humanFacingDisagreement, true);
  assert.equal(result.identities[0].priorExposure, "declared");
  assert.ok(result.pairSummaries["system-vs-assistant"].distance.maximum < 1e-12);
});

test("save-order identity cannot match a corpus identity without an explicit reference or image hash", () => {
  const c = captures(); delete c.faces[0].referenceId; delete c.faces[0].diagnostics.side.imageSource.originalFileSha256;
  const result = compare(undefined, c);
  assert.equal(result.matchedSideCaptures, 0);
  assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 0);
  c.faces[0].diagnostics.side.imageSource.originalFileSha256 = fileHash;
  assert.equal(compare(undefined, c).matchedSideCaptures, 1);
});

test("system facing is not replaced by the human's corrected facing selection", () => {
  const c = captures(); c.faces[0].diagnostics.side.faceDir = -1;
  c.faces[0].diagnostics.side.automaticPoints.pronasale.x = 500;
  c.faces[0].diagnostics.side.automaticPoints.tragion.x = 100;
  const result = compare(undefined, c);
  assert.equal(result.identities[0].facingDisagreement, false);
  assert.equal(result.identities[0].humanFacingDisagreement, true);
});

test("primary blinded subset requires an explicit no-exposure declaration", () => {
  const a = assistant();
  assert.equal(compare(a).primaryBlindedSubset.includedIds.length, 0);
  a.records[0].priorExposure = "none";
  assert.deepEqual(compare(a).primaryBlindedSubset.includedIds, ["m01"]);
  assert.equal(compare(a).primaryBlindedSubset.pairSummaries["assistant-vs-human"].comparablePoints, 13);
  a.records[0].priorExposure = "Earlier human review visible";
  assert.deepEqual(compare(a).primaryBlindedSubset.excludedIds, ["m01"]);
  assert.equal(compare(a).pairSummaries["assistant-vs-human"].comparablePoints, 13);
});

test("RGBA verification uses the app's exact versioned header", () => {
  const rgba = Buffer.from([3, 4, 5, 255]);
  const expected = createHash("sha256").update("truemax-calibration-rgba8-v1\n1x1\n").update(rgba).digest("hex");
  assert.equal(displayedRgbaHash(1, 1, rgba), expected);
  assert.throws(() => displayedRgbaHash(2, 1, rgba), /byte count/);
  const a = validateAssistant(assistant())[0]; const c = matchCaptures([a], captures()).matched.get("m01");
  assert.equal(verifyUnchangedFrame(a, c, rasters().get("m01")).verified, true);
});

test("comparison output contains no point coordinates, file paths, hashes or private notes", () => {
  const a = assistant(); a.records[0].notes = "PRIVATE_SENTINEL"; a.records[0].points.trichion.note = "PRIVATE_SENTINEL";
  const serialized = JSON.stringify(compare(a));
  assert.doesNotMatch(serialized, /"x":|"y":|synthetic\.png|PRIVATE_SENTINEL|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(serialized, /not placement accuracy or ground truth/);
  assert.match(serialized, /does not fit a detector or repair scoring/);
});

test("CLI help is read-only and rejects ambiguous arguments", () => {
  const tool = new URL("./compare-placement-pilot.mjs", import.meta.url);
  assert.match(execFileSync(process.execPath, [tool.pathname, "--help"], { encoding: "utf8" }), /Offline, read-only/);
  assert.throws(() => execFileSync(process.execPath, [tool.pathname, "--wrong", "x"], { stdio: "pipe" }), /Command failed/);
});

test("local raster reader verifies actual original bytes and dimensions within the chosen directory", async () => {
  const { default: sharp } = await import("sharp");
  const directory = await mkdtemp(join(tmpdir(), "truemax-placement-unit-"));
  try {
    const rgba = Buffer.from([3, 4, 5, 255, 7, 8, 9, 255]);
    const png = await sharp(rgba, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    await writeFile(join(directory, "fixture.png"), png);
    const a = assistant(); Object.assign(a.records[0].image, { file: "fixture.png", width: 2, height: 1, sha256: createHash("sha256").update(png).digest("hex") });
    const actual = await loadOriginalRasters(validateAssistant(a), directory);
    assert.equal(actual.get("m01").reviewPixelsSha256, displayedRgbaHash(2, 1, rgba));
    a.records[0].image.sha256 = "e".repeat(64);
    await assert.rejects(loadOriginalRasters(validateAssistant(a), directory), /hash does not match/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical baseline compares system and assistant before human reviews exist", () => {
  const a = assistant(); a.records[0].priorExposure = "none";
  const result = comparePilot(a, null, rasters(), historical());
  assert.equal(result.pairSummaries["system-vs-assistant"].comparablePoints, 13);
  assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 0);
  assert.equal(result.primaryBlindedSubset.pairSummaries["system-vs-assistant"].comparablePoints, 13);
  assert.equal(result.historicalBaseline.source, "historical-local-device");
  assert.equal(result.identities[0].systemFrame.evidenceTier, "recorded-identity-frame-metadata");
  assert.equal(result.identities[0].systemFrame.displayedPixelProof, false);
  assert.equal(result.identities[0].systemTemplateFallback, null);
  assert.match(result.identities[0].pairs["system-vs-assistant"].warnings.join(" "), /not exact displayed-pixel proof/);
});

test("historical system baseline remains distinct from automatic points at human capture", () => {
  const c = captures(); c.faces[0].diagnostics.side.automaticPoints.trichion.x += 90;
  const result = comparePilot(assistant(), c, rasters(), historical());
  assert.ok(result.pairSummaries["system-vs-assistant"].distance.maximum < 1e-12);
  assert.ok(Math.abs(result.pairSummaries["system-vs-human"].distance.mean - .01) < 1e-12);
  assert.equal(result.identities[0].systemSource, "historical-local-device");
});

test("historical frame verification refuses assumed resize, mirror, orientation and missing original pixels", () => {
  for (const key of ["size", "mirror", "orientation", "native-size", "missing-raster"]) {
    const h = historical(); const r = rasters();
    if (key === "size") { h.data.records[0].source.width = 1200; for (const p of h.data.records[0].points) p.x *= 2; }
    if (key === "native-size") h.data.records[0].source.nativeWidth = 1200;
    if (key === "mirror") h.data.records[0].source.mirrored = true;
    if (key === "orientation") h.data.records[0].source.orientation = "unknown";
    if (key === "missing-raster") r.clear();
    assert.equal(comparePilot(assistant(), null, r, h).pairSummaries["system-vs-assistant"].comparablePoints, 0, key);
  }
});

test("historical original image or identity conflicts and inconsistent coordinates fail closed", () => {
  const h = historical(); h.data.records[0].source.sha256 = "c".repeat(64);
  assert.throws(() => comparePilot(assistant(), null, rasters(), h), /different original image/);
  h.data.records[0].source.sha256 = fileHash; h.data.records[0].personId = "m02";
  assert.throws(() => comparePilot(assistant(), null, rasters(), h), /identity and image hash conflict/);
  h.data.records[0].personId = "m01"; h.data.records[0].points[0].normalizedX = .9;
  assert.throws(() => comparePilot(assistant(), null, rasters(), h), /coordinates disagree/);
});

test("cross-capture human comparison still requires displayed-pixel proof with historical baselines", () => {
  const c = captures(); c.faces[0].diagnostics.side.imageSource.reviewPixelsSha256 = "f".repeat(64);
  const result = comparePilot(assistant(), c, rasters(), historical());
  assert.equal(result.pairSummaries["system-vs-assistant"].comparablePoints, 13);
  assert.equal(result.pairSummaries["system-vs-human"].comparablePoints, 0);
  assert.equal(result.pairSummaries["assistant-vs-human"].comparablePoints, 0);
});

test("historical metadata must declare a local unverified no-prior run", () => {
  for (const key of ["localOnly", "ownerPriorUsed", "automaticPointsVerified"]) {
    const h = historical(); h.data.runtime[key] = !h.data.runtime[key];
    assert.throws(() => comparePilot(assistant(), null, rasters(), h), /local pilot baseline/);
  }
});

test("private viewer annotation schema resolves only a basename in the chosen images root", () => {
  const a = assistant();
  a.schemaVersion = "assistant-side-placement-pilot-v1"; delete a.kind; delete a.coordinateSpace;
  Object.assign(a, { coordinateSystem: "normalized-original-image", origin: "top-left", annotationSource: "assistant-independent-visual-review" });
  a.records[0].image.relativePath = "../../references/synthetic.png"; delete a.records[0].image.file;
  a.records[0].points.trichion.notes = "PRIVATE_SENTINEL";
  assert.equal(validateAssistant(a)[0].image.file, "synthetic.png");
  assert.equal(comparePilot(a, captures(), rasters()).pairSummaries["assistant-vs-human"].comparablePoints, 13);
  assert.doesNotMatch(JSON.stringify(comparePilot(a, captures(), rasters())), /PRIVATE_SENTINEL/);
  a.origin = "bottom-left"; assert.throws(() => validateAssistant(a), /Expected/);
});
