import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = fileURLToPath(new URL("../../tools/review-side-calibration.mjs", import.meta.url));
test("private review tool counts legacy and failed automatic captures without fitting or outputting identities", () => {
  const result = spawnSync(process.execPath, [tool, "-"], { encoding: "utf8", input: JSON.stringify({ faces: [
    { label: "Private name", diagnostics: { side: { diagnostics: { templateFallback: true }, placementComparison: {
      comparisonKind: "automatic-versus-operator", automaticReport: null,
      pointChanges: [{ id: "gonion", imageDiagonalFraction: .2 }], metricChanges: [{ id: "gonialAngle", delta: 180 }],
    } } } },
    { diagnostics: { side: { placementComparison: {
      comparisonKind: "automatic-versus-operator", automaticReport: { metrics: [] },
      pointChanges: [{ id: "gonion", imageDiagonalFraction: .1 }], metricChanges: [{ id: "gonialAngle", delta: -3 }],
    } } } },
    { diagnostics: { side: {} } }, { diagnostics: { front: {} } },
  ] }) });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.sideCaptures, 3);
  assert.equal(summary.comparableCaptures, 2);
  assert.equal(summary.legacyOrMissingComparisons, 1);
  assert.equal(summary.unscoredAutomatic, 1);
  assert.equal(summary.templateFallbacks, 1);
  assert.equal(summary.pointMovement[0].count, 2);
  assert.equal(summary.metricChanges[0].medianAbsoluteChange, 3);
  assert.doesNotMatch(result.stdout, /Private name/);
  assert.match(summary.interpretation, /Not independent placement accuracy/);
});
