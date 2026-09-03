import { randomUUID } from "node:crypto";
import { GOAL_CATALOGUE_VERSION, RENDER_LAYERS, specAllowed } from "../src/engine/goalCatalogue.js";
import type { RenderLayer } from "../src/engine/goalCatalogue.js";
import { GOAL_PREVIEW_CAPTION, GOAL_PREVIEW_CONSENT_VERSION } from "../src/engine/goalPreviewConsent.js";
import { GOALS } from "../src/engine/goals.js";
import type { MorphBlueprint, MorphEffectId } from "../src/engine/morphPlan.js";
import { isScanId } from "../src/engine/scanSession.js";
import { maxAccessForUser } from "./_maxAccess.js";
import { previewInstructions, previewProvider } from "./_previewProvider.js";
import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";
import {
  GOAL_PREVIEW_BUCKET,
  GOAL_PREVIEW_RENDERS_PER_DAY,
  captioned,
  consented,
  dataUrl,
  nextUtcMidnight,
  prepared,
} from "./goal-preview.js";

// ---------------------------------------------------------------------------
// The Goal preview in the wire shape the client speaks.
//
// docs/MORPH_PREVIEW_CONTRACT.md is the front end's contract: a JSON body
// with the two photographs as data URLs and the measured blueprint, a job
// id back, and a `ready` state the browser displays only when five gates
// are true. This route is that contract over the same machinery as
// api/goal-preview.ts: the same gates in the same order, the same provider
// interface, the same private storage, the same caption in the pixels.
//
// One thing this route will not do is assert a gate it cannot check. The
// server can stand behind three of the five: the provider did not refuse
// (moderationPassed), the instruction set came from the catalogue's layers
// and nothing typed (naturalOnly), and both views were rendered from one
// instruction set in one job (crossViewConsistent). Identity preservation
// and target alignment are pixel questions for the landmarker and the
// metrics, and those run on the device, not here. So the response carries
// them as false with `pending` naming them, the browser withholds the
// image as the contract says, and the on-device validator's verdict comes
// back through PATCH /api/goal-preview?id=<jobId>, after which GET returns
// the job with all five gates true. Section 5d of docs/FACIAL_MORPH_PLAN.md.
// ---------------------------------------------------------------------------

const MAX_IMAGE_CHARS = 3_000_000;
const MAX_BODY_BYTES = 2 * MAX_IMAGE_CHARS + 200_000;
const TOTAL_BUDGET_MS = 250_000;
const DATA_URL = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const SERVER_GATES = ["moderationPassed", "naturalOnly", "crossViewConsistent"] as const;
const CLIENT_GATES = ["identityPreserved", "targetAligned"] as const;

/** The effects a blueprint may carry, and the presentation layer each is allowed to touch. */
export const EFFECT_LAYERS: Record<MorphEffectId, RenderLayer> = {
  facialFullness: "leanerPresentation",
  underEyePuffiness: "skinSurface",
  jawDefinition: "leanerPresentation",
  underChinFullness: "leanerPresentation",
  skinEvenness: "skinSurface",
  blemishVisibility: "skinSurface",
  browDefinition: "brows",
  hairFinish: "hair",
  smileFinish: "expression",
  posture: "posture",
  lighting: "lighting",
};

export interface MorphRequestInput {
  scanId: string;
  variant: "selected" | "max_vision";
  front: Buffer;
  side: Buffer | null;
  goalIds: string[];
  layers: RenderLayer[];
  hasSide: boolean;
}

function decodeImage(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length > MAX_IMAGE_CHARS) return null;
  const m = value.match(DATA_URL);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  return bytes.length >= 100 ? bytes : null;
}

/**
 * The request, strictly. Ids and numbers only: the blueprint's effects
 * become the catalogue's layers, its goal ids are checked against GOALS,
 * and nothing else in it reaches the render. A blueprint that names an
 * effect this table does not know is refused rather than guessed at.
 */
export function parseMorphRequest(value: unknown): MorphRequestInput | { error: string } {
  if (!value || typeof value !== "object") return { error: "The request body is not a preview request." };
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return { error: "The preview request version is not one this server knows." };
  if (raw.variant !== "selected" && raw.variant !== "max_vision") return { error: "The preview variant is unknown." };
  if (!isScanId(raw.scanId)) return { error: "The request must name the scan it previews." };
  const privacy = raw.privacy as Record<string, unknown> | undefined;
  if (!privacy || privacy.purpose !== "goal-preview" || privacy.retainSource !== false) {
    return { error: "The preview request must state its purpose and that the source is not retained." };
  }
  const source = raw.source as Record<string, unknown> | undefined;
  const front = decodeImage(source?.front);
  if (!front) return { error: "The front photograph is missing or not a bounded JPEG or WebP." };
  const blueprint = raw.blueprint as Partial<MorphBlueprint> | undefined;
  if (!blueprint || blueprint.version !== 1 || !Array.isArray(blueprint.goals) || !blueprint.effects || typeof blueprint.effects !== "object") {
    return { error: "The blueprint is missing or malformed." };
  }
  const hasSide = blueprint.hasSide === true;
  const side = hasSide ? decodeImage(source?.side) : null;
  if (hasSide && !side) return { error: "The profile photograph is missing or not a bounded JPEG or WebP." };
  const goalIds = [...new Set(blueprint.goals.map((g) => (g as { id?: unknown }).id).filter((id): id is string => typeof id === "string" && GOALS.some((d) => d.id === id)))];
  if (goalIds.length !== blueprint.goals.length) return { error: "The blueprint names a goal the catalogue does not know." };
  const layers = new Set<RenderLayer>();
  for (const [effect, amount] of Object.entries(blueprint.effects)) {
    if (!(effect in EFFECT_LAYERS)) return { error: `The blueprint names an effect the server does not render: ${effect}.` };
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1) return { error: "An effect amount is out of range." };
    if (amount > 0) layers.add(EFFECT_LAYERS[effect as MorphEffectId]);
  }
  return {
    scanId: raw.scanId,
    variant: raw.variant,
    front,
    side,
    goalIds,
    layers: RENDER_LAYERS.filter((l) => layers.has(l)),
    hasSide,
  };
}

interface ValidationBlock {
  identityPreserved: boolean;
  targetAligned: boolean;
  moderationPassed: boolean;
  naturalOnly: boolean;
  crossViewConsistent: boolean;
  /** The gates only the device's re-measurement can turn true. */
  pending: string[];
}

function validationBlock(clientPassed: boolean): ValidationBlock {
  return {
    identityPreserved: clientPassed,
    targetAligned: clientPassed,
    moderationPassed: true,
    naturalOnly: true,
    crossViewConsistent: true,
    pending: clientPassed ? [] : [...CLIENT_GATES],
  };
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
  const markFailed = async () => {
    if (!previewId) return;
    await admin.from("goal_previews").update({ status: "failed" }).eq("id", previewId);
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
    const parsed = parseMorphRequest(await request.json().catch(() => null));
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    const allowed = specAllowed({ goalIds: parsed.goalIds, layers: parsed.layers, catalogueVersion: GOAL_CATALOGUE_VERSION }, true);
    if (!allowed.ok) return json({ error: allowed.reason }, 400);

    const provider = previewProvider();
    if (!provider) return json({ error: "Goal preview is not configured on this deployment." }, 503);

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
    const spec = { contract: "morph-preview-1", variant: parsed.variant, goalIds: parsed.goalIds, layers: parsed.layers, hasSide: parsed.hasSide, catalogueVersion: GOAL_CATALOGUE_VERSION };
    const { error: insertError } = await admin.from("goal_previews").insert({
      id: previewId,
      user_id: user.id,
      scan_id: parsed.scanId,
      spec,
      catalogue_version: GOAL_CATALOGUE_VERSION,
      consent_version: GOAL_PREVIEW_CONSENT_VERSION,
      status: "generating",
      provider: provider.name,
    });
    if (insertError) throw new Error(`Preview row failed: ${insertError.message}`);

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const frontIn = await prepared(parsed.front);
    // A front-only scan renders the front twice so the provider interface
    // stays one shape; the second image is dropped below.
    const sideIn = parsed.side ? await prepared(parsed.side) : frontIn;
    const rendered = await provider.render({ front: frontIn, side: sideIn, instructions: previewInstructions(parsed.layers), deadline });
    if (!("front" in rendered)) {
      await releaseClaim().catch((releaseError) => console.error("morph-preview release", safeMessage(releaseError)));
      await markFailed();
      return json({ status: "failed", jobId: previewId, error: rendered.error }, rendered.status);
    }
    claimedUserId = null;

    const frontOut = await captioned(rendered.front);
    const sideOut = parsed.side ? await captioned(rendered.side) : null;
    if (!frontOut || (parsed.side && !sideOut)) {
      await markFailed();
      return json({ status: "failed", jobId: previewId, error: "The preview was too large to deliver safely." }, 502);
    }

    const frontPath = `${user.id}/${previewId}/front.jpg`;
    const sidePath = sideOut ? `${user.id}/${previewId}/side.jpg` : null;
    const storage = admin.storage.from(GOAL_PREVIEW_BUCKET);
    const uploads = await Promise.all([
      storage.upload(frontPath, frontOut, { contentType: "image/jpeg", upsert: false }),
      sidePath && sideOut ? storage.upload(sidePath, sideOut, { contentType: "image/jpeg", upsert: false }) : Promise.resolve({ error: null }),
    ]);
    if (uploads.some((u) => u.error)) {
      await storage.remove([frontPath, ...(sidePath ? [sidePath] : [])]).catch(() => undefined);
      await markFailed();
      throw new Error(`Preview storage failed: ${uploads.map((u) => u.error?.message).filter(Boolean).join("; ")}`);
    }
    const { error: readyError } = await admin
      .from("goal_previews")
      .update({ status: "ready", front_path: frontPath, side_path: sidePath, provider_job_ref: rendered.providerRef?.slice(0, 400) ?? null })
      .eq("id", previewId);
    if (readyError) throw new Error(`Preview row update failed: ${readyError.message}`);
    await admin
      .from("goal_preview_consent_events")
      .insert({ subject_id: previewId, event_type: "rendered", consent_version: GOAL_PREVIEW_CONSENT_VERSION, details: { provider: provider.name, goals: parsed.goalIds.length, variant: parsed.variant } })
      .then(({ error }) => {
        if (error) console.error("morph-preview audit", error.message);
      });

    return json({
      status: "ready",
      jobId: previewId,
      images: { front: dataUrl(frontOut), ...(sideOut ? { side: dataUrl(sideOut) } : {}) },
      validation: validationBlock(false),
      caption: GOAL_PREVIEW_CAPTION,
      remaining: typeof remaining === "number" ? remaining : null,
    });
  } catch (error) {
    console.error("morph-preview", safeMessage(error));
    await releaseClaim().catch((releaseError) => console.error("morph-preview release", safeMessage(releaseError)));
    await markFailed().catch(() => undefined);
    return json({ status: "failed", ...(previewId ? { jobId: previewId } : {}), error: "The preview could not be made just then." }, 500);
  }
}

/** Poll a job: the stored preview, with the client gates true once its verdict has been posted. */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin previews are not allowed." }, 403);
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to see your Goal preview." }, 401);
    const id = new URL(request.url).searchParams.get("job") ?? "";
    if (!isScanId(id)) return json({ status: "failed", error: "Not found." }, 404);
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("goal_previews")
      .select("id,status,front_path,side_path,validation")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; status: string; front_path: string | null; side_path: string | null; validation: { passed?: unknown } | null }>();
    if (error) throw new Error(error.message);
    if (!data) return json({ status: "failed", error: "Not found." }, 404);
    if (data.status === "generating") return json({ status: "processing", jobId: data.id });
    if (data.status !== "ready" || !data.front_path) return json({ status: "failed", jobId: data.id, error: "The preview did not pass TrueMax validation." });
    const storage = admin.storage.from(GOAL_PREVIEW_BUCKET);
    const front = await storage.download(data.front_path);
    const side = data.side_path ? await storage.download(data.side_path) : null;
    if (front.error || !front.data || (side && (side.error || !side.data))) return json({ status: "failed", jobId: data.id, error: "Not found." }, 404);
    return json({
      status: "ready",
      jobId: data.id,
      images: {
        front: dataUrl(Buffer.from(await front.data.arrayBuffer())),
        ...(side?.data ? { side: dataUrl(Buffer.from(await side.data.arrayBuffer())) } : {}),
      },
      validation: validationBlock(data.validation?.passed === true),
      caption: GOAL_PREVIEW_CAPTION,
    });
  } catch (error) {
    console.error("morph-preview get", safeMessage(error));
    return json({ status: "failed", error: "The preview could not be loaded." }, 500);
  }
}

export { SERVER_GATES, CLIENT_GATES };
