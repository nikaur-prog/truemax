import assert from "node:assert/strict";
import test from "node:test";
import { FUNNEL_EVENTS } from "./funnelEvents.js";
import { FUNNEL_CHAIN, SIGNUP_RETURN_PAIR, buildChain, biggestDrop, formatFunnelReport, summariseFunnel, windowDays } from "./funnelReport.js";

test("every chain step and the signup pair are counted events", () => {
  for (const e of [...FUNNEL_CHAIN, ...SIGNUP_RETURN_PAIR, "install-prompt-shown", "install-accepted", "launch-standalone", "streak-day-counted", "streak-ended"]) {
    assert.ok((FUNNEL_EVENTS as readonly string[]).includes(e), `${e} is not in the allowlist`);
  }
  for (const e of FUNNEL_EVENTS) assert.ok(e.length <= 48, `${e} exceeds the column length`);
});

test("the window is the last N UTC days ending today, ascending", () => {
  const days = windowDays(3, new Date("2026-09-04T23:30:00Z"));
  assert.deepEqual(days, ["2026-09-02", "2026-09-03", "2026-09-04"]);
});

test("each step's share is of the one before, and the biggest drop is the smallest share", () => {
  const chain = buildChain({ visit: 1000, "scan-front-done": 400, "scan-side-done": 300, "results-shown": 290, "account-created": 60, "checkout-started": 30 });
  assert.equal(chain[0].share, null);
  assert.equal(chain[1].share, 0.4);
  assert.equal(chain[4].share, 60 / 290);
  assert.equal(biggestDrop(chain)?.event, "account-created");
  const empty = buildChain({});
  assert.equal(biggestDrop(empty), null);
});

test("rows outside the window are ignored and the pair reads as a recovery rate", () => {
  const days = windowDays(2, new Date("2026-09-04T00:00:00Z"));
  const summary = summariseFunnel(
    [
      { day: "2026-09-03", event: "visit", count: 10 },
      { day: "2026-09-04", event: "visit", count: 5 },
      { day: "2026-08-01", event: "visit", count: 999 },
      { day: "2026-09-04", event: "signup-return-analysis", count: 3 },
      { day: "2026-09-04", event: "signup-return-lost", count: 1 },
    ],
    days,
  );
  assert.equal(summary.totals.visit, 15);
  assert.equal(summary.byDay.visit["2026-09-03"], 10);
  assert.equal(summary.signupReturn.recovered, 0.75);
  const text = formatFunnelReport(summary);
  assert.match(text, /visit\s+15/);
  assert.match(text, /75% recovered/);
  assert.doesNotMatch(text, /—/);
});
