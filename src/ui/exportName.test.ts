import test from "node:test";
import assert from "node:assert/strict";
import { exportName } from "./saveFile.js";

// ---------------------------------------------------------------------------
// Names are the only filing lever a browser has.
//
// A download's FOLDER is the operating system's decision — every file lands in
// the same one. So the name has to carry everything a sorting rule or a person
// scanning a list needs, and the old ones carried almost nothing:
// truemax-1755738291043.png next to truemax-card-... and truemax-rundown-...,
// three schemes, one opaque number.
// ---------------------------------------------------------------------------

test("the kind leads, so one prefix selects one category", () => {
  for (const kind of ["reel", "rundown", "card", "scan"] as const) {
    assert.match(exportName(kind, "mp4"), new RegExp(`^truemax-${kind}-`));
  }
});

test("the timestamp reads as a date and sorts as text", () => {
  const name = exportName("reel", "mp4");
  // truemax-reel-YYYY-MM-DD-HHMM.mp4
  assert.match(name, /^truemax-reel-\d{4}-\d{2}-\d{2}-\d{4}\.mp4$/);
  // Sorting matters as much as reading: zero-padded fields mean plain
  // alphabetical order is chronological order, which epoch milliseconds only
  // manage while the digit count happens to stay the same.
  const early = "truemax-reel-2026-08-09-0900.mp4";
  const late = "truemax-reel-2026-08-22-1430.mp4";
  assert.ok(early < late, "text sort must agree with time order");
});

test("a label is slugged into the middle, never into the extension", () => {
  const name = exportName("rundown", "mp4", "Henry Cavill!");
  assert.match(name, /^truemax-rundown-henry-cavill-\d{4}-\d{2}-\d{2}-\d{4}\.mp4$/);
});

test("an empty or punctuation-only label collapses away rather than doubling a dash", () => {
  // The trap: a naive join leaves truemax-card--2026-... which reads as a typo
  // and breaks any rule matching on a single separator.
  for (const label of ["", "   ", "!!!", "///"]) {
    const name = exportName("card", "png", label);
    assert.ok(!name.includes("--"), `"${label}" produced ${name}`);
    assert.match(name, /^truemax-card-\d{4}-/);
  }
});

test("a long label cannot run away with the filename", () => {
  const name = exportName("rundown", "mp4", "a".repeat(200));
  assert.ok(name.length < 80, `filename is ${name.length} characters`);
});
