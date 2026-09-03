import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";

// The retention sweep for Goal previews, run daily by the Vercel cron (see
// vercel.json). Same shape as api/cleanup-side-correction-feedback.ts:
// expired rows are deleted (the BEFORE DELETE trigger queues their objects),
// the queue is drained from the private bucket, and consent events past
// their retention are purged. Batches of a hundred; the next day catches
// whatever a day of a hundred does not.

const BUCKET = "goal-previews";

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized." }, 401);
  }
  try {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data: expired, error: expiredError } = await admin
      .from("goal_previews")
      .select("id")
      .lte("expires_at", now)
      .is("kept_until", null)
      .order("expires_at", { ascending: true })
      .limit(100);
    if (expiredError) throw new Error(`Expired preview lookup failed: ${expiredError.message}`);
    const { data: kept, error: keptError } = await admin
      .from("goal_previews")
      .select("id")
      .lte("kept_until", now)
      .limit(100);
    if (keptError) throw new Error(`Kept preview lookup failed: ${keptError.message}`);
    const ids = [...(expired ?? []), ...(kept ?? [])].map((r) => (r as { id: string }).id);
    // A render killed at the function ceiling never reaches its own catch:
    // the row stays 'generating' with the claim spent. Fifteen minutes is
    // three times the render budget, so nothing still running is caught.
    const stale = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count: staleCount, error: staleError } = await admin
      .from("goal_previews")
      .update({ status: "failed" }, { count: "exact" })
      .eq("status", "generating")
      .lte("created_at", stale);
    if (staleError) throw new Error(`Stale preview sweep failed: ${staleError.message}`);
    if (ids.length) {
      const { error: deleteError } = await admin.from("goal_previews").delete().in("id", ids);
      if (deleteError) throw new Error(`Expired preview deletion failed: ${deleteError.message}`);
    }

    const { data: queued, error: queuedError } = await admin
      .from("goal_preview_storage_cleanup")
      .select("storage_path")
      .order("queued_at", { ascending: true })
      .limit(200);
    if (queuedError) throw new Error(`Storage cleanup lookup failed: ${queuedError.message}`);
    const paths = (queued ?? []).map((r) => (r as { storage_path: string }).storage_path);
    let removed = 0;
    if (paths.length) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      if (removeError) throw new Error(`Private preview deletion failed: ${removeError.message}`);
      const { error: dequeueError } = await admin.from("goal_preview_storage_cleanup").delete().in("storage_path", paths);
      if (dequeueError) throw new Error(`Storage cleanup dequeue failed: ${dequeueError.message}`);
      removed = paths.length;
    }

    const { count: auditsPurged, error: auditError } = await admin
      .from("goal_preview_consent_events")
      .delete({ count: "exact" })
      .lte("retain_until", now);
    if (auditError) throw new Error(`Consent audit cleanup failed: ${auditError.message}`);

    return json({ expired: ids.length, removed, stale: staleCount ?? 0, auditsPurged: auditsPurged ?? 0 });
  } catch (error) {
    console.error("cleanup-goal-previews", safeMessage(error));
    return json({ error: "Cleanup failed." }, 500);
  }
}
