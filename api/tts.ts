import { authenticatedUser, getSupabaseAdmin, json, requestOrigin, safeMessage } from "./_shared.js";

// ---------------------------------------------------------------------------
// The voice on a rundown.
//
// The browser composites the video — canvas, landmarks, overlays, the encoder,
// all of it on the device. This is the one part it cannot do, because speech
// synthesis needs a billable credential and a credential in a public bundle is
// somebody else's free API.
//
// So the shape is: the page sends the finished narration, the server holds the
// key, and audio comes back. Nothing about the face, the scan or the score is
// sent — narrationFrom() has already reduced the whole thing to a paragraph of
// English, and that paragraph is all that leaves the device.
//
// ONE REQUEST PER VIDEO, not one per beat. Splitting it would let the renderer
// place each line exactly, which sounds like the better design until you hear
// it: synthesised speech resets its prosody at every call, so fourteen separate
// requests produce fourteen sentences each landing with the same cadence, and
// the result is a station announcement. One request lets the model carry
// emphasis across the whole read. The renderer gets its timing from the beat
// list instead, which it already has.
//
// Gates, in order and not cosmetic:
//
//   1. origin  — no cross-site use of somebody's session
//   2. signed in
//   3. staff   — the hard one, see below
//   4. length  — a ceiling on the bill for any single call
//
// The staff gate is the important one and it is deliberately stricter than the
// rest of the product. /quick is an internal tool: the founder, one editor and
// whoever gets hired next. It is not a customer feature, and every character
// that passes through here costs money at a rate nobody is paying us for. An
// endpoint that turns text into billable audio for any signed-in account is a
// way to empty the ElevenLabs balance from a browser console. Customers get
// scores and a plan; nobody gets a synthesiser.
// ---------------------------------------------------------------------------

// A full rundown measured about 1,100 characters against a real scan. Three
// thousand is roughly triple that: comfortable headroom for a face with more to
// say, and still a bounded worst case per call. The cap is here rather than in
// the client because a limit the caller enforces is not a limit.
const MAX_CHARS = 3000;

// Overridable so the voice can be changed without a deploy — picking one is a
// taste decision that will be made by listening, not by reading code. The
// default is a stock ElevenLabs voice so a missing variable still produces
// audio rather than a 500 nobody can diagnose.
const DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB";

// eleven_multilingual_v2 rather than a turbo model. This is not a live
// conversation — the file is rendered once, in the background, and then edited
// into a video that will be watched thousands of times. Latency is worth
// nothing here and prosody is worth a great deal, so the trade goes the
// opposite way to a chat endpoint.
const DEFAULT_MODEL = "eleven_multilingual_v2";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!requestOrigin(request)) return json({ error: "Cross-origin narration is not allowed." }, 403);

    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to render a voiceover." }, 401);

    const { data: staff } = await getSupabaseAdmin()
      .from("app_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();
    // Deliberately vague to a non-staff caller. "Not found" rather than "you
    // are not staff" — an endpoint that confirms its own existence to everyone
    // is an invitation to keep pushing at it.
    if (!staff) return json({ error: "Not found." }, 404);

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return json({ error: "Voiceover is not configured on this deployment." }, 503);

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "Nothing to say." }, 400);
    if (text.length > MAX_CHARS) {
      return json({ error: `Narration is ${text.length} characters; the ceiling is ${MAX_CHARS}.` }, 413);
    }

    const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
    const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          // Stability low-ish and similarity high is the documented shape for
          // narration that varies its delivery without drifting off the voice.
          // A completely stable setting reads every sentence identically, which
          // is the station-announcement problem again, one layer down.
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.15 },
        }),
      },
    );

    if (!upstream.ok) {
      // The upstream body can carry quota and voice-id detail worth seeing in a
      // log, but it is not echoed to the caller: it is ElevenLabs' account
      // state, not this user's, and some of it names the plan and its limits.
      const detail = await upstream.text().catch(() => "");
      console.error("ElevenLabs refused", upstream.status, detail.slice(0, 500));
      const message =
        upstream.status === 401
          ? "The voiceover key was rejected."
          : upstream.status === 429
            ? "Voiceover quota is exhausted."
            : "Voiceover generation failed.";
      return json({ error: message }, upstream.status === 429 ? 429 : 502);
    }

    const audio = await upstream.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(audio.byteLength),
        // Never cached. The narration is keyed to one face and one scan, and a
        // cached voice track landing on the wrong rundown is the sort of bug
        // that ships a video with somebody else's name in it.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("tts failed", error);
    return json({ error: safeMessage(error) }, 500);
  }
}
