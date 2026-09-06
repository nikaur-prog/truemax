import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchSideFeedbackRows, sideFeedbackCalibrationOffsets, sideFeedbackOffsets } from "../../scripts/side-feedback-analysis.mjs";
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
  const helper = readFileSync(new URL("../../scripts/side-feedback-analysis.mjs", import.meta.url), "utf8");
  assert.match(helper, /id,face_dir,image_width,image_height,review_status,/);
  assert.match(source, /sideFeedbackOffsets\(row, POINT_IDS\)/);
  assert.match(source, /sideFeedbackCalibrationOffsets\(row, POINT_IDS/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("calibration candidates require independent review, active retention and moved-point evidence", () => {
  const now = Date.parse("2026-09-07T00:00:00Z");
  const row = { ...fixture(640, 853), expires_at: "2026-09-08T00:00:00Z", moved_point_ids: ["tragion"] };
  assert.deepEqual(Object.keys(sideFeedbackCalibrationOffsets(row, IDS, now)!), ["tragion"]);
  for (const review_status of ["new", "rejected", "unknown", undefined]) {
    assert.equal(sideFeedbackCalibrationOffsets({ ...row, review_status }, IDS, now), null);
  }
  for (const expires_at of [undefined, "invalid", "2026-09-07T00:00:00Z"]) {
    assert.equal(sideFeedbackCalibrationOffsets({ ...row, expires_at }, IDS, now), null);
  }
  assert.equal(sideFeedbackCalibrationOffsets({ ...row, moved_point_ids: undefined }, IDS, now), null);
});

const SNAPSHOT = "2026-09-07T00:00:00.000Z";
function pageRow(n: number) {
  return { ...fixture(640, 853), id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, created_at: "2026-09-06T00:00:00.000Z", expires_at: "2026-09-08T00:00:00.000Z" };
}

test("feedback pagination reads beyond a server-capped page using a stable keyset and expiry filter", async () => {
  const requests: URL[] = [];
  const batches = [[pageRow(1)], [pageRow(2)], []];
  const fetcher = (async (url: string | URL | Request) => {
    requests.push(new URL(String(url)));
    return Response.json(batches.shift());
  }) as typeof fetch;
  const rows = await fetchSideFeedbackRows("https://example.invalid", "test-key", { fetcher, now: SNAPSHOT, pageSize: 500 });
  assert.equal(rows.length, 2);
  assert.equal(requests.length, 3, "a short server-capped page is not end of data");
  assert.equal(requests[0].searchParams.get("expires_at"), `gt.${SNAPSHOT}`);
  assert.equal(requests[0].searchParams.get("created_at"), `lte.${SNAPSHOT}`);
  assert.equal(requests[0].searchParams.get("order"), "created_at.asc,id.asc");
  assert.ok(requests[1].searchParams.get("or")!.includes(pageRow(1).id));
  assert.ok(requests[2].searchParams.get("or")!.includes(pageRow(2).id));
});

test("incomplete, repeated and expired feedback pages fail instead of emitting partial calibration", async () => {
  const run = (batches: unknown[]) => fetchSideFeedbackRows("https://example.invalid", "test-key", {
    now: SNAPSHOT,
    fetcher: (async () => Response.json(batches.shift())) as typeof fetch,
  });
  await assert.rejects(run([[pageRow(1)], [pageRow(1)]]), /repeated/);
  await assert.rejects(run([[pageRow(1)], { error: "bad page" }]), /did not return rows/);
  await assert.rejects(run([[{ ...pageRow(1), expires_at: "2026-09-01T00:00:00Z" }]]), /outside the active snapshot/);
  await assert.rejects(run([[{ ...pageRow(1), id: null }]]), /pagination evidence/);
});
