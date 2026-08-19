import assert from "node:assert/strict";
import test from "node:test";
import { FUNNEL_EVENTS } from "./funnelEvents.js";

test("funnel events are unique aggregate names without identity or content fields", () => {
  assert.equal(new Set(FUNNEL_EVENTS).size, FUNNEL_EVENTS.length);
  assert.ok(FUNNEL_EVENTS.includes("quick-card-downloaded"));
  assert.ok(FUNNEL_EVENTS.includes("quick-rundown-downloaded"));
  for (const event of FUNNEL_EVENTS) {
    assert.doesNotMatch(event, /user|email|token|photo|image|answer|questionnaire/i);
  }
});
