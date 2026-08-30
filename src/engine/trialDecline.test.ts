import test from "node:test";
import assert from "node:assert/strict";
import { nextDeclinedCache } from "./trialDecline.js";

// The load-bearing one. A declined account whose profile read fails must not
// come back as a clean account: that is the sheet's consequence undone by a
// dropped request, and it was reachable by flight mode alone.
test("a failed read never clears a decline that was already known", () => {
  assert.equal(nextDeclinedCache("free", undefined, true), true);
});

test("a failed read on an account not known to have declined stays lenient", () => {
  // Cold start with nothing ever read. Refusing somebody their own face on a
  // fact never once read is the worse of the two mistakes.
  assert.equal(nextDeclinedCache("free", undefined, false), false);
});

test("a successful read with no stamp clears a stale cached decline", () => {
  // The direction that matters for a decline reversed by hand in the database:
  // a real answer always outranks the cache.
  assert.equal(nextDeclinedCache("free", null, true), false);
});

test("a stamp declines the account", () => {
  assert.equal(nextDeclinedCache("free", "2026-08-01T00:00:00Z", false), true);
});

test("a live subscription un-declines, stamp or no stamp", () => {
  assert.equal(nextDeclinedCache("starter", "2026-08-01T00:00:00Z", true), false);
  assert.equal(nextDeclinedCache("max", "2026-08-01T00:00:00Z", true), false);
});

test("a live subscription un-declines even when the stamp could not be read", () => {
  // The paid branch must not consult `declined` at all, or a paying customer
  // with one unreachable column keeps a decline they already bought out of.
  assert.equal(nextDeclinedCache("starter", undefined, true), false);
});
