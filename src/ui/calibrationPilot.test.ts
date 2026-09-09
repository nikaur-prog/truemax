import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PILOT_NOTICE, parsePilotFilename, pilotJson, pilotManifest, pilotPairs, pilotReferenceSnapshot, pilotReportSnapshot } from "./calibrationPilotData.js";
import type { PilotRecord } from "./calibrationPilotData.js";
import { METRICS, distFor } from "../engine/metrics.js";
import { SIDE_METRICS } from "../engine/sideMetrics.js";
import { analyzeSide, mergeReports, scoreFrontMeasurements } from "../engine/scoring.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import type { Report } from "../engine/types.js";

const profile: SidePoints = {
  trichion: { x: 300, y: 100 }, glabella: { x: 330, y: 190 }, nasion: { x: 325, y: 210 },
  pronasale: { x: 395, y: 265 }, subnasale: { x: 355, y: 295 }, labialeSuperius: { x: 360, y: 320 },
  labialeInferius: { x: 358, y: 345 }, pogonion: { x: 350, y: 390 }, menton: { x: 335, y: 410 },
  gonion: { x: 215, y: 360 }, condylion: { x: 205, y: 250 }, cervicale: { x: 240, y: 430 }, tragion: { x: 200, y: 240 },
};
function records(): PilotRecord[] {
  return pilotManifest([{ name: "m01-front.png" }, { name: "m01-side.png" }]).slots.map(({ file: _file, ...slot }) => ({ ...slot, failure: null, warnings: [] }));
}
const front = () => scoreFrontMeasurements(Object.fromEntries(METRICS.map((m) => [m.id, distFor(m, "male").mean])), "male");

test("pilot filenames declare the stable adult-generation stratum and view", () => {
  assert.deepEqual(parsePilotFilename("f01-front.png"), { personId: "f01", key: "f01-front", sex: "female", view: "front" });
  assert.deepEqual(parsePilotFilename("M10-SIDE.JPEG"), { personId: "m10", key: "m10-side", sex: "male", view: "side" });
  for (const name of ["f00-front.png", "f11-front.png", "m1-front.png", "f01.png", "f01-front.svg", "../f01-front.png", "real-person-front.png"]) assert.equal(parsePilotFilename(name), null);
});

test("manifest always exposes all 40 expected views, including missing files", () => {
  const manifest = pilotManifest([{ name: "f01-front.png" }]);
  assert.equal(manifest.slots.length, 40);
  assert.equal(manifest.slots.filter((s) => s.sex === "female").length, 20);
  assert.equal(manifest.slots.filter((s) => s.status === "missing").length, 39);
  assert.equal(manifest.slots[0].status, "queued");
  assert.equal(manifest.slots[1].status, "missing");
});

test("duplicate identities across names or extensions are rejected without choosing a winner", () => {
  const manifest = pilotManifest([{ name: "m01-side.png" }, { name: "M01-SIDE.jpg" }, { name: "unknown.png" }]);
  const slot = manifest.slots.find((s) => s.key === "m01-side")!;
  assert.equal(slot.status, "duplicate"); assert.equal(slot.file, null);
  assert.deepEqual(slot.filenames, ["m01-side.png", "M01-SIDE.jpg"]);
  assert.equal(manifest.rejected.length, 1);
});

test("reference snapshot reads actual active definitions and retains held-out separation", () => {
  const snapshot = pilotReferenceSnapshot();
  assert.equal(snapshot.metricDefinitions.length, METRICS.filter((m) => m.view === "front").length + SIDE_METRICS.length);
  const metric = snapshot.metricDefinitions.find((m) => m.id === "gonialAngle")!;
  assert.deepEqual(metric.dist, SIDE_METRICS.find((m) => m.id === "gonialAngle")!.dist);
  assert.equal(metric.selectedReferences.male.ideal, 119);
  assert.equal(metric.selectedReferences.female.ideal, 122);
  assert.ok(snapshot.heldOutSideMetricIds.includes("ramusMandible"));
  assert.ok(!snapshot.metricDefinitions.some((m) => snapshot.heldOutSideMetricIds.includes(m.id)));
  assert.match(PILOT_NOTICE, /unverified, not ground truth/);
  assert.match(PILOT_NOTICE, /No norms are fitted or changed/);
});

test("report export preserves production scores, raw z aggregates, ideals and region visibility", () => {
  const report = analyzeSide(profile, 1, "male");
  const snapshot = pilotReportSnapshot(report);
  assert.equal(snapshot.overall, report.overall);
  assert.deepEqual(snapshot.zScores, report.zScores);
  for (const m of report.metrics) {
    const result = snapshot.metrics.find((item) => item.def.id === m.def.id)!;
    assert.equal(result.score, m.score); assert.equal(result.conformance, m.conformance);
    assert.deepEqual(result.idealRange, m.idealRange);
    assert.equal(result.selectedReference.mean, distFor(m.def, "male").mean);
  }
  assert.ok(snapshot.regions.some((r) => r.displayedAsScored === false));
});

test("unmeasured metrics are not converted into neutral valid measurements", () => {
  const report = front();
  const metric = report.metrics[0];
  metric.value = NaN; metric.implausible = true;
  const result = pilotReportSnapshot(report).metrics[0];
  assert.equal(result.measurementStatus, "unavailable");
  assert.equal(result.effectiveWeight, 0);
  assert.equal(result.reading, null);
});

test("JSON records every non-finite path rather than silently coercing failed values", () => {
  const result = JSON.parse(pilotJson({ metrics: [{ value: NaN, bound: Infinity }], raw: { angle: -Infinity, valid: 0 } }));
  assert.deepEqual(result.data, { metrics: [{ value: null, bound: null }], raw: { angle: null, valid: 0 } });
  assert.deepEqual(result.nonFiniteValues.map((entry: { path: string }) => entry.path), ["metrics[0].value", "metrics[0].bound", "raw.angle"]);
  assert.match(result.nonFiniteValues[0].reason, /unavailable/);
});

test("unavailable pixel metrics retain their raw key and explicit reason", () => {
  const raw = Object.fromEntries(METRICS.filter((m) => m.id !== "foreheadRatio").map((m) => [m.id, distFor(m, "male").mean]));
  const report = scoreFrontMeasurements(raw, "male");
  for (const metric of report.metrics) raw[metric.def.id] = metric.value;
  const result = JSON.parse(pilotJson({ raw, report: pilotReportSnapshot(report) }));
  assert.equal(result.data.raw.foreheadRatio, null);
  assert.ok(result.nonFiniteValues.some((value: { path: string }) => value.path === "raw.foreheadRatio"));
  assert.equal(result.data.report.metrics.find((m: { def: { id: string } }) => m.def.id === "foreheadRatio").measurementStatus, "unavailable");
});

test("missing or failed profile never produces a combined score", () => {
  const reports = new Map<string, Report>([["m01-front", front()]]);
  const result = pilotPairs(records(), reports).find((pair) => pair.personId === "m01")!;
  assert.equal(result.report, null); assert.equal(result.status, "unavailable");
  assert.match(result.reason!, /not imputed/);
});

test("paired diagnostics use the production merge, retaining the unverified warning", () => {
  const f = front(), s = analyzeSide(profile, 1, "male");
  const reports = new Map([["m01-front", f], ["m01-side", s]]);
  const result = pilotPairs(records(), reports).find((pair) => pair.personId === "m01")!;
  assert.equal(result.report!.overall, mergeReports(f, s).overall);
  assert.equal(result.automaticPointsVerified, false);
  assert.equal(result.status, "diagnostic-unverified");
  assert.match(result.pairing, /identity consistency not verified/);
});

test("pilot has its own DEV-gated entry and is not a production HTML input", () => {
  const entry = readFileSync("src/ui/calibrationPilotEntry.ts", "utf8");
  const html = readFileSync("dev/calibration-pilot.html", "utf8");
  const config = readFileSync("vite.config.ts", "utf8");
  assert.match(entry, /if \(import\.meta\.env\.DEV\)/);
  assert.match(entry, /import\("\.\/calibrationPilot\.js"\)/);
  assert.doesNotMatch(entry, /(?:auth|main)\.js/);
  assert.doesNotMatch(html, /src\/main\.ts|https:\/\//);
  assert.doesNotMatch(config, /calibration-pilot\.html/);
});

test("pilot invokes real detector, seed and scoring paths with scoped prior suppression", () => {
  const source = readFileSync("src/ui/calibrationPilot.ts", "utf8");
  for (const pattern of [/detectStable\(canvas\)/, /seedSidePointsSmart\(canvas/, /analyze\(landmarks, width, height, record.sex, canvas\)/, /analyzeSide\(seed.points, faceDir, record.sex\)/]) assert.match(source, pattern);
  assert.match(source, /setSidePriorSuspended\(true\)/);
  assert.match(source, /finally\s*\{\s*setSidePriorSuspended\(false\)/);
  assert.doesNotMatch(source, /\/api\/|currentUser\(|loadEntitlement\(|localStorage\.|savePhotos\(|writeSidePrior\(/);
  assert.match(source, /consensus may fall back to the single base detection/);
  assert.doesNotMatch(source, /production five-transform consensus/);
  assert.match(source, /fetch\(path, \{ credentials: "omit", signal \}\)/);
  assert.match(source, /waitForPilotStage\("Source and asset provenance", provenance, signal\)/);
  assert.match(source, /waitForPilotStage\("Face detector startup", detectorStartup, signal\)/);
});
