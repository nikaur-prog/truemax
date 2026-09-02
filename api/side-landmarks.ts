import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./_anthropicKey.js";
import {
  LANDMARK_PASSES_PER_DAY,
  MAX_LANDMARK_IMAGE_BYTES,
  landmarksToPixels,
  placeSideLandmarks,
  prepareLandmarkImage,
} from "./_sideLandmarks.js";
import type { LandmarkMediaType } from "./_sideLandmarks.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// POST /api/side-landmarks
//
// The side photograph in, thirteen points out. This is the only place in the
// product where a photograph leaves the device before the person has answered
// a consent question, which is why the client must ask before calling it (see
// docs/SIDE_LANDMARKS_AI_FIRST.md) and why this handler does exactly one thing
// with the bytes: uprights and resizes them in memory, forwards them to the
// model (the whole frame, then an enlarged ear crop and chin crop) and drops
// them. No bucket, no row, no log line with image data. The feedback record
// that keeps a photograph is a different endpoint behind its own consent.
//
// Gates, in order, for the same reasons as api/max-chat.ts:
//
//   1. origin      no cross-site use of somebody else's session
//   2. signed in   a signed-out capture falls back to the on-device seeder
//   3. rate limit  claimed before the model call, released if the call fails
//
// No tier gate. The owner's decision is that the first pass runs on every side
// scan, free scans included, because the point of it is that the product is
// right the first time. The daily ceiling is what keeps that from becoming an
// image API for the world.
//
// Request: multipart form with `photo` (JPEG, PNG or WebP, at most 2 MB) and
// optional `width` and `height` of the frame the client draws in, so the
// response can carry pixels as well as fractions.
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = MAX_LANDMARK_IMAGE_BYTES + 20_000;
const MEDIA_TYPES = new Set<LandmarkMediaType>(["image/jpeg", "image/png", "image/webp"]);

function nextUtcMidnight(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

function client(): Anthropic {
  return new Anthropic({ apiKey: anthropicKey() });
}

function frameSize(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 20_000 ? n : null;
}

export async function POST(request: Request): Promise<Response> {
  let claimedUserId: string | null = null;
  const releaseClaim = async () => {
    const userId = claimedUserId;
    claimedUserId = null;
    if (!userId) return;
    const { error } = await getSupabaseAdmin().rpc("release_side_landmark_pass", { p_user_id: userId });
    if (error) throw new Error(error.message);
  };
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin placement is not allowed." }, 403);

    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to place the points with the cloud pass." }, 401);

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json({ error: "That photo is too large." }, 413);

    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) return json({ error: "Attach the side photo as `photo`." }, 400);
    if (!MEDIA_TYPES.has(photo.type as LandmarkMediaType) || photo.size < 100 || photo.size > MAX_LANDMARK_IMAGE_BYTES) {
      return json({ error: "The side photo must be a JPEG, PNG or WebP under 2 MB." }, 400);
    }
    const width = frameSize(form.get("width"));
    const height = frameSize(form.get("height"));

    // Claimed before the model is called, as one statement, so two requests
    // racing cannot both pass the ceiling (same shape as the chat allowance).
    const admin = getSupabaseAdmin();
    const { data: remaining, error: claimError } = await admin.rpc("claim_side_landmark_pass", {
      p_user_id: user.id,
      p_limit: LANDMARK_PASSES_PER_DAY,
    });
    if (claimError) throw new Error(`Placement allowance is unavailable: ${claimError.message}`);
    if (typeof remaining === "number" && remaining < 0) {
      return json(
        {
          error: `That is ${LANDMARK_PASSES_PER_DAY} cloud placements today, which is the daily limit. You can still place the points yourself.`,
          resetsAt: nextUtcMidnight(),
        },
        429,
      );
    }
    claimedUserId = user.id;

    let pass;
    try {
      const prepared = await prepareLandmarkImage(Buffer.from(await photo.arrayBuffer()));
      pass = await placeSideLandmarks(client(), prepared, {
        onZoomError: (cluster, error) => console.error(`side-landmarks zoom ${cluster}`, safeMessage(error)),
      });
    } catch (error) {
      // A pass that produced nothing costs nothing: give the claim back, and
      // tell the client plainly so it falls through to the seeder.
      await releaseClaim().catch((releaseError) => {
        console.error("side-landmarks release", safeMessage(releaseError));
      });
      console.error("side-landmarks model", safeMessage(error));
      return json({ error: "The points could not be placed just then. Placing them on the device instead." }, 502);
    }
    claimedUserId = null;

    return json({
      points: pass.result.points,
      pixels: width && height ? landmarksToPixels(pass.result, width, height) : undefined,
      confidence: pass.result.confidence,
      faceDir: pass.result.faceDir,
      model: pass.model,
      version: pass.version,
      zoomed: pass.zoomed,
      remaining: typeof remaining === "number" ? remaining : null,
    });
  } catch (error) {
    console.error("side-landmarks", safeMessage(error));
    await releaseClaim().catch((releaseError) => {
      console.error("side-landmarks release", safeMessage(releaseError));
    });
    return json({ error: "The points could not be placed just then." }, 500);
  }
}
