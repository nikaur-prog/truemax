import assert from "node:assert/strict";
import test from "node:test";
import { chooseMaxPresence, maxPresenceLines, routineDay } from "./maxPresence.js";
import { maxSpeechWindow, maxTextMouthLevel } from "./maxSpeechText.js";

const now = new Date(2026, 8, 19, 12).getTime();

test("Max's unscanned greeting never invents a reading, routine, product or progress", () => {
  const lines = maxPresenceLines({ hasOwnScan: false, now });
  assert.ok(lines.some((line) => line.id === "first-scan"));
  assert.ok(!lines.some((line) => line.id === "scan-context" || line.id.startsWith("routine:")));
  assert.doesNotMatch(lines.map((line) => line.text).join(" "), /progress|you look|better|retinol|day \d|your latest scan/i);
});

test("only an actual own scan enables scan-aware openers", () => {
  const lines = maxPresenceLines({ hasOwnScan: true, now });
  assert.ok(lines.some((line) => line.id === "scan-context"));
  assert.ok(!lines.some((line) => line.id === "first-scan"));
});

test("routine check-in uses the recorded start, not an assumed result or adherence streak", () => {
  const lines = maxPresenceLines({ hasOwnScan: true, now, routines: [
    { id: "real", title: "Evening cleanse", status: "running", startedAt: new Date(2026, 8, 16, 23).getTime() },
    { id: "not-started", title: "Unstarted product", status: "committed", startedAt: null },
    { id: "future", title: "Future routine", status: "running", startedAt: now + 86_400_000 },
    { id: "unknown", title: "Missing start", status: "running", startedAt: null },
    { id: "judged", title: "Finished routine", status: "judged", startedAt: now - 86_400_000 },
  ] });
  const routines = lines.filter((line) => line.id.startsWith("routine:"));
  assert.equal(routines.length, 1);
  assert.equal(lines[0].id, "routine:real", "a recorded running routine makes the first visit useful");
  assert.match(routines[0].text, /^Day 4 since you started Evening cleanse\./);
  assert.doesNotMatch(routines[0].text, /working|improv|progress|consisten|streak/);
  assert.match(routines[0].question, /Ask me how it has been going before suggesting any changes/);
});

test("invalid dates and future starts do not become routine days", () => {
  assert.equal(routineDay(null, now), null);
  assert.equal(routineDay(NaN, now), null);
  assert.equal(routineDay(now, Infinity), null);
  assert.equal(routineDay(now + 1, now), null);
  assert.equal(routineDay(now, now), 1);
});

test("personal name is optional, bounded and not repeated across every greeting", () => {
  const lines = maxPresenceLines({ name: "Mary", hasOwnScan: true, now });
  assert.equal(lines.filter((line) => line.text.includes("Mary")).length, 1);
  assert.ok(!maxPresenceLines({ name: "A".repeat(100), hasOwnScan: false }).some((line) => line.text.includes("AAAA")));
  assert.doesNotMatch(lines.map((line) => line.text).join(" "), /\u2014/);
});

test("visible-entry rotation is stable and does not immediately repeat", () => {
  const context = { hasOwnScan: false, now };
  const first = chooseMaxPresence(context, 0);
  assert.deepEqual(chooseMaxPresence(context, 0), first);
  assert.notEqual(chooseMaxPresence(context, 0, first.id).id, first.id);
  assert.ok(chooseMaxPresence(context, NaN).text);
  let previous: string | undefined;
  const visited = new Set<string>();
  for (let visit = 0; visit < maxPresenceLines(context).length; visit++) {
    const next = chooseMaxPresence(context, visit, previous);
    visited.add(next.id); previous = next.id;
  }
  assert.equal(visited.size, maxPresenceLines(context).length);
});

test("speech excerpt follows the latest words, with bounded plain text", () => {
  assert.equal(maxSpeechWindow("**Hello.**\nWhat's next?"), "Hello. What's next?");
  const answer = "Earlier information. ".repeat(50) + "This is the final sentence.";
  const excerpt = maxSpeechWindow(answer, 100);
  assert.ok(excerpt.length <= 100);
  assert.ok(excerpt.endsWith("This is the final sentence."));
  assert.equal(maxSpeechWindow(""), "");
  assert.equal(maxSpeechWindow("x".repeat(500), NaN).length, 140);
});

test("decorative mouth cadence has pauses and finite bounded levels", () => {
  for (const char of ["", " ", ".", ",", "!", "?"]) assert.equal(maxTextMouthLevel(char), 0);
  for (const char of ["a", "z", "é", "🙂"]) {
    const level = maxTextMouthLevel(char);
    assert.ok(Number.isFinite(level) && level > 0 && level <= 1);
  }
});
