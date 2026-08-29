import test from "node:test";
import assert from "node:assert/strict";
import { firstUnansweredStep } from "./onboarding.js";
import type { OnboardingProfile } from "./onboarding.js";

// The funnel used to open on step 0 for everybody, which meant a returning
// account was shown its own stored answers and made to press Continue past
// each of the six. These pin the resume point, because the bug it fixes is
// invisible from the code: every step still RENDERS correctly, it is only the
// starting index that was wrong.

const TOTAL = 6;

function profile(over: Partial<OnboardingProfile> = {}): OnboardingProfile {
  return {
    firstName: "",
    lastName: "",
    mobile: "",
    dateOfBirth: "",
    discoverySource: "",
    primaryObjectives: [],
    successOutcome: "",
    expectations: "",
    strengths: "",
    supportAreas: "",
    quietTopics: [],
    completedAt: null,
    ...over,
  };
}

/** Everything the four required steps ask for. */
const ANSWERED: Partial<OnboardingProfile> = {
  firstName: "Sam",
  lastName: "Rivers",
  dateOfBirth: "2000-01-01",
  discoverySource: "tiktok",
  primaryObjectives: ["skin"],
  successOutcome: "Something I can stick to.",
  expectations: "Honest measurements.",
};

test("a first run still starts at the very beginning", () => {
  assert.equal(firstUnansweredStep(profile(), TOTAL), 0);
});

test("an OAuth name on a first run does not skip the name step", () => {
  // emptyOnboardingProfile seeds firstName/lastName from OAuth metadata, so a
  // Google signup reaches the funnel with a name it has never been shown. That
  // validates step 0 without answering it. Resuming past it would make
  // "2 OF 6" the first screen a new account ever sees, and would persist a
  // name the person never confirmed.
  const p = profile({ firstName: "Sam", lastName: "Rivers" });
  assert.equal(firstUnansweredStep(p, TOTAL), 0);
});

test("a stored profile with a gap resumes at the gap", () => {
  const p = profile({
    firstName: "Sam", lastName: "Rivers",
    dateOfBirth: "2000-01-01", discoverySource: "tiktok",
    completedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(firstUnansweredStep(p, TOTAL), 2);
});

test("a fully answered profile lands on the last step, never past the end", () => {
  // Steps 4 and 5 are optional and so always validate. Without the clamp the
  // loop runs off the end and returns 6 — a screen that does not exist, on a
  // dialog with no way back.
  const p = profile({ ...ANSWERED, completedAt: "2026-01-01T00:00:00.000Z" });
  const step = firstUnansweredStep(p, TOTAL);
  assert.equal(step, TOTAL - 1);
  assert.ok(step < TOTAL, `resumed past the last step: ${step}`);
});

test("a half-finished profile resumes at its own gap, not at zero", () => {
  // The case the owner reported: everything from a previous session is on the
  // record except one answer. Starting at 0 replays five answered screens.
  const p = profile({ ...ANSWERED, expectations: "", completedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(firstUnansweredStep(p, TOTAL), 3);
});

test("an unparseable date of birth is treated as unanswered", () => {
  // A stored value that is not a real date must not count as an answer, or
  // somebody resumes past the one step that could fix it.
  const p = profile({ ...ANSWERED, dateOfBirth: "2000-13-45", completedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(firstUnansweredStep(p, TOTAL), 1);
});
