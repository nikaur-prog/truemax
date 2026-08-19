import { createHash } from "node:crypto";
import {
  movedSidePointIds,
  normalizedSidePoints,
  sideFeedbackMetadataIssues,
} from "../src/engine/sideFeedbackPayload.js";
import type { SideFeedbackMetadata } from "../src/engine/sideFeedbackPayload.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

const BUCKET = "side-correction-feedback";
const MAX_BODY_BYTES = 2_500_000;
const MAX_REVOKE_BODY_BYTES = 2_000;
const MAX_PHOTO_BYTES = 2_000_000;
const MAX_METADATA_CHARS = 40_000;
const MAX_SUBMISSIONS_PER_24_HOURS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Listing never returns the photo path, hashes, landmarks, notes or review
// outcome. Those fields are for the private review process, not account UI.
export const SIDE_FEEDBACK_LIST_FIELDS = "id,scan_id,created_at,expires_at,consent_version";

interface ExistingFeedback {
  id: string;
  scan_id: string;
  user_id: string;
  consent_version: string;
}

interface FeedbackSummaryRow {
  id: string;
  scan_id: string;
  created_at: string;
  expires_at: string;
  consent_version: string;
}

export interface FeedbackRevocation {
  submissionId: string;
  scanId: string;
}

export function parseFeedbackRevocation(value: unknown): FeedbackRevocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Revocation details are missing");
  }
  const candidate = value as Partial<FeedbackRevocation>;
  if (!UUID_PATTERN.test(candidate.submissionId || "")) throw new Error("Submission ID is invalid");
  if (!UUID_PATTERN.test(candidate.scanId || "")) throw new Error("Scan ID is invalid");
  return { submissionId: candidate.submissionId!, scanId: candidate.scanId! };
}

export function parseSideFeedbackMetadata(raw: string): SideFeedbackMetadata {
  if (!raw || raw.length > MAX_METADATA_CHARS) throw new Error("Feedback metadata is too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Feedback metadata is not valid JSON");
  }
  const issues = sideFeedbackMetadataIssues(value);
  if (issues.length) throw new Error(issues.join("; "));
  return value as SideFeedbackMetadata;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9;
}

export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isJpeg(bytes)) return null;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      if (length < 7) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin feedback access is not allowed." }, 403);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to view shared feedback." }, 401);

    const { data, error } = await getSupabaseAdmin()
      .from("side_landmark_feedback")
      .select(SIDE_FEEDBACK_LIST_FIELDS)
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`Feedback list failed: ${error.message}`);

    const submissions = ((data || []) as FeedbackSummaryRow[]).map((row) => ({
      submissionId: row.id,
      scanId: row.scan_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consentVersion: row.consent_version,
    }));
    return json({ submissions });
  } catch (error) {
    console.error("side-correction-feedback-list", safeMessage(error));
    return json({ error: "Shared feedback could not be loaded." }, 503);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin feedback access is not allowed." }, 403);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REVOKE_BODY_BYTES) return json({ error: "Revocation request is too large." }, 413);

  let revocation: FeedbackRevocation;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REVOKE_BODY_BYTES) {
      return json({ error: "Revocation request is too large." }, 413);
    }
    revocation = parseFeedbackRevocation(JSON.parse(raw));
  } catch (error) {
    return json({ error: safeMessage(error) }, 400);
  }

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before revoking feedback." }, 401);

    // The database function is security-invoker and service-only. It checks
    // all three IDs, deletes the source row and writes the revocation audit in
    // one transaction, so a stale UI or guessed UUID cannot touch another
    // account's submission.
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("revoke_side_feedback", {
      p_submission_id: revocation.submissionId,
      p_scan_id: revocation.scanId,
      p_user_id: user.id,
    });
    if (error) throw new Error(`Feedback revocation failed: ${error.message}`);

    const storagePath = (data as Array<{ storage_path?: unknown }> | null)?.[0]?.storage_path;
    if (typeof storagePath !== "string" || !storagePath) {
      // Idempotent and non-enumerating: callers learn nothing about whether a
      // UUID exists for a different owner.
      return json({ revoked: true, alreadyRemoved: true });
    }

    let cleanupPending = false;
    const { error: removeError } = await admin.storage.from(BUCKET).remove([storagePath]);
    if (removeError) {
      cleanupPending = true;
      console.error("side-correction-feedback-revoke-storage", safeMessage(removeError));
    } else {
      const { error: queueError } = await admin
        .from("side_feedback_storage_cleanup")
        .delete()
        .eq("storage_path", storagePath);
      if (queueError) {
        cleanupPending = true;
        console.error("side-correction-feedback-revoke-queue", safeMessage(queueError));
      }
    }

    return json({ revoked: true, cleanupPending });
  } catch (error) {
    console.error("side-correction-feedback-revoke", safeMessage(error));
    return json({ error: "Feedback could not be revoked. Try again." }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!requestOrigin(request)) return json({ error: "Cross-origin feedback is not allowed." }, 403);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Feedback upload is too large." }, 413);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in before sharing feedback." }, 401);

    const form = await request.formData();
    const rawMetadata = form.get("metadata");
    const photo = form.get("photo");
    if (typeof rawMetadata !== "string") return json({ error: "Feedback metadata is missing." }, 400);
    if (!(photo instanceof File)) return json({ error: "Side photo is missing." }, 400);
    if (photo.type !== "image/jpeg" || photo.size < 100 || photo.size > MAX_PHOTO_BYTES) {
      return json({ error: "Side photo must be a JPEG under 2 MB." }, 400);
    }

    const metadata = parseSideFeedbackMetadata(rawMetadata);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!isJpeg(bytes)) return json({ error: "Side photo is not a valid JPEG." }, 400);
    const dimensions = jpegDimensions(bytes);
    if (!dimensions
      || dimensions.width !== metadata.width
      || dimensions.height !== metadata.height) {
      return json({ error: "Side photo dimensions do not match its landmark data." }, 400);
    }

    const admin = getSupabaseAdmin();
    const { data: existing, error: existingError } = await admin
      .from("side_landmark_feedback")
      .select("id,scan_id,user_id,consent_version")
      .eq("id", metadata.submissionId)
      .maybeSingle<ExistingFeedback>();
    if (existingError) throw new Error(`Feedback lookup failed: ${existingError.message}`);
    if (existing) {
      if (existing.user_id !== user.id) return json({ error: "Submission ID is already in use." }, 409);
      if (existing.scan_id !== metadata.scanId) return json({ error: "Submission ID is already in use." }, 409);
      const { error: auditError } = await admin.from("side_feedback_consent_events").upsert({
        submission_id: existing.id,
        scan_id: existing.scan_id,
        event_type: "granted",
        consent_version: existing.consent_version,
        details: { source: "idempotent_retry" },
      }, {
        onConflict: "submission_id,event_type",
        ignoreDuplicates: true,
      });
      if (auditError) throw new Error(`Feedback consent audit failed: ${auditError.message}`);
      return json({ received: true, duplicate: true, submissionId: existing.id });
    }

    // Consent does not make an upload endpoint unlimited. A small per-account
    // ceiling is enough for genuine correction retries while preventing a
    // signed-in client from turning the private review bucket into file
    // storage. Duplicate retries above remain idempotent and do not count.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: countError } = await admin
      .from("side_landmark_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (countError) throw new Error(`Feedback rate check failed: ${countError.message}`);
    if ((recentCount ?? 0) >= MAX_SUBMISSIONS_PER_24_HOURS) {
      return json(
        { error: "Feedback limit reached for today. Your analysis can still continue." },
        429,
      );
    }

    const storagePath = `${user.id}/${metadata.submissionId}.jpg`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: "image/jpeg",
      cacheControl: "0",
      upsert: false,
    });
    if (uploadError) throw new Error(`Private photo upload failed: ${uploadError.message}`);

    const movedPointIds = movedSidePointIds(metadata.automaticPoints, metadata.correctedPoints);
    const { error: insertError } = await admin.from("side_landmark_feedback").insert({
      id: metadata.submissionId,
      scan_id: metadata.scanId,
      user_id: user.id,
      storage_path: storagePath,
      image_sha256: createHash("sha256").update(bytes).digest("hex"),
      image_width: metadata.width,
      image_height: metadata.height,
      face_dir: metadata.faceDir,
      seed_method: metadata.seedMethod,
      automatic_points: normalizedSidePoints(
        metadata.automaticPoints,
        metadata.width,
        metadata.height,
      ),
      corrected_points: normalizedSidePoints(
        metadata.correctedPoints,
        metadata.width,
        metadata.height,
      ),
      moved_point_ids: movedPointIds,
      consent_version: metadata.consentVersion,
      app_commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    });
    if (insertError) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      throw new Error(`Feedback metadata insert failed: ${insertError.message}`);
    }

    const { error: auditError } = await admin.from("side_feedback_consent_events").insert({
      submission_id: metadata.submissionId,
      scan_id: metadata.scanId,
      event_type: "granted",
      consent_version: metadata.consentVersion,
      details: { source: "explicit_consent_upload" },
    });
    if (auditError) {
      // Fail closed: a consented upload is not accepted without its grant
      // record. The row delete queues storage cleanup transactionally; the
      // immediate remove keeps the ordinary rollback path prompt.
      const { error: rollbackError } = await admin
        .from("side_landmark_feedback")
        .delete()
        .eq("id", metadata.submissionId)
        .eq("scan_id", metadata.scanId)
        .eq("user_id", user.id);
      const { error: removeError } = await admin.storage.from(BUCKET).remove([storagePath]);
      if (!rollbackError && !removeError) {
        await admin.from("side_feedback_storage_cleanup").delete().eq("storage_path", storagePath);
      }
      throw new Error(`Feedback consent audit failed: ${auditError.message}`);
    }

    return json({ received: true, submissionId: metadata.submissionId });
  } catch (error) {
    console.error("side-correction-feedback", safeMessage(error));
    return json({ error: "Feedback could not be saved. Your analysis can still continue." }, 503);
  }
}
