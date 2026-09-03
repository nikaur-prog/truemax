import { GOAL_PREVIEW_CONSENT_VERSION } from "../src/engine/goalPreviewConsent.js";
import { maxAccessForUser } from "./_maxAccess.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The Goal preview consent: granted, read and revoked.
//
// The consent row is service-only for writes, because every change to it
// must leave an entry in the pseudonymous trail and the browser cannot
// write that table. So the dialog's Yes and the Settings revoke both come
// here. The gates match the render route's: origin, signed in, Max tier
// (which yields the age), adult. Revoking deletes every preview the person
// has (the delete trigger queues the objects for the sweep) and records the
// revocation; nothing is kept back.
// ---------------------------------------------------------------------------

const BUCKET = "goal-previews";

async function gate(request: Request): Promise<{ userId: string } | Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin consent is not allowed." }, 403);
  const user = await authenticatedUser(request);
  if (!user) return json({ error: "Sign in first." }, 401);
  const access = await maxAccessForUser(user.id);
  if (!access.ok) return json({ error: access.error, ...(access.upgrade ? { upgrade: access.upgrade } : {}) }, access.status);
  if (access.age < 18) return json({ error: "Goal preview is available from age 18." }, 403);
  return { userId: user.id };
}

/** The current state of the person's consent, for Settings. */
export async function GET(request: Request): Promise<Response> {
  try {
    const gated = await gate(request);
    if (gated instanceof Response) return gated;
    const { data, error } = await getSupabaseAdmin()
      .from("goal_preview_consents")
      .select("consent_version,granted_at,revoked_at")
      .eq("user_id", gated.userId)
      .maybeSingle<{ consent_version: string; granted_at: string; revoked_at: string | null }>();
    if (error) throw new Error(error.message);
    const granted = !!data && data.consent_version === GOAL_PREVIEW_CONSENT_VERSION && !data.revoked_at;
    return json({ granted, version: GOAL_PREVIEW_CONSENT_VERSION, grantedAt: granted ? data!.granted_at : null });
  } catch (error) {
    console.error("goal-preview-consent get", safeMessage(error));
    return json({ error: "Consent could not be read." }, 500);
  }
}

/** Grant. The body carries the version the dialog showed; a stale dialog is refused. */
export async function PUT(request: Request): Promise<Response> {
  try {
    const gated = await gate(request);
    if (gated instanceof Response) return gated;
    const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
    if (!body || body.version !== GOAL_PREVIEW_CONSENT_VERSION) {
      return json({ error: "That consent wording is out of date. Reload and read it again." }, 409);
    }
    const admin = getSupabaseAdmin();
    const { error: upsertError } = await admin
      .from("goal_preview_consents")
      .upsert({ user_id: gated.userId, consent_version: GOAL_PREVIEW_CONSENT_VERSION, granted_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (upsertError) throw new Error(upsertError.message);
    // The trail: subject is a fresh id, never the user id.
    const { error: auditError } = await admin
      .from("goal_preview_consent_events")
      .insert({ subject_id: crypto.randomUUID(), event_type: "granted", consent_version: GOAL_PREVIEW_CONSENT_VERSION, details: {} });
    if (auditError) {
      // Fail closed: a grant without a trail is rolled back.
      await admin.from("goal_preview_consents").delete().eq("user_id", gated.userId);
      throw new Error(auditError.message);
    }
    return json({ granted: true, version: GOAL_PREVIEW_CONSENT_VERSION });
  } catch (error) {
    console.error("goal-preview-consent put", safeMessage(error));
    return json({ error: "Consent could not be recorded." }, 500);
  }
}

/** Revoke: every preview goes, the objects are removed now, the trail records it. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const gated = await gate(request);
    if (gated instanceof Response) return gated;
    const admin = getSupabaseAdmin();
    const { data: rows, error: deleteError } = await admin
      .from("goal_previews")
      .delete()
      .eq("user_id", gated.userId)
      .select("front_path,side_path");
    if (deleteError) throw new Error(deleteError.message);
    const paths = (rows ?? []).flatMap((r) => [(r as { front_path: string | null }).front_path, (r as { side_path: string | null }).side_path]).filter((p): p is string => !!p);
    if (paths.length) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      // A failed removal is not an error for the person: the queue the
      // trigger filled hands the same paths to the daily sweep.
      if (!removeError) await admin.from("goal_preview_storage_cleanup").delete().in("storage_path", paths);
    }
    const { error: revokeError } = await admin
      .from("goal_preview_consents")
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", gated.userId);
    if (revokeError) throw new Error(revokeError.message);
    await admin
      .from("goal_preview_consent_events")
      .insert({ subject_id: crypto.randomUUID(), event_type: "revoked", consent_version: GOAL_PREVIEW_CONSENT_VERSION, details: { previews: paths.length / 2 } })
      .then(({ error: auditError }) => {
        if (auditError) console.error("goal-preview-consent audit", auditError.message);
      });
    return json({ granted: false, deleted: paths.length / 2 });
  } catch (error) {
    console.error("goal-preview-consent delete", safeMessage(error));
    return json({ error: "Consent could not be withdrawn." }, 500);
  }
}
