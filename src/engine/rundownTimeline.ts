import type { Beat } from "./reelScript.js";

// ---------------------------------------------------------------------------
// When each beat happens.
//
// buildReelScript decides WHAT is said and in what order. This decides WHEN,
// which is the other half of the format and the half that cannot be judged by
// reading it — a running order that looks right on paper still fails if the
// measurement draws after the sentence that describes it.
//
// Pure, like the script it times: no audio, no canvas, no clock. It takes beats
// and returns numbers, so the pacing can be tested without rendering anything.
//
// ON THE ESTIMATE, which is the thing to understand before changing any of it.
//
// The voice track is synthesised in ONE request (see api/tts.ts — splitting it
// wrecks the prosody), which means its real duration is unknown until the audio
// comes back. So this builds a timeline from an estimate of speech rate, and
// fitTimeline() then scales that estimate onto the duration the synthesiser
// actually produced.
//
// Scaling works because the estimate is PROPORTIONAL: every beat is measured in
// the same units, so if the whole read comes back 12% longer, every beat is
// about 12% longer and the relative pacing survives. It would not work if
// beats had fixed durations mixed with variable ones, which is why the floor
// below is applied before scaling rather than after.
//
// The exact-alignment upgrade, when this is not good enough: ElevenLabs will
// return per-character timestamps alongside the audio, which would let captions
// track the voice word by word instead of sentence by sentence. It changes the
// response shape from audio bytes to JSON-with-base64, so it is deliberately
// not the first version. Sentence-level sync is what the reference channel
// does and it reads fine.
// ---------------------------------------------------------------------------

// Words per second for the default voice at default settings, measured by ear
// against a real synthesis rather than taken from a specification. This is only
// the starting proportion — fitTimeline corrects the absolute value — so it
// matters that it is roughly right for ALL beats, not exactly right for one.
const WORDS_PER_SECOND = 2.7;

// No beat is shorter than this however few words it has. "The jaw is
// excellent." is four words and would otherwise flash past in under a second,
// which is not long enough to look at the measurement being described — and
// looking at the measurement is the entire point of the format.
const MIN_BEAT = 1.6;

// Silence between beats. Speech synthesis puts almost none between sentences,
// and without a gap the video has no rhythm and no room to move the crop.
const GAP = 0.35;

// A keystroke every other character rather than every one. Per-character is
// what a real typewriter does and what it sounds like at 2.7 words a second is
// a machine gun; halving it keeps the texture and loses the rattle.
const CHARS_PER_KEYSTROKE = 2;

export type SfxKind = "key" | "click";

export interface SfxCue {
  at: number;
  kind: SfxKind;
}

export interface TimedBeat {
  beat: Beat;
  /** Seconds from the start of the video. */
  start: number;
  duration: number;
  /**
   * When the measurement overlay finishes drawing itself onto the face.
   *
   * Only set for beats that draw something. The click lands here, and it lands
   * on the END of the draw rather than the start because the sound is the
   * measurement arriving, not the line beginning to move.
   */
  drawAt?: number;
}

export interface RundownTimeline {
  beats: TimedBeat[];
  duration: number;
  /** Every sound effect in the video, already placed. */
  sfx: SfxCue[];
}

function wordCount(line: string): number {
  return line.split(/\s+/).filter(Boolean).length;
}

/** The un-scaled estimate. Callers want buildTimeline. */
function estimate(beats: Beat[]): TimedBeat[] {
  let cursor = 0;
  return beats.map((beat) => {
    const spoken = Math.max(MIN_BEAT, wordCount(beat.spoken ?? beat.line) / WORDS_PER_SECOND);
    const duration = spoken + GAP;
    const timed: TimedBeat = { beat, start: cursor, duration };
    if (beat.metricId) {
      // The overlay draws over the first third of the beat, so the line is on
      // the face while the sentence about it is still being said. Drawing it
      // afterwards reads as an illustration of a claim already made; drawing it
      // during reads as the claim being demonstrated.
      timed.drawAt = cursor + spoken * 0.34;
    }
    cursor += duration;
    return timed;
  });
}

/**
 * Scale a timeline onto a known audio duration.
 *
 * The gaps scale with everything else. It is tempting to hold them fixed and
 * absorb the difference into speech, on the grounds that a pause is a pause —
 * but the gaps are where the crop moves between regions, and a fixed gap inside
 * a stretched video makes those moves progressively more abrupt as the read
 * gets longer.
 */
export function fitTimeline(timeline: RundownTimeline, actualDuration: number): RundownTimeline {
  if (!(actualDuration > 0) || !(timeline.duration > 0)) return timeline;
  const k = actualDuration / timeline.duration;
  return {
    duration: actualDuration,
    beats: timeline.beats.map((b) => ({
      ...b,
      start: b.start * k,
      duration: b.duration * k,
      drawAt: b.drawAt === undefined ? undefined : b.drawAt * k,
    })),
    sfx: timeline.sfx.map((cue) => ({ ...cue, at: cue.at * k })),
  };
}

export function buildTimeline(beats: Beat[]): RundownTimeline {
  const timed = estimate(beats);
  const duration = timed.reduce((total, b) => total + b.duration, 0);

  const sfx: SfxCue[] = [];
  for (const b of timed) {
    // Captions type over the first 62% of the beat, so the line is complete and
    // readable for a moment before it leaves. A caption still typing when the
    // beat ends has not been read by anybody.
    const typing = (b.duration - GAP) * 0.62;
    const strokes = Math.floor(b.beat.line.length / CHARS_PER_KEYSTROKE);
    for (let i = 0; i < strokes; i++) {
      sfx.push({ at: b.start + (typing * i) / Math.max(1, strokes), kind: "key" });
    }
    if (b.drawAt !== undefined) sfx.push({ at: b.drawAt, kind: "click" });
  }
  sfx.sort((a, b) => a.at - b.at);

  return { beats: timed, duration, sfx };
}

/**
 * How far through its own typing a beat is at time t, 0..1.
 *
 * The renderer needs this per frame and it is the one piece of timing maths
 * that would otherwise be duplicated between the compositor and the tests.
 */
export function typedFraction(beat: TimedBeat, t: number): number {
  const typing = (beat.duration - GAP) * 0.62;
  if (typing <= 0) return 1;
  return Math.max(0, Math.min(1, (t - beat.start) / typing));
}

/** The beat playing at time t, or null past the end. */
export function beatAt(timeline: RundownTimeline, t: number): TimedBeat | null {
  for (const b of timeline.beats) {
    if (t >= b.start && t < b.start + b.duration) return b;
  }
  return null;
}
