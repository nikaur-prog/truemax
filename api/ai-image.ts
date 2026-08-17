import { authenticatedUser, getSupabaseAdmin, json, requestOrigin } from "./_shared.js";

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
    description,
    "Front on, looking straight at the camera, neutral expression, mouth closed.",
    "Plain mid-grey background, even soft light, no shadows across the face.",
    "Shot on an 85mm lens. Natural skin texture with visible pores.",
  ].join(" ");
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin generation is not allowed." }, 403);

    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to generate a pair." }, 401);

    const { data: staff } = await getSupabaseAdmin()
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();
    // Vague on purpose, same as the voiceover route: an endpoint that confirms
    // its own existence to everyone is an invitation to keep pushing at it.
    if (!staff) return json({ error: "Not found." }, 404);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "Image generation is not configured on this deployment." }, 503);

    const body = (await request.json().catch(() => null)) as {
      sex?: unknown;
      description?: unknown;
      blemishes?: unknown;
    } | null;

    const sex = body?.sex === "female" ? "female" : "male";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const blemishes = typeof body?.blemishes === "string" ? body.blemishes.trim() : "";
    if (!description) return json({ error: "Describe the character first." }, 400);
    if (description.length + blemishes.length > MAX_CHARS) {
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
      blemishes
        ? `Visible on this shot: ${blemishes}.`
        : "Tired, slightly unkempt: dull skin, uneven tone, flat lighting on the face.",
      "Unstyled hair. Do not retouch. This is the unflattering photograph of this person.",
    ].join(" ");

    const before = await openaiImage(apiKey, { prompt: beforePrompt });
    if ("error" in before) return json({ error: before.error }, before.status);

    // --- the AFTER, as an edit of the before -------------------------------
    //
    // The identity carries in the pixels. Everything named here is a thing to
    // REMOVE or tidy; nothing describes the face, because describing it again is
    // how it becomes a different one.
    const afterPrompt = [
      "Keep this exact person: same face, same bone structure, same eyes, same age, same hair colour.",
      blemishes ? `Clear the ${blemishes}.` : "Clear the blemishes and even out the skin tone.",
      "Clear, healthy skin. Groomed hair and brows. Well rested.",
      "Same pose, same framing, same background, same lighting.",
      "Do not restructure the face. Do not slim it. Do not change the features.",
    ].join(" ");

    const after = await openaiImage(apiKey, { prompt: afterPrompt, edit: before.b64 });
    if ("error" in after) return json({ error: after.error }, after.status);

    return json({
      before: `data:image/png;base64,${before.b64}`,
      after: `data:image/png;base64,${after.b64}`,
    });
  } catch (error) {
    console.error("ai-image failed", error);
    return json({ error: "The pair could not be generated." }, 500);
  }
}

/**
 * One image, either from text or as an edit of another.
 *
 * The edit path sends multipart because the images/edits route takes a file;
 * the generate path sends JSON. Keeping both here means the caller above reads
 * as two prompts rather than as two different HTTP shapes.
 */
async function openaiImage(
  apiKey: string,
  options: { prompt: string; edit?: string },
): Promise<{ b64: string } | { error: string; status: number }> {
  let response: Response;

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
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: options.prompt, size: SIZE, n: 1 }),
    });
  }

  if (!response.ok) {
    // The upstream body carries account and quota detail worth logging and not
    // worth echoing — it describes OUR billing state, not this caller's.
    const detail = await response.text().catch(() => "");
    console.error("OpenAI images refused", response.status, detail.slice(0, 400));
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
}
