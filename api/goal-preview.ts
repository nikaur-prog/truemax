import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { GOAL_CATALOGUE_VERSION, RENDER_LAYERS, specAllowed } from "../src/engine/goalCatalogue.js";
import { GOALS } from "../src/engine/goals.js";
import { maxAccessForUser } from "./_maxAccess.js";
import { previewInstructions, previewProvider } from "./_previewProvider.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The Goal preview: the person's own front and side photographs, rendered
// with their chosen goals' presentation applied, front and side.
//
// This is the first product surface that sends a person's own photographs
// off the device for rendering, and the rules are the side pass's rules
// made stricter (docs/FACIAL_MORPH_PLAN.md, section 5):
//
//   - The source photographs are forwarded to the provider in memory and
//     dropped. No bucket, no row, no log line holds them.
//   - What is stored is the rendered output, in a private bucket with no
//     policies and no signed URLs, under a row that expires in thirty days.
//   - Every rendered image carries the caption in its pixels before it
//     leaves this function, so an unlabelled preview cannot exist.
//   - The prompt is built from the catalogue's layers and nothing a person
//     typed; the identity clauses are fixed in api/_previewProvider.ts.
//
// Gates, in the standing order: origin, signed in, Max tier (which also
// yields the age), adult, consent granted and unrevoked, the daily claim
// before the provider is called, released only when the provider produced
// nothing. Adults only and never for a guest's scan: the client does not
// call this for a guest, and the row records the scan id so a guest scan id
// can be audited if it ever appears.
// ---------------------------------------------------------------------------

export const GOAL_PREVIEW_CONSENT_VERSION = "goal-preview-v1";
export const GOAL_PREVIEW_RENDERS_PER_DAY = 3;
export const GOAL_PREVIEW_CAPTION = "A synthetic visual direction based on your selected goals, not a forecast.";

const BUCKET = "goal-previews";
const MAX_PHOTO_BYTES = 2_000_000;
const MAX_BODY_BYTES = 2 * MAX_PHOTO_BYTES + 60_000;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_RESPONSE_JPEG_BYTES = 1_800_000;
// Under the function's 300 second ceiling (vercel.json), so a slow provider
// gets a response and a refund rather than a killed invocation.
const TOTAL_BUDGET_MS = 250_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GoalPreviewSpecInput {
  sourceScanId: string;
  goalIds: string[];
  layers: string[];
  catalogueVersion: string;
  consentVersion: string;
}

/** Strict: ids only, from the catalogue's vocabularies, nothing free-form. */
export function parseSpec(value: unknown): GoalPreviewSpecInput | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sourceScanId !== "string" || !UUID.test(raw.sourceScanId)) return null;
  if (!Array.isArray(raw.goalIds) || raw.goalIds.length > GOALS.length) return null;
  if (!Array.isArray(raw.layers) || raw.layers.length > RENDER_LAYERS.length) return null;
  const goalIds = raw.goalIds.filter((g): g is string => typeof g === "string" && GOALS.some((d) => d.id === g));
  const layers = raw.layers.filter((l): l is string => typeof l === "string" && (RENDER_LAYERS as readonly string[]).includes(l));
  if (goalIds.length !== raw.goalIds.length || layers.length !== raw.layers.length) return null;
  if (raw.catalogueVersion !== GOAL_CATALOGUE_VERSION) return null;
  if (raw.consentVersion !== GOAL_PREVIEW_CONSENT_VERSION) return null;
  return {
    sourceScanId: raw.sourceScanId,
    goalIds: [...new Set(goalIds)],
    layers: [...new Set(layers)],
    catalogueVersion: raw.catalogueVersion,
    consentVersion: raw.consentVersion,
  };
}

function nextUtcMidnight(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

async function prepared(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * The caption, in the pixels, along the bottom edge. Drawn before the image
 * is stored or returned, so no unlabelled preview exists anywhere.
 */
export async function captioned(image: Buffer): Promise<Buffer | null> {
  const meta = await sharp(image, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return null;
  const font = Math.max(14, Math.round(width / 46));
  const band = font * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect x="0" y="${height - band}" width="${width}" height="${band}" fill="rgba(0,0,0,0.6)"/>` +
    `<text x="${Math.round(width / 2)}" y="${height - Math.round(band / 2) + Math.round(font / 3)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${font}" fill="#ffffff">${GOAL_PREVIEW_CAPTION}</text>` +
    `</svg>`;
  for (const quality of [88, 76, 62]) {
    const out = await sharp(image, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= MAX_RESPONSE_JPEG_BYTES) return out;
  }
  return null;
}

function dataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

async function consented(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("goal_preview_consents")
    .select("consent_version,revoked_at")
    .eq("user_id", userId)
    .maybeSingle<{ consent_version: string; revoked_at: string | null }>();
  if (error) throw new Error(`Consent check failed: ${error.message}`);
  return !!data && data.consent_version === GOAL_PREVIEW_CONSENT_VERSION && !data.revoked_at;
}

export async function POST(request: Request): Promise<Response> {
  let claimedUserId: string | null = null;
  let previewId: string | null = null;
  const admin = getSupabaseAdmin();
  const releaseClaim = async () => {
    const userId = claimedUserId;
    claimedUserId = null;
    if (!userId) return;
    const { error } = await admin.rpc("release_goal_preview_render", { p_user_id: userId });
    if (error) throw new Error(error.message);
  };
  const markFailed = async (status: "failed" | "rejected") => {
    if (!previewId) return;
    await admin.from("goal_previews").update({ status }).eq("id", previewId);
  };
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin previews are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to make a Goal preview." }, 401);

    const access = await maxAccessForUser(user.id);
    if (!access.ok) return json({ error: access.error, ...(access.upgrade ? { upgrade: access.upgrade } : {}) }, access.status);
    if (access.age < 18) return json({ error: "Goal preview is available from age 18." }, 403);
    if (!(await consented(user.id))) return json({ error: "Choose Goal preview in Settings first." }, 403);

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json({ error: "Those photos are too large." }, 413);
    const form = await request.formData();
    const front = form.get("front");
    const side = form.get("side");
    for (const photo of [front, side]) {
      if (!(photo instanceof File) || photo.type !== "image/jpeg" || photo.size < 100 || photo.size > MAX_PHOTO_BYTES) {
        return json({ error: "Attach the front and side photos as JPEGs under 2 MB." }, 400);
      }
    }
    const spec = parseSpec(form.get("spec"));
    if (!spec) return json({ error: "The preview recipe is not one the catalogue knows." }, 400);
    const allowed = specAllowed(spec, true);
    if (!allowed.ok) return json({ error: allowed.reason }, 400);

    const provider = previewProvider();
    if (!provider) return json({ error: "Goal preview is not configured on this deployment." }, 503);

    // Claimed before the provider is called, as one statement, so two
    // requests racing cannot both pass the ceiling.
    const { data: remaining, error: claimError } = await admin.rpc("claim_goal_preview_render", {
      p_user_id: user.id,
      p_limit: GOAL_PREVIEW_RENDERS_PER_DAY,
    });
    if (claimError) throw new Error(`Preview allowance is unavailable: ${claimError.message}`);
    if (typeof remaining === "number" && remaining < 0) {
      return json(
        { error: `That is ${GOAL_PREVIEW_RENDERS_PER_DAY} previews today, which is the daily limit. Your plan is still here.`, resetsAt: nextUtcMidnight() },
        429,
      );
    }
    claimedUserId = user.id;

    previewId = randomUUID();
    const { error: insertError } = await admin.from("goal_previews").insert({
      id: previewId,
      user_id: user.id,
      scan_id: spec.sourceScanId,
      spec,
      catalogue_version: spec.catalogueVersion,
      consent_version: spec.consentVersion,
      status: "generating",
      provider: provider.name,
    });
    if (insertError) throw new Error(`Preview row failed: ${insertError.message}`);

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const [frontIn, sideIn] = await Promise.all([
      prepared(Buffer.from(await (front as File).arrayBuffer())),
      prepared(Buffer.from(await (side as File).arrayBuffer())),
    ]);
    const rendered = await provider.render({ front: frontIn, side: sideIn, instructions: previewInstructions(spec.layers), deadline });
    if (!("front" in rendered)) {
      // The provider produced nothing: give the claim back, mark the row, say so.
      await releaseClaim().catch((releaseError) => console.error("goal-preview release", safeMessage(releaseError)));
      await markFailed("failed");
      return json({ error: rendered.error }, rendered.status);
    }
    claimedUserId = null;

    const [frontOut, sideOut] = await Promise.all([captioned(rendered.front), captioned(rendered.side)]);
    if (!frontOut || !sideOut) {
      await markFailed("failed");
      return json({ error: "The preview was too large to deliver safely." }, 502);
    }

    const frontPath = `${user.id}/${previewId}/front.jpg`;
    const sidePath = `${user.id}/${previewId}/side.jpg`;
    const storage = admin.storage.from(BUCKET);
    const [frontUp, sideUp] = await Promise.all([
      storage.upload(frontPath, frontOut, { contentType: "image/jpeg", upsert: false }),
      storage.upload(sidePath, sideOut, { contentType: "image/jpeg", upsert: false }),
    ]);
    if (frontUp.error || sideUp.error) {
      await storage.remove([frontPath, sidePath]).catch(() => undefined);
      await markFailed("failed");
      throw new Error(`Preview storage failed: ${frontUp.error?.message ?? sideUp.error?.message}`);
    }

    const { error: readyError } = await admin
      .from("goal_previews")
      .update({ status: "ready", front_path: frontPath, side_path: sidePath, provider_job_ref: rendered.providerRef })
      .eq("id", previewId);
    if (readyError) throw new Error(`Preview row update failed: ${readyError.message}`);
    await admin
      .from("goal_preview_consent_events")
      .insert({ subject_id: previewId, event_type: "rendered", consent_version: GOAL_PREVIEW_CONSENT_VERSION, details: { provider: provider.name, goals: spec.goalIds.length } })
      .then(({ error }) => {
        if (error) console.error("goal-preview audit", error.message);
      });

    return json({
      id: previewId,
      front: dataUrl(frontOut),
      side: dataUrl(sideOut),
      caption: GOAL_PREVIEW_CAPTION,
      catalogueVersion: spec.catalogueVersion,
      remaining: typeof remaining === "number" ? remaining : null,
    });
  } catch (error) {
    console.error("goal-preview", safeMessage(error));
    await releaseClaim().catch((releaseError) => console.error("goal-preview release", safeMessage(releaseError)));
    await markFailed("failed").catch(() => undefined);
    return json({ error: "The preview could not be made just then." }, 500);
  }
}

function previewIdFrom(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return UUID.test(id) ? id : null;
}

/** A stored preview, inline, for its owner. */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin previews are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to see your Goal preview." }, 401);
    const id = previewIdFrom(request);
    if (!id) return json({ error: "Not found." }, 404);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("goal_previews")
      .select("id,status,front_path,side_path,expires_at,kept_until,validation,spec")
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; status: string; front_path: string | null; side_path: string | null; expires_at: string; kept_until: string | null; validation: unknown; spec: unknown }>();
    if (error) throw new Error(error.message);
    if (!data || data.status !== "ready" || !data.front_path || !data.side_path) return json({ error: "Not found." }, 404);
    const storage = admin.storage.from(BUCKET);
    const [front, side] = await Promise.all([storage.download(data.front_path), storage.download(data.side_path)]);
    if (front.error || side.error || !front.data || !side.data) return json({ error: "Not found." }, 404);
    return json({
      id: data.id,
      front: dataUrl(Buffer.from(await front.data.arrayBuffer())),
      side: dataUrl(Buffer.from(await side.data.arrayBuffer())),
      caption: GOAL_PREVIEW_CAPTION,
      expiresAt: data.kept_until ?? data.expires_at,
      validation: data.validation ?? null,
      spec: data.spec,
    });
  } catch (error) {
    console.error("goal-preview get", safeMessage(error));
    return json({ error: "The preview could not be loaded." }, 500);
  }
}

/**
 * The client's re-measurement verdict, or a keep, on one preview. A verdict
 * that failed marks the row rejected so the regeneration limit still counts
 * it and the image is never listed as ready again.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin previews are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const id = previewIdFrom(request);
    if (!id) return json({ error: "Not found." }, 404);
    const body = (await request.json().catch(() => null)) as { validation?: unknown; keep?: unknown } | null;
    if (!body || typeof body !== "object") return json({ error: "Nothing to update." }, 400);
    const patch: Record<string, unknown> = {};
    if (body.validation && typeof body.validation === "object") {
      const v = body.validation as { passed?: unknown };
      patch.validation = body.validation;
      if (v.passed === false) patch.status = "rejected";
    }
    if (body.keep === true) patch.kept_until = new Date(Date.now() + 365 * 86_400_000).toISOString();
    if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);
    const { data, error } = await getSupabaseAdmin()
      .from("goal_previews")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    if (!data) return json({ error: "Not found." }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error("goal-preview patch", safeMessage(error));
    return json({ error: "The preview could not be updated." }, 500);
  }
}

/** Revoke one preview: the row goes, the trigger queues the objects, and they are removed now rather than at the next sweep. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin previews are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in first." }, 401);
    const id = previewIdFrom(request);
    if (!id) return json({ error: "Not found." }, 404);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("goal_previews")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("front_path,side_path")
      .maybeSingle<{ front_path: string | null; side_path: string | null }>();
    if (error) throw new Error(error.message);
    if (!data) return json({ error: "Not found." }, 404);
    const paths = [data.front_path, data.side_path].filter((p): p is string => !!p);
    if (paths.length) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      // A failed removal is not an error for the person: the queue the
      // trigger filled hands the same paths to the daily sweep.
      if (!removeError) await admin.from("goal_preview_storage_cleanup").delete().in("storage_path", paths);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("goal-preview delete", safeMessage(error));
    return json({ error: "The preview could not be deleted." }, 500);
  }
}
