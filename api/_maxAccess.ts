import { ageOnDate } from "../src/engine/age.js";
import { getSupabaseAdmin } from "./_shared.js";

interface ProfileRow {
  date_of_birth: string;
}

interface EntitlementRow {
  tier: string;
  status: string;
}

export type MaxAccessResult =
  | { ok: true; age: number; staff: boolean }
  | { ok: false; status: 402 | 409 | 503; error: string; upgrade?: "max" };

/** One server-side boundary shared by chat generation and stored chat data. */
export async function maxAccessForUser(userId: string): Promise<MaxAccessResult> {
  const admin = getSupabaseAdmin();
  const [profileResult, entitlementResult, staffResult] = await Promise.all([
    admin.from("profiles").select("date_of_birth").eq("user_id", userId).maybeSingle<ProfileRow>(),
    admin.from("entitlements").select("tier,status").eq("user_id", userId).maybeSingle<EntitlementRow>(),
    admin.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle<{ user_id: string }>(),
  ]);
  const accessError = profileResult.error || entitlementResult.error || staffResult.error;
  if (accessError) {
    return { ok: false, status: 503, error: "Max access could not be checked right now." };
  }
  if (!profileResult.data) {
    return { ok: false, status: 409, error: "Finish your pathway questions before chatting to Max." };
  }
  const age = ageOnDate(profileResult.data.date_of_birth);
  if (age === null) {
    return { ok: false, status: 409, error: "Your date of birth needs fixing before Max can help." };
  }
  const staff = Boolean(staffResult.data);
  const entitlement = entitlementResult.data;
  const live = Boolean(entitlement && ["active", "trialing"].includes(entitlement.status));
  if (!staff && !(live && entitlement?.tier === "max")) {
    return { ok: false, status: 402, error: "Max coaching is part of the Max plan.", upgrade: "max" };
  }
  return { ok: true, age, staff };
}
