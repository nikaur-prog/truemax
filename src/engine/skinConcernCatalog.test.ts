import assert from "node:assert/strict";
import test from "node:test";
import {
  SKIN_CONCERN_CATALOG,
  TRIAL_DETECTABLE_SKIN_CONCERNS,
} from "./skinConcernCatalog.ts";

test("the visible-skin catalogue has unique ids and evidence gates", () => {
  const ids = SKIN_CONCERN_CATALOG.map((concern) => concern.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const concern of SKIN_CONCERN_CATALOG) {
    assert.ok(concern.observable.length > 20);
    assert.ok(concern.minimumEvidence.length > 20);
    assert.ok(concern.actions.length > 0);
  }
});

test("clinician-only concerns can never enter the detectable trial set", () => {
  assert.ok(TRIAL_DETECTABLE_SKIN_CONCERNS.length > 0);
  assert.ok(TRIAL_DETECTABLE_SKIN_CONCERNS.every((concern) => concern.tier === "trial"));
  assert.ok(!TRIAL_DETECTABLE_SKIN_CONCERNS.some((concern) => concern.id === "changing-lesion"));
  assert.ok(!TRIAL_DETECTABLE_SKIN_CONCERNS.some((concern) => concern.id === "infection-or-acute-rash"));
});
