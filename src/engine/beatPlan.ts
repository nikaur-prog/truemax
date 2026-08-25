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
// First, then last, then inward — so a single spare beat lengthens the
// opening shot rather than an arbitrary middle one.
function endsFirst(count: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < count; i++) order.push(i % 2 === 0 ? i / 2 : count - 1 - (i - 1) / 2);
  return order.map(Math.floor);
}

function share(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const out = new Array<number>(count).fill(base);
  let left = total - base * count;
  const order = endsFirst(count);
  for (let i = 0; left > 0 && i < order.length; i++, left--) out[order[i]]++;
  // More clips than beats: the tail gets nothing, and the caller is told by
  // being handed fewer cuts than clips rather than by a zero-length cut.
  return out;
}

/**
 * Like share(), but some clips have asked for a specific length.
 *
 * A pin is a request, not a law: the counts must still sum to EXACTLY
 * `total`, or the last cut drifts off the grid. When the pins over-ask, the
 * largest pinned clip gives beats back first (never below one) — trimming
 * the most indulgent request is the cut a human editor would make. When
 * beats are left over they go to the unpinned clips ends-first, and only
 * when every clip is pinned do the pins themselves stretch, because a spare
 * beat has to live somewhere and silence is not an option.
 */
export function shareWithPins(total: number, pins: ReadonlyArray<number | null>): number[] {
  const count = pins.length;
  if (count <= 0) return [];
  if (pins.every((p) => p == null)) return share(total, count);
  const counts = pins.map((p) => (p != null ? Math.max(1, Math.round(p)) : 1));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum > total) {
    let idx = -1;
    let best = 1;
    counts.forEach((c, i) => {
      if (pins[i] != null && c > best) { best = c; idx = i; }
    });
    if (idx < 0) {
      counts.forEach((c, i) => {
        if (c > best) { best = c; idx = i; }
      });
    }
    if (idx < 0) break; // everything already at one beat; total < count
    counts[idx]--;
    sum--;
  }
  if (sum < total) {
    const unpinned: number[] = [];
    pins.forEach((p, i) => { if (p == null) unpinned.push(i); });
    const targets = unpinned.length ? unpinned : counts.map((_, i) => i);
    const extra = total - sum;
    const base = Math.floor(extra / targets.length);
    for (const i of targets) counts[i] += base;
    let left = extra - base * targets.length;
    const order = endsFirst(targets.length);
    for (let k = 0; left > 0 && k < order.length; k++, left--) counts[targets[order[k]]]++;
  }
  return counts;
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
  /**
   * Per-clip beat requests, in clip order; null means "the pace decides".
   *
   * This is how a clip is SLOWED DOWN rather than sped up: ask for more
   * beats and the cut simply holds longer on the music. Pins grow the
   * window in pace mode (each clip contributes its pin instead of the
   * pace), and inside a fixed window they are honoured as far as whole
   * beats allow — see shareWithPins.
   */
  beatOverrides?: ReadonlyArray<number | null>;
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
  const pins: Array<number | null> =
    opts.beatOverrides?.slice(0, clipCount).map((p) => (p != null ? Math.max(1, Math.round(p)) : null)) ??
    new Array<number | null>(clipCount).fill(null);
  while (pins.length < clipCount) pins.push(null);
  const minBeats = pins.reduce<number>((a, p) => a + (p ?? 1), 0);

  // At least one beat per clip either way: a clip that gets none is a clip the
  // person attached and never sees. Rounded to whole beats whatever produced
  // it — a fractional total cannot be tiled by whole-beat clips, and the
  // integer shares then summed PAST the stated duration, running the last cut
  // off the end of the music window it claimed to fill.
  //
  // In pace mode each clip contributes its pin (or the pace); in fit mode
  // the window can only GROW to fit the pins, never shrink a pin to fit the
  // window silently — a clip somebody lengthened on purpose and the panel
  // quietly cut back down is the edit arguing with its editor.
  const paceTotal = pins.reduce<number>((a, p) => a + (p ?? beatsPerClip), 0);
  const totalBeats = Math.max(
    clipCount,
    minBeats,
    Math.round(opts.totalBeats != null ? Math.max(opts.totalBeats, minBeats) : paceTotal),
  );
  const cuts: ClipCut[] = [];

  // No usable drop: one stretch, even share, remainder to the ends. A drop
  // with a single clip is unusable too — there is nothing to cut TO it from,
  // and honouring it started the only clip mid-window with dead air ahead.
  const dropBeat =
    opts.dropAt != null
      ? Math.round((opts.dropAt - start) / grid.period)
      : null;
  const useDrop = dropBeat != null && dropBeat > 0 && dropBeat < totalBeats && clipCount >= 2;

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

  let finalBeats = totalBeats;
  if (!useDrop) {
    emit(0, 0, shareWithPins(totalBeats, pins));
  } else {
    // Two solves. The split point is a beat, so neither half can drag the
    // reveal off it — the pre-drop clips fill exactly the beats before, the
    // post-drop clips exactly the beats after.
    //
    // The requested split is honoured only as far as the beats can carry it.
    // Each half must hold at least one beat PER CLIP it is given, or share()
    // hands zero-beat clips back and the render silently loses them: a drop
    // two beats in with five clips asked for before it produced five cuts for
    // eight clips, with a hole where three of them should have been. The
    // clamp below is always satisfiable — totalBeats >= clipCount and the
    // drop is strictly inside the window, so [lo, hi] cannot be empty.
    const lo = Math.max(1, clipCount - (totalBeats - dropBeat));
    const hi = Math.min(clipCount - 1, dropBeat);
    const before = Math.min(hi, Math.max(lo, opts.clipsBeforeDrop ?? Math.floor(clipCount / 2)));
    // The beats BEFORE the drop are fixed by where the drop is — pins on that
    // side are honoured as far as those beats allow and no further, because
    // the reveal moving off the drop to make room is the one trade this
    // planner exists to refuse. The AFTER side can grow: pins there extend
    // the window's end, which is the same music playing longer.
    const afterPins = pins.slice(before);
    const afterTotal = Math.max(
      totalBeats - dropBeat,
      afterPins.reduce<number>((a, p) => a + (p ?? 1), 0),
    );
    finalBeats = dropBeat + afterTotal;
    emit(0, 0, shareWithPins(dropBeat, pins.slice(0, before)));
    emit(before, dropBeat, shareWithPins(afterTotal, afterPins), 0);
  }

  const duration = finalBeats * grid.period;
  return {
    cuts,
    duration,
    songStart: start,
    songEnd: start + duration,
    bpm: grid.bpm,
    beatsPerClip,
  };
}
