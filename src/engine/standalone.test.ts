import assert from "node:assert/strict";
import test from "node:test";
import { isStandaloneLaunch } from "./standalone.js";

test("a standalone launch is read from the media query or the iOS flag, and nothing else", () => {
  assert.equal(isStandaloneLaunch({}), false);
  assert.equal(isStandaloneLaunch({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isStandaloneLaunch({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isStandaloneLaunch({ navigator: { standalone: true } }), true);
  assert.equal(isStandaloneLaunch({ matchMedia: () => { throw new Error("no"); }, navigator: { standalone: false } }), false);
});
