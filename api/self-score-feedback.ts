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

    // Duplicate detection, the rolling cap and insertion are one database
    // operation under a per-user lock. A burst of concurrent requests cannot
    // all observe nine rows and each insert a tenth.
    const { data: outcome, error } = await admin.rpc("submit_self_score_feedback", {
      p_user_id: user.id,
      p_scan_id: payload.scanId,
      p_our_score: payload.ourScore,
      p_self_score: payload.selfScore,
      p_sex: payload.sex,
      p_consent_version: payload.consentVersion,
      p_app_commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      p_limit: MAX_SUBMISSIONS_PER_24_HOURS,
    });
    if (error) throw new Error(`Self-score submission failed: ${error.message}`);
    if (outcome === "duplicate") return json({ received: true, duplicate: true });
    if (outcome === "rate_limited") return json({ error: "Feedback limit reached for today." }, 429);
    if (outcome !== "inserted") throw new Error("Self-score submission returned an invalid outcome");

    return json({ received: true });
  } catch (error) {
    console.error("self-score-feedback", safeMessage(error));
    return json({ error: "Your score could not be saved. Try again later." }, 503);
  }
}
