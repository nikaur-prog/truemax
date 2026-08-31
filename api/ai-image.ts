import {
  authenticatedUser,
  claimTtsRender,
  finalizeTtsRender,
  getSupabaseAdmin,
  json,
  refundTtsRender,
  requestOrigin,
  safeMessage,
} from "./_shared.js";
import { concernsFor, flawsFromIds } from "../src/engine/faceFlawCatalog.js";
import {
  afterBodyPrompt,
  afterPortraitPrompt,
  beforeBodyPrompt,
  beforeFromAfterPrompt,
  redoPrompt,
  usableScore,
  MAX_REDO_CHARS,
} from "../src/engine/aiPairPrompt.js";
import type { PairFrame, PairSpec } from "../src/engine/aiPairPrompt.js";

// ---------------------------------------------------------------------------
// The before/after pair for the AI Model Reel.
//
// The mode existed as a form in front of nothing: it saved a character to
// localStorage and then told you generation was not configured, which was true
// because there was no endpoint at all. This is the endpoint.
//
// THE HARD PART IS NOT GENERATING TWO IMAGES. It is generating two images of
// the SAME PERSON. A before/after where the face changes is not a before and
// after: it is two strangers, and every viewer sees that instantly even when
// they cannot say why. Two independent text-to-image calls from one description
// produce exactly that: same hair, same age, same vibe, different bone
// structure.
//
// So exactly ONE call invents a person and every other frame is an edit
// descending from it. Identity is carried by the pixels rather than re-described
// in words, which is the only way it survives.
//
// THE ROOT CALL IS THE AFTER. That is the correction this route needed. It used
// to make the before first and clear its blemishes to get the after, which set
// the pair's ceiling at whatever face the first call happened to return: an
// operator asking for an eight got the model's default person with the
// puffiness removed. The reasoning for the old order was that models resist
// making a face worse, which is true of a text prompt and false of an edit.
// "Add shadows under the eyes" to a photograph that already exists is a small
// local retouch and the model does it readily. The prompts themselves live in
// src/engine/aiPairPrompt.ts, where they can be read by a test.
//
// Gates match api/tts.ts exactly and for the same reason: /quick is an internal
// tool, this costs money per call at a rate nobody is paying us for, and an
// endpoint that turns a text box into billable images for any signed-in account
// is a way to empty an API balance from a browser console.
// ---------------------------------------------------------------------------

const MAX_CHARS = 600;

// gpt-image-1 does text-to-image and image-EDIT through the same account, which
// is what this needs: the second call has to accept the first image. A model
// that could only do text-to-image would not be able to hold the face at all.
const MODEL = "gpt-image-1";

// Portrait, because every downstream use of these is a 9:16 reel.
const SIZE = "1024x1536";

// JPEG, NOT PNG, and this is a correctness fix rather than a size preference.
//
// A Vercel function response is capped at 4.5MB. Four photorealistic
// 1024x1536 PNGs, base64-encoded into JSON, blow through that comfortably:
// each would have to average under about 860KiB raw to fit, and a detailed
// face at 1.5 megapixels does not. The failure is the worst shape available:
// generation SUCCEEDS, both quota slots are consumed, and then the platform
// replaces the whole response with FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE, so the
// creator is billed two renders for nothing and the finally block has no
// reservation left to refund.
//
// Asking the provider for JPEG directly is what fixes it: roughly a fifth of
// the bytes, and no server-side transcoding in a function with no image
// library. The chained edits re-render the whole frame rather than preserving
// pixels, so successive encodes are not compounding a lossy copy the way
// re-saving a file would.
const OUTPUT_FORMAT = "jpeg";
const OUTPUT_COMPRESSION = 88;

export async function POST(request: Request): Promise<Response> {
  // Held here so every exit below, thrown or returned, can give the slots back.
  //
  // A LIST, because a run can now bill for two pairs. The portrait pair costs a
  // slot and the optional full-length pair costs a second one, since it is two
  // more billable calls to the same provider at the same price. One slot
  // covering four images would have halved the protection this meter exists to
  // give, quietly, on the day the body shot shipped.
  const reservations: string[] = [];
  let claimant: string | null = null;
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin generation is not allowed." }, 403);

    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to generate a pair." }, 401);

    const { data: staff, error: staffError } = await getSupabaseAdmin()
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();
    if (staffError) throw new Error(`Image access check failed: ${staffError.message}`);

    // TWO DOORS, matching the narration route rather than inventing a scheme.
    // Staff generate unmetered. A League creator holding the `studio` pillar
    // grant spends a slot from the same monthly quota their voiceovers come
    // from. Everybody else gets the same vague "Not found" as /api/tts: an
    // endpoint that confirms its own existence to strangers is an invitation.
    //
    // This read decides only WHICH REFUSAL to send. The authorisation itself
    // happens inside claim_tts_render, which re-checks the grant in SQL under
    // an advisory lock. A grant revoked between these two statements is caught
    // there, so this cannot be used to slip past the gate.
    let meter: "studio" | null = null;
    if (!staff) {
      const { data: creator, error: creatorError } = await getSupabaseAdmin()
        .from("league_creators")
        .select("status, pillar_grants")
        .eq("user_id", user.id)
        .maybeSingle<{ status: string; pillar_grants: Record<string, unknown> | null }>();
      if (creatorError) throw new Error(`Image access check failed: ${creatorError.message}`);
      if (creator?.status !== "approved" || creator.pillar_grants?.studio !== true) {
        return json({ error: "Not found." }, 404);
      }
      meter = "studio";
    }
    claimant = user.id;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "Image generation is not configured on this deployment." }, 503);

    const body = (await request.json().catch(() => null)) as {
      sex?: unknown;
      description?: unknown;
      flaws?: unknown;
      beforeScore?: unknown;
      afterScore?: unknown;
      fullBody?: unknown;
      mode?: unknown;
      frame?: unknown;
      instruction?: unknown;
      anchor?: unknown;
      current?: unknown;
    } | null;

    const sex = body?.sex === "female" ? "female" : "male";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    // IDS ONLY. There is no free-text route into the flaw half of either
    // prompt, and this is the second time that box has had to go.
    //
    // It shipped alongside the catalogue as "anything the chips do not cover",
    // capped and appended to both halves. Which meant a crafted body, or the
    // visible optional box, could send "a narrow jaw and a recessed chin" and
    // the after prompt would dutifully ask the model to CLEAR them: exactly the
    // structural before-and-after the catalogue exists to make impossible,
    // reachable by typing. A guarantee with a text box beside it is not a
    // guarantee, and an allowlist for free text is just a second catalogue with
    // worse wording.
    //
    // The description field is unaffected: it says who the person IS, is used
    // identically in both halves, and cannot move anything between them.
    const flaws = flawsFromIds(Array.isArray(body?.flaws) ? body.flaws : []);
    // THE SCORES ARE ACTUALLY USED NOW, and their absence was the complaint that
    // started this. The form has always shown a before and an after field under
    // a note reading "these numbers steer the prompt". They were never sent.
    // Asking for an eight and receiving a five was not the generator missing:
    // it had never been told. Clamped rather than rejected because a number
    // input is the wrong place to argue with somebody.
    const afterScore = usableScore(body?.afterScore, 7.5);
    const beforeScore = usableScore(body?.beforeScore, 4.5);
    const fullBody = body?.fullBody === true;
    if (!description) return json({ error: "Describe the character first." }, 400);
    if (description.length > MAX_CHARS) {
      return json({ error: `Description is too long; the ceiling is ${MAX_CHARS} characters.` }, 413);
    }

    // --- ONE FRAME, REDONE -------------------------------------------------
    //
    // A set used to be all or nothing: liking three of four images and wanting
    // the fourth changed meant spending another render on every one of them,
    // so the cheap move was to accept the worse image. This regenerates the one
    // frame the operator picked.
    //
    // Metered as a full slot even though it is a single call. It is a billable
    // provider request either way, and a cheaper redo would be the obvious way
    // to get images for less than they cost.
    if (body?.mode === "redo") {
      const frames: PairFrame[] = ["after", "before", "afterBody", "beforeBody"];
      const frame = frames.find((f) => f === body?.frame);
      const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
      // The frame being redone is what gets edited. The after portrait is sent
      // alongside as the anchor and is used when the requested frame has no
      // pixels of its own to work from.
      const source = typeof body?.current === "string" ? body.current : "";
      const anchor = typeof body?.anchor === "string" ? body.anchor : "";
      const base = dataUrlBody(source) || dataUrlBody(anchor);
      if (!frame || !instruction || !base) {
        return json({ error: "Say which frame to redo and what should change." }, 400);
      }
      if (instruction.length > MAX_REDO_CHARS) {
        return json({ error: `Keep the change under ${MAX_REDO_CHARS} characters.` }, 413);
      }

      if (meter) {
        const slot = await claimTtsRender(user.id, meter);
        if (!slot) return json({ error: "Monthly render quota reached. It resets on the 1st." }, 429);
        reservations.push(slot);
      }
      const redone = await openaiImage(apiKey, {
        prompt: redoPrompt(frame, instruction),
        edit: base,
        deadline: Date.now() + IMAGE_TIMEOUT_MS,
      });
      if ("error" in redone) return json({ error: redone.error }, redone.status);
      for (const slot of reservations.splice(0)) {
        try {
          await finalizeTtsRender(slot, user.id);
        } catch (finalizeError) {
          console.error("ai-image finalize failed, slot left reserved", safeMessage(finalizeError));
        }
      }
      return json({ frame: `data:image/${OUTPUT_FORMAT};base64,${redone.b64}` });
    }

    const spec: PairSpec = { sex, description, flaws, afterScore, beforeScore };
    const deadline = Date.now() + TOTAL_BUDGET_MS;

    // RESERVED BEFORE THE FIRST BILLABLE CALL, and released if any frame fails.
    // One reservation per PAIR, because the pair is the unit that is worth
    // anything: half a before-and-after is not a cheaper product, it is nothing.
    if (meter) {
      for (let i = 0; i < (fullBody ? 2 : 1); i += 1) {
        const slot = await claimTtsRender(user.id, meter);
        if (!slot) {
          return json(
            {
              error: fullBody
                ? "Monthly render quota reached. A full-length set costs two renders; it resets on the 1st."
                : "Monthly render quota reached. It resets on the 1st.",
            },
            429,
          );
        }
        reservations.push(slot);
      }
    }

    // --- the AFTER portrait: the root, and the only invented face ----------
    const afterPortrait = await openaiImage(apiKey, { prompt: afterPortraitPrompt(spec), deadline });
    if ("error" in afterPortrait) return json({ error: afterPortrait.error }, afterPortrait.status);

    // --- the BEFORE portrait, as an edit that ADDS the flaws ---------------
    //
    // The identity carries in the pixels. Everything named in this prompt is a
    // thing to put ON the face; nothing describes the face, because describing
    // it again is how it becomes a different one.
    const beforePortrait = await openaiImage(apiKey, {
      prompt: beforeFromAfterPrompt(spec),
      edit: afterPortrait.b64,
      deadline,
    });
    if ("error" in beforePortrait) return json({ error: beforePortrait.error }, beforePortrait.status);

    // --- the full-length pair, optional and descending from the same face ---
    //
    // Chained off the after PORTRAIT rather than generated fresh, for the same
    // reason as everything else here: a second text-to-image call from one
    // description returns a sibling, and a reel that cuts from a face to a body
    // belonging to somebody else is worse than having no body shot at all.
    let afterBody: string | null = null;
    let beforeBody: string | null = null;
    if (fullBody) {
      const bodyAfter = await openaiImage(apiKey, {
        prompt: afterBodyPrompt(spec),
        edit: afterPortrait.b64,
        deadline,
      });
      if ("error" in bodyAfter) return json({ error: bodyAfter.error }, bodyAfter.status);
      const bodyBefore = await openaiImage(apiKey, {
        prompt: beforeBodyPrompt(spec),
        edit: bodyAfter.b64,
        deadline,
      });
      if ("error" in bodyBefore) return json({ error: bodyBefore.error }, bodyBefore.status);
      afterBody = bodyAfter.b64;
      beforeBody = bodyBefore.b64;
    }

    // Every frame landed. Spend the slots, once each.
    //
    // A finalize that throws must not lose the set somebody just waited for, so
    // it is caught and the reservation is left standing: the finally block then
    // attempts a refund, which no-ops harmlessly if the row was in fact consumed
    // and genuinely returns the slot if it was not. Both outcomes favour the
    // person who is holding the images either way.
    for (const slot of reservations.splice(0)) {
      try {
        await finalizeTtsRender(slot, user.id);
      } catch (finalizeError) {
        // NOT pushed back for refund, and that is the fix rather than an
        // oversight. A finalize that throws before its transaction commits
        // leaves the row 'reserved', so refunding it here would succeed and
        // hand the slot back to somebody who is about to receive the images:
        // two frames for nothing, or four for nothing if both throw. Leaving
        // it reserved costs the creator nothing either, because the
        // 15-minute stale sweep in claim_tts_render releases it. The images
        // still go out, which is right for the person who waited for them.
        console.error("ai-image finalize failed, slot left reserved", safeMessage(finalizeError));
      }
    }

    const png = (b64: string) => `data:image/${OUTPUT_FORMAT};base64,${b64}`;
    return json({
      before: png(beforePortrait.b64),
      after: png(afterPortrait.b64),
      beforeBody: beforeBody ? png(beforeBody) : null,
      afterBody: afterBody ? png(afterBody) : null,
      // What the product would recognise in that before, so the plan the video
      // shows can be the real plan for what is on screen.
      concerns: concernsFor(flaws),
    });
  } catch (error) {
    console.error("ai-image failed", safeMessage(error));
    return json({ error: "The pair could not be generated." }, 500);
  } finally {
    // ANY exit still holding a reservation gives it back: a provider refusal,
    // a safety rejection, a thrown error, or a half-finished pair. Never a
    // quota slot spent on nothing. A refund that itself fails is logged and
    // swallowed, because the 15-minute stale sweep in claim_tts_render is the
    // backstop and an error here would replace one lost slot with a lost
    // response.
    if (claimant) {
      for (const slot of reservations) {
        await refundTtsRender(slot, claimant).catch((refundError) => {
          console.error("ai-image refund failed", safeMessage(refundError));
        });
      }
    }
  }
}

/**
 * One image, either from text or as an edit of another.
 *
 * The edit path sends multipart because the images/edits route takes a file;
 * the generate path sends JSON. Keeping both here means the caller above reads
 * as two prompts rather than as two different HTTP shapes.
 */
/**
 * How long ONE image call may run before it is abandoned.
 *
 * fetch has no default timeout, and this one is worse than the usual case: a
 * hung call holds a serverless invocation open until the platform kills it AND
 * holds a reserved quota slot while it does. The stale sweep would eventually
 * return the slot, but not before the creator had spent a month believing they
 * were one render poorer.
 *
 * Generous, because image generation genuinely takes tens of seconds.
 *
 * THIS NUMBER IS TIED TO THE CALL COUNT, and the tie was broken when the
 * full-length pair took the route from two calls to four. At 90s each, four
 * dependent calls is 360s against a 300s function ceiling: the platform kills
 * the invocation, no response is sent, `finally` is not guaranteed to run, and
 * both reserved slots sit unusable until the 15-minute stale sweep. The old
 * comment here said it was sized "so that two of them" fit, which is exactly
 * the reasoning that stopped being true.
 *
 * 65s x 4 is 260s, and TOTAL_BUDGET_MS below enforces the ceiling directly
 * rather than trusting the multiplication to stay correct if a fifth call is
 * ever added.
 */
const IMAGE_TIMEOUT_MS = 65_000;

/**
 * The base64 payload of a data URL, or "" for anything that is not one.
 *
 * The redo path is the first time this route accepts an IMAGE from the client
 * rather than only text, so the shape is checked rather than trusted: only a
 * png or jpeg data URL with a base64 body gets through, and everything else
 * returns empty and is refused by the caller.
 */
function dataUrlBody(value: string): string {
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+=*)$/i.exec(value.trim());
  return match ? match[1] : "";
}

/**
 * The wall clock the whole run may spend on the provider.
 *
 * Checked before each call, so a slow early frame shortens the later ones
 * instead of running the invocation off the end of its own ceiling. Set below
 * the 300s configured in vercel.json to leave room for the reservation work
 * and for serialising the response.
 */
const TOTAL_BUDGET_MS = 250_000;

async function openaiImage(
  apiKey: string,
  options: { prompt: string; edit?: string; deadline?: number },
): Promise<{ b64: string } | { error: string; status: number }> {
  let response: Response;
  // The shorter of this call's own timeout and whatever is left of the run's
  // total budget. A slow early frame therefore shortens the later ones rather
  // than running the invocation off the end of its ceiling, where no response
  // is sent and `finally` is not guaranteed to run.
  const remaining = options.deadline ? options.deadline - Date.now() : IMAGE_TIMEOUT_MS;
  if (remaining <= 1_000) {
    return { error: "The image service did not respond in time.", status: 504 };
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.min(IMAGE_TIMEOUT_MS, remaining));
  try {

  if (options.edit) {
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", options.prompt);
    form.append("size", SIZE);
    form.append("output_format", OUTPUT_FORMAT);
    form.append("output_compression", String(OUTPUT_COMPRESSION));
    form.append(
      "image",
      new Blob([Uint8Array.from(atob(options.edit), (c) => c.charCodeAt(0))], { type: "image/jpeg" }),
      "source.jpg",
    );
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      signal: abort.signal,
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal: abort.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: options.prompt,
        size: SIZE,
        n: 1,
        output_format: OUTPUT_FORMAT,
        output_compression: OUTPUT_COMPRESSION,
      }),
    });
  }

  if (!response.ok) {
    // The upstream body carries account and quota detail worth logging and not
    // worth echoing — it describes OUR billing state, not this caller's.
    // Do not log the upstream body: safety errors can echo parts of the user's
    // description, which is content rather than operational telemetry.
    console.error("OpenAI images refused", response.status);
    if (response.status === 401) return { error: "The image key was rejected.", status: 502 };
    if (response.status === 429) return { error: "Image generation is rate limited right now.", status: 429 };
    // A refusal is the interesting case: a prompt the safety system declined is
    // a prompt worth rewording, and saying "try again" would send somebody round
    // the same loop.
    if (response.status === 400) {
      return { error: "That description was refused by the generator. Try rewording it.", status: 400 };
    }
    return { error: "The image service failed.", status: 502 };
  }

  const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) return { error: "The image service returned nothing.", status: 502 };
  return { b64 };
  } catch (error) {
    // An abort lands here, and so does a socket failure. Returned rather than
    // thrown so the caller's ordinary "either half failed" path refunds the
    // slot, instead of a second error type needing its own handling.
    const aborted = (error as { name?: string }).name === "AbortError";
    console.error("OpenAI images", aborted ? "timed out" : safeMessage(error));
    return {
      error: aborted ? "The image service did not respond in time." : "The image service failed.",
      status: 504,
    };
  } finally {
    clearTimeout(timer);
  }
}
