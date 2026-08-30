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
