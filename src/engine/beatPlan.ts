import type { BeatGrid } from "./beats.js";
import { nearestDownbeat } from "./beats.js";

// ---------------------------------------------------------------------------
// How long is each clip? The music decides.
//
// The old Reel Creator asked for a duration per clip, which is the wrong
// question asked of the wrong person: a cut that lands 80ms off the beat reads
// as a mistake no matter how carefully the number was chosen, and nobody can
// pick that number by eye. So clips are not measured in seconds here. They are
// measured in BEATS, and seconds fall out of the tempo.
//
// That inverts the workflow in the one way that makes it usable: you say how
// many clips you have, the song says how long each one is, and the tool tells
// you how much of the song to hand it. You are never asked to guess a length.
//
// UNEVEN COUNTS. Beats rarely divide evenly by clips, and the leftovers are not
// smeared as fractions — a fractional beat is exactly the off-by-a-hair cut
// this exists to prevent. They go to the FIRST and LAST clip, in that order,
// because an opening shot that breathes and a closing shot that lands are what
// a longer clip is worth; a longer clip in the middle just reads as a stall.
//
// THE DROP. If a drop is marked, it is not "near" a cut — it IS one. The
// timeline is solved as two independent stretches, before and after, each
// getting its own share of the clips, so the reveal lands on the drop exactly
// and neither half drifts to make it fit.
// ---------------------------------------------------------------------------

export interface ClipCut {
  /** Index into the caller's clip list. */
  clip: number;
  /** Seconds from the start of the exported reel. */
  start: number;
  end: number;
  /** Whole beats this clip is held for — what makes the cut land on the music. */
  beats: number;
  /** True for the clip that begins on the marked drop. */
  onDrop?: boolean;
}

export interface BeatPlan {
  cuts: ClipCut[];
  /** Total reel length in seconds. */
  duration: number;
  /** Where the song window starts, in the song's own timeline. */
  songStart: number;
  songEnd: number;
  bpm: number;
  /** Beats each clip is held for, before the first/last remainder is added. */
  beatsPerClip: number;
}

/**
 * How much song to cut out, for a given number of clips.
 *
 * This is the number the UI shows before the user goes hunting through the
 * track: "give me 11.3 seconds". Reported in beats as well, because a musician
 * picking a section thinks in bars and 24 beats is six bars.
 */
export function suggestWindow(
  bpm: number,
  clipCount: number,
  beatsPerClip: number,
  beatsPerBar = 4,
): { seconds: number; beats: number; bars: number } {
  const beats = Math.max(1, clipCount) * Math.max(1, beatsPerClip);
  return {
    seconds: (beats * 60) / bpm,
    beats,
    bars: beats / beatsPerBar,
  };
}

/**
 * The beats-per-clip that best fills a window the user has already chosen.
 *
 * The other direction of the same formula, for when somebody has a specific
 * 20 seconds they want and a pile of clips to fit into it. Returns the whole
 * number of beats per clip that comes closest without going over, floored at
 * one — a clip shorter than a beat is a flash frame, not an edit.
 */
export function beatsPerClipFor(grid: BeatGrid, windowSeconds: number, clipCount: number): number {
  return Math.max(1, Math.floor(beatsIn(grid, windowSeconds) / Math.max(1, clipCount)));
}

/**
 * The whole beats that fit inside a chosen number of seconds.
 *
 * The epsilon is not decoration: a window derived from a beat count and then
 * measured back in seconds lands a hair under its own length in floating point,
 * and a bare floor would drop the final beat of the section every time.
 */
export function beatsIn(grid: BeatGrid, seconds: number): number {
  if (!(grid.period > 0)) return 0;
  return Math.max(0, Math.floor(seconds / grid.period + 1e-6));
}

/**
 * Spread `total` beats across `count` clips as whole numbers.
 *
 * Even share to everyone, remainder to the ends. Deliberately not a rounding
 * loop: every clip must get an integer, and they must sum to exactly `total`,
 * or the last cut drifts off the grid the whole exercise exists to hit.
 */
function share(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const out = new Array<number>(count).fill(base);
  let left = total - base * count;
  // First, then last, then inward — so a single spare beat lengthens the
  // opening shot rather than an arbitrary middle one.
  const order: number[] = [];
  for (let i = 0; i < count; i++) order.push(i % 2 === 0 ? i / 2 : count - 1 - (i - 1) / 2);
  for (let i = 0; left > 0 && i < order.length; i++, left--) out[Math.floor(order[i])]++;
  // More clips than beats: the tail gets nothing, and the caller is told by
  // being handed fewer cuts than clips rather than by a zero-length cut.
  return out;
}

export interface PlanOptions {
  grid: BeatGrid;
  clipCount: number;
  /** How many beats each clip is held for. 2 is the default reel pace. */
  beatsPerClip?: number;
  /**
   * Fill exactly this many beats, ignoring `beatsPerClip`.
   *
   * For the other way round: somebody with a specific section in mind says how
   * long it is, and the clips divide it. Dividing by the clip count and
   * rounding down would leave the tail of the section unused — at 124 BPM a
   * twenty-second window is 41 beats, and six clips of six beats covers 36 of
   * them, ending two and a half seconds early on a section that was chosen for
   * where it ENDS as much as where it starts. Here the remainder is shared out
   * instead, so the window is filled to the beat.
   */
  totalBeats?: number;
  /** Where in the song the window begins. Snapped to a bar start. */
  songStart: number;
  /**
   * Where the drop is, in the song's own timeline. The clip that starts here
   * is the reveal. Snapped to the nearest beat; ignored if outside the window.
   */
  dropAt?: number;
  /** How many clips play BEFORE the drop. Defaults to half, rounded down. */
  clipsBeforeDrop?: number;
}

/**
 * Turn clips plus a song into a cut list.
 *
 * Every returned time is a beat time, never an interpolation between two — the
 * cuts are on the grid by construction rather than by rounding at the end.
 */
export function planBeatCuts(opts: PlanOptions): BeatPlan {
  const { grid, clipCount } = opts;
  const beatsPerClip = Math.max(1, opts.beatsPerClip ?? 2);
  const start = nearestDownbeat(grid, opts.songStart);

  // At least one beat per clip either way: a clip that gets none is a clip the
  // person attached and never sees.
  const totalBeats = Math.max(
    clipCount,
    opts.totalBeats != null ? Math.round(opts.totalBeats) : clipCount * beatsPerClip,
  );
  const cuts: ClipCut[] = [];

  // No usable drop: one stretch, even share, remainder to the ends.
  const dropBeat =
    opts.dropAt != null
      ? Math.round((opts.dropAt - start) / grid.period)
      : null;
  const useDrop = dropBeat != null && dropBeat > 0 && dropBeat < totalBeats;

  const emit = (clipFrom: number, beatFrom: number, counts: number[], dropIndex?: number) => {
    let at = beatFrom;
    counts.forEach((beats, i) => {
      if (beats <= 0) return;
      cuts.push({
        clip: clipFrom + i,
        start: at * grid.period,
        end: (at + beats) * grid.period,
        beats,
        ...(dropIndex === i ? { onDrop: true } : {}),
      });
      at += beats;
    });
  };

  if (!useDrop) {
    emit(0, 0, share(totalBeats, clipCount));
  } else {
    // Two solves. The split point is a beat, so neither half can drag the
    // reveal off it — the pre-drop clips fill exactly the beats before, the
    // post-drop clips exactly the beats after.
    const before = Math.min(
      Math.max(1, opts.clipsBeforeDrop ?? Math.floor(clipCount / 2)),
      clipCount - 1,
    );
    const after = clipCount - before;
    emit(0, 0, share(dropBeat, before));
    emit(before, dropBeat, share(totalBeats - dropBeat, after), 0);
  }

  const duration = totalBeats * grid.period;
  return {
    cuts,
    duration,
    songStart: start,
    songEnd: start + duration,
    bpm: grid.bpm,
    beatsPerClip,
  };
}
