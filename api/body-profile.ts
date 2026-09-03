import { ageOnDate } from "../src/engine/age.js";
import { BODY_BOUNDS, bodyMetricUsable, toMetric } from "../src/engine/bodyUnits.js";
import type { BodyEntry } from "../src/engine/bodyUnits.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// Height and weight, for the account.
//
// GET says what the server holds and whether it is required right now.
// "Required" is computed here from the authoritative facts and nowhere else:
// the date of birth on the profile (immutable after onboarding) and the live
// tier on the entitlements row (a Stripe projection). An adult on Max with
// no values is required; a minor never is, whatever the client says, because
// nothing body-related is ever offered under 18. Free and Starter are never
// required either: the calculator is part of Max, so the ask belongs to Max.
//
// PUT accepts metric or imperial and stores canonical centimetres and
// kilograms, bounded by the same numbers the calculator and the table
// enforce. A request marked as a device migration writes only when the row
// has nothing yet, so a value that lived on one phone cannot overwrite a
// value typed on another. DELETE clears the two values and keeps the row.
//
// Nothing here reaches facial scoring, and a test pins that the scoring
// modules never read these columns.
// ---------------------------------------------------------------------------

interface ProfileRow {
  date_of_birth: string | null;
}
interface EntitlementRow {
  tier: string;
  status: string;
}
interface BodyRow {
  height_cm: number | string | null;
  weight_kg: number | string | null;
  unit_preference: string;
  updated_at: string;
}

export interface BodyRequirementInput {
  age: number | null;
  tier: string | null;
  status: string | null;
  hasBody: boolean;
}

/** The one rule, pure so a test can walk every case. */
export function bodyRequired(input: BodyRequirementInput): boolean {
  if (input.hasBody) return false;
  if (input.age === null || input.age < 18) return false;
  const live = input.status === "active" || input.status === "trialing";
  return input.tier === "max" && live;
}

const num = (v: number | string | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function state(userId: string) {
  const admin = getSupabaseAdmin();
  const [profile, entitlement, body] = await Promise.all([
    admin.from("profiles").select("date_of_birth").eq("user_id", userId).maybeSingle<ProfileRow>(),
    admin.from("entitlements").select("tier,status").eq("user_id", userId).maybeSingle<EntitlementRow>(),
    admin.from("body_profiles").select("height_cm,weight_kg,unit_preference,updated_at").eq("user_id", userId).maybeSingle<BodyRow>(),
  ]);
  if (profile.error) throw new Error(`Profile read failed: ${profile.error.message}`);
  if (entitlement.error) throw new Error(`Entitlement read failed: ${entitlement.error.message}`);
  if (body.error) throw new Error(`Body profile read failed: ${body.error.message}`);
  const heightCm = num(body.data?.height_cm ?? null);
  const weightKg = num(body.data?.weight_kg ?? null);
  const hasBody = heightCm !== null && weightKg !== null;
  const age = profile.data?.date_of_birth ? ageOnDate(profile.data.date_of_birth) : null;
  return {
    heightCm,
    weightKg,
    unit: body.data?.unit_preference === "imperial" ? "imperial" : "metric",
    updatedAt: body.data?.updated_at ?? null,
    required: bodyRequired({ age, tier: entitlement.data?.tier ?? null, status: entitlement.data?.status ?? null, hasBody }),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin profile reads are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    return json(await state(user.id));
  } catch (error) {
    console.error("body-profile get", safeMessage(error));
    return json({ error: "Your details could not be read just then." }, 500);
  }
}

/** The request, strictly: one unit system, numbers only, a known source. */
export function parseBodyRequest(value: unknown): { entry: BodyEntry; source: "signup" | "dialog" | "settings" | "device_migration" } | { error: string } {
  if (!value || typeof value !== "object") return { error: "The request body is not a body profile." };
  const raw = value as Record<string, unknown>;
  const unit = raw.unit === "imperial" ? "imperial" : raw.unit === "metric" ? "metric" : null;
  if (!unit) return { error: "Say whether the figures are metric or imperial." };
  const source = raw.source === "signup" || raw.source === "settings" || raw.source === "device_migration" ? raw.source : "dialog";
  const n = (k: string) => (typeof raw[k] === "number" ? (raw[k] as number) : Number.NaN);
  const entry: BodyEntry = unit === "metric"
    ? { unit, heightCm: n("heightCm"), weightKg: n("weightKg") }
    : { unit, feet: n("feet"), inches: typeof raw.inches === "number" ? (raw.inches as number) : 0, pounds: n("pounds") };
  return { entry, source };
}

export async function PUT(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin profile writes are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const parsed = parseBodyRequest(await request.json().catch(() => null));
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    const metric = toMetric(parsed.entry);
    if (!bodyMetricUsable(metric)) {
      return json({
        error: `Enter a height from ${BODY_BOUNDS.heightCm.min} to ${BODY_BOUNDS.heightCm.max} cm and a weight from ${BODY_BOUNDS.weightKg.min} to ${BODY_BOUNDS.weightKg.max} kg, or the same in feet, inches and pounds.`,
      }, 400);
    }
    const admin = getSupabaseAdmin();
    if (parsed.source === "device_migration") {
      // Once, and only into an empty row: a phone's cache never beats a
      // value the person typed elsewhere.
      const { data: existing, error: readError } = await admin
        .from("body_profiles")
        .select("height_cm,weight_kg")
        .eq("user_id", user.id)
        .maybeSingle<{ height_cm: number | string | null; weight_kg: number | string | null }>();
      if (readError) throw new Error(readError.message);
      if (existing && num(existing.height_cm) !== null && num(existing.weight_kg) !== null) {
        return json(await state(user.id));
      }
    }
    const { error } = await admin.from("body_profiles").upsert(
      { user_id: user.id, height_cm: metric.heightCm, weight_kg: metric.weightKg, unit_preference: parsed.entry.unit, source: parsed.source },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return json(await state(user.id));
  } catch (error) {
    console.error("body-profile put", safeMessage(error));
    return json({ error: "Your details could not be saved just then." }, 500);
  }
}

/** Clear the two values. The row stays so the unit preference survives. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin profile writes are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const { error } = await getSupabaseAdmin()
      .from("body_profiles")
      .update({ height_cm: null, weight_kg: null, source: "settings" })
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return json(await state(user.id));
  } catch (error) {
    console.error("body-profile delete", safeMessage(error));
    return json({ error: "Your details could not be cleared just then." }, 500);
  }
}
