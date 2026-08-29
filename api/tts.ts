import {
  authenticatedUser,
  getSupabaseAdmin,
  json,
  leagueRenderBudget,
  recordLeagueRender,
  requestOrigin,
  safeMessage,
  spendVoiceCredit,
  voiceCreditBalance,
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
// 1.12 was the first setting and 1.18 the second; both read as measured
// rather than confident when watched back against the fast-cut reference
// channels. 1.25 is the owner's call after listening: past ~1.2 the delivery
// does start clipping its own end-of-line pauses, and that trade is accepted
// — on the short cut the beats are terse enough that pace reads as energy,
// not as reciting. If it still drags, 1.5 is the next stop; anything between
// is unlikely to be distinguishable by ear.
const VOICE_SPEED = 1.125;

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
    // everyone is an invitation to keep pushing at it. Three doors in:
    // staff (unmetered), League creators (the owner's per-creator budget),
    // and anyone holding a purchased voiced-analysis credit ($2.99 each).
    // Which ledger the render lands in follows from which door admitted it.
    let budget: LeagueRenderBudget | null = null;
    let meter: "league" | "voice" | null = null;
    if (!staff) {
      budget = await leagueRenderBudget(user.id);
      meter = budget ? "league" : null;
      if (!budget) {
        // The credit door. 402 rather than 404: the client showed this person
        // a buy button, so the refusal has to name the purchase, not deny the
        // endpoint exists. A signed-in caller poking the API by hand learns
        // only that something here is purchasable, which the pricing page
        // already says.
        const balance = await voiceCreditBalance(user.id);
        if (balance <= 0) {
          return json({ error: "No voiced analysis credit on this account. It's a one-time $2.99 purchase." }, 402);
        }
        meter = "voice";
      }
      if (budget && budget.used >= budget.quota) {
        return json(
          { error: `Monthly render quota reached (${budget.quota}). It resets on the 1st — or ask for a raise.` },
          429,
        );
      }
    }

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "Nothing to say." }, 400);
    if (text.length > MAX_CHARS) {
      return json({ error: `Narration is ${text.length} characters; the ceiling is ${MAX_CHARS}.` }, 413);
    }

    // A CHAIN of providers, best first, and the render only fails when every
    // one of them has. ElevenLabs leads because it is the only one that
    // returns per-character timestamps — the word-accurate captions — but an
    // unpaid subscription or an exhausted quota there must degrade to the
    // next voice, not to a silent video: a rundown without narration also has
    // no captions, and the export it produced looked broken, not minimal.
    // Every attempt is recorded so the caller can be told exactly which
    // services failed and why, instead of a generic shrug.
    const attempts: string[] = [];
    let spoken: {
      audio: string;
      provider: string;
      alignment?: {
        characters?: string[];
        character_start_times_seconds?: number[];
        character_end_times_seconds?: number[];
      };
    } | null = null;

    if (process.env.ELEVENLABS_API_KEY) {
      spoken = await speakWithElevenLabs(text, process.env.ELEVENLABS_API_KEY, attempts);
    } else {
      attempts.push("ElevenLabs is not configured.");
    }
    if (!spoken) {
      if (process.env.OPENAI_API_KEY) {
        spoken = await speakWithOpenAI(text, process.env.OPENAI_API_KEY, attempts);
      } else {
        attempts.push("The fallback voice is not configured.");
      }
    }
    if (!spoken) {
      console.error("all voice providers failed", attempts.join(" | "));
      return json({ error: `No voice service produced audio. ${attempts.join(" ")}` }, 502);
    }
    const payload = { audio_base64: spoken.audio, alignment: spoken.alignment };

    // The audio has to BE audio before anybody is charged for it.
    //
    // The balance check happens before synthesis and the spend after it, which
    // is the right order — a provider that refuses must not cost a credit. But
    // "the provider answered" is not the same as "the answer is playable": a
    // 200 carrying an HTML error page, a truncated body, or a JSON blob would
    // all have passed as success, spent the credit, and produced a silent
    // video that the buyer only discovers after the render. So the bytes are
    // checked for a real MP3 signature first, and a provider that hands back
    // something else is treated as a failure of that provider.
    if (!looksLikeMp3(spoken.audio)) {
      console.error("voice provider returned non-audio", spoken.provider);
      return json(
        { error: "The voice service returned unplayable audio. Nothing was charged — try again." },
        502,
      );
    }

    // The meter ticks only after audio actually came back — a failed upstream
    // call must not spend a quota slot or a paid credit.
    //
    // The RESULT of the spend is checked, not discarded. spend_voice_credit is
    // atomic in SQL and answers -1 when there was nothing left to spend, which
    // is exactly what a second simultaneous render sees: both requests read a
    // balance of 1 before either spent, both synthesised, and one of them is
    // riding a credit that no longer exists. Ignoring that return value let
    // two renders share one purchase. A render that could not be paid for is
    // refused rather than delivered — the audio is already made and that cost
    // is ours, but it is not handed over unpaid.
    if (meter === "league") {
      await recordLeagueRender(user.id, "tts").catch((e) => console.error("render log failed", safeMessage(e)));
    } else if (meter === "voice") {
      let spent = -1;
      try {
        spent = await spendVoiceCredit(user.id);
      } catch (e) {
        // The ledger is unreachable. The buyer holds a credit we could not
        // read, so they get their render and the miss is logged: an infra
        // fault must not eat a purchase.
        console.error("credit spend failed", safeMessage(e));
        spent = 0;
      }
      if (spent < 0) {
        return json(
          {
            error:
              "That credit was already used by another render in flight. Nothing extra was charged.",
          },
          409,
        );
      }
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
        // Which service spoke, so the exporter can say so — an operator who
        // hears the fallback voice deserves to know it was the fallback and
        // not a new default.
        provider: spoken.provider,
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
    // Logged in full, reported generically. safeMessage strips the obvious
    // secrets but an internal Error.message is still our stack talking to a
    // stranger — it can name tables, columns and upstream hosts. The operator
    // gets the log; the caller gets the fact.
    console.error("tts failed", safeMessage(error));
    return json({ error: "The voiceover could not be produced." }, 500);
  }
}

/**
 * Does this base64 payload actually start like an MP3?
 *
 * Both providers are asked for mp3 and both normally deliver it. This catches
 * the case where one answers 200 with something else — an error page, a
 * truncated body — which would otherwise be charged for and shipped as a
 * silent video. Deliberately a signature check, not a decode: the server has
 * no audio stack, and every real failure mode here is "these bytes are not an
 * MP3 at all" rather than "this MP3 is subtly corrupt".
 *
 * An MP3 begins either with an ID3 tag ("ID3") or with a frame sync — eleven
 * set bits, so 0xFF followed by a byte whose top three bits are set.
 */
export function looksLikeMp3(base64: string): boolean {
  if (!base64 || base64.length < 32) return false;
  let head: Buffer;
  try {
    head = Buffer.from(base64.slice(0, 64), "base64");
  } catch {
    return false;
  }
  if (head.length < 3) return false;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  return head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
}

// ---------------------------------------------------------------------------
// The providers. Each returns base64 audio or null, and appends a one-line
// reason to `attempts` when it fails — those lines are what the operator sees
// when the whole chain comes up empty, so they name the service and the class
// of failure, never account internals.
// ---------------------------------------------------------------------------

async function speakWithElevenLabs(
  text: string,
  apiKey: string,
  attempts: string[],
): Promise<{
  audio: string;
  provider: string;
  alignment?: {
    characters?: string[];
    character_start_times_seconds?: number[];
    character_end_times_seconds?: number[];
  };
} | null> {
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  try {
    const upstream = await fetch(
      // WITH TIMESTAMPS, which is the whole reason this route returns JSON:
      // the start and end time of every CHARACTER spoken, so captions are
      // looked up rather than predicted. Two generations of estimating where
      // sentences fall were both visibly late — the synthesiser is the only
      // thing that knows how it reads.
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
          //
          // speed is a native delivery control, not a resample: the voice
          // talks faster, it does not get played faster, so nothing shifts in
          // pitch — and the visual timeline fits itself to the real audio, so
          // a faster read compresses the whole rundown for free.
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
      // The upstream body can carry quota and voice-id detail worth seeing in
      // a log, but it is not echoed to the caller: it is the provider's
      // account state, not this user's.
      console.error("ElevenLabs refused", upstream.status);
      attempts.push(
        upstream.status === 401
          ? "ElevenLabs rejected the key."
          : upstream.status === 429
            ? "ElevenLabs quota is exhausted."
            : `ElevenLabs failed (${upstream.status}).`,
      );
      return null;
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
      attempts.push("ElevenLabs returned no audio.");
      return null;
    }
    return { audio: payload.audio_base64, provider: "elevenlabs", alignment: payload.alignment };
  } catch (error) {
    console.error("ElevenLabs call failed", safeMessage(error));
    attempts.push("ElevenLabs was unreachable.");
    return null;
  }
}

// The fallback voice, spoken through the OpenAI account the deployment
// already holds for image generation — one existing credential, no new
// service to stand up. No character timestamps, so a rundown narrated by the
// fallback times its captions by fitting the estimate onto the real audio
// span: sentence-level sync, the same as before alignment existed.
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "onyx";

async function speakWithOpenAI(
  text: string,
  apiKey: string,
  attempts: string[],
): Promise<{ audio: string; provider: string } | null> {
  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
        input: text,
        response_format: "mp3",
        // The same delivery pace as the lead voice, natively — see VOICE_SPEED.
        speed: VOICE_SPEED,
      }),
    });
    if (!upstream.ok) {
      console.error("OpenAI TTS refused", upstream.status);
      attempts.push(
        upstream.status === 401
          ? "The fallback voice rejected the key."
          : upstream.status === 429
            ? "The fallback voice quota is exhausted."
            : `The fallback voice failed (${upstream.status}).`,
      );
      return null;
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length) {
      attempts.push("The fallback voice returned no audio.");
      return null;
    }
    return { audio: bytes.toString("base64"), provider: "openai" };
  } catch (error) {
    console.error("OpenAI TTS call failed", safeMessage(error));
    attempts.push("The fallback voice was unreachable.");
    return null;
  }
}
