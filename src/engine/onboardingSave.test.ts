import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { emptyOnboardingProfile, onOnboardingProfileSaved, saveOnboardingProfile } from "./onboarding.js";

const user = { id: "profile-owner-a", user_metadata: {} } as User;
const profile = () => ({
  ...emptyOnboardingProfile(user), firstName: " First ", lastName: " Person ",
  dateOfBirth: "2012-03-04", discoverySource: "friend" as const,
});

test("a delayed profile save never mirrors one account's names into a newly active Auth account", async () => {
  let resolveSave!: (value: { error: null }) => void;
  const saved = new Promise<{ error: null }>((resolve) => { resolveSave = resolve; });
  let activeUser = user.id;
  const authWrites: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const fakeClient = {
    from(table: string) {
      assert.equal(table, "profiles");
      return { upsert(row: Record<string, unknown>, options: { onConflict: string }) {
        assert.equal(options.onConflict, "user_id"); rows.push(row); return saved;
      } };
    },
    auth: { async updateUser() { authWrites.push(activeUser); return { error: null }; } },
  } as unknown as SupabaseClient;
  const entry = profile();
  const pending = saveOnboardingProfile(user, entry, 1, async () => fakeClient);
  await Promise.resolve();
  activeUser = "profile-owner-b";
  resolveSave({ error: null });
  assert.deepEqual(await pending, { ok: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, user.id);
  assert.equal(rows[0].first_name, "First");
  assert.equal(rows[0].last_name, "Person");
  assert.equal(rows[0].date_of_birth, "2012-03-04", "minor age data is unchanged");
  assert.equal(rows[0].consent_version, "onboarding-v1");
  assert.ok(entry.completedAt);
  assert.deepEqual(authWrites, [], "no unbound second Auth write, even after a successful profile save");
});

test("a failed canonical save stays failed and never stamps completion or writes Auth metadata", async () => {
  let authWrites = 0;
  const fakeClient = {
    from: () => ({ upsert: async () => ({ error: { message: "Profile save denied" } }) }),
    auth: { updateUser: async () => { authWrites++; return { error: null }; } },
  } as unknown as SupabaseClient;
  const entry = profile();
  assert.deepEqual(await saveOnboardingProfile(user, entry, 1, async () => fakeClient), { ok: false, message: "Profile save denied" });
  assert.equal(entry.completedAt, null);
  assert.equal(authWrites, 0);
});

test("successful canonical saves notify their owner, failed saves do not, and view failures never retry a saved row", async () => {
  let writes = 0;
  let denied = false;
  const owners: string[] = [];
  const fakeClient = {
    from: () => ({ upsert: async () => {
      writes++;
      return { error: denied ? { message: "Save denied" } : null };
    } }),
  } as unknown as SupabaseClient;
  const unsubscribe = onOnboardingProfileSaved((savedUser) => { owners.push(savedUser.id); });
  const unsubscribeFailedView = onOnboardingProfileSaved(async () => { throw new Error("View already closed"); });
  try {
    assert.deepEqual(await saveOnboardingProfile(user, profile(), 1, async () => fakeClient), { ok: true });
    assert.deepEqual(owners, [user.id]);
    assert.equal(writes, 1);
    denied = true;
    assert.equal((await saveOnboardingProfile(user, profile(), 1, async () => fakeClient)).ok, false);
    assert.deepEqual(owners, [user.id]);
    unsubscribe();
    denied = false;
    await saveOnboardingProfile(user, profile(), 1, async () => fakeClient);
    assert.deepEqual(owners, [user.id]);
  } finally {
    unsubscribe();
    unsubscribeFailedView();
  }
});
