import test from "node:test";
import assert from "node:assert/strict";
import { macroPanelHTML } from "./macroPanel.js";
import type { MacroPanelCtx } from "./macroPanel.js";

// No DOM here: these check the four gates before the calculator, which are the
// part that must never be wrong. A calorie figure in front of the wrong person
// is the failure this panel is shaped to prevent.

const NOW = new Date("2026-08-30T00:00:00Z");
const ADULT: MacroPanelCtx = {
  sex: "male",
  dateOfBirth: "1996-04-02",
  maxAccess: true,
  dietAdvice: true,
};

const hasNumbers = (html: string) => /kcal a day/.test(html);

test("a free or Starter account never sees a calorie figure", () => {
  const html = macroPanelHTML({ ...ADULT, maxAccess: false }, NOW);
  assert.equal(hasNumbers(html), false);
  assert.match(html, /Part of Max/);
});

test("a minor never sees a calorie figure, whatever they have paid", () => {
  assert.equal(hasNumbers(macroPanelHTML({ ...ADULT, dateOfBirth: "2012-01-01" }, NOW)), false);
});

test("an unknown date of birth closes the gate rather than opening it", () => {
  // Same direction as adultUser: an age we could not read behaves like an age
  // that is too young.
  for (const dob of [null, "", "nonsense"]) {
    assert.equal(hasNumbers(macroPanelHTML({ ...ADULT, dateOfBirth: dob }, NOW)), false, String(dob));
  }
});

test("the age copy never claims to know an age it does not have", () => {
  // "You are too young" is a claim, and on a missing date of birth it is one we
  // cannot make. The copy says what is true instead.
  const html = macroPanelHTML({ ...ADULT, dateOfBirth: null }, NOW);
  assert.doesNotMatch(html, /too young|under 18|not old enough/i);
  assert.match(html, /adults only/i);
});

test("muting diet advice switches the calculator off, and says which it is", () => {
  const html = macroPanelHTML({ ...ADULT, dietAdvice: false }, NOW);
  assert.equal(hasNumbers(html), false);
  // Distinguishable from the paywall: one is the person's own choice and the
  // other is ours, and a paywall that reads as the user's own setting is the
  // small dishonesty this product is supposed to be the opposite of.
  assert.doesNotMatch(html, /Part of Max/);
  assert.match(html, /asked me to keep food/i);
});

test("muting outranks the paywall, so a Starter account is not upsold what it muted", () => {
  const html = macroPanelHTML({ ...ADULT, dietAdvice: false, maxAccess: false }, NOW);
  assert.doesNotMatch(html, /Part of Max/);
});

test("no gate copy states a calorie number, a weight, or a goal weight", () => {
  for (const ctx of [
    { ...ADULT, maxAccess: false },
    { ...ADULT, dietAdvice: false },
    { ...ADULT, dateOfBirth: null },
  ]) {
    const html = macroPanelHTML(ctx, NOW);
    assert.doesNotMatch(html, /\d{3,4}\s*kcal|goal weight|target weight/i, JSON.stringify(ctx));
  }
});

test("no user-facing copy on this panel uses an em dash", () => {
  for (const ctx of [
    ADULT,
    { ...ADULT, maxAccess: false },
    { ...ADULT, dietAdvice: false },
    { ...ADULT, dateOfBirth: null },
  ]) {
    assert.doesNotMatch(macroPanelHTML(ctx, NOW), /—/, JSON.stringify(ctx));
  }
});
