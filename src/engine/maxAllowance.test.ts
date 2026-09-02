import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALLOWANCE_WARN_AT, MAX_DAILY_MESSAGES, allowanceLine, formatMaxReturn, nextUtcMidnight } from "./maxAllowance.js";

// The paywall's benefit line and the server's ceiling are one number. The
// tab sold "Unlimited chats" over a wall of thirty for a whole cycle because
// the two lived in files that never met; now the client prints this constant
// and the test reads the server's.
test("the printed allowance is the enforced allowance", () => {
  const server = readFileSync(new URL("../../api/_maxPersona.ts", import.meta.url), "utf8");
  const declared = Number(/export const MAX_DAILY_MESSAGES = (\d+);/.exec(server)?.[1]);
  assert.equal(declared, MAX_DAILY_MESSAGES);
  const tab = readFileSync(new URL("../ui/maxTab.ts", import.meta.url), "utf8");
  assert.doesNotMatch(tab, /Unlimited chats/);
  assert.match(tab, /Up to \$\{MAX_DAILY_MESSAGES\} messages a day/);
});

test("the day rolls over at the next UTC midnight", () => {
  assert.equal(nextUtcMidnight(Date.UTC(2026, 8, 2, 13, 5)), "2026-09-03T00:00:00.000Z");
  assert.equal(nextUtcMidnight(Date.UTC(2026, 8, 2, 23, 59)), "2026-09-03T00:00:00.000Z");
  assert.equal(nextUtcMidnight(Date.UTC(2026, 11, 31, 1)), "2027-01-01T00:00:00.000Z");
});

test("the return time is said in the reader's clock", () => {
  const resets = "2026-09-03T00:00:00.000Z";
  // Auckland is UTC+12 in September: midnight UTC is noon the same day.
  const noonNz = formatMaxReturn(resets, Date.UTC(2026, 8, 2, 20), "en-NZ", "Pacific/Auckland");
  assert.match(noonNz, /^back at 12:00/);
  // London at 21:00 the evening before sees it as tomorrow.
  const london = formatMaxReturn(resets, Date.UTC(2026, 8, 2, 20), "en-GB", "Europe/London");
  assert.match(london, /^back tomorrow at 0?1:00/);
  assert.equal(formatMaxReturn(null), "back tomorrow");
  assert.equal(formatMaxReturn("not a date"), "back tomorrow");
});

test("the composer line appears only once the count is low", () => {
  const resets = "2026-09-03T00:00:00.000Z";
  const now = Date.UTC(2026, 8, 2, 20);
  assert.equal(allowanceLine(null, resets, now), null);
  assert.equal(allowanceLine(ALLOWANCE_WARN_AT + 1, resets, now), null);
  assert.match(allowanceLine(ALLOWANCE_WARN_AT, resets, now) ?? "", /^5 messages left today\. Max is back/);
  assert.match(allowanceLine(1, resets, now) ?? "", /^1 message left today\./);
  assert.match(allowanceLine(0, resets, now) ?? "", new RegExp(`^That is ${MAX_DAILY_MESSAGES} messages today`));
  for (const line of [allowanceLine(3, resets, now), allowanceLine(0, resets, now)]) {
    assert.doesNotMatch(line ?? "", /—/, "no em dash in user-facing copy");
  }
});
