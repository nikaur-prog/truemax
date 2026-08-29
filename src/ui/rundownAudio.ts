import type { RundownTimeline, SfxKind } from "../engine/rundownTimeline.js";

// ---------------------------------------------------------------------------
// The sound of a rundown: one voice track and a few hundred small noises.
//
// SOUND EFFECTS ARE SYNTHESISED, NOT SHIPPED. There is no public/sfx/ and
// nothing is fetched. A keystroke and a UI click are both a few milliseconds of
// shaped noise, which is a dozen lines of arithmetic — and as files they would
// be two binary assets in the repository that nobody can diff, review or tune
// without opening an audio editor. Generated, they are readable, adjustable by
// changing a number, identical on every device, and cost no request.
//
// They are also, and this matters more than it sounds, exactly repeatable. A
// video rendered twice produces the same file, which is what makes the export
// testable at all.
//
// The mix happens in an OfflineAudioContext because it renders faster than real
// time — a sixty second track mixes in well under a second, where scheduling it
// through a live AudioContext would take sixty seconds and a foreground tab.
// ---------------------------------------------------------------------------

// Levels, set against a voice track at unity.
//
// The effects are deliberately far down. Their job is to make the measurements
// feel mechanical and deliberate, not to be heard as sounds in their own right
// — and every one of them lands while somebody is talking. A keystroke loud
// enough to notice on its own is a keystroke that competes with the narration
// it is supposed to be decorating.
const KEY_GAIN = 0.14;
const CLICK_GAIN = 0.32;

// Nothing about a real keyboard is longer than this, and a long "click" reads
// as a thud.
const KEY_SECONDS = 0.014;
const CLICK_SECONDS = 0.028;

/**
 * A keystroke: a filtered noise transient with a near-instant decay.
 *
 * Deterministic pseudo-noise rather than Math.random, so the same video renders
 * to the same bytes twice. The generator is a cheap LCG — this is texture, not
 * cryptography, and an obviously-arbitrary constant is clearer here than an
 * imported dependency.
 */
function keystroke(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * KEY_SECONDS);
  const out = new Float32Array(n);
  let seed = 0x2f6e2b1;
  // A one-pole low-pass rolls the hiss off so it reads as plastic rather than
  // as static; without it the transient is thin and sits on top of the voice.
  let low = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    low += (noise - low) * 0.42;
    // Exponential decay, steep. The body of a key press is over almost before
    // it starts; what remains is the tail of the housing.
    out[i] = low * Math.exp((-i / n) * 7) * KEY_GAIN;
  }
  return out;
}

/**
 * The measurement click: a short pitched blip rather than noise.
 *
 * Pitched because it has to be distinguishable from the keystrokes underneath
 * it — a hundred noise transients and then one more noise transient is not an
 * event. This one is the sound of a number landing, so it has a note in it.
 */
function click(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * CLICK_SECONDS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // A steeper decay than the first version (12, up from 9): at 9 the two
    // partials beat against each other long enough to read as a double tap,
    // which was the whole complaint. One fundamental with a faint upper
    // partial and a fast die-off is one tap.
    const envelope = Math.exp((-i / n) * 12);
    const body = Math.sin(2 * Math.PI * 1500 * t) * 0.85 + Math.sin(2 * Math.PI * 2250 * t) * 0.15;
    out[i] = body * envelope * CLICK_GAIN;
  }
  return out;
}

/**
 * The cutaway whoosh: air moving left to right, for the shot changes.
 *
 * Band-limited noise with the low-pass corner swept up and back down over the
 * swell, which is what makes filtered noise read as movement rather than as
 * static. Short and far down in the mix, like everything else here: it marks
 * the cut, it is not a sound effect to admire.
 */
function whoosh(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 0.3);
  const out = new Float32Array(n);
  let seed = 0x51f7a3d;
  let low = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    // The filter opens toward the middle of the swell and closes again.
    const open = 0.08 + 0.3 * Math.sin(Math.PI * u);
    low += (noise - low) * open;
    const envelope = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 2;
    out[i] = low * envelope * 0.34;
  }
  return out;
}

/**
 * The graph landing: a downward swoop with a low body under it.
 *
 * The click is a number arriving on a face and lasts a few milliseconds. This
 * is a whole frame changing to make an argument about the population, so it is
 * longer and it moves — a falling pitch reads as something coming to rest,
 * which is what the marker on the curve is doing. Reusing the click here
 * punctuated the biggest frame in the video with the same tick as a cheekbone.
 */
function pop(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 0.42);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    // 900Hz down to 180Hz over the swoop, integrated so the phase is continuous
    // — stepping frequency per sample without integrating produces a click at
    // every step rather than a glide.
    const freq = 900 * Math.exp(-u * 1.6) + 180;
    phase += (2 * Math.PI * freq) / sampleRate;
    // Fast attack, long tail. A slow attack on a sound meant to punctuate a cut
    // arrives after the cut.
    const envelope = Math.min(1, u * 40) * Math.exp(-u * 4.2);
    out[i] = (Math.sin(phase) * 0.75 + Math.sin(phase * 0.5) * 0.25) * envelope * 0.5;
  }
  return out;
}

/** Sum a short effect into a mix at a sample offset, clipping at the end. */
function stamp(mix: Float32Array, effect: Float32Array, offset: number): void {
  const start = Math.max(0, Math.round(offset));
  const count = Math.min(effect.length, mix.length - start);
  for (let i = 0; i < count; i++) mix[start + i] += effect[i];
}

export interface MixedAudio {
  buffer: AudioBuffer;
  duration: number;
}

/**
 * Decode the synthesiser's response so its true length is known.
 *
 * This is separate from mixing, and the order matters: the timeline is only an
 * estimate until it has been fitted to the real audio, and the sound effects
 * have to be stamped at their FITTED positions. Decode, fit, then mix — mixing
 * against the estimate would place every click slightly wrong, by more and more
 * as the video goes on.
 *
 * OfflineAudioContext decodes without opening an output device, so no audio
 * hardware is touched to render a file.
 */
export async function decodeVoice(voice: ArrayBuffer | null): Promise<AudioBuffer | null> {
  if (!voice || voice.byteLength === 0) return null;
  try {
    const probe = new OfflineAudioContext(1, 44100, 44100);
    return await probe.decodeAudioData(voice.slice(0));
  } catch (error) {
    // A corrupt or refused response must not take the video with it. The cut is
    // still worth having silent, and the operator will hear that it is.
    console.warn("narration would not decode; rendering silent", error);
    return null;
  }
}

/**
 * Where the speech actually starts and stops inside the decoded file.
 *
 * THIS IS THE SYNC BUG, and it is not in the timeline maths.
 *
 * fitTimeline allocates the beats across the duration it is given, and it was
 * being given `voice.duration` — the length of the FILE. A synthesised mp3 is
 * not wall-to-wall speech: the decoder's own priming adds a few tens of
 * milliseconds at the front, and the synthesiser leaves a tail of silence at the
 * end, which for a minute-long read is commonly half a second to a second.
 *
 * Fitting to the file stretches every beat by that ratio. The stretch is
 * invisible at the top and compounds: by the middle of the video the caption is
 * a few tenths behind the voice, and by the card it is nearly a full second —
 * which is exactly the amount, and exactly the shape, of the lateness that was
 * being reported after the word-share fix. The words were being shared out
 * correctly across a span that was too long.
 *
 * So the span of actual sound is measured and the beats are fitted to THAT. The
 * audio track is untouched — the file still plays start to finish, silence and
 * all — only the timeline stops pretending the silence is speech.
 *
 * Peak per window rather than RMS: speech is spiky, and a window holding one
 * consonant has a low mean and an unmistakable peak. The threshold is relative
 * to the track's own peak so it works on a quiet render and an loud one alike,
 * with an absolute floor so a track of pure digital silence does not resolve to
 * "all of it is speech".
 */
export function speechSpan(buffer: AudioBuffer): { start: number; end: number } {
  const whole = { start: 0, end: buffer.duration };
  const data = buffer.getChannelData(0);
  if (!data.length) return whole;

  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
  }
  // Nothing audible in the file at all; there is no span to find and the caller
  // is better off with the file length than with zero.
  if (peak < 0.02) return whole;

  // 20ms windows. Long enough that a single zero crossing inside a vowel does
  // not read as silence, short enough that the answer is precise to well under
  // the tolerance anybody can see.
  const window = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const threshold = Math.max(0.008, peak * 0.035);

  let first = -1;
  let last = -1;
  for (let start = 0; start < data.length; start += window) {
    let loud = 0;
    const end = Math.min(data.length, start + window);
    for (let i = start; i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > loud) loud = v;
    }
    if (loud >= threshold) {
      if (first < 0) first = start;
      last = end;
    }
  }
  if (first < 0 || last <= first) return whole;

  // A little air either side. The threshold necessarily clips the quietest
  // fraction of the first and last phoneme, and a timeline that starts a hair
  // early is invisible where one that starts a hair late is the whole complaint.
  const pad = buffer.sampleRate * 0.04;
  const span = {
    start: Math.max(0, (first - pad) / buffer.sampleRate),
    end: Math.min(buffer.duration, (last + pad) / buffer.sampleRate),
  };

  // A sanity floor, not a tuning knob. If the detector claims that less than
  // three quarters of a narration file is speech, the more likely explanation is
  // that the detector is wrong about this file than that the synthesiser
  // returned a quarter of a minute of silence — and being wrong in that
  // direction compresses the whole video into the first half of its own audio,
  // which is far worse than the drift this is fixing.
  if (span.end - span.start < buffer.duration * 0.75) return whole;
  return span;
}

/**
 * Mix the voice track and every cue into one buffer.
 *
 * The voice is decoded from whatever the synthesiser returned; the effects are
 * stamped on top at the timeline's cue points. Mono, because nothing here is
 * positioned and a stereo track would double the size of the audio for no
 * audible difference.
 *
 * `voice` may be null — a rundown with no narration still gets its effects,
 * which is what makes the whole thing degrade sensibly when the TTS route is
 * unconfigured or out of quota rather than failing the export outright.
 */
export async function mixRundownAudio(
  voiceBuffer: AudioBuffer | null,
  timeline: RundownTimeline,
): Promise<MixedAudio> {
  const sampleRate = 44100;

  // The video is as long as the audio when there IS audio, because the timeline
  // was fitted to it. Half a second of tail so the last word is not clipped by
  // the encoder rounding down.
  const duration = (voiceBuffer?.duration ?? timeline.duration) + 0.5;
  const length = Math.ceil(duration * sampleRate);
  const context = new OfflineAudioContext(1, length, sampleRate);
  const out = context.createBuffer(1, length, sampleRate);
  const mix = out.getChannelData(0);

  if (voiceBuffer) {
    const source = voiceBuffer.getChannelData(0);
    const count = Math.min(source.length, mix.length);
    for (let i = 0; i < count; i++) mix[i] = source[i];
  }

  const effects: Record<SfxKind, Float32Array> = {
    key: keystroke(sampleRate),
    click: click(sampleRate),
    pop: pop(sampleRate),
    whoosh: whoosh(sampleRate),
  };
  for (const cue of timeline.sfx) {
    stamp(mix, effects[cue.kind] ?? effects.click, cue.at * sampleRate);
  }

  // Summing hundreds of effects onto speech can exceed unity in a few places.
  // Hard clipping there would be audible as a crackle on exactly the frames
  // people re-watch, so normalise instead — and only when it is actually needed,
  // so a quiet track is not pointlessly amplified.
  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  if (peak > 0.99) {
    const k = 0.99 / peak;
    for (let i = 0; i < mix.length; i++) mix[i] *= k;
  }

  return { buffer: out, duration };
}

/**
 * Ask the server for the voice track.
 *
 * Returns null rather than throwing on anything that is not a working audio
 * response. The caller renders a silent rundown in that case, which is a far
 * better outcome than losing a completed composite because a quota ran out.
 */
/**
 * When the synthesiser said each character of the narration.
 *
 * The end of the estimating. Two versions of "guess where the sentences fall"
 * shipped and both were visibly late, because both were models of how a voice
 * reads and the voice is the only thing that knows. This is its own account.
 */
export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface Narration {
  audio: ArrayBuffer;
  /** Absent when the model or voice returned none; the caller falls back. */
  alignment?: Alignment;
  /** Which service spoke — "elevenlabs" leads, "openai" is the fallback. */
  provider?: string;
}

/**
 * Thrown when the narration route answered but no voice service produced
 * audio, carrying the route's own account of which providers failed and why.
 * Distinct from a null return (no session, no quota — the legitimately silent
 * cases) so the exporter can stop a render that was going to come out broken.
 */
export class NarrationFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrationFailed";
  }
}

export async function fetchNarration(text: string, accessToken: string): Promise<Narration | null> {
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn("narration unavailable", response.status, detail);
      // Which refusals stop the render, and which quietly degrade it.
      //
      // 502 is the chain's own verdict — every voice service was tried and
      // every one failed, or one returned something that was not audio. 409
      // means the credit was spent by another render already in flight. Both
      // are cases where the operator asked for a narrated video and would
      // otherwise get a mute file they only discover after the edit, so both
      // stop and report.
      //
      // 401/402/429 — not signed in, no credit, quota reached — still degrade
      // to a silent cut on purpose. Those are answerable conditions the
      // button already names, and losing a finished composite over them
      // would cost more than the missing narration does.
      if (response.status === 502 || response.status === 409) {
        let message = "No voice service produced audio.";
        try {
          const parsed = JSON.parse(detail) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          /* the generic line stands */
        }
        throw new NarrationFailed(message);
      }
      return null;
    }
    const payload = (await response.json()) as {
      audio?: string;
      provider?: string;
      alignment?: { characters?: string[]; starts?: number[]; ends?: number[] };
    };
    if (!payload.audio) return null;

    // base64 to bytes. The route returns JSON now because the timestamps have
    // to come back alongside the audio, and there is no way to put both in one
    // binary body without inventing a container.
    const binary = atob(payload.audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const a = payload.alignment;
    const alignment =
      a?.characters && a.starts && a.ends && a.characters.length === a.starts.length
        ? { characters: a.characters, starts: a.starts, ends: a.ends }
        : undefined;
    return { audio: bytes.buffer, alignment, provider: payload.provider };
  } catch (error) {
    if (error instanceof NarrationFailed) throw error;
    console.warn("narration request failed", error);
    return null;
  }
}
