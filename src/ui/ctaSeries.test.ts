import test from "node:test";
import assert from "node:assert/strict";
import { CTA_BEATS, CTA_SECONDS } from "./ctaSeries.js";

// The CTA is one fixed piece of film. These tests pin the properties that
// make it usable as one: the beats tile the runtime exactly, in script order,
// so a VO recorded against the published beat map can never drift out from
// under the visuals in a later edit.

test("the beats tile the full runtime with no gaps and no overlaps", () => {
  assert.equal(CTA_BEATS[0].start, 0);
  for (let i = 1; i < CTA_BEATS.length; i++) {
    assert.equal(CTA_BEATS[i].start, CTA_BEATS[i - 1].end, `gap before ${CTA_BEATS[i].id}`);
  }
  assert.equal(CTA_BEATS[CTA_BEATS.length - 1].end, CTA_SECONDS);
});

test("the beats follow the script order", () => {
  // The VO reads: analysis → breakdown → coach → confident self → recs →
  // weekly tracking → link in bio → search. A reorder here is a re-shoot.
  assert.deepEqual(
    CTA_BEATS.map((b) => b.id),
    ["score", "measure", "coach", "confident", "recs", "progress", "linkbio", "search"],
  );
});

test("every beat is long enough to read", () => {
  for (const b of CTA_BEATS) {
    assert.ok(b.end - b.start >= 1.5, `${b.id} is ${(b.end - b.start).toFixed(1)}s — a flash, not a beat`);
  }
});
