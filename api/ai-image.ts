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
import type { FaceFlaw } from "../src/engine/faceFlawCatalog.js";

// ---------------------------------------------------------------------------
// The before/after pair for the AI Model Reel.
//
// The mode existed as a form in front of nothing: it saved a character to
// localStorage and then told you generation was not configured, which was true
// because there was no endpoint at all. This is the endpoint.
//
// THE HARD PART IS NOT GENERATING TWO IMAGES. It is generating two images of
// the SAME PERSON. A before/after where the face changes is not a before and
// after — it is two strangers, and every viewer sees that instantly even when
// they cannot say why. Two independent text-to-image calls from one description
// produce exactly that: same hair, same age, same vibe, different bone
// structure.
//
// So the after is an EDIT of the before rather than a second generation. The
// first call makes the person; the second call is handed that image and asked
// to clear the blemishes and nothing else. Identity is carried by the pixels
// rather than re-described in words, which is the only way it survives.
//
// That ordering is also why the two prompts are asymmetric, and why the form
// asks for blemishes but not for a glow-up. "What is wrong in the before" is a
// list a person can write; "what does better look like" is not, and asking for
// it produces a second description that pulls the after away from the first
// face. The after is defined as the before minus the flaws.
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

/**
 * The shared half of both prompts: who this person is.
 *
 * Stated once and reused verbatim so nothing in the wording can drift between
 * the two calls. Photographic language rather than beauty language — "shot on"
 * and "even light" hold the framing steady, which matters more for a pair than
 * any single adjective does.
 */
function subject(sex: string, description: string): string {
  const person = sex === "female" ? "woman" : "man";
  return [
    `A photorealistic head-and-shoulders portrait of one ${person}.`,
    // THE ANCHOR, and its absence was the whole defect.
    //
    // Without a word about structure the model returns its default face, the
    // before prompt degrades it, and the after clears the degradation: an
    // average person made worse, then made average again. Neither end is worth
    // looking at, and the after in particular is not a face anybody wants.
    //
    // Anchoring structure here, in the half both calls share verbatim, is also
    // the honest construction. Bone does not move; what the before and after
    // differ by is surface, which is exactly what a protocol can change. The
    // after inherits this face by being an EDIT of the before's pixels, so this
    // sentence is what both halves are built on rather than a wish repeated
    // twice.
    "Strong clear bone structure: a defined jawline, high cheekbones, balanced facial proportions and symmetrical features.",
    description,
    "Front on, looking straight at the camera, neutral expression, mouth closed.",
    "Plain mid-grey background, even soft light, no shadows across the face.",
    "Shot on an 85mm lens. Natural skin texture with visible pores.",
  ].join(" ");
}

/**
 * What the before shows, from the chips plus whatever was typed.
 *
 * A default exists because a pair with no flaws at all is two identical
 * photographs, which is not a before and after. It is the mildest honest
 * version rather than a heavy one: an operator who picked nothing has said
 * nothing, not asked for the worst.
 */
function showing(flaws: readonly FaceFlaw[]): string {
  if (!flaws.length) return "Tired and unstyled: dull skin, uneven tone, unkempt hair.";
  return `Visible on this shot: ${flaws.map((f) => f.add).join("; ")}.`;
}

/**
 * What the after clears. ONLY REMOVALS.
 *
 * Never a description of the face, because describing it again is how it
 * becomes a different one. Every phrase here names something to take away or
 * tidy, and the catalogue is written so that they can be read in a row.
 */
function cleared(flaws: readonly FaceFlaw[]): string {
  const removals = flaws.length
    ? `Clear ${flaws.map((f) => f.clear).join("; clear ")}.`
    : "Clear the blemishes and even out the skin tone.";
  return `${removals} Clear healthy skin, groomed hair and brows, well rested.`;
}

export async function POST(request: Request): Promise<Response> {
  // Held here so every exit below, thrown or returned, can give the slot back.
  let reservation: string | null = null;
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
    if (!description) return json({ error: "Describe the character first." }, 400);
    if (description.length > MAX_CHARS) {
      return json({ error: `Description is too long; the ceiling is ${MAX_CHARS} characters.` }, 413);
    }

    // --- the BEFORE -------------------------------------------------------
    //
    // Generated first because it is the one that defines the face. Doing it the
    // other way round — make the good-looking one, then degrade it — sounds
    // equivalent and is not: models resist making a face worse and comply
    // readily with making one better, so starting from the flawed version is
    // what actually produces a visible difference.
    const beforePrompt = [
      subject(sex, description),
      showing(flaws),
      "Do not retouch. This is the unflattering photograph of this person.",
    ].join(" ");

    // RESERVED BEFORE THE FIRST BILLABLE CALL, and released if either half
    // fails. One reservation for the PAIR, because the pair is the unit that
    // is worth anything: half a before-and-after is not a cheaper product, it
    // is nothing.
    if (meter) {
      reservation = await claimTtsRender(user.id, meter);
      if (!reservation) {
        return json({ error: "Monthly render quota reached. It resets on the 1st." }, 429);
      }
    }

    const before = await openaiImage(apiKey, { prompt: beforePrompt });
    if ("error" in before) return json({ error: before.error }, before.status);

    // --- the AFTER, as an edit of the before -------------------------------
    //
    // The identity carries in the pixels. Everything named here is a thing to
    // REMOVE or tidy; nothing describes the face, because describing it again is
    // how it becomes a different one.
    const afterPrompt = [
      "Keep this exact person: same face, same bone structure, same eyes, same age, same hair colour.",
      cleared(flaws),
      // SAME SHOT, and this line is doing real work. A before in flat light
      // beside an after in good light is the standard lie of glow-up content:
      // nothing about the person changed. Holding the photograph constant is
      // what makes the difference attributable to the face.
      "Same pose, same framing, same background, same lighting, same camera.",
      "Do not restructure the face. Do not slim it. Do not change the features.",
    ].join(" ");

    const after = await openaiImage(apiKey, { prompt: afterPrompt, edit: before.b64 });
    if ("error" in after) return json({ error: after.error }, after.status);

    // Both halves landed. Spend the slot, once.
    //
    // A finalize that throws must not lose the pair somebody just waited for,
    // so it is caught and the reservation is left standing: the block below
    // then attempts a refund, which no-ops harmlessly if the row was in fact
    // consumed and genuinely returns the slot if it was not. Both outcomes
    // favour the person who is holding two images either way.
    if (reservation) {
      try {
        await finalizeTtsRender(reservation, user.id);
        reservation = null;
      } catch (finalizeError) {
        console.error("ai-image finalize failed", safeMessage(finalizeError));
      }
    }

    return json({
      before: `data:image/png;base64,${before.b64}`,
      after: `data:image/png;base64,${after.b64}`,
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
    if (reservation && claimant) {
      await refundTtsRender(reservation, claimant).catch((refundError) => {
        console.error("ai-image refund failed", safeMessage(refundError));
      });
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
 * Generous, because image generation genuinely takes tens of seconds, and set
 * so that two of them plus the surrounding work stay inside a 300s Vercel
 * function ceiling with room to spare.
 */
const IMAGE_TIMEOUT_MS = 90_000;

async function openaiImage(
  apiKey: string,
  options: { prompt: string; edit?: string },
): Promise<{ b64: string } | { error: string; status: number }> {
  let response: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), IMAGE_TIMEOUT_MS);
  try {

  if (options.edit) {
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", options.prompt);
    form.append("size", SIZE);
    form.append(
      "image",
      new Blob([Uint8Array.from(atob(options.edit), (c) => c.charCodeAt(0))], { type: "image/png" }),
      "before.png",
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
      body: JSON.stringify({ model: MODEL, prompt: options.prompt, size: SIZE, n: 1 }),
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
