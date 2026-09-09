import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { User } from "@supabase/supabase-js";
import { emptyOnboardingProfile } from "../engine/onboarding.js";
import { loadOptionalOnboardingBody, saveOptionalOnboardingBody, type OnboardingBodyServices } from "./onboardingBody.js";

const user = { id: "quiz-owner", user_metadata: {} } as User;
const adult = { ...emptyOnboardingProfile(user), dateOfBirth: "1990-01-01", completedAt: "2026-09-07T00:00:00Z" };
const emptyBody = { heightCm: null, weightKg: null, unit: "metric" as const, required: false, updatedAt: null };
const entry = { unit: "metric" as const, heightCm: 180, weightKg: 80 };
const services = (overrides: Partial<OnboardingBodyServices> = {}): OnboardingBodyServices => ({
  loadProfile: async () => adult,
  token: async () => "owner-bound-test-token",
  fetchBody: async () => emptyBody,
  migrateBody: async () => false,
  saveBody: async () => ({ ok: true, metric: { heightCm: 180, weightKg: 80 } }),
  ...overrides,
});

test("optional details are offered only after the account's saved DOB confirms an adult", async () => {
  assert.deepEqual(await loadOptionalOnboardingBody(user, () => true, services()), emptyBody);
  for (const profile of [
    { ...adult, dateOfBirth: "2015-01-01" },
    { ...adult, dateOfBirth: "" },
    { ...adult, completedAt: null },
  ]) {
    let bodyReads = 0;
    assert.equal(await loadOptionalOnboardingBody(user, () => true, services({
      loadProfile: async () => profile,
      fetchBody: async () => { bodyReads++; return emptyBody; },
    })), null);
    assert.equal(bodyReads, 0);
  }
});

test("existing values and offline or signed-out states skip the optional screen", async () => {
  assert.equal(await loadOptionalOnboardingBody(user, () => true, services({
    fetchBody: async () => ({ ...emptyBody, heightCm: 180, weightKg: 80 }),
  })), null);
  assert.equal(await loadOptionalOnboardingBody(user, () => true, services({ token: async () => null })), null);
  assert.equal(await loadOptionalOnboardingBody(user, () => true, services({ fetchBody: async () => null })), null);
  assert.equal(await loadOptionalOnboardingBody(user, () => true, services({ loadProfile: async () => { throw new Error("offline"); } })), null);
});

test("legacy measurements migrate before the optional screen hydrates an empty server row", async () => {
  let migrated = false;
  const order: string[] = [];
  assert.equal(await loadOptionalOnboardingBody(user, () => true, services({
    migrateBody: async () => { order.push("migrate"); migrated = true; return true; },
    fetchBody: async () => {
      order.push("read");
      return migrated ? { ...emptyBody, heightCm: 180, weightKg: 80 } : emptyBody;
    },
  })), null, "saved legacy details must not be discarded or requested again");
  assert.deepEqual(order, ["migrate", "read"]);
});

test("an account change during migration cannot start a body read for a dismissed quiz", async () => {
  let current = true;
  let reads = 0;
  assert.equal(await loadOptionalOnboardingBody(user, () => current, services({
    migrateBody: async () => { current = false; return false; },
    fetchBody: async () => { reads++; return emptyBody; },
  })), null);
  assert.equal(reads, 0);
});

test("a stale quiz cannot read or save another account's measurements", async () => {
  let current = true;
  let tokenReads = 0;
  let writes = 0;
  const api = services({
    loadProfile: async () => { current = false; return adult; },
    token: async () => { tokenReads++; return "owner-bound-test-token"; },
    saveBody: async () => { writes++; return { ok: true, metric: entry }; },
  });
  assert.equal(await loadOptionalOnboardingBody(user, () => current, api), null);
  assert.equal(tokenReads, 0);
  current = true;
  assert.equal((await saveOptionalOnboardingBody(user, entry, () => current, api)).ok, false);
  assert.equal(tokenReads, 0);
  assert.equal(writes, 0);
});

test("saving checks the server DOB again and uses the existing body profile write", async () => {
  const order: string[] = [];
  const api = services({
    loadProfile: async (value) => { assert.equal(value.id, user.id); order.push("profile"); return adult; },
    token: async (id) => { assert.equal(id, user.id); order.push("token"); return "owner-bound-test-token"; },
    saveBody: async (token, value) => {
      assert.equal(token, "owner-bound-test-token"); assert.deepEqual(value, entry);
      order.push("save"); return { ok: true, metric: entry };
    },
  });
  assert.equal((await saveOptionalOnboardingBody(user, entry, () => true, api)).ok, true);
  assert.deepEqual(order, ["profile", "token", "save"]);
  let writes = 0;
  const blocked = services({
    loadProfile: async () => ({ ...adult, dateOfBirth: "2015-01-01" }),
    saveBody: async () => { writes++; return { ok: true, metric: entry }; },
  });
  assert.equal((await saveOptionalOnboardingBody(user, entry, () => true, blocked)).ok, false);
  assert.equal(writes, 0);
});

test("invalid or incomplete values are never written and imperial uses the shared conversion", async () => {
  let writes = 0;
  const api = services({ saveBody: async () => { writes++; return { ok: true, metric: entry }; } });
  assert.equal((await saveOptionalOnboardingBody(user, { unit: "metric", heightCm: 180 }, () => true, api)).ok, false);
  assert.equal((await saveOptionalOnboardingBody(user, { ...entry, heightCm: 900 }, () => true, api)).ok, false);
  assert.equal(writes, 0);
  assert.equal((await saveOptionalOnboardingBody(user, { unit: "imperial", feet: 5, inches: 10, pounds: 175 }, () => true, api)).ok, true);
  assert.equal(writes, 1);
});

test("quiz body details remain an optional post-save step, not a signup or payment prerequisite", () => {
  const source = readFileSync(new URL("./onboardingFunnel.ts", import.meta.url), "utf8");
  assert.match(source, /result.ok && !preview[\s\S]*?loadOptionalOnboardingBody\(user, alive\)/);
  assert.match(source, /Skip for now/);
  assert.match(source, /saveOptionalOnboardingBody\(user, entry, current\)/);
  assert.match(source, /const current = \(\) => alive\(\) && showing/);
  assert.match(source, /preview\?\.body && profileIsAdult\(profile\)/);
  assert.match(source, /data-trial-body-unit="metric"/);
  assert.match(source, /data-trial-body-unit="imperial"/);
  assert.doesNotMatch(source, /user_metadata.*(?:dateOfBirth|date_of_birth|height|weight)/);
});

test("a stalled optional read times out and cannot start later account work", async () => {
  let resolveProfile!: (value: typeof adult) => void;
  const pending = new Promise<typeof adult>((resolve) => { resolveProfile = resolve; });
  let tokenReads = 0;
  const result = await loadOptionalOnboardingBody(user, () => true, services({
    loadProfile: () => pending,
    token: async () => { tokenReads++; return "owner-bound-test-token"; },
  }), 5);
  assert.equal(result, null);
  resolveProfile(adult);
  await Promise.resolve();
  assert.equal(tokenReads, 0);
});
