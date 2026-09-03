import assert from "node:assert/strict";
import test from "node:test";
import {
  beginIntentionalNavigation,
  cancelIntentionalNavigation,
  isIntentionalNavigation,
  resetIntentionalNavigationForTests,
} from "./navigationIntent.js";

test("intentional navigation bypass is explicit and reversible", () => {
  resetIntentionalNavigationForTests();
  assert.equal(isIntentionalNavigation(), false);
  beginIntentionalNavigation();
  assert.equal(isIntentionalNavigation(), true);
  cancelIntentionalNavigation();
  assert.equal(isIntentionalNavigation(), false);
});
