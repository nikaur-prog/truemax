import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sideFeedbackOffsets } from "../../scripts/side-feedback-analysis.mjs";
import type { FeedbackAnalysisRow } from "../../scripts/side-feedback-analysis.mjs";

const IDS = ["trichion", "menton", "tragion"];
function fixture(width: number, height: number, scale = 1): FeedbackAnalysisRow {
  const point = (x: number, y: number) => ({ x: x * scale / width, y: y * scale / height });
  const automatic_points = { trichion: point(240, 100), menton: point(240, 500), tragion: point(200, 300) };
  return {
    review_status: "reviewed", image_width: width, image_height: height, face_dir: 1,
    automatic_points, corrected_points: { ...automatic_points, tragion: point(240, 310) },
  };
}

test("equal pixel corrections agree on portrait, landscape and square frames", () => {
  for (const [width, height] of [[640, 853], [853, 640], [640, 640]]) {
    const offsets = sideFeedbackOffsets(fixture(width, height), IDS)!;
    assert.ok(Math.abs(offsets.tragion.dx - 0.1) < 1e-12, `${width}x${height} horizontal`);
    assert.ok(Math.abs(offsets.tragion.dy - 0.025) < 1e-12, `${width}x${height} vertical`);
    assert.deepEqual(offsets.menton, { dx: 0, dy: 0 });
  }
});

test("portrait correction is not multiplied by the frame aspect ratio", () => {
  const row = fixture(640, 853);
  const legacy = (row.corrected_points.tragion.x - row.automatic_points.tragion.x)
    / (row.corrected_points.menton.y - row.corrected_points.trichion.y);
  assert.ok(Math.abs(legacy - 0.1 * 853 / 640) < 1e-12);
  assert.ok(Math.abs(sideFeedbackOffsets(row, IDS)!.tragion.dx - 0.1) < 1e-12);
});

test("scaling the same image preserves offsets and mirroring changes only x sign", () => {
  const row = fixture(1280, 1706, 2);
  const offsets = sideFeedbackOffsets(row, IDS)!;
  assert.ok(Math.abs(offsets.tragion.dx - 0.1) < 1e-12);
  const mirrored = sideFeedbackOffsets({ ...row, face_dir: -1 }, IDS)!;
  assert.equal(mirrored.tragion.dx, -offsets.tragion.dx);
  assert.equal(mirrored.tragion.dy, offsets.tragion.dy);
});

test("rejected and unknown-review feedback cannot influence the diagnostic offsets", () => {
  for (const review_status of ["rejected", "unknown", undefined]) {
    assert.equal(sideFeedbackOffsets({ ...fixture(640, 853), review_status }, IDS), null);
  }
  for (const review_status of ["new", "reviewed", "incorporated"]) {
    assert.ok(sideFeedbackOffsets({ ...fixture(640, 853), review_status }, IDS));
  }
});

test("missing dimensions and degenerate corrected heights are excluded, never guessed", () => {
  assert.equal(sideFeedbackOffsets({ ...fixture(640, 853), image_width: undefined }, IDS), null);
  assert.equal(sideFeedbackOffsets({ ...fixture(640, 853), image_height: Number.NaN }, IDS), null);
  const row = fixture(640, 853);
  row.corrected_points.menton = row.corrected_points.trichion;
  assert.equal(sideFeedbackOffsets(row, IDS), null);
});

test("the diagnostic reader requests dimensions and review status without applying changes", () => {
  const source = readFileSync(new URL("../../scripts/analyze-side-feedback.mjs", import.meta.url), "utf8");
  assert.match(source, /select=face_dir,image_width,image_height,review_status,/);
  assert.match(source, /sideFeedbackOffsets\(row, POINT_IDS\)/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});
