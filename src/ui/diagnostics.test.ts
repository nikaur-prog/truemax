import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticsText } from "./diagnostics.js";
import { METRICS } from "../engine/metrics.js";
import type { Report, ScoredMetric } from "../engine/types.js";

// ---------------------------------------------------------------------------
// The dump is a WIRE FORMAT, not just something to read.
//
// tools/repeat-scans.mjs parses this text to measure how much a score moves
// between two photographs of one person — the number the whole "we'll tell you
// whether it moved" promise rests on. That makes the layout a contract between
// two files that cannot import each other: one runs in a browser, the other in
// node against pasted text.
//
// The failure mode is silent and expensive. Rename a heading or drop the
// capture line and the tool reads zero scans out of a file that looks full,
// or — worse — reads the metrics and silently loses the pose gate, so a
// crooked capture is averaged in and reported as an unstable metric. Nobody
// would see it until a scanning session had already been spent.
//
// So the regexes below are DELIBERATE COPIES of the ones in the tool. If the
// dump format changes, these fail, and both files move together.
// ---------------------------------------------------------------------------

const CAPTURE_LINE = /^capture:\s*(.+)$/m;
const TAKEN_LINE = /^taken:\s*(\S+)/m;
const SCAN_LINE = /^scan:\s*(\S+)/m;
const FACE_LINE = /^face:\s*(.+)$/m;
const SEX_LINE = /^scored against:\s*(men|women)\s*$/m;
const OVERALL_LINE = /^overall:\s*([-\d.]+)/m;
const FRONT_LINE = /^front:\s*([-\d.]+)/m;
const SIDE_LINE = /·\s*side:\s*([-\d.]+)/m;
// The metric row: score, off in sigma, reliability, direction, value, ideal,
// then the name, which may contain spaces.
const METRIC_ROW =
  /^\s+([-\d.—]+)\s+([+-][\d.—]+)σ\s+([\d.—]+)\s+(\S+)\s+([-\d.—]+)\s+([-\d.—]+)\s+(.+?)\s*$/;

function metric(id: string, value: number, score: number): ScoredMetric {
  const def = METRICS.find((m) => m.id === id) ?? METRICS[0];
  return {
    def,
    value,
    score,
    percentile: 50,
    z: 0,
    zEff: 0,
    markerPct: 50,
    idealRange: [0, 1],
  } as unknown as ScoredMetric;
}

function report(overrides: Partial<Report> = {}): Report {
  const front = METRICS.filter((m) => m.view === "front").slice(0, 3);
  return {
    sex: "male",
    overall: 6.42,
    overallPercentile: 71.3,
    overallZ: 0.5,
    potential: 7.1,
    pillars: {} as Report["pillars"],
    regions: [],
    metrics: front.map((m, i) => metric(m.id, 1.234 + i, 5 + i)),
    zScores: {},
    ...overrides,
  } as Report;
}

test("the header lines the tool keys on are present and parseable", () => {
  const text = diagnosticsText(report(), "Henry");
  assert.equal(FACE_LINE.exec(text)?.[1].trim(), "Henry");
  assert.equal(SEX_LINE.exec(text)?.[1], "men");
  assert.equal(Number(OVERALL_LINE.exec(text)?.[1]), 6.4);
});

test("women are labelled in the words the tool maps to a sex", () => {
  const text = diagnosticsText(report({ sex: "female" }), "Ada");
  assert.equal(SEX_LINE.exec(text)?.[1], "women");
});

// The line that decides whether two dumps of one person can be compared at
// all. Without it the tool cannot gate on pose, and a 20-degree capture is
// averaged in as instability that belongs to the photographer.
test("capture conditions round-trip through the dump", () => {
  const text = diagnosticsText(report(), "Henry", {
    yawDeg: 3.14,
    pitchDeg: -1.4,
    rollDeg: 0.25,
    smileScore: 0.081,
    at: "2026-08-25T09:14:22.118Z",
    scanId: "7f3c9a",
  });
  const cap = CAPTURE_LINE.exec(text)?.[1] ?? "";
  assert.match(cap, /yaw\s*3\.1°/);
  assert.match(cap, /pitch\s*-1\.4°/);
  assert.match(cap, /roll\s*0\.3°/);
  assert.match(cap, /smile\s*0\.08/);
  // Parsed back exactly the way the tool does it.
  assert.equal(Number(/yaw\s*([-\d.]+)/.exec(cap)?.[1]), 3.1);
  assert.equal(Number(/pitch\s*([-\d.]+)/.exec(cap)?.[1]), -1.4);
  assert.equal(Number(/smile\s*([-\d.]+)/.exec(cap)?.[1]), 0.08);
  assert.equal(TAKEN_LINE.exec(text)?.[1], "2026-08-25T09:14:22.118Z");
  assert.equal(SCAN_LINE.exec(text)?.[1], "7f3c9a");
});

// A dump with no capture block must still parse as a scan — the tool counts
// those separately as "cannot be gated" rather than dropping them silently.
test("a dump without capture conditions still carries face and metrics", () => {
  const text = diagnosticsText(report(), "Henry");
  assert.equal(CAPTURE_LINE.test(text), false);
  assert.equal(FACE_LINE.exec(text)?.[1].trim(), "Henry");
  const rows = text.split("\n").filter((l) => METRIC_ROW.test(l));
  assert.ok(rows.length >= 3, `expected metric rows, got ${rows.length}`);
});

test("every metric row parses, and the value column is the measurement", () => {
  const text = diagnosticsText(report(), "Henry");
  const rows = text.split("\n").map((l) => METRIC_ROW.exec(l)).filter(Boolean);
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    const value = Number(row![5]);
    const name = row![7];
    assert.ok(Number.isFinite(value), `value column not numeric: ${row![0]}`);
    assert.ok(name.length > 0, "metric name column is empty");
    // The name is what groups a metric across two dumps, so it must not be
    // truncated into something ambiguous.
    assert.ok(METRICS.some((m) => m.name === name), `unknown metric name "${name}"`);
  }
});

// Both views' scores travel, because a merged overall cannot be read back as
// "roughly the front" — and the side is the half under suspicion.
test("front and side scores are separately readable when both were measured", () => {
  const text = diagnosticsText(
    report({ views: { front: { score: 6.1, percentile: 65 }, side: { score: 5.2, percentile: 48 } } as Report["views"] }),
    "Henry",
  );
  assert.equal(Number(FRONT_LINE.exec(text)?.[1]), 6.1);
  assert.equal(Number(SIDE_LINE.exec(text)?.[1]), 5.2);
});

test("a front-only scan says so rather than reporting a side of zero", () => {
  const text = diagnosticsText(report(), "Henry");
  assert.equal(SIDE_LINE.test(text), false);
  assert.match(text, /views: front only/);
});

// The tool splits a multi-dump file on this heading. If it stops being the
// first line of its own, several pasted scans merge into one and the
// repeatability measurement quietly compares a face against itself.
test("the heading is on its own line, so concatenated dumps split cleanly", () => {
  const a = diagnosticsText(report(), "Henry");
  const b = diagnosticsText(report(), "Ada");
  const joined = `${a}\n\n${b}`;
  const chunks = joined
    .split(/^(?=TRUEMAX SCAN DIAGNOSTICS\s*$)/m)
    .filter((c) => c.trim().startsWith("TRUEMAX SCAN DIAGNOSTICS"));
  assert.equal(chunks.length, 2);
  assert.equal(FACE_LINE.exec(chunks[0])?.[1].trim(), "Henry");
  assert.equal(FACE_LINE.exec(chunks[1])?.[1].trim(), "Ada");
});
