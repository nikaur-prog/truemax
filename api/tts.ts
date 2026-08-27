import {
  authenticatedUser,
  getSupabaseAdmin,
  json,
  leagueRenderBudget,
  recordLeagueRender,
  requestOrigin,
  safeMessage,
  type LeagueRenderBudget,
} from "./_shared.js";

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
//   3. staff OR approved League creator — the hard one, see below
//   4. quota   — a creator spends only what the owner budgeted for them
//   5. length  — a ceiling on the bill for any single call
//
// The membership gate is the important one and it is deliberately stricter
// than the rest of the product. /quick is the League's toolroom: the founder,
// and the creators the founder approved BY HAND in the League admin panel.
// It is not a customer feature, and every character that passes through here
// costs money at a rate nobody is paying us for. An endpoint that turns text
// into billable audio for any signed-in account is a way to empty the
// ElevenLabs balance from a browser console. Customers get scores and a plan;
// only the League gets a synthesiser — and each member only up to the
// monthly_render_quota the owner set at approval, metered in
// league_render_log after each successful render. Staff are exempt from the
// meter: the quota bounds spending the owner did not budget, and the owner
// spending their own money is not that.
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

// How fast the narrator talks, as a multiplier on ElevenLabs' default pace.
// Raising it shortens the whole rundown, because the visual timeline is fitted
// to the audio rather than the other way round.
//
// 1.12 is a deliberate ceiling. Past about 1.2 the delivery starts clipping its
// own pauses, and the beat of air spokenSeconds leaves at the end of each line
// stops landing — which is what makes a rundown read as a list being recited
// rather than as somebody talking.
// 1.18, up from 1.12 — watched back, 1.12 still read as measured rather than
// confident. Still under the 1.2 ceiling above, so the end-of-line pauses that
// keep this sounding like talking rather than reciting survive.
const VOICE_SPEED = 1.18;

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
    // Deliberately vague to an outside caller. "Not found" rather than "you
    // are not a member" — an endpoint that confirms its own existence to
    // everyone is an invitation to keep pushing at it.
    let budget: LeagueRenderBudget | null = null;
    if (!staff) {
      budget = await leagueRenderBudget(user.id);
      if (!budget) return json({ error: "Not found." }, 404);
      // Past the door, the refusal turns honest: a member over budget is told
      // exactly that, because "not found" to somebody who rendered here
      // yesterday reads as an outage, not a limit.
      if (budget.used >= budget.quota) {
        return json(
          { error: `Monthly render quota reached (${budget.quota}). It resets on the 1st — or ask for a raise.` },
          429,
        );
      }
    }

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
      // WITH TIMESTAMPS, which is the whole reason this route returns JSON.
      //
      // The renderer used to estimate where each sentence fell inside the audio,
      // first by scaling a word count and then by weighing syllables. Both got
      // closer and both were still visibly late, because both are models of how
      // a synthesiser reads and the synthesiser is the only thing that knows.
      // This endpoint returns the start and end time of every CHARACTER it
      // spoke, so the captions stop being predicted and start being looked up.
      //
      // The cost is that the response is base64 JSON rather than audio bytes,
      // which is roughly a third larger over the wire and needs decoding on the
      // client. For a file rendered once, in the background, that is nothing
      // against a caption that lands on the word.
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          // Stability low-ish and similarity high is the documented shape for
          // narration that varies its delivery without drifting off the voice.
          // A completely stable setting reads every sentence identically, which
          // is the station-announcement problem again, one layer down.
          //
          // speed is a native delivery control, not a resample: the voice talks
          // faster, it does not get played faster, so nothing shifts in pitch.
          // Doing this here rather than with an ffmpeg atempo pass afterwards is
          // also what keeps the video in sync for free — rundownExport fits the
          // visual beats onto the REAL audio duration, so a shorter read
          // compresses the whole rundown to match and nothing else changes.
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            style: 0.15,
            speed: VOICE_SPEED,
          },
        }),
      },
    );

    if (!upstream.ok) {
      // The upstream body can carry quota and voice-id detail worth seeing in a
      // log, but it is not echoed to the caller: it is ElevenLabs' account
      // state, not this user's, and some of it names the plan and its limits.
      // The body may repeat narration supplied by the user. Status is enough to
      // diagnose account/quota failures without putting content in logs.
      console.error("ElevenLabs refused", upstream.status);
      const message =
        upstream.status === 401
          ? "The voiceover key was rejected."
          : upstream.status === 429
            ? "Voiceover quota is exhausted."
            : "Voiceover generation failed.";
      return json({ error: message }, upstream.status === 429 ? 429 : 502);
    }

    const payload = (await upstream.json()) as {
      audio_base64?: string;
      alignment?: {
        characters?: string[];
        character_start_times_seconds?: number[];
        character_end_times_seconds?: number[];
      };
    };
    if (!payload.audio_base64) {
      console.error("ElevenLabs returned no audio");
      return json({ error: "Voiceover generation failed." }, 502);
    }

    // The meter ticks only after audio actually came back — a failed upstream
    // call must not spend a quota slot. And a failed LOG must not spend a
    // render: the audio exists, so it ships, and the miss is logged instead.
    if (budget) {
      await recordLeagueRender(user.id, "tts").catch((e) => console.error("render log failed", safeMessage(e)));
    }

    // The alignment is passed through rather than reshaped. It is the
    // synthesiser's own account of what it said and when; anything this route
    // did to it would be a second model of the same thing, which is the class
    // of bug being retired here.
    //
    // Forwarded as OPTIONAL: a model or voice that returns no alignment must
    // still produce a video, just one timed by the old estimate. Losing the
    // voiceover entirely because the timestamps were missing would be a worse
    // failure than the one being fixed.
    const alignment = payload.alignment;
    return json(
      {
        audio: payload.audio_base64,
        alignment:
          alignment?.characters && alignment.character_start_times_seconds
            ? {
                characters: alignment.characters,
                starts: alignment.character_start_times_seconds,
                ends: alignment.character_end_times_seconds ?? alignment.character_start_times_seconds,
              }
            : undefined,
      },
      // json() already sends no-store, which matters here: the narration is
      // keyed to one face and one scan, and a cached voice track landing on the
      // wrong rundown ships a video with somebody else's name in it.
      200,
    );
  } catch (error) {
    console.error("tts failed", safeMessage(error));
    return json({ error: safeMessage(error) }, 500);
  }
}
