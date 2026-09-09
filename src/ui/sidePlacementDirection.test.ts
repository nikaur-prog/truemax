import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SIDE_POINTS, faceDirFromPoints } from "../engine/sideMetrics.js";
import type { SidePoints } from "../engine/sideMetrics.js";
import { sidePlacementEvidence } from "../engine/sidePlacementEvidence.js";
import { fuseSideSeeds } from "../engine/sideSeedFusion.js";
import { cloudSideSeedFractions } from "./sideCloudPlacement.js";
import { withPointDerivedSideDirection } from "./sidePlacementDirection.js";

function points(facing: 1 | -1): SidePoints {
  const result = Object.fromEntries(SIDE_POINTS.map(({ id }, index) => [
    id, { x: 200 + index, y: 120 + index * 20 },
  ])) as SidePoints;
  result.pronasale = { x: facing === 1 ? 350 : 150, y: 300 };
  result.tragion = { x: facing === 1 ? 150 : 350, y: 300 };
  result.condylion = { x: facing === 1 ? 165 : 335, y: 285 };
  return result;
}

for (const facing of [1, -1] as const) {
  test(`point-derived direction repairs stale metadata for an image-${facing === 1 ? "right" : "left"} profile without moving it`, () => {
    const placed = points(facing);
    for (const point of Object.values(placed)) Object.freeze(point);
    Object.freeze(placed);
    const stale = Object.freeze({ points: placed, faceDir: -facing, method: "mesh", confidence: 0.7 });
    const normalized = withPointDerivedSideDirection(stale);

    assert.equal(normalized.faceDir, facing);
    assert.equal(normalized.faceDir, faceDirFromPoints(placed));
    assert.equal(normalized.points, placed, "direction correction must not clone, mirror or replace the coordinates");
    assert.equal(stale.faceDir, -facing, "the original detector record stays unchanged");
    assert.equal(normalized.method, stale.method);
    assert.equal(normalized.confidence, stale.confidence);

    assert.equal(cloudSideSeedFractions(placed, 500, 500, stale.faceDir < 0 ? -1 : 1), null,
      "the stale direction would reject an otherwise usable cloud hint");
    const fractions = cloudSideSeedFractions(normalized.points, 500, 500, normalized.faceDir);
    assert.ok(fractions, "the corrected direction must send the supported seed");
    assert.equal(fractions.pronasale.x, placed.pronasale.x / 500);
    assert.equal(fractions.tragion.x, placed.tragion.x / 500);
  });
}

test("direction follows the final fused geometry and preserves its points and provenance", () => {
  const device = points(1);
  const cloud = { ...device, tragion: { x: 170, y: 306 }, condylion: { x: 175, y: 289 } };
  const evidence = sidePlacementEvidence("whole");
  const fused = fuseSideSeeds(device, cloud, undefined, undefined, evidence);
  assert.equal(fused.source.tragion, "blend");
  assert.notDeepEqual(fused.points.tragion, device.tragion);
  const seed = { ...fused, faceDir: -1, method: "fused", automaticPoints: device, evidence };
  const normalized = withPointDerivedSideDirection(seed);

  assert.equal(normalized.faceDir, 1);
  assert.equal(normalized.points, fused.points);
  assert.deepEqual(normalized.points, fused.points);
  assert.equal(normalized.automaticPoints, device);
  assert.equal(normalized.source, fused.source);
  assert.equal(normalized.band, fused.band);
  assert.equal(normalized.evidence, evidence);
  assert.deepEqual(normalized.points.gonion, device.gonion, "the conservative fusion policy is unchanged");
});

test("correct and restored directions use the same geometry without discarding review data", () => {
  const placed = points(-1);
  const seed = { points: placed, faceDir: -1, automaticPoints: points(-1), method: "existing", seedVersion: "review-v1" };
  const normalized = withPointDerivedSideDirection(seed);
  assert.deepEqual(normalized, seed);
  assert.equal(normalized.points, seed.points);
  assert.equal(normalized.automaticPoints, seed.automaticPoints);
});

test("cloud, cosmetic orientation and verifier entry all normalize direction before consuming it", () => {
  const flow = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");
  const cloud = flow.slice(flow.indexOf("async function cloudPlacementFor"), flow.indexOf("export async function prepareSidePlacementChoice"));
  assert.match(cloud, /const directedSeed = withPointDerivedSideDirection\(seed\);[\s\S]*seed: directedSeed\.points,[\s\S]*faceDir: directedSeed\.faceDir,/);

  const fusion = flow.slice(flow.indexOf("const fused = fuseSideSeeds("), flow.indexOf("async function cloudPlacementFor"));
  assert.match(fusion, /let seed: SidePlacementSeed = withPointDerivedSideDirection\(\{[\s\S]*points: fused\.points,[\s\S]*\}\);[\s\S]*if \(seed\.faceDir === -1/);
  assert.match(fusion, /seed\.method === "mesh" \|\| \(seed\.confidence \?\? 0\) >= 0\.5/, "existing mirror eligibility stays unchanged");

  const verifier = flow.slice(flow.indexOf("function mountVerify("));
  assert.match(verifier, /seed = withPointDerivedSideDirection\(seed\);[\s\S]*verifier = mountVerifier\(/);
  assert.match(verifier, /mountSideReference\(e\.frame, seed\.faceDir\)/);
  assert.match(verifier, /const faceDir = faceDirFromPoints\(verifier\.points\);/, "final measurements still derive their own direction");
});
