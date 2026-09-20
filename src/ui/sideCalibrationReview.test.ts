import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { seedSideTemplate } from "./sideVerify.js";
import { SIDE_POINTS } from "../engine/sideMetrics.js";

const flow = readFileSync(new URL("./sideFlow.ts", import.meta.url), "utf8");

test("fallback points are all editable finite estimates even on a tiny decodable canvas", () => {
  for (const [width, height] of [[800, 1000], [1200, 600], [1, 1]]) {
    const seed = seedSideTemplate(width, height);
    assert.equal(seed.templateFallback, true);
    assert.equal(seed.confidence, 0);
    for (const { id } of SIDE_POINTS) {
      const point = seed.points[id];
      assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= width);
      assert.ok(Number.isFinite(point.y) && point.y >= 0 && point.y <= height);
    }
  }
});

test("a readable image is painted before detector preparation and placement errors are not called decode errors", () => {
  const load = flow.slice(flow.indexOf("async function loadCanvas"), flow.indexOf("async function cloudPlacementFor"));
  assert.ok(load.indexOf("photoPrepared = true") < load.indexOf("recoverSideSeed({"));
  assert.match(load, /if \(photoPrepared\) showSidePlacementFailure\(ctx\);\s*else showSideLoadFailure\(ctx\)/);
  assert.match(load, /read: \(readSignal\) => seedSidePointsSmart\(snapshot, ctx.reviewMode === "calibration" \? undefined/);
});

test("admin calibration retains original orientation and exposes a point-only facing correction", () => {
  assert.match(flow, /if \(ctx.reviewMode !== "calibration" && seed.faceDir === -1/);
  assert.match(flow, /data-side-direction="-1"><span aria-hidden="true">←<\/span> Nose faces left/);
  assert.match(flow, /data-side-direction="1">Nose faces right <span aria-hidden="true">→<\/span>/);
  assert.match(flow, /verifier.reset\(flipSideReviewPoints\(verifier.points, w\)\)/);
  assert.match(flow, /diagnostics: diagnostics \? structuredClone\(diagnostics\) : undefined/);
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.side-review-tools > button\[aria-pressed="true"\] \{\s*background: var\(--acc\)/);
});

test("calibration facing explains displayed nose direction and automatically highlights the point-derived choice", () => {
  assert.match(flow, /<legend>Which way does the nose face\?<\/legend>/);
  assert.match(flow, /as you see it in this photo, not the person's left or right/);
  assert.match(flow, /If the highlighted choice matches, leave it selected/);
  assert.match(flow, /Changing it flips the starting points, not the photo/);
  assert.match(flow, /direction\.setAttribute\("aria-describedby", "side-direction-help"\)/);
  const facing = flow.slice(flow.indexOf('const facing = document.createElement("fieldset")'), flow.indexOf('const confirmation = document.createElement("label")'));
  assert.match(facing, /const actual = faceDirFromPoints\(verifier!\.points\)/);
  assert.match(facing, /button\.setAttribute\("aria-pressed", selected \? "true" : "false"\)/);
  assert.match(facing, /paintCalibrationDirection\(\);\s*facing.appendChild\(direction\)/,
    "the matching direction is selected before the controls mount, without a required extra click");
});

test("admin review cannot take the unverified automatic shortcut or confirm without its own explicit check", () => {
  assert.match(flow, /if \(calibrationReview\) \{[^}]*showReviewActions\(\);\s*\} else if \(startInGuidedMode\)/s);
  assert.match(flow, /type="checkbox" id="side-calibration-reviewed" \/>/);
  const confirm = flow.slice(flow.indexOf("const confirmPlacement"), flow.indexOf("const afterAutomatic"));
  assert.match(confirm, /if \(calibrationReview && !calibrationAcknowledged\)/);
  assert.ok(confirm.indexOf("calibrationAcknowledged") < confirm.indexOf("analyzeSide("));
  assert.match(confirm, /verified: calibrationReview \? calibrationAcknowledged/);
});

test("reviewed out-of-range admin metrics stay excluded diagnostics; public hard limits and point integrity remain", () => {
  const confirm = flow.slice(flow.indexOf("const confirmPlacement"), flow.indexOf("const afterAutomatic"));
  assert.match(confirm, /const issues = sidePointIntegrityIssues/);
  assert.match(confirm, /if \(issues.length\)/);
  assert.match(confirm, /if \(impossible.length && !calibrationReview\)/);
  assert.match(confirm, /diagnostics.reviewedRangeWarnings = report.metrics.filter\(\(m\) => m.implausible\)/);
  assert.doesNotMatch(confirm, /implausible\s*=\s*false|\.reliability\s*=/);
});
