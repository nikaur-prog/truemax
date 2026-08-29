import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// "Do you think we scored you wrong?" submissions. Two numbers per scan, no
// photo, no measurements. Collection only: nothing reads this table to change
// a score — it feeds a manual calibration review, the same shape as the
// side-landmark feedback loop.

const MAX_BODY_BYTES = 2_000;
const MAX_SUBMISSIONS_PER_24_HOURS = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SelfScorePayload {
  scanId: string;
  ourScore: number;
  selfScore: number;
  sex: "male" | "female";
  consentVersion: string;
}

export function parseSelfScorePayload(value: unknown): SelfScorePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Feedback details are missing.");
  }
  const c = value as Partial<SelfScorePayload>;
  if (!UUID_PATTERN.test(c.scanId || "")) throw new Error("Scan ID is invalid.");
  const validScore = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10;
  if (!validScore(c.ourScore)) throw new Error("Measured score is invalid.");
  if (!validScore(c.selfScore)) throw new Error("Self score is invalid.");
  if (c.sex !== "male" && c.sex !== "female") throw new Error("Reference population is invalid.");
  if (typeof c.consentVersion !== "string" || !c.consentVersion || c.consentVersion.length > 64) {
    throw new Error("Consent version is invalid.");
  }
  return {
    scanId: c.scanId!,
    ourScore: Math.round(c.ourScore * 10) / 10,
    selfScore: Math.round(c.selfScore * 10) / 10,
    sex: c.sex,
    consentVersion: c.consentVersion,
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin feedback is not allowed." }, 403);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Feedback request is too large." }, 413);

  let payload: SelfScorePayload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Feedback request is too large." }, 413);
    }
    payload = parseSelfScorePayload(JSON.parse(raw));
  } catch (error) {
    return json({ error: safeMessage(error) }, 400);
  }

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before sending your score." }, 401);

    const admin = getSupabaseAdmin();

    // One opinion per scan is the useful unit; a retry of the same scan is
    // acknowledged, not stored twice. The uniqueness constraint is the
    // authority — this early return just keeps the rate check honest.
    const { data: existing, error: existingError } = await admin
      .from("self_score_feedback")
      .select("id")
      .eq("user_id", user.id)
      .eq("scan_id", payload.scanId)
      .maybeSingle<{ id: string }>();
    if (existingError) throw new Error(`Self-score lookup failed: ${existingError.message}`);
    if (existing) return json({ received: true, duplicate: true });

    // A small ceiling. Ten distinct scans a day is far beyond genuine use of a
    // two-scans-a-week product; anything past it is a client writing garbage.
    //
    // Counted BEFORE the insert and re-counted after it, because a count and
    // an insert are two statements and concurrent requests can both pass the
    // first one. The re-count is what actually holds the line: a row that
    // turns out to be over the ceiling is deleted again, so the cap bounds
    // what is STORED rather than what was checked. Cheaper and clearer than a
    // transaction for a table whose worst case is a few extra rows of two
    // numbers — and unlike the first check alone, it converges.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: countError } = await admin
      .from("self_score_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (countError) throw new Error(`Self-score rate check failed: ${countError.message}`);
    if ((recentCount ?? 0) >= MAX_SUBMISSIONS_PER_24_HOURS) {
      return json({ error: "Feedback limit reached for today." }, 429);
    }

    const { error: insertError } = await admin.from("self_score_feedback").insert({
      user_id: user.id,
      scan_id: payload.scanId,
      our_score: payload.ourScore,
      self_score: payload.selfScore,
      sex: payload.sex,
      consent_version: payload.consentVersion,
      app_commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    });
    if (insertError) {
      // A racing duplicate hits the unique constraint; that is still success
      // from the client's point of view.
      if (insertError.code === "23505") return json({ received: true, duplicate: true });
      throw new Error(`Self-score insert failed: ${insertError.message}`);
    }

    // The other half of the cap. If simultaneous requests both passed the
    // check above, the loser of the re-count takes its own row back out.
    const { count: settled } = await admin
      .from("self_score_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if ((settled ?? 0) > MAX_SUBMISSIONS_PER_24_HOURS) {
      await admin
        .from("self_score_feedback")
        .delete()
        .eq("user_id", user.id)
        .eq("scan_id", payload.scanId);
      return json({ error: "Feedback limit reached for today." }, 429);
    }

    return json({ received: true });
  } catch (error) {
    console.error("self-score-feedback", safeMessage(error));
    return json({ error: "Your score could not be saved. Try again later." }, 503);
  }
}
