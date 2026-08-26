// ---------------------------------------------------------------------------
// Which colour a score is.
//
// Three bands, one rule, used everywhere a number is shown as a number: the
// view cards on the report, and the blurred preview in the signup dialog.
// It was written inline in results.ts, which was fine while one screen used
// it and would not have survived a second — two copies of a threshold drift,
// and the day they disagree the same face reads amber in one place and green
// in another.
//
// The cut points are 6.5 and 4.5 on the ten-point scale, which is roughly the
// top quarter and the bottom quarter of where real faces land: high enough
// that "green" means something, low enough that "red" is not most people.
// ---------------------------------------------------------------------------

export type ScoreTone = "hi" | "mid" | "lo";

export function scoreTone(score: number): ScoreTone {
  if (score >= 6.5) return "hi";
  if (score >= 4.5) return "mid";
  return "lo";
}
