import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./auth.js";

// ---------------------------------------------------------------------------
// Whether this account turned the trial down, and when.
//
// Deliberately its own module rather than a field on OnboardingProfile. That
// profile is written by a single upsert that names every column, so folding
// the decline into it would mean every later profile save carries a copy of
// the flag — and the first save that carried a stale copy would silently
// un-decline the account. A consequence needs a write path of its own.
//
// The write is an RPC, not an update. The own-profile UPDATE policy lets an
// account write any column of its own row, so a client-side write would also
// be a client-side CLEAR: anyone who declined could undo it from the console
// and the sheet's promise would be decoration. The column is revoked from the
// browser roles and record_trial_decline is the only thing that sets it.
// ---------------------------------------------------------------------------

/**
 * The decline stamp, or null if this account has not declined.
 *
 * Throws on a failed read rather than returning null, because the two mean
 * opposite things: null is "may still scan themselves", and a network failure
 * must not be read as permission. Callers decide the safe direction; here that
 * is loadTrialDeclined's contract, not its guess.
 */
export async function loadTrialDeclined(user: User): Promise<string | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .select("trial_declined_at")
    .eq("user_id", user.id)
    .maybeSingle<{ trial_declined_at: string | null }>();
  if (error) throw new Error(error.message);
  return data?.trial_declined_at ?? null;
}

/**
 * Record the decline. Idempotent: the first one wins.
 *
 * Returns the stamp that is now on the account, which is the ORIGINAL date for
 * an account that had already declined — pressing the button twice records
 * when somebody chose, not when they last pressed something.
 */
export async function recordTrialDecline(): Promise<string | null> {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("record_trial_decline");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// The cached answer, for the surfaces that need it without a round trip.
//
// The subject chooser runs on a path with no network read of its own, so it
// cannot await the profile. This holds the last known answer instead.
//
// Defaults to FALSE and is reset on every identity change, which is the
// opposite direction from the tier cache beside it and deliberately so: an
// unread tier must not hand out an allowance nobody paid for, while an unread
// decline must not refuse somebody their own face on a network hiccup.
// ---------------------------------------------------------------------------

let cached = false;

export function declinedNow(): boolean {
  return cached;
}

/** Set from the entitlement read, from a confirmed decline, and on sign-out. */
export function setDeclinedCache(value: boolean): void {
  cached = value;
}
