import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, existsSync, writeFileSync, statSync, openSync, ftruncateSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateSideBandFit, SIDE_BAND_FIT_VERSION } from "./sideBandFit.js";
import { analyzeSide, mergeReports, scoreFrontMeasurements, scoreSideMeasurements, toleranceOf } from "./scoring.js";
import { METRICS, distFor } from "./metrics.js";
import { SIDE_METRICS, computeSideMetrics } from "./sideMetrics.js";
import type { SidePoints } from "./sideMetrics.js";
import type { Report, Sex } from "./types.js";
import {
  evaluateCaptureDiagnostics, privateScoreOutputPath, readBoundedScoreInput,
  scoreImplementationProvenance, writePrivateScoreArtifact, MAX_SCORE_INPUT_BYTES,
} from "../../tools/evaluate-side-band-fit.js";

const sexes = ["male", "female"] as const;
const ideals = (sex: Sex) => Object.fromEntries(SIDE_METRICS.map((def) => [def.id, distFor(def, sex).ideal ?? distFor(def, sex).mean]));
const frontMeans = (sex: Sex) => Object.fromEntries(METRICS.filter((def) => def.view === "front").map((def) => [def.id, distFor(def, sex).mean]));
// Mathematical fixture, not a portrait annotation or population example.
const PROFILE: SidePoints = {
  trichion: { x: 120, y: 50 }, glabella: { x: 130, y: 90 }, nasion: { x: 128, y: 110 },
  pronasale: { x: 180, y: 160 }, subnasale: { x: 150, y: 190 },
  labialeSuperius: { x: 155, y: 215 }, labialeInferius: { x: 153, y: 245 },
  pogonion: { x: 160, y: 290 }, menton: { x: 145, y: 320 },
  gonion: { x: 70, y: 285 }, condylion: { x: 72, y: 155 },
  cervicale: { x: 90, y: 330 }, tragion: { x: 65, y: 170 },
};

test("the legacy ideal-vector ceiling is reproduced, not silently relabelled as repaired", () => {
  assert.equal(scoreSideMeasurements(ideals("male"), "male").overall, 5.2);
  assert.equal(scoreSideMeasurements(ideals("female"), "female").overall, 5.1);
});

test("candidate reaches full band fit with all ten declared ideals, without percentile claims", () => {
  for (const sex of sexes) {
    const fit = evaluateSideBandFit(ideals(sex), sex);
    assert.equal(fit.version, SIDE_BAND_FIT_VERSION);
    assert.equal(fit.status, "offline-candidate");
    assert.equal(fit.populationPercentile, null);
    assert.equal(fit.overall.score, 10);
    assert.equal(fit.overall.coverage, 1);
    assert.equal(fit.overall.expectedCount, 10);
    assert.deepEqual(fit.overall.possibleScoreRange, [10, 10]);
    assert.ok(fit.metrics.every((m) => m.conformance === 1));
    assert.ok(Object.values(fit.regions).every((r) => r.score === 10));
  }
});

test("a tolerance band stays flat rather than rewarding sub-resolution differences", () => {
  for (const sex of sexes) for (const def of SIDE_METRICS) {
    const d = distFor(def, sex);
    for (const sign of [-1, 1]) {
      const raw = ideals(sex);
      raw[def.id] += sign * 0.999 * toleranceOf(def) * d.sd;
      assert.equal(evaluateSideBandFit(raw, sex).overall.score, 10);
    }
  }
});

test("fit decreases monotonically outside either edge of every current band", () => {
  for (const sex of sexes) for (const def of SIDE_METRICS) for (const sign of [-1, 1]) {
    const d = distFor(def, sex);
    const ideal = d.ideal ?? d.mean;
    const bandEdge = ideal + sign * toleranceOf(def) * d.sd;
    const farEdge = def.plausible?.[sign < 0 ? 0 : 1] ?? d.mean + sign * 3 * d.sd;
    let previous = 10;
    for (let i = 1; i <= 100; i++) {
      const raw = ideals(sex);
      raw[def.id] = i === 100 ? farEdge : bandEdge + (farEdge - bandEdge) * i / 100;
      const score = evaluateSideBandFit(raw, sex).overall.score;
      assert.notEqual(score, null, `${sex} ${def.id} within valid bounds`);
      assert.ok(score! <= previous + 1e-12, `${sex} ${def.id} must not improve farther from band`);
      assert.ok(score! >= 0 && score! <= 10);
      previous = score!;
    }
    assert.ok(previous < 10);
  }
});

test("worsening every supported measurement lowers the fit without changing legacy definitions", () => {
  for (const sex of sexes) {
    const raw = ideals(sex);
    for (const def of SIDE_METRICS) {
      const d = distFor(def, sex);
      const edge = raw[def.id] + toleranceOf(def) * d.sd;
      raw[def.id] = (edge + (def.plausible?.[1] ?? d.mean + 3 * d.sd)) / 2;
    }
    assert.ok(evaluateSideBandFit(raw, sex).overall.score! < 6);
  }
});

test("missing, null, nonfinite, and string values never coerce into measurements", () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, "119"]) {
    const fit = evaluateSideBandFit({ ...ideals("male"), gonialAngle: value }, "male");
    assert.equal(fit.overall.score, null);
    assert.equal(fit.overall.measuredCount, 9);
    assert.equal(fit.metrics.find((m) => m.id === "gonialAngle")!.state, "missing");
    assert.ok(fit.overall.coverage < 1);
    assert.equal(fit.overall.observedSubsetFit, 10);
    assert.ok(fit.overall.possibleScoreRange[0] < 10);
    assert.ok(Math.abs(fit.overall.possibleScoreRange[1] - 10) < 1e-12);
  }
});

test("dropping a poorly fitting metric cannot manufacture an improved complete score", () => {
  const raw = { ...ideals("male"), gonialAngle: 154 };
  const complete = evaluateSideBandFit(raw, "male");
  const incomplete = evaluateSideBandFit({ ...raw, gonialAngle: undefined }, "male");
  assert.equal(incomplete.overall.score, null);
  assert.ok(incomplete.overall.possibleScoreRange[0] <= complete.overall.score!);
  assert.ok(incomplete.overall.possibleScoreRange[1] >= complete.overall.score!);
});

test("out-of-plausibility values remain unknown, not a poor-face score", () => {
  const fit = evaluateSideBandFit({ ...ideals("female"), gonialAngle: 180 }, "female");
  assert.equal(fit.overall.score, null);
  assert.equal(fit.regions.jaw!.score, null);
  assert.equal(fit.metrics.find((m) => m.id === "gonialAngle")!.state, "outside-plausibility");
});

test("no measurements produces no neutral or perfect score", () => {
  const fit = evaluateSideBandFit({}, "female");
  assert.equal(fit.overall.score, null);
  assert.equal(fit.overall.observedSubsetFit, null);
  assert.equal(fit.overall.coverage, 0);
  assert.deepEqual(fit.overall.possibleScoreRange, [0, 10]);
});

test("held-out constructions do not enter the candidate", () => {
  const base = evaluateSideBandFit(ideals("male"), "male");
  const extra = evaluateSideBandFit({ ...ideals("male"), ramusMandible: 999, foreheadSlope: -999 }, "male");
  assert.deepEqual(extra, base);
});

test("reference group is explicit, not inferred or silently defaulted", () => {
  assert.throws(() => evaluateSideBandFit({}, "unknown" as Sex), /explicit reference group/);
});

test("legacy side replay is exactly the live scorer after geometric validation", () => {
  for (const sex of sexes) {
    assert.deepEqual(analyzeSide(PROFILE, 1, sex), scoreSideMeasurements(computeSideMetrics(PROFILE, 1), sex));
  }
});

test("scaling, translating, or mirroring a profile cannot change its band fit", () => {
  for (const sex of sexes) {
    const raw = computeSideMetrics(PROFILE, 1);
    const transformed = Object.fromEntries(Object.entries(PROFILE).map(([id, p]) => [id, { x: 1000 - 2 * p.x, y: 2 * p.y + 100 }])) as SidePoints;
    const fit = evaluateSideBandFit(raw, sex).overall.score!;
    const mirrorFit = evaluateSideBandFit(computeSideMetrics(transformed, -1), sex).overall.score!;
    assert.ok(Math.abs(fit - mirrorFit) < 1e-12);
  }
});

test("front golden outputs and production merge remain unchanged by candidate evaluation", () => {
  const golden = { male: { score: 5.5, z: 0.3705920089999369, potential: 6.1 }, female: { score: 5.7, z: 0.5742006085215295, potential: 6 } };
  for (const sex of sexes) {
    const front = scoreFrontMeasurements(frontMeans(sex), sex, 0.25);
    const side = analyzeSide(PROFILE, 1, sex);
    const merged = mergeReports(front, side);
    assert.equal(front.overall, golden[sex].score);
    assert.ok(Math.abs(front.overallZ - golden[sex].z) < 1e-12);
    assert.equal(front.potential, golden[sex].potential);
    const fit = evaluateSideBandFit(computeSideMetrics(PROFILE, 1), sex);
    assert.deepEqual(scoreFrontMeasurements(frontMeans(sex), sex, 0.25), front);
    assert.deepEqual(mergeReports(front, analyzeSide(PROFILE, 1, sex)), merged);
    // Structurally incompatible on purpose; even an unsafe cast cannot yield a
    // fake blended percentile through the existing finite-z guard.
    assert.equal(mergeReports(front, fit as unknown as Report), front);
  }
});

test("candidate has no customer-facing scoring integration", () => {
  const source = readFileSync(new URL("./scoring.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("sideBandFit"));
  assert.ok(!source.includes("evaluateSideBandFit"));
});

function capture(id = "row1", hash = "a".repeat(64)) {
  const report = analyzeSide(PROFILE, 1, "male");
  return {
    id, referenceId: "example", referenceGroup: "male", rating: null,
    diagnostics: {
      schemaVersion: 1, capturedAt: "2026-01-01T00:00:00Z", build: "fixture", referenceGroup: "male",
      front: { report: scoreFrontMeasurements(frontMeans("male"), "male") },
      side: { automaticPoints: structuredClone(PROFILE), finalPoints: structuredClone(PROFILE),
        faceDir: 1, width: 400, height: 400, operatorVerified: true, report,
        imageSource: { reviewPixelsSha256: hash } },
    },
  };
}

test("offline diagnostics replay ignores all rating labels and keeps candidate out of merge", () => {
  const row = capture();
  const before = JSON.stringify(row);
  const result = evaluateCaptureDiagnostics({ faces: [row] });
  assert.equal(result.evaluatedRows, 1);
  assert.equal(result.rows[0].replayDelta, 0);
  assert.equal(result.rows[0].candidateMerged, null);
  assert.equal(result.rows[0].legacyMerged!.automatic, result.rows[0].legacyMerged!.reviewed);
  assert.equal(result.ratingFieldsIgnored, 0);
  assert.equal(JSON.stringify(row), before);
  const arbitrary = evaluateCaptureDiagnostics({ faces: [{ ...row, rating: 9.9 }] });
  assert.deepEqual(arbitrary.rows, result.rows);
  assert.equal(arbitrary.ratingFieldsIgnored, 1);
});

test("offline replay rejects duplicate images unless explicitly excluded", () => {
  const rows = [capture(), capture("duplicate")];
  assert.throws(() => evaluateCaptureDiagnostics({ faces: rows }), /Duplicate side image/);
  assert.equal(evaluateCaptureDiagnostics({ faces: rows }, new Set(["duplicate"])).evaluatedRows, 1);
  assert.throws(() => evaluateCaptureDiagnostics({ faces: rows }, new Set(["typo"])), /does not exist/);
});

test("offline replay fails closed on unconfirmed, mismatched, or corpus-only captures", () => {
  const row = capture();
  row.diagnostics.side.operatorVerified = false;
  assert.throws(() => evaluateCaptureDiagnostics({ faces: [row] }), /not operator confirmed/);
  assert.throws(() => evaluateCaptureDiagnostics({ faces: [{ id: "row", measurements: ideals("male") }] }), /side capture diagnostics/);
  assert.throws(() => evaluateCaptureDiagnostics({ faces: [{ ...capture(), referenceGroup: "female" }] }), /group mismatch/);
});

test("private score output rejects public targets and a symlinked private root before writing", () => {
  const repo = mkdtempSync(join(tmpdir(), "score-output-root-"));
  const publicDir = join(repo, "public");
  mkdirSync(publicDir);
  assert.throws(() => privateScoreOutputPath(repo, join(publicDir, "score.json")), /must stay inside/);
  const privateRoot = join(repo, ".calibration-pilot");
  symlinkSync(publicDir, privateRoot);
  assert.throws(() => writePrivateScoreArtifact(repo, join(privateRoot, "new/score.json"), {}), /symlink/);
  assert.equal(existsSync(join(publicDir, "new")), false);
});

test("private score output rejects symlinked ancestors and output files", () => {
  const repo = mkdtempSync(join(tmpdir(), "score-output-ancestor-"));
  const privateRoot = join(repo, ".calibration-pilot");
  const publicDir = join(repo, "public");
  mkdirSync(privateRoot); mkdirSync(publicDir);
  symlinkSync(publicDir, join(privateRoot, "redirect"));
  assert.throws(() => writePrivateScoreArtifact(repo, join(privateRoot, "redirect/new/score.json"), {}), /symlink/);
  assert.equal(existsSync(join(publicDir, "new")), false);
  symlinkSync(join(publicDir, "score.json"), join(privateRoot, "linked.json"));
  assert.throws(() => writePrivateScoreArtifact(repo, join(privateRoot, "linked.json"), {}), /symlink/);
  assert.equal(existsSync(join(publicDir, "score.json")), false);
});

test("private score artifact creates an owner-only file and never overwrites an experiment", () => {
  const repo = mkdtempSync(join(tmpdir(), "score-output-mode-"));
  const privateRoot = join(repo, ".calibration-pilot");
  mkdirSync(privateRoot);
  const output = join(privateRoot, "nested/score.json");
  writePrivateScoreArtifact(repo, output, { test: 1 });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), { test: 1 });
  assert.throws(() => writePrivateScoreArtifact(repo, output, { test: 2 }), /EEXIST/);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), { test: 1 });
});

test("score replay rejects inputs over 30 MB before parsing or evaluating", () => {
  const temp = mkdtempSync(join(tmpdir(), "score-input-size-"));
  const input = join(temp, "oversize.json");
  const fd = openSync(input, "wx", 0o600);
  try { ftruncateSync(fd, MAX_SCORE_INPUT_BYTES + 1); } finally { closeSync(fd); }
  assert.throws(() => readBoundedScoreInput(input), /30 MB safety limit/);
  assert.throws(() => readBoundedScoreInput(temp), /regular diagnostic file/);
  const small = join(temp, "small.json");
  writeFileSync(small, "{}", { flag: "wx", mode: 0o600 });
  assert.equal(readBoundedScoreInput(small).toString("utf8"), "{}");
});

test("implementation provenance fingerprints mapping logic and numeric dependencies", () => {
  const provenance = scoreImplementationProvenance();
  const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(provenance.implementationFiles["src/engine/sideBandFit.ts"], hash(readFileSync(new URL("./sideBandFit.ts", import.meta.url))));
  assert.equal(provenance.implementationFiles["src/engine/scoring.ts"], hash(readFileSync(new URL("./scoring.ts", import.meta.url))));
  assert.equal(provenance.implementationFiles["tools/evaluate-side-band-fit.ts"], hash(readFileSync(new URL("../../tools/evaluate-side-band-fit.ts", import.meta.url))));
  assert.equal(provenance.implementationSha256, hash(JSON.stringify(provenance.implementationFiles)));
  const result = evaluateCaptureDiagnostics({ faces: [capture()] });
  assert.equal(result.implementationSha256, provenance.implementationSha256);
  assert.deepEqual(result.implementationFiles, provenance.implementationFiles);
});
