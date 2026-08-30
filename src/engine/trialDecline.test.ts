import test from "node:test";
import assert from "node:assert/strict";
import {
  clearDeclinedCache,
  declinedNow,
  nextDeclinedCache,
  setDeclinedCache,
} from "./trialDecline.js";
import { activateScanOwner } from "./scanScope.js";

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

// ---------------------------------------------------------------------------
// The device mirror, which is what makes a cold start safe.
//
// In memory alone the cache defaults to false and resets to false on every
// identity change, so a declined account only had to reload the page and fail
// one profile read to come back un-declined. Flight mode and a refresh.
// ---------------------------------------------------------------------------

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });

const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

test("a confirmed decline survives a reload with no successful read", () => {
  local.clear();
  activateScanOwner(ALICE);
  setDeclinedCache(true);

  // The reload: page state is gone, only the device remains.
  clearDeclinedCache();
  activateScanOwner(ALICE);
  assert.equal(declinedNow(), true);
});

test("a confirmed non-decline clears the stamp, so a reversal in the database sticks", () => {
  local.clear();
  activateScanOwner(ALICE);
  setDeclinedCache(true);
  setDeclinedCache(false);

  clearDeclinedCache();
  activateScanOwner(ALICE);
  assert.equal(declinedNow(), false);
});

test("one account's stamp never answers for another", () => {
  local.clear();
  activateScanOwner(ALICE);
  setDeclinedCache(true);

  // An identity change forgets rather than asserting, so Bob's own stamp is
  // what gets read, and Bob has none.
  clearDeclinedCache();
  activateScanOwner(BOB);
  assert.equal(declinedNow(), false);

  // And Alice's is still hers when she comes back.
  clearDeclinedCache();
  activateScanOwner(ALICE);
  assert.equal(declinedNow(), true);
});

test("clearing forgets without erasing the device stamp", () => {
  // The distinction the identity-change path depends on: setDeclinedCache(false)
  // is a claim, and it would wipe the incoming account's record before that
  // account's entitlement had ever been read.
  local.clear();
  activateScanOwner(ALICE);
  setDeclinedCache(true);
  clearDeclinedCache();
  assert.equal(declinedNow(), true);
});

test("a signed-out visitor has not declined, and the owner's stamp survives it", () => {
  // Signing out moves to an anonymous scope, which has a key of its own and
  // legitimately holds no stamp. What must not happen is that answer becoming
  // the account's answer when they sign back in.
  //
  // The genuinely unreadable case, where the identity has not resolved at all
  // and scopedStorageKey returns null, exists only before the first
  // activateScanOwner call at page load and cannot be re-entered through the
  // public API. declinedNow answers false there without memoising it, so the
  // next call once the identity lands reads the real stamp; that branch is
  // covered by inspection rather than by this test.
  local.clear();
  activateScanOwner(ALICE);
  setDeclinedCache(true);

  clearDeclinedCache();
  activateScanOwner(null);
  assert.equal(declinedNow(), false, "an anonymous scope carries no decline");

  clearDeclinedCache();
  activateScanOwner(ALICE);
  assert.equal(declinedNow(), true, "and the account's own stamp is still there");
});
