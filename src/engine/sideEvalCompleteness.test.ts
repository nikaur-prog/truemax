import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanProfileRate, evaluationCompletenessHolds } from "../../scripts/side-eval-completeness.js";
import type { EvaluationFace } from "../../scripts/side-eval-completeness.js";

const POINTS = ["menton", "cervicale", "gonion", "condylion", "tragion"] as const;
const READERS = ["seeder", "model", "fused"] as const;
type Face = EvaluationFace<typeof POINTS[number], typeof READERS[number]>;
function face(id = "profile-a"): Face {
  return {
    id,
    moved: new Set(POINTS),
    err: Object.fromEntries(READERS.map((reader) => [reader,
      Object.fromEntries(POINTS.map((point) => [point, 0.04])),
    ])) as Face["err"],
  };
}
const holds = (faces: Face[], ids = ["profile-a"]) => evaluationCompletenessHolds(ids, faces, POINTS, READERS);

test("a complete sample keeps the existing numerical verdict eligible", () => {
  assert.deepEqual(holds([face()]), []);
  assert.equal(cleanProfileRate([face()], POINTS, "fused", 0.1), 1);
});

test("absent hand-moved evidence holds every affected back point", () => {
  const sample = face();
  sample.moved = new Set(["tragion", "condylion"]);
  const reasons = holds([sample]);
  for (const point of ["menton", "cervicale", "gonion"]) {
    assert.ok(reasons.includes(`${point}: no hand-moved evidence`));
  }
});

test("missing or nonfinite required errors are not clean and cannot pass", () => {
  for (const value of [undefined, NaN, Infinity, -1]) {
    const sample = face();
    sample.err.fused.gonion = value;
    assert.ok(holds([sample]).some((reason) => reason.includes("gonion") && reason.includes("fused")));
    assert.equal(cleanProfileRate([sample], POINTS, "fused", 0.1), 0);
  }
});

test("partial annotations cannot masquerade as an all-five clean profile", () => {
  const sample = face();
  for (const reader of READERS) delete sample.err[reader].menton;
  assert.equal(cleanProfileRate([sample], POINTS, "fused", 0.1), 0);
  assert.equal(holds([sample]).filter((reason) => reason.includes("menton")).length, 3);
});

test("missing provider results, limited runs and empty datasets hold", () => {
  assert.ok(holds([face()], ["profile-a", "profile-b"]).includes("1 expected profile(s) were not scored"));
  assert.ok(holds([]).length > 0);
  assert.ok(holds([], []).length > 0);
  assert.equal(cleanProfileRate([], POINTS, "fused", 0.1), 0);
});

test("duplicate faces cannot inflate evidence and the error threshold stays unchanged", () => {
  assert.ok(holds([face(), face()]).includes("duplicate profiles in the evaluation sample"));
  const sample = face();
  sample.err.fused.gonion = 0.100001;
  assert.equal(cleanProfileRate([sample], POINTS, "fused", 0.1), 0);
  assert.equal(cleanProfileRate([sample], POINTS, "fused", 0.100001), 1);
});

test("the real verdict uses full eligible coverage and a hold exits nonzero", () => {
  const source = readFileSync(new URL("../../scripts/eval-vision-landmarks.ts", import.meta.url), "utf8");
  assert.match(source, /evaluationCompletenessHolds\(eligibleIds, perFace, BACK_LANDMARK_IDS, READERS\)/);
  assert.match(source, /cleanProfileRate\(perFace, BACK_LANDMARK_IDS, reader, within\)/);
  assert.match(source, /cached\.version !== LANDMARK_VERSION/);
  assert.match(source, /if \(holds\.length\) process\.exitCode = 1/);
  assert.doesNotMatch(source, /f\.err\[reader\]\[pid\] === undefined \|\|/);
});
