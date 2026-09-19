import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_QUALITY_CASES, buildConversationQualityInput } from "./_maxConversationQuality.fixtures.js";
import { reviewConversationReply } from "./_maxConversationQualityEval.js";
import { SAFETY_RULES } from "./_maxPersona.js";

function scenario(id: string) {
  const found = CONVERSATION_QUALITY_CASES.find((entry) => entry.id === id);
  assert.ok(found, `Missing synthetic case: ${id}`);
  return found;
}

test("every quality case builds the production prompt and a bounded, complete conversation input", () => {
  const ids = new Set<string>();
  for (const entry of CONVERSATION_QUALITY_CASES) {
    assert.ok(!ids.has(entry.id), `Duplicate case: ${entry.id}`);
    ids.add(entry.id);
    const input = buildConversationQualityInput(entry);
    assert.ok(input.shared.includes(SAFETY_RULES));
    assert.equal(input.messages[0].role, "user");
    assert.equal(input.messages[input.messages.length - 1]?.role, "user");
    assert.ok(entry.reviewCriteria.length >= 2);
    assert.ok(entry.maxWords <= 180);
    assert.equal(input.scoped.split("</scan_data>").length - 1, 1);
  }
});

test("the fixture builder distinguishes client claims from confirmed server note writes", () => {
  assert.match(buildConversationQualityInput(scenario("unconfirmed_client_save")).scoped, /No server-confirmed account-note update/);
  assert.match(buildConversationQualityInput(scenario("confirmed_note_only")).scoped, /Server-confirmed account-note update for this turn: saved a plan note/);
  assert.match(buildConversationQualityInput(scenario("not_working_report")).scoped, /recorded their report that an item is not working/);
  assert.match(buildConversationQualityInput(scenario("under_18_weight_request")).shared, /This person is under 18/);
});

test("reply review catches mechanical regressions without claiming semantic correctness", () => {
  const reviewed = reviewConversationReply(scenario("follow_up_why"), "Great question, bro!\n**The reference is ideal** — aim for it. Want a plan? What is your goal?");
  assert.equal(reviewed.mechanicalFlags.length, 5);
  assert.equal(reviewed.questions, 2);
  assert.equal(reviewed.humanReviewRequired, true);
  assert.equal(reviewed.reviewCriteria.length, 2);
});

test("scenario signals flag unsupported saves, invented points and missing-angle guesses", () => {
  assert.ok(reviewConversationReply(scenario("ambiguous_add_after_prior_claim"), "I've saved the whole routine.").mechanicalFlags.includes("Claims a save or routine start without confirmation"));
  assert.ok(reviewConversationReply(scenario("recorded_ticks_not_outcomes"), "You earned 30 points.").mechanicalFlags.includes("Invents points"));
  assert.ok(reviewConversationReply(scenario("missing_measurement"), "Your jaw angle is probably 126 degrees.").mechanicalFlags.includes("Guesses a missing angle"));
});

test("clean prose still requires human assessment of the actual reply", () => {
  const reviewed = reviewConversationReply(scenario("missing_measurement"), "The individual jaw angle is not available in this view. Open your scan to check whether that reading is available.");
  assert.deepEqual(reviewed.mechanicalFlags, []);
  assert.equal(reviewed.humanReviewRequired, true);
  assert.ok(reviewed.reviewCriteria.some((criterion) => criterion.includes("without guessing")));
});

test("reply review distinguishes a precise confirmed note acknowledgement from a started routine", () => {
  const saved = reviewConversationReply(scenario("confirmed_note_only"), "Saved evening cleanse as a plan note. That does not start a scheduled routine.");
  assert.deepEqual(saved.mechanicalFlags, []);
  const started = reviewConversationReply(scenario("confirmed_note_only"), "I've activated your routine and awarded 50 points.");
  assert.ok(started.mechanicalFlags.includes("Expands a note save into routine execution"));
});

test("empty and oversized captured replies are surfaced for review", () => {
  assert.deepEqual(reviewConversationReply(scenario("one_step_time_constraint"), " ").mechanicalFlags, ["Empty response"]);
  assert.ok(reviewConversationReply(scenario("one_step_time_constraint"), "word ".repeat(46)).mechanicalFlags.some((flag) => flag.includes("45-word")));
});
