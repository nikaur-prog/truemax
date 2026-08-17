// ---------------------------------------------------------------------------
// What Max says after the second scan, and the tenth.
//
// This is the thing the rest of the category cannot copy. Every face app will
// tell you your potential; none of them come back six weeks later and say
// whether you reached it. Telling somebody what to do is content. Telling them
// whether it worked is a product, and it needs exactly one thing nobody else
// collects: their own numbers over time.
//
// Three rules hold this together, and all three exist to stop it becoming the
// flattering nonsense it would otherwise decay into.
//
// 1. IT READS MEASUREMENTS, NOT INTENTIONS. The input is the score history and
//    what the person told us they were working on. Nothing here estimates,
//    infers, or generates a number. If the jaw score did not move, the jaw
//    score did not move, and no amount of encouragement changes the sentence.
//
// 2. IT IS ALLOWED TO SAY IT ISN'T WORKING. An app that only ever congratulates
//    you is an app you stop believing, and then stop opening. "Two months, no
//    measurable change, worth trying something else" is the most valuable
//    sentence in here and the one every competitor is structurally unable to
//    say, because they are selling the thing that isn't working.
//
// 3. IT NEVER PRESCRIBES. Max can say a routine has not moved a number and
//    suggest changing approach. It cannot name a dose, a drug, or a procedure.
//    "Two months, nothing moved, worth trying something different" is an
//    observation about data. "Lower your dose" is medical advice from a face
//    scanner, and the fact that it would often be correct is not the point.
//
// Deterministic templates, no model call. Same history, same words, every time
// — because a follow-up that reworded itself on each open would read as
// generated rather than observed, and the whole claim here is that it was
// observed.
// ---------------------------------------------------------------------------

export interface ScanPoint {
  // Milliseconds since epoch. Passed in rather than read from a clock so the
  // whole module is pure and a test can walk six months in four lines.
  at: number;
  overall: number;
}

export type FollowUpKind =
  | "too-soon"
  | "working"
  | "holding"
  | "stalled"
  | "slipping"
  | "maintaining";

export interface FollowUp {
  kind: FollowUpKind;
  headline: string;
  body: string;
  // True when the honest reading is "this approach has had long enough".
  // Surfaced separately so the UI can offer to revisit the plan rather than
  // burying the suggestion in a paragraph.
  suggestChange: boolean;
}

const DAY = 86_400_000;

// Below this, a difference is the instrument rather than the face.
//
// Two photographs of one unchanged face differ by about 1.3 points. This sat at
// 0.9 for exactly as long as scores passed through the 0.66 shrinkage, which
// compressed that spread to ~0.87 — the floor tracked the scale, correctly.
//
// The shrinkage has been retired (see scoring.ts), so the displayed spread is
// the raw 1.3 again and the floor has to come back with it. Leaving it at 0.9
// would be the dangerous direction of this error: a floor BELOW the real spread
// invents progress, cheerfully reporting a 1.0-point jump between two photos of
// a face that did not change. A floor above it merely hides slow progress.
//
// This is the single most important number in the file and it must move in step
// with the display scale, in both directions.
export const NOISE = 1.3;

// How long a routine gets before "no change" becomes a finding rather than
// impatience. Skin turns over in roughly six weeks and body composition shows
// on a face over a similar span, so eight weeks is past the point where a
// working approach should have shown something.
const LONG_ENOUGH_DAYS = 56;
const MIN_DAYS = 14;

function daysBetween(a: number, b: number): number {
  return Math.abs(b - a) / DAY;
}

// The comparison is first-versus-latest, not latest-versus-previous.
//
// Scan-to-scan deltas are dominated by noise at this instrument's precision, so
// a run of six scans compared pairwise produces five coin flips and a story
// that changes every week. Against the starting point, the noise is a fixed
// cost paid once and everything above it is signal.
export function followUp(history: ScanPoint[], goalLabel?: string): FollowUp {
  const scans = [...history].sort((a, b) => a.at - b.at);
  const first = scans[0];
  const last = scans[scans.length - 1];
  const goal = goalLabel ? ` on your ${goalLabel.toLowerCase()}` : "";

  if (scans.length < 2 || !first || !last) {
    return {
      kind: "too-soon",
      headline: "One scan is a number, not a trend.",
      body: "Scan again in a couple of weeks and this becomes a measurement of change rather than a snapshot. That second reading is where this stops being a score and starts being progress.",
      suggestChange: false,
    };
  }

  const days = daysBetween(first.at, last.at);
  const change = last.overall - first.overall;
  const weeks = Math.max(1, Math.round(days / 7));

  if (days < MIN_DAYS) {
    return {
      kind: "too-soon",
      headline: "Too close together to read yet.",
      body: `Both scans are inside ${Math.max(1, Math.round(days))} days of each other, and two photos of one unchanged face differ by about ${NOISE.toFixed(1)} points on their own. Give it a fortnight and the difference starts meaning something.`,
      suggestChange: false,
    };
  }

  if (change >= NOISE) {
    return {
      kind: "working",
      headline: `Up ${change.toFixed(1)} in ${weeks} weeks. That is a real move.`,
      body: `That is past the ${NOISE.toFixed(1)} points two photos of the same unchanged face differ by, so it is not the camera — something you are doing${goal} is showing up in the measurements. Keep the routine as it is; this is the part where people change things and lose the thread.`,
      suggestChange: false,
    };
  }

  if (change <= -NOISE) {
    return {
      kind: "slipping",
      headline: `Down ${Math.abs(change).toFixed(1)} over ${weeks} weeks.`,
      body: "Worth checking the boring explanations before the interesting ones: sleep, salt, alcohol and how recently you ate all move a face, and so does shooting in harder light than last time. If none of those apply, the routine is the next thing to look at.",
      suggestChange: days >= LONG_ENOUGH_DAYS,
    };
  }

  // Flat. What that means depends entirely on how long it has been flat for,
  // and on whether flat was the goal.
  if (days >= LONG_ENOUGH_DAYS) {
    return {
      kind: "stalled",
      headline: `${weeks} weeks, and the number has not moved.`,
      body: `Flat past two months is long enough to call. Nothing here is a failure${goal ? ` of yours${goal}` : ""} — it means this particular approach is not the lever for your face, and continuing it out of loyalty costs you the time a different one would have used. Worth rebuilding the plan around a different one.`,
      suggestChange: true,
    };
  }

  return {
    kind: "holding",
    headline: `Steady across ${weeks} weeks.`,
    body: `The change is inside the ${NOISE.toFixed(1)} points two photos of the same face differ by, so there is nothing to read either way yet. Most of what moves a face takes six to eight weeks to show. Keep going and check again.`,
    suggestChange: false,
  };
}

// Which regions actually moved — the sentence under the verdict that says
// where a change came from, or where a stall is hiding one.
//
// The overall can sit flat while a jaw climbs and a midface slips, and an app
// that only reads the average would call that "no change" — which is false in
// the way that matters most to somebody working on exactly one feature. Same
// rules as the overall read: first versus latest, a noise floor, and silence
// when there is nothing above it.

export interface RegionPoint {
  at: number;
  scores: Partial<Record<string, number>>;
}

// The per-region noise floor. There is still no measured retest spread per
// region, so this is bounded from below by arithmetic rather than data: a
// region averages a handful of metrics where the overall averages all of them,
// so a region reading cannot be LESS noisy than the overall's, and a test pins
// that ordering.
//
// It sat at 1.3 while the overall floor was 0.9 — the raw pre-shrinkage spread,
// used as a conservative stand-in. Retiring the shrinkage moved the overall
// floor to that same 1.3, which would have made a region exactly as trustworthy
// as the whole face. It is not: fewer measurements, more noise.
//
// 1.8 keeps the gap roughly proportional to what it was. Averaging four
// correlated metrics instead of thirty implies a wider ratio still, but a floor
// set too high only hides slow region progress, while one set too low INVENTS
// it — and on a sentence that names somebody's jaw specifically, inventing is
// much the worse failure. Provisional until the calibration set pins it.
export const REGION_NOISE = 1.8;

export interface RegionShift {
  region: string;
  change: number;
}

// First-vs-latest change per region, largest magnitude first, only shifts past
// the noise floor. Regions missing from either end are skipped rather than
// zero-filled — a region that was not measured did not "hold steady".
export function regionShifts(history: RegionPoint[]): RegionShift[] {
  const scans = [...history].sort((a, b) => a.at - b.at);
  const first = scans[0];
  const last = scans[scans.length - 1];
  if (scans.length < 2 || !first || !last) return [];
  if (daysBetween(first.at, last.at) < MIN_DAYS) return [];
  const shifts: RegionShift[] = [];
  for (const [region, then] of Object.entries(first.scores)) {
    const now = last.scores[region];
    if (typeof then !== "number" || typeof now !== "number") continue;
    const change = now - then;
    if (Math.abs(change) >= REGION_NOISE) shifts.push({ region, change });
  }
  return shifts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

// The sentence itself. Deterministic for the same reason the verdict is: a
// line that names your jaw has to say the same thing tomorrow. Returns null
// when nothing cleared the floor — no sentence beats a filler sentence.
export function regionNote(
  history: RegionPoint[],
  labels: Record<string, string>,
): string | null {
  const shifts = regionShifts(history);
  if (!shifts.length) return null;
  const name = (r: string) => (labels[r] ?? r).toLowerCase();
  const signed = (v: number) => `${v > 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}`;
  const up = shifts.filter((s) => s.change > 0);
  const down = shifts.filter((s) => s.change < 0);
  const list = (xs: RegionShift[]) =>
    xs.map((s) => `${name(s.region)} ${signed(s.change)}`).join(", ");
  if (up.length && down.length) {
    return `Region by region: ${list(up)}; ${list(down)}. The average hides both.`;
  }
  if (up.length) {
    return `The move is coming from specific features: ${list(up)}. The rest is inside measurement noise.`;
  }
  return `One place is doing the moving: ${list(down)}. The rest is inside measurement noise.`;
}

// A concern the person told us they had, which has since resolved.
//
// Separate from the score because it is a different kind of fact: the overall
// number can sit still while the one thing somebody actually cared about
// clears up, and saying nothing about that is the app failing to notice the
// only result that mattered to them.
//
// Note what the message does NOT do. It does not tell anyone to reduce, stop,
// or maintain a product, because that is a dosing instruction and this is a
// camera. It says the thing they were tracking has cleared, and that the
// question of what to do next is one for a pharmacist — which is true, and
// which is also the answer they would get from an honest person.
export function concernCleared(label: string, weeks: number): FollowUp {
  return {
    kind: "maintaining",
    headline: `Your ${label.toLowerCase()} has cleared.`,
    body: `${weeks} weeks ago you told us this was the thing you wanted to work on, and the measurements no longer show it. Worth knowing what worked, because that is information about your face specifically rather than about faces in general. If you are using anything for it, a pharmacist is the right person to ask about what happens now — we measure, we do not prescribe.`,
    suggestChange: false,
  };
}
