import assert from "node:assert/strict";
import test from "node:test";
import { isQuickOwner, normalizedQuickGrants } from "./_quickAccess.js";

test("owner is an explicit app_admins note, not every staff account", () => {
  assert.equal(isQuickOwner("owner"), true);
  assert.equal(isQuickOwner(" OWNER "), true);
  assert.equal(isQuickOwner("founder"), false);
  assert.equal(isQuickOwner("admin"), false);
  assert.equal(isQuickOwner(null), false);
});

test("staff receive all creator grants without becoming owner", () => {
  assert.deepEqual(normalizedQuickGrants(null, true), {
    cta: true,
    clips: true,
    polisher: true,
    studio: true,
  });
});

test("creator grants are strict booleans and ignore unknown fields", () => {
  assert.deepEqual(normalizedQuickGrants({ cta: true, clips: 1, studio: false, other: true }, false), {
    cta: true,
    clips: false,
    polisher: false,
    studio: false,
  });
});
