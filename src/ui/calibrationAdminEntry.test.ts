import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const quick = readFileSync(new URL("../quick.ts", import.meta.url), "utf8");
const league = readFileSync(new URL("../league/main.ts", import.meta.url), "utf8");

test("calibration is a League owner-admin tool, not a creator upgrade or public route", () => {
  const html = readFileSync(new URL("../../quick.html", import.meta.url), "utf8");
  assert.match(html, /data-mode="calibrate" data-owner-only="true"/);
  assert.match(league, /\$\{me\.owner \? `[\s\S]*?href="\/league\/tools#calibrate"/);
  const entry = quick.slice(quick.indexOf("function enterMode("), quick.indexOf("async function openSavedFaceFromLibrary"));
  assert.ok(entry.indexOf("!canUseOwnerTools(quickAccess, quickOwnerId)") < entry.indexOf("mode = next"));
  const cal = quick.slice(quick.indexOf("function renderFaceSlots"), quick.indexOf("function renderRatingEdit"));
  assert.match(cal, /if \(!canUseOwnerTools\(quickAccess, quickOwnerId\)\) return/);
  assert.match(cal, /reviewMode: "calibration"/);
  assert.match(cal, /diagnostics: review\.diagnostics/);
  assert.equal([...quick.matchAll(/reviewMode: "calibration"/g)].length, 1, "regular creator/public scanning does not get the research override");
});

test("account switching clears the resolved grant before leaving the tool", () => {
  const changed = quick.slice(quick.indexOf("if (changed) {"), quick.indexOf("location.reload()"));
  assert.ok(changed.indexOf("quickAccess = null") < changed.indexOf("leaveMode()"));
});

test("League uses staff access independently of a pending creator application", () => {
  assert.match(league, /const entry = leagueEntry\(staff, row\?\.status \?\? null\)/);
  assert.match(league, /if \(entry === "staff"\)[\s\S]*?synthetic_staff: true/);
});
