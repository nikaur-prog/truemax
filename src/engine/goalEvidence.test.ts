import test from "node:test";
import assert from "node:assert/strict";
import { MOVE_MIN, canShowProgress, evidenceFor, noEvidenceReason } from "./goalEvidence.js";
import { GOALS } from "./goals.js";
import { RELIABLE_MIN, reliabilityOf } from "./reliability.js";
import { METRICS } from "./metrics.js";
import { SIDE_METRICS } from "./sideMetrics.js";

const ALL = [...METRICS, ...SIDE_METRICS];
const def = (id: string) => ALL.find((m) => m.id === id)!;

test("the four measurements that cannot hold still are never offered as evidence", () => {
  // Named individually because these are the ones that are currently declared
  // by a goal and would otherwise be shown. fwhr reproduces at 0.00 across two
  // photographs of one face, and mirrorDeviation at 0.02: a progress line on
  // either would move on the weather.
  for (const id of ["fwhr", "mirrorDeviation", "eyeMouthParallel", "chinHeightRatio"]) {
    assert.ok(reliabilityOf(id) < RELIABLE_MIN, `${id} is no longer under the bar; re-check this test`);
    assert.equal(canShowProgress(id), false, id);
  }
});

test("a measurement that is mostly bone is never offered as evidence", () => {
  // It cannot move however well somebody does, so a line on it reads as failure
  // when it is nothing of the kind.
  for (const id of ["lipRatio", "philtrumChinRatio", "canthalTilt"]) {
    assert.ok(def(id).fixability < MOVE_MIN, `${id} moved above the floor; re-check this test`);
    assert.equal(canShowProgress(id), false, id);
  }
});

test("the soft-tissue readings that do move and do reproduce are offered", () => {
  // The other side of the same rule, so the filter cannot be tightened into
  // uselessness without this failing.
  for (const id of ["jawCheekRatio", "cheekboneHeight", "gonialProxy", "browTilt", "mouthCornerTilt"]) {
    assert.equal(canShowProgress(id), true, id);
  }
});

test("every id a goal declares either passes both filters or is dropped", () => {
  for (const goal of GOALS) {
    const shown = new Set(evidenceFor(goal.id).map((m) => m.id));
    for (const id of goal.metrics) {
      const ok = def(id).fixability >= MOVE_MIN && reliabilityOf(id) >= RELIABLE_MIN;
      assert.equal(shown.has(id), ok, `${goal.id}/${id}`);
    }
  }
});

test("evidence is ordered by how much it would actually show", () => {
  for (const goal of GOALS) {
    const rows = evidenceFor(goal.id);
    const w = rows.map((m) => m.fixability * reliabilityOf(m.id));
    assert.deepEqual(w, [...w].sort((a, b) => b - a), goal.id);
  }
});

test("an unknown goal returns nothing rather than throwing", () => {
  assert.deepEqual(evidenceFor("not-a-goal"), []);
  assert.equal(noEvidenceReason("not-a-goal"), null);
});

test("a goal with nothing to show says which kind of nothing it is", () => {
  // Skin and hair declare no metrics: the face scan measures geometry and
  // neither of those is geometry. That is a different statement from "the
  // measurements exist but are too noisy", and a person reading it deserves the
  // difference.
  assert.equal(noEvidenceReason("skin"), "unmeasured");
  assert.equal(noEvidenceReason("hair"), "unmeasured");
  for (const goal of GOALS) {
    const reason = noEvidenceReason(goal.id);
    if (evidenceFor(goal.id).length) assert.equal(reason, null, goal.id);
    else assert.ok(reason, `${goal.id} has no evidence and no reason`);
  }
});

test("no goal is left claiming evidence it does not have", () => {
  // The regression this whole module exists to prevent: symmetry declares four
  // metrics, two of which are among the least reproducible in the product.
  const symmetry = evidenceFor("symmetry").map((m) => m.id);
  assert.ok(!symmetry.includes("mirrorDeviation"));
  assert.ok(!symmetry.includes("eyeMouthParallel"));
  assert.ok(symmetry.includes("midlineDeviation"), "symmetry lost the one reading that does hold still");
});

test("the jaw goal keeps its soft-tissue readings and loses its bone one", () => {
  const jaw = evidenceFor("jaw").map((m) => m.id);
  assert.ok(jaw.includes("gonialProxy"));
  assert.ok(jaw.includes("jawCheekRatio"));
  // jawFrontalAngle reproduces at 0.10 and chinHeightRatio at 0.03.
  assert.ok(!jaw.includes("jawFrontalAngle"));
  assert.ok(!jaw.includes("chinHeightRatio"));
});
