import type { RundownTimeline } from "../engine/rundownTimeline.js";

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
    const envelope = Math.exp((-i / n) * 9);
    // Two partials a fifth apart. One sine is a beep; two is a mechanism.
    const body = Math.sin(2 * Math.PI * 2100 * t) * 0.7 + Math.sin(2 * Math.PI * 3150 * t) * 0.3;
    out[i] = body * envelope * CLICK_GAIN;
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

  const key = keystroke(sampleRate);
  const tick = click(sampleRate);
  for (const cue of timeline.sfx) {
    stamp(mix, cue.kind === "key" ? key : tick, cue.at * sampleRate);
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
export async function fetchNarration(text: string, accessToken: string): Promise<ArrayBuffer | null> {
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
      console.warn("narration unavailable", response.status, await response.text().catch(() => ""));
      return null;
    }
    return await response.arrayBuffer();
  } catch (error) {
    console.warn("narration request failed", error);
    return null;
  }
}
