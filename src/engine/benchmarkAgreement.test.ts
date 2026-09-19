import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const moduleUrl = new URL("../../tools/benchmark-agreement.mjs", import.meta.url);
const { summarizeBenchmark, formatBenchmark } = await import(moduleUrl.href);
const pair = (ours: number, theirs: number, extra: Record<string, unknown> = {}) => ({
  metric: "angle", unit: "deg", ours, theirs, definitionConfirmed: true, ...extra,
});
const capture = (person: string, rows: unknown[], extra: Record<string, unknown> = {}) => ({
  person, name: `${person} capture`, rows, ...extra,
});

test("benchmark accepts only explicit true confirmation and never silently approves historical rows", () => {
  const result = summarizeBenchmark({ faces: [capture("a", [
    pair(2, 1), pair(20, 1, { definitionConfirmed: undefined }),
    pair(20, 1, { definitionConfirmed: false }), pair(20, 1, { definitionConfirmed: "true" }),
  ])] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].n, 1);
  assert.equal(result.rows[0].meanDelta, 1);
  assert.equal(result.held.length, 3);
  assert.equal(result.faces[0].accepted, 1);
  const none = summarizeBenchmark({ faces: [capture("a", [pair(2, 1, { definitionConfirmed: undefined })])] });
  assert.match(formatBenchmark(none), /No explicitly confirmed measurement pairs/);
});

test("benchmark handles zero, near-zero and negative measurements in signed native units", () => {
  const result = summarizeBenchmark({ faces: [
    capture("a", [pair(0.2, 0)]), capture("b", [pair(-0.1, 0.000001)]),
    capture("c", [pair(-0.3, -0.4)]),
  ] });
  const row = result.rows[0];
  assert.ok(Math.abs(row.meanDelta - (0.2 - 0.100001 + 0.1) / 3) < 1e-12);
  assert.ok(Math.abs(row.meanAbsDelta - (0.2 + 0.100001 + 0.1) / 3) < 1e-12);
  assert.equal(row.maxAbsDelta, 0.2);
  assert.equal(row.unit, "°");
  assert.equal(row.consistent, false);
  assert.equal("meanRel" in row, false);
  assert.doesNotMatch(formatBenchmark(result), /NaN|Infinity|mean Δ%/);
});

test("benchmark does not pool incompatible units or silently convert percent into ratios", () => {
  const result = summarizeBenchmark({ faces: [capture("a", [
    pair(1, 0, { unit: "°" }), pair(2, 0, { unit: "degrees" }),
    pair(0.8, 0.7, { unit: "x" }), pair(0.9, 0.7, { unit: "" }),
    pair(80, 70, { unit: "%" }), pair(4, 2, { unit: "mm" }),
    pair(4, 2, { unit: undefined }),
  ])] });
  const groups = new Map<string, { n: number; meanDelta: number }>(result.rows.map((row: { unit: string; n: number; meanDelta: number }) => [row.unit, row]));
  assert.equal(groups.size, 4);
  assert.equal(groups.get("°")?.n, 2);
  assert.equal(groups.get("ratio")?.n, 2);
  assert.equal(groups.get("pp")?.meanDelta, 10);
  assert.equal(groups.get("mm")?.meanDelta, 2);
  assert.equal(result.held[0].reason, "measurement unit missing");
});

test("repeat captures cannot masquerade as independent people or dominate signed and absolute means", () => {
  const data = { faces: [
    ...Array.from({ length: 10 }, () => capture("a", [pair(4, 0)])),
    capture("b", [pair(-2, 0)]), capture("c", [pair(1, 0)]),
  ] };
  const row = summarizeBenchmark(data).rows[0];
  assert.equal(row.n, 12);
  assert.equal(row.people, 3);
  assert.equal(row.meanDelta, 1);
  assert.equal(row.meanAbsDelta, 7 / 3);
  assert.equal(row.consistent, false);
  const repeatsOnly = summarizeBenchmark({ faces: data.faces.slice(0, 10) }).rows[0];
  assert.equal(repeatsOnly.people, 1);
  assert.equal(repeatsOnly.consistent, false);
});

test("shared signs are exploratory only, and changing product scores cannot change measurement statistics", () => {
  const faces = [capture("a", [pair(0.1, 0)]), capture("b", [pair(0.2, 0)]), capture("c", [pair(0.3, 0)])];
  const first = summarizeBenchmark({ faces });
  const second = summarizeBenchmark({ faces: faces.map((face) => ({ ...face, ourOverall: 9, theirOverall: 2, theirGeometryOnly: 4 })) });
  assert.deepEqual(first.rows, second.rows);
  assert.equal(first.rows[0].consistent, true);
  assert.match(formatBenchmark(second), /yes, exploratory/);
  assert.match(formatBenchmark(second), /not an accuracy verdict/);
});

test("invalid and unavailable values are held rather than treated as zero", () => {
  const result = summarizeBenchmark({ faces: [capture("a", [
    pair(Number.NaN, 1), pair(Infinity, 1), pair(0, 0, { ours: null }),
    pair(0, 0, { metric: "" }), pair(Number.MAX_VALUE, -Number.MAX_VALUE),
    pair(0, 0),
  ])] });
  assert.equal(result.held.length, 5);
  assert.equal(result.rows[0].n, 1);
  assert.equal(result.rows[0].meanDelta, 0);
});

test("importing the benchmark helper never reads or prints a dataset", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl.href)}); console.log("imported");`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "imported\n");
});
