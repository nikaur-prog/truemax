import type { ClipCut } from "./beatPlan.js";

// ---------------------------------------------------------------------------
// The arithmetic a beat-cut reel needs per frame, kept out of the renderer.
//
// None of this touches a canvas, a video element or an encoder, which is the
// point: a renderer is only checkable by rendering and looking, and "does the
// right frame of the right clip appear at the right moment" is a question that
// should be answerable by a test rather than by an eye. Everything here is a
// pure function of numbers, so it is.
// ---------------------------------------------------------------------------

/**
 * The source rectangle that fills a destination without distorting it.
 *
 * Reels are 9:16 and phone footage mostly is not, so something has to give. It
 * is always the framing, never the proportions: a face stretched to fit is the
 * single most obvious mark of an automated edit, and this tool measures faces
 * for a living. The excess is cropped from the centre.
 *
 * `bias` shifts the crop along the cropped axis, -1 to 1. Landscape footage of
 * a person usually wants a slightly high crop, because heads are above the
 * middle of a wide frame and the centre cut takes the chin off.
 */
export function coverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  bias = 0,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  if (srcAspect > dstAspect) {
    // Source is wider: crop the sides.
    const sw = srcH * dstAspect;
    const slack = srcW - sw;
    return { sx: (slack / 2) * (1 + clamp(bias)), sy: 0, sw, sh: srcH };
  }
  // Source is taller: crop top and bottom.
  const sh = srcW / dstAspect;
  const slack = srcH - sh;
  return { sx: 0, sy: (slack / 2) * (1 + clamp(bias)), sw: srcW, sh };
}

/**
 * Which cut is on screen at time `t`, and how far into it we are.
 *
 * The cuts tile the reel with no gaps, so a lookup is a search rather than an
 * accumulation — and the last cut owns the final instant. Without that, the
 * very last frame of a reel (t exactly equal to the duration) falls off the end
 * of the list and renders black, which is a one-frame flash on every single
 * export and reads as an encoding fault.
 */
export function activeCut(cuts: ClipCut[], t: number): { cut: ClipCut; into: number } | null {
  if (!cuts.length) return null;
  for (const cut of cuts) {
    if (t >= cut.start && t < cut.end) return { cut, into: t - cut.start };
  }
  const last = cuts[cuts.length - 1];
  if (t >= last.end) return { cut: last, into: last.end - last.start };
  const first = cuts[0];
  return t < first.start ? { cut: first, into: 0 } : null;
}

export interface ClipSource {
  /** Seconds into the source file where this clip should begin. */
  startAt: number;
  /** The source's own length, so a short clip cannot be seeked past its end. */
  duration: number;
}

/**
 * Where in the source file to seek, for a given moment of the reel.
 *
 * A clip shorter than the beats it has been given is HELD on its last frame
 * rather than looped. Looping a two-second clip through a three-second cut
 * produces a visible jump back that reads as a glitch, where a held frame reads
 * as a deliberate hold — and the cut still lands on the beat either way, which
 * is the thing that must not be compromised.
 */
export function sourceTime(clip: ClipSource, into: number, speed = 1): number {
  const usable = Math.max(0, clip.duration - clip.startAt);
  const wanted = into * Math.max(0.05, speed);
  // A hair back from the very end: the final frame of a file is frequently not
  // decodable by a seek, and landing on it yields the previous frame anyway.
  return clip.startAt + Math.min(wanted, Math.max(0, usable - 0.05));
}

/**
 * Copy a window of decoded audio out of a longer track.
 *
 * The window is the user's chosen section of the song and nothing else — the
 * rest of the file is never written into the export. Deliberately a plain copy
 * rather than a resample: the output keeps the source's own sample rate, so
 * nothing here can alter the pitch or the timing the beat grid was measured
 * against.
 */
export function sliceAudio(
  channels: Float32Array[],
  sampleRate: number,
  startSec: number,
  durationSec: number,
): Float32Array[] {
  const from = Math.max(0, Math.round(startSec * sampleRate));
  const count = Math.max(0, Math.round(durationSec * sampleRate));
  return channels.map((ch) => {
    const out = new Float32Array(count);
    // A window running past the end of the file is filled with silence rather
    // than refused: a song that ends mid-reel should end mid-reel, not fail the
    // export after the render has already run.
    const take = Math.max(0, Math.min(count, ch.length - from));
    if (take > 0) out.set(ch.subarray(from, from + take), 0);
    return out;
  });
}

/**
 * A short fade at each end of the music window, in seconds.
 *
 * A song sliced mid-waveform starts and ends with a click — a step change in
 * amplitude is a broadband transient, which is exactly what the onset detector
 * elsewhere in this codebase is built to notice, and the ear notices it too.
 * Ten milliseconds is inaudible as a fade and completely removes the click.
 */
export const EDGE_FADE = 0.01;

export function applyEdgeFades(channels: Float32Array[], sampleRate: number): void {
  const n = Math.max(1, Math.round(EDGE_FADE * sampleRate));
  for (const ch of channels) {
    const len = ch.length;
    const span = Math.min(n, Math.floor(len / 2));
    for (let i = 0; i < span; i++) {
      const g = i / span;
      ch[i] *= g;
      ch[len - 1 - i] *= g;
    }
  }
}
