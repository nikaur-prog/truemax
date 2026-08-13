import test from "node:test";
import assert from "node:assert/strict";
import { onboardingComplete } from "./onboarding.js";
import type { OnboardingProfile } from "./onboarding.js";

// ---------------------------------------------------------------------------
// The gate that decides whether the quiz is compulsory.
//
// Worth its own test because it is the only thing standing between the app and
// an account whose age it does not know — and an unknown age has no safe
// default. Treating it as adult offers a subscription to a thirteen-year-old;
// treating it as a minor withholds one from a paying adult. The answer is to
// not proceed without it.
//
// Note what "complete" does NOT include: buying anything. Somebody who answered
// every question and declined both plans is complete. The questions are
// required; the subscription is not, and if that ever inverts it should invert
// here, loudly, in a test.
// ---------------------------------------------------------------------------

const done: OnboardingProfile = {
  firstName: "Nikau",
  lastName: "Robertson",
  mobile: "",
  dateOfBirth: "2000-04-20",
  discoverySource: "tiktok",
  primaryObjectives: ["jaw"],
  successOutcome: "A routine I stick to.",
  expectations: "Honest numbers.",
  strengths: "",
  supportAreas: "",
  quietTopics: [],
  completedAt: "2026-08-13T00:00:00.000Z",
};

test("a finished profile passes", () => {
  assert.equal(onboardingComplete(done), true);
});

test("a minor who finished the quiz is still complete", () => {
  // Being under 18 restricts which plan may be offered. It is not an unfinished
  // profile, and treating it as one would trap a fifteen-year-old in a loop of
  // a quiz they have already answered.
  assert.equal(onboardingComplete({ ...done, dateOfBirth: "2012-04-20" }), true);
});

test("no name, no age, or no completion stamp all fail", () => {
  assert.equal(onboardingComplete({ ...done, firstName: "" }), false);
  assert.equal(onboardingComplete({ ...done, firstName: "   " }), false);
  assert.equal(onboardingComplete({ ...done, dateOfBirth: "" }), false);
  assert.equal(onboardingComplete({ ...done, completedAt: null }), false);
});

test("a date of birth that is not a date fails", () => {
  // The field is a native date input, so this should be unreachable — but a
  // profile row is data from a table, and rows outlive the form that wrote them.
  for (const bad of ["not-a-date", "0000-00-00", "2000-13-45", "tomorrow"]) {
    assert.equal(onboardingComplete({ ...done, dateOfBirth: bad }), false, bad);
  }
});
