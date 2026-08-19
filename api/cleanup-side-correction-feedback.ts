import { getSupabaseAdmin, json, safeMessage } from "./_shared.js";

const BUCKET = "side-correction-feedback";

interface ExpiredFeedback {
  id: string;
  storage_path: string;
}

interface QueuedStorage {
  storage_path: string;
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  try {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const [
      { data: expired, error: expiredError },
      { data: queued, error: queuedError },
      { count: auditsPurged, error: auditPurgeError },
    ] =
      await Promise.all([
        admin
          .from("side_landmark_feedback")
          .select("id,storage_path")
          .lte("expires_at", now)
          .order("expires_at", { ascending: true })
          .limit(100),
        admin
          .from("side_feedback_storage_cleanup")
          .select("storage_path")
          .order("queued_at", { ascending: true })
          .limit(100),
        admin
          .from("side_feedback_consent_events")
          .delete({ count: "exact" })
          .lte("retain_until", now),
      ]);
    if (expiredError) throw new Error(`Expired feedback lookup failed: ${expiredError.message}`);
    if (queuedError) throw new Error(`Storage cleanup lookup failed: ${queuedError.message}`);
    if (auditPurgeError) throw new Error(`Consent audit cleanup failed: ${auditPurgeError.message}`);

    const expiredRows = (expired || []) as ExpiredFeedback[];
    const queuedRows = (queued || []) as QueuedStorage[];
    const paths = [...new Set([
      ...expiredRows.map((row) => row.storage_path),
      ...queuedRows.map((row) => row.storage_path),
    ])];
    if (!paths.length) return json({ removed: 0, auditsPurged: auditsPurged ?? 0 });

    const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
    if (removeError) throw new Error(`Private photo deletion failed: ${removeError.message}`);

    if (expiredRows.length) {
      const { error } = await admin
        .from("side_landmark_feedback")
        .delete()
        .in("id", expiredRows.map((row) => row.id));
      if (error) throw new Error(`Expired feedback deletion failed: ${error.message}`);
    }
    const { error: queueDeleteError } = await admin
      .from("side_feedback_storage_cleanup")
      .delete()
      .in("storage_path", paths);
    if (queueDeleteError) throw new Error(`Cleanup queue deletion failed: ${queueDeleteError.message}`);

    return json({ removed: paths.length, auditsPurged: auditsPurged ?? 0 });
  } catch (error) {
    console.error("cleanup-side-correction-feedback", safeMessage(error));
    return json({ error: "Feedback cleanup failed." }, 500);
  }
}
