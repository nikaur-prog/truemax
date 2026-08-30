import { aggregateScoreToPercentile } from "./scoring.js";
import { statedPct } from "./precision.js";
import type { Sex } from "./types.js";
import { DISPLAY_NOISE } from "./history.js";

// ---------------------------------------------------------------------------
// What a number on this scale actually means.
//
// The scale is a population curve: 5.0 is the median face by construction (see
// aggNorm.ts), and a point is 1.3 standard deviations wide (SCORE_SCALE). That
// makes it tight — two thirds of everybody lands inside about two points — and
// tightness is the whole problem this module exists to fix.
//
// A reader who has never met a curve reads "6.1" against the only ten-point
// scale they own, which is school. On that scale six is a pass you would not
// tell anyone about. On this one it is roughly one person in five. The number
// is the same; the two readings are nothing alike, and the gap between them is
// where every offended tester has landed.
//
// The fix is not a second, kinder scale — that would be the same lie as a
// harsh one, and analysisMode.ts already refuses it for the verdict wording.
// The fix is that a number never appears without the thing that makes it
// legible. This module is the one place that translation is written, so the
// grid, the verdict, the explainer and the share card cannot drift apart.
//
// Everything here is DERIVED, never typed in. The ladder below is computed by
// inverting the same display curve the score came from, so if SCORE_SCALE, the
// soft floor or the quantile tables ever move, the copy moves with them and
// nobody has to remember to update a sentence.
// ---------------------------------------------------------------------------

// The score a given percentile lands on. Inverts aggregateScoreToPercentile by
// bisection — that function is itself a bisection over the display curve, so
// there is no closed form to prefer and the cost is irrelevant at this scale.
export function scoreAtPercentile(target: number): number {
  let lo = 0.5;
  let hi = 9.9;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (aggregateScoreToPercentile(mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

// Where the middle of the population actually sits. Quoted to one decimal
// because that is the resolution the score itself is shown at.
//
// Note this is deliberately the middle 68% and not the middle 95%. The 95%
// band runs from about 3.6 to 7.5, which is so wide it stops doing the job —
// it reads as "anything is normal" and tells nobody where they stand. The
// one-sigma band is the honest version of "most people".
export const SPREAD = {
  low: scoreAtPercentile(16),
  median: scoreAtPercentile(50),
  high: scoreAtPercentile(84),
};

// How many people you would need to see one scoring at least this well.
//
// Computed from the STATED percentile, not the raw one, so the rarity on
// screen and the percentile on screen are the same fact. Quoting "1 in 13" off
// a percentile shown as "top 10%" invites the reader to catch the product
// contradicting itself over rounding it already admitted to.
export function oneInN(pct: number): number {
  const shown = statedPct(pct);
  const rest = shown >= 50 ? 100 - shown : shown;
  return Math.max(2, Math.round(100 / Math.max(1, rest)));
}

// The canonical "1 in N" phrase, and the only place that wording is built.
//
// ui/templates.ts delegates to this. It used to own a second copy that worked
// off the RAW percentile, which put "1 in 8" in the full report and "1 in 10"
// in the basic grid for one unchanged face — the same drift statedPct exists
// to prevent, reintroduced one layer up.
//
// Past the resolution of the reference set the denominator is dropped rather
// than sharpened. A hundred-odd faces cannot express "1 in 400", and inventing
// the digit is the specific way a measurement product loses trust.
// "1 in N" is only honest in the tail, and that is not a rounding nicety.
//
// Stated percentiles land on multiples of five, and most of those do not
// divide a hundred: the 55th percentile is the top 45%, which "1 in 2" renders
// as the top 50%. Five points of drift, printed next to a chip that just said
// 45%, reads as the product not knowing its own answer rather than as
// arithmetic. So the fraction is used only where it lands exactly — rest of
// 50, 25, 20, 10 or 5 — and everywhere else the percentage says it directly.
//
// The returned string is a QUANTIFIER dropped in front of "faces": "1 in 8
// faces", "45% of faces", "the top 1%". Callers do not add "of".
export function rarityPhrase(pct: number): string {
  const shown = statedPct(pct);
  if (shown >= 99) return "the top 1%";
  const rest = shown >= 50 ? 100 - shown : shown;
  // ALWAYS the percentage, never the fraction.
  //
  // This used to return "1 in 10" wherever the percentage divided exactly,
  // and this function feeds a person's own report: "Roughly 1 in 10 male
  // faces measure this way", printed under their score. That is the sentence
  // CLAUDE.md bars, which says a rarity is never stated about a PERSON. The
  // fraction is what makes it about them; the percentage is the same fact in
  // the language the rest of the product already uses, next to "Top 10%" and
  // "30% of faces come in above you".
  //
  // The scale note's ladder is unaffected and stays: it reads oneInN directly
  // through LADDER, and it describes the rungs of the curve before anybody has
  // seen their own number, which is the exception the rule names.
  return `${rest}% of`;
}

// The compact form, for a grid cell rather than a sentence.
//
// Fraction or percentage is not a house-style choice, it is per-value, because
// the two forms fail in opposite places. "Top 10%" is punchy and "Top 45%" is
// limp — a percentage gets weaker as it approaches the middle, until it is
// saying nothing. A fraction stays concrete all the way down ("1 in 2" is just
// true), but only where it divides exactly: "1 in 7" quietly claims 14.3% when
// the number on screen beside it says 15%.
//
// So the fraction is used where it is faithful and the percentage everywhere
// else, which puts the visceral form on precisely the values worth being
// visceral about — 1 in 4, 1 in 5, 1 in 10, 1 in 20.
//
// Below the median it stays a percentage regardless. "1 in 3" there would need
// a "lower" hung off it to avoid reading as an achievement, and a grid cell has
// no room for the qualifier that stops it being a lie.
export function rarityShort(pct: number): string {
  const shown = statedPct(pct);
  if (shown >= 99) return "Top 1%";
  if (shown < 50) return `Ahead of ${shown}%`;
  // "Top N%", never "1 in N", for the reason given on rarityPhrase above: this
  // labels a person's own cell. The comment block below explains why the
  // fraction was chosen originally and it is a good argument about legibility,
  // which is why it is kept rather than deleted; it is simply outranked by the
  // rule about what may be said to somebody about their own face.
  return `Top ${100 - shown}%`;
}

// The one line that does the most work in the product.
//
// Symmetric on purpose. Above the median it reads "1 in 8 measure this high",
// below it "1 in 8 measure this low" — same construction, same tone, no
// commiseration on one side and no congratulation on the other. The instrument
// does not change its voice depending on whether the answer flatters you.
export function rarityLine(pct: number): string {
  const q = rarityPhrase(pct);
  if (q === "the top 1%") return "This is the top 1% of the reference set.";
  const dir = statedPct(pct) >= 50 ? "high" : "low";
  // rarityPhrase now always returns the "N% of" shape, so the bare-fraction
  // branch this used to carry ("About 1 in 8 measure this high") is gone with
  // it rather than left behind as an unreachable alternative.
  return `About ${q} people measure this ${dir}.`;
}

// "Two thirds of men measure between 4.1 and 6.3."
//
// The single most useful sentence available, because it is the one that
// contradicts the school reading directly: a reader who thinks 6 is mediocre
// learns in nine words that 6 is outside where two thirds of people live.
export function spreadLine(sex: Sex): string {
  const group = sex === "male" ? "men" : "women";
  return `Two thirds of ${group} measure between ${SPREAD.low.toFixed(1)} and ${SPREAD.high.toFixed(1)}.`;
}

// The ladder shown in the explainer: what the round numbers are worth.
//
// Starts at the median, because the point being made is how fast the scale
// gets steep above it. Stops at 8 for a reason worth writing down: on the raw
// curve a 9 is about one in a thousand, but precision.ts rounds every stated
// percentile to the nearest five and clamps at 99, so the product cannot say
// "one in a thousand" without claiming a resolution its hundred-face reference
// set does not have. Above the 99th percentile the honest statement is "rarer
// than 1 in 100, and this sample cannot tell you how much rarer".
//
// `capped` marks a rung the reference sample cannot resolve past — the honest
// reading is a bound rather than a count. That much is right and is why the
// flag exists.
//
// What it does NOT license is a bound in the flattering direction, and for a
// long time every rung here leaned that way. The ladder was built on `oneInN`,
// which reads the STATED percentile — rounded to the nearest five, because a
// report has to quote the same figure as the chip beside it. On a report that
// is correct. On this ladder there is no chip beside it, and the rounding was
// pure inflation:
//
//   score   true percentile   true 1-in-N   was shown as
//     6.0        77.90            4.5          1 in 5
//     7.0        93.80           16.1          1 in 20
//     8.0        98.90           90.9          1 in 100
//
// Three rungs, all overstated, all in the direction that makes a reader's
// score look rarer than it is — on the one screen whose entire job is telling
// them what the number is worth. The 8.0 rung was the worst of it: the comment
// that used to sit here already recorded that 1 in 91 was being printed as
// 1 in 100, and the fix went into the WORDING while the number stayed. The
// prose two paragraphs below it in the primer said "around one in ninety" at
// the same time, so one card showed the same fact as both 90 and 100.
//
// The floored raw values were tried and reverted, on purpose and on request.
// They read 1 in 2 / 4 / 16 / 90, which is more accurate and materially harder
// to hold in your head — and this ladder exists to be understood in thirty
// seconds by somebody who has just been handed a number about their face. A
// rung nobody parses teaches nothing, however correct it is.
//
// So it is back on `oneInN`, which reads the STATED percentile and therefore
// lands on round numbers: 2, 5, 20, 100. The overstatement is real and small —
// an 8.0 is about 1 in 91 and is shown as 1 in 100 — and it is bounded by the
// same five-point rounding every percentile on every screen already uses, so
// the ladder now agrees with the rest of the product rather than being the one
// place quoting a sharper figure.
//
// What does NOT come back is the contradiction. The prose beside the ladder
// used to hardcode "around one in ninety" next to a rung reading 1 in 100 —
// one card, one fact, two numbers. scaleNote reads its figures out of LADDER
// now, so whatever this returns is what the sentence says.
//
// `capped` still marks where statedPct clamps, which is the point past which
// the product stops quoting counts at all — 8 is where we stop counting, not
// where the faces stop. On the raw curve a 9 is about 1 in 1000, and a
// hundred-odd reference faces per sex cannot support three digits of
// resolution. Derived rather than hardcoded, so a larger reference set grows
// the ladder a real rung instead of keeping a stale ceiling.
export const LADDER: Array<{ score: number; oneIn: number; capped: boolean }> = [5, 6, 7, 8].map(
  (score) => {
    const pct = aggregateScoreToPercentile(score);
    return { score, oneIn: oneInN(pct), capped: statedPct(pct) >= 99 };
  },
);

// Why the reader should not take one reading to heart.
//
// This is not hedging for its own sake. VALIDITY.md §1 measured it: every
// shippable-licence photograph of one person, scored on the current calibrated
// display, moves about ±0.6 points on a face that did not change. A person
// upset by a single number is reacting
// to something the instrument cannot resolve, and telling them so is both the
// honest thing and the thing most likely to defuse it.
export const PHOTO_VARIANCE = DISPLAY_NOISE;

export function varianceLine(): string {
  return `One photograph is not a verdict: across many photographs of the same
    unchanged face this score moves by about ±${PHOTO_VARIANCE.toFixed(1)}. Rescan on a
    different day before you believe any single reading of it.`;
}
