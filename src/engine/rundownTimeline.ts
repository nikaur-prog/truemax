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

// Speech rate for the default voice at default settings, measured by ear
// against a real synthesis rather than taken from a specification. In
// SYLLABLES, not words — see spokenWeight. About 2.7 words a second at the
// measured 1.7-ish syllables a word. Only the starting proportion; fitTimeline
// corrects the absolute value whenever there is real audio to correct it
// against, so this number matters only for a silent render.
const SYLLABLES_PER_SECOND = 4.6;

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

// Where in a beat the measurement finishes drawing itself, as a fraction.
//
// The line must be on the face while the sentence about it is still being said.
// Drawing it afterwards reads as an illustration of a claim already made;
// drawing it during reads as the claim being demonstrated.
//
// Was 0.34 of the SPOKEN portion, which put the line a third of the way into a
// sentence that now runs twenty words — the viewer heard "a canthal tilt of 6.4
// degrees" and had nothing to look at for the length of it. At 0.16 the
// measurement lands under the figure rather than after it, which is the moment
// it is evidence rather than illustration.
//
// Expressed against the beat's whole duration so fitTimeline can place it
// without re-deriving what the "spoken portion" of a fitted beat means.
const DRAW_AT = 0.16;

// "pop" existed for the curve and is no longer emitted — see cuesFor. The kind
// stays in the union so the mixer keeps its sample and re-enabling it is one
// line rather than a re-import.
export type SfxKind = "key" | "click" | "pop";

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

// ---------------------------------------------------------------------------
// How long a line takes to SAY.
//
// Word count was the weight, and a word is not a unit of time. The synthesiser
// reads at a roughly constant rate in SYLLABLES per second, not words per
// second, and the two only agree when every beat has the same average word
// length. This script is full of beats where they do not:
//
//   "Before the rating, go get yours at truemax.app."
//
// Eight whitespace-words, and the last of them is spoken "truemax dot app" —
// four syllables where the count says one. And:
//
//   "The verdict: Mogger. A very attractive male. Steph measures 7.2 out of 10."
//
// "7.2" is one whitespace-word and four syllables ("seven point two"); "10" is
// one and one. A beat whose words are heavier than the video's average is
// allocated less time than the voice takes to say it, and — this is the part
// that shows up on screen — every beat BEFORE it is allocated more, because the
// shares must sum to one. So the caption lags on the run-up and the lag is
// worst immediately before the heaviest lines.
//
// Those two beats are exactly where the lag was reported, which is what makes
// this the explanation rather than a plausible story about one. The mp3-silence
// fix removed the drift that grew steadily through the video; this removes the
// part that was never steady, and was always concentrated around the numbers.
//
// Syllables are estimated, not looked up. A dictionary would be better and is
// not worth a megabyte of one: vowel-group counting is wrong on a small
// fraction of English words, by one syllable, in both directions, and the
// weight only has to be right on AVERAGE across a twenty-word clause.
// ---------------------------------------------------------------------------

// zero one two three four five six seven eight nine
const DIGIT_SYLLABLES = [2, 1, 1, 1, 1, 1, 1, 2, 1, 1];

// Tens are their own shape rather than a rule: "twenty" is two and "seventy" is
// three, and there is no way to derive that from the digit.
const TENS_SYLLABLES = [0, 0, 2, 2, 2, 2, 2, 3, 2, 2];

// The teens, which follow neither pattern.
const TEEN_SYLLABLES: Record<string, number> = {
  "10": 1, "11": 1, "12": 2, "13": 2, "14": 2,
  "15": 2, "16": 2, "17": 3, "18": 2, "19": 2,
};

/** Syllables in an integer as it is actually read aloud. */
function integerSyllables(digits: string): number {
  const n = digits.replace(/^0+(?=\d)/, "");
  if (n.length === 1) return DIGIT_SYLLABLES[Number(n)] ?? 1;
  if (n.length === 2) {
    if (TEEN_SYLLABLES[n] !== undefined) return TEEN_SYLLABLES[n];
    const tens = TENS_SYLLABLES[Number(n[0])] ?? 2;
    return tens + (n[1] === "0" ? 0 : (DIGIT_SYLLABLES[Number(n[1])] ?? 1));
  }
  // Past two digits this script only ever says a percentile, and "a hundred" is
  // as close as an estimate needs to get. Read digit by digit as a floor.
  return [...n].reduce((total, d) => total + (DIGIT_SYLLABLES[Number(d)] ?? 1), 0);
}

/** Syllables in one whitespace-delimited token. */
function tokenSyllables(raw: string): number {
  // Punctuation that is heard as a pause rather than as sound.
  const token = raw.replace(/[,;:!?"'()]/g, "");
  if (!token) return 0;

  // A percentage is two words before it is anything else.
  if (token.includes("%")) return tokenSyllables(token.replace("%", "")) + 2;

  // A number, possibly decimal, possibly ordinal: "7.2", "10", "92nd", "1.62".
  const numeric = /^(\d+)(?:\.(\d+))?(st|nd|rd|th)?$/.exec(token);
  if (numeric) {
    const [, whole, fraction, ordinal] = numeric;
    let total = integerSyllables(whole);
    // An ordinal is the cardinal plus a syllable, near enough: "ninety-second",
    // "twelfth" is the exception and it costs a tenth of a second.
    if (ordinal) total += 1;
    // A decimal point is read "point" and the digits after it are read one at
    // a time — "seven point two", never "seven point twenty".
    if (fraction) {
      total += 1;
      for (const d of fraction) total += DIGIT_SYLLABLES[Number(d)] ?? 1;
    }
    return total;
  }

  // A dotted token that is not a number is an address, and every dot in it is
  // spoken. This is the whole of the truemax.app case.
  if (token.includes(".")) {
    const parts = token.split(".").filter(Boolean);
    const dots = token.split(".").length - 1;
    return parts.reduce((total, p) => total + tokenSyllables(p), 0) + dots;
  }

  // A word. Vowel groups, less a silent trailing e, floor of one — the standard
  // heuristic, and accurate enough at clause length.
  const word = token.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 1;
  const groups = word.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  // "male" is one syllable, not two. But "the" keeps its vowel, and a word of
  // three letters or fewer has nothing to give back.
  if (word.length > 3 && /[^aeiouy]e$/.test(word)) count -= 1;
  return Math.max(1, count);
}

/**
 * A line's share of the read, in units proportional to how long it takes to say.
 *
 * Exported because the timing is the half of this format that cannot be judged
 * by reading it, and a weight that silently goes wrong on numbers is exactly
 * the kind of thing that needs a test rather than a comment.
 */
export function spokenWeight(line: string): number {
  const tokens = line.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const token of tokens) total += tokenSyllables(token);
  return Math.max(1, total);
}

/** The un-scaled estimate. Callers want buildTimeline. */
function estimate(beats: Beat[]): TimedBeat[] {
  let cursor = 0;
  return beats.map((beat) => {
    const spoken = Math.max(MIN_BEAT, spokenWeight(beat.spoken ?? beat.line) / SYLLABLES_PER_SECOND);
    const duration = spoken + GAP;
    const timed: TimedBeat = { beat, start: cursor, duration };
    if (beat.metricId) timed.drawAt = cursor + duration * DRAW_AT;
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
export function fitTimeline(
  timeline: RundownTimeline,
  actualDuration: number,
  /**
   * Where the speech starts inside the audio file, in seconds.
   *
   * Not zero, because a synthesised mp3 opens with a little silence and the
   * beats have to start where the talking starts rather than where the file
   * does. See speechSpan in ui/rundownAudio.ts, which measures both ends —
   * actualDuration here is the length of the SPEECH, not of the file.
   */
  startAt = 0,
): RundownTimeline {
  if (!(actualDuration > 0) || !(timeline.duration > 0)) return timeline;

  // Re-allocate by WORD SHARE, rather than scaling the estimate by one factor.
  //
  // The old version multiplied every start and duration by
  // actualDuration / estimatedDuration. That is only correct if the estimate is
  // proportional to the real speech, and it is not, for two reasons that both
  // push the same way:
  //
  //   estimated_i = max(MIN_BEAT, words_i / 2.7) + GAP
  //
  // GAP is a flat 0.35s added to every beat, and MIN_BEAT is a floor. Both are
  // fixed costs, so they are a much larger share of a short beat than a long
  // one. The hook — "How attractive is Marlon?", four words — estimates at
  // 1.6 + 0.35 = 1.95s while the voice says it in about 1.3. The synthesiser
  // does not insert a third of a second of silence after every sentence, so
  // that surplus is not real; scaling preserves it as a proportion and hands
  // it back to the same short beats.
  //
  // The error does not cancel, it ACCUMULATES: every over-long early beat
  // pushes everything after it later, so the visuals fall further behind the
  // voice the longer the video runs. That is the drift — nothing is wrong at
  // the top and by the score beat the caption is a full sentence behind.
  //
  // Word share has none of that. The synthesiser reads at a roughly constant
  // rate through one request, so a beat's share of the words IS its share of
  // the duration, the allocations sum to exactly the audio length by
  // construction, and no error is left over to accumulate.
  const words = timeline.beats.map((b) => spokenWeight(b.beat.spoken ?? b.beat.line));
  const total = words.reduce((a, w) => a + w, 0);

  const beats: TimedBeat[] = [];
  let cursor = Math.max(0, startAt);
  const starts: number[] = [];
  timeline.beats.forEach((b, i) => {
    const duration = (words[i] / total) * actualDuration;
    starts.push(cursor);
    beats.push({
      ...b,
      start: cursor,
      duration,
      // drawAt keeps its position WITHIN the beat rather than being rescaled
      // from an absolute time that no longer means anything.
      drawAt: b.drawAt === undefined ? undefined : cursor + duration * DRAW_AT,
    });
    cursor += duration;
  });

  // Sound effects are re-derived rather than scaled, for the same reason: a cue
  // placed against the estimate is a cue placed against a beat boundary that
  // has just moved.
  // duration is where the beats END, which with an offset is not the same as
  // how long they run for. The renderer asks "which beat is playing at t" with
  // an absolute t, so an end that did not include the offset would send the last
  // few frames past the end of the timeline.
  return { duration: cursor, beats, sfx: cuesFor(beats) };
}

function cuesFor(timed: TimedBeat[]): SfxCue[] {
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
    // No sound on the curve.
    //
    // It had a downward swoop on the reasoning that the biggest frame in the
    // video deserved punctuation. Heard against the narration it is a noise
    // arriving over a sentence, and the frame is already the loudest thing on
    // screen — it does not need announcing. The keystroke and measurement cues
    // stay; they sit under the voice rather than across it.

  }
  sfx.sort((a, b) => a.at - b.at);
  return sfx;
}

export function buildTimeline(beats: Beat[]): RundownTimeline {
  const timed = estimate(beats);
  const duration = timed.reduce((total, b) => total + b.duration, 0);
  return { beats: timed, duration, sfx: cuesFor(timed) };
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

/** The beat playing at time t, or null outside the timeline. */
export function beatAt(timeline: RundownTimeline, t: number): TimedBeat | null {
  for (const b of timeline.beats) {
    if (t >= b.start && t < b.start + b.duration) return b;
  }
  return null;
}

/**
 * The beat to DRAW at time t. Never null while the timeline has any beats.
 *
 * A fitted timeline no longer starts at zero — it starts where the speech starts
 * inside the audio file, which is a few tens of milliseconds in. Those frames
 * belong to no beat, and the renderer's old fallback was "the last beat", which
 * would have opened the video on the sign-off card for a frame or two. Clamping
 * to the ends is what a viewer expects at both edges: hold the first frame
 * before the talking starts, hold the last one after it stops.
 */
export function beatNear(timeline: RundownTimeline, t: number): TimedBeat | null {
  const beats = timeline.beats;
  if (!beats.length) return null;
  const exact = beatAt(timeline, t);
  if (exact) return exact;
  return t < beats[0].start ? beats[0] : beats[beats.length - 1];
}
