import type { RegionScore, Report, ScoredMetric, Sex } from "../engine/types.js";
import { REGION_NAMES, regionIsScored } from "../engine/scoring.js";
import { distFor } from "../engine/metrics.js";
import { REFERENCE_N as ENGINE_REFERENCE_N, statedPct } from "../engine/precision.js";
import { rarityPhrase } from "../engine/rarity.js";
import type { AdviceChannel } from "../engine/goals.js";
import { DISPLAY_NOISE } from "../engine/history.js";
import type { ScanDelta } from "../engine/history.js";
import { RELIABLE_MIN, reliabilityOf } from "../engine/reliability.js";

// Deterministic explanation engine. No LLM, no randomness: banded templates
// with the actual computed numbers interpolated in. Every sentence must
// reference a real measurement — zero generic filler.

// What each metric *means*. Every entry is a noun phrase that completes the
// sentence "It measures ___", so the summary can introduce it with ordinary
// punctuation. They used to be written to slot after an em-dash, which is why
// a few were clauses rather than phrases and why the summaries were stitched
// together with dashes end to end.
const TRAITS: Record<string, string> = {
  canthalTilt: "the angle between the inner and outer eye corners",
  eyeAspectRatio: "the height of the visible eye opening relative to its width",
  eyeSeparationRatio: "how the eyes sit across the face's width",
  intercanthalEyeWidth: "eye spacing, counted in eye-widths",
  browPosition: "brow height relative to the eyes",
  browTilt: "the rise of the brow from inner to outer end",
  fwhr: "upper-face width relative to the measured upper-face height",
  midfaceRatio: "the compactness of the midface",
  cheekboneHeight: "where the face carries its widest point",
  jawCheekRatio: "the jaw base measured against the cheekbones",
  gonialProxy: "how sharply the jaw turns at its corner",
  jawFrontalAngle: "the squareness of the jaw's base",
  chinHeightRatio: "the chin's share of the lower third",
  philtrumChinRatio: "the balance of chin against philtrum",
  chinWidthRatio: "chin width against the jaw base",
  lowerFacePct: "the lower face's share of total height",
  noseMouthRatio: "nose width played against mouth width",
  noseIntercanthal: "nose width against the space between the eyes",
  nasalIndex: "nose width against nose length",
  lipRatio: "lower-lip fullness against the upper lip",
  mouthIPD: "mouth width against pupil spacing",
  lipHeightLowerThird: "how much of the lower third the lips claim",
  mouthCornerTilt: "whether the corners sit above or below the lip line",
  topThirdEst: "the forehead's share of face height",
  middleLowerBalance: "midface length against lower-face length",
  fifthsEyeRatio: "eye width against total face width",
  facialIndex: "face length against face width",
  mirrorDeviation: "how far paired landmarks sit from perfect mirror symmetry",
  canthalAsymmetry: "the tilt difference between your two eyes",
  eyeMouthParallel: "whether the mouth line runs parallel to the eye line",
  midlineDeviation: "how far the center features drift off the facial midline",
  // Side-profile metrics. These were missing, and the merged report puts front
  // and side measurements into the same regions — so the summary for Midface
  // reached for a trait that did not exist and printed the word "undefined"
  // into the sentence. See the lookup below, which now cannot do that again.
  gonialAngle: "how sharply the jaw turns at the corner, seen from the side",
  ramusMandible: "the vertical arm of the jaw against its horizontal one",
  submentalCervical: "the angle under the chin where it meets the neck",
  mandibularPlane: "the slope of the jawline from corner to chin",
  chinProjection: "how far the chin sits forward of the facial plane",
  chinRecession: "how far the chin sits back from the line of the lips",
  facialConvexity: "the profile's bend from brow to nose base to chin",
  totalFacialConvexity: "the same bend measured to the nose tip instead",
  nasofrontalAngle: "the angle where the brow meets the bridge of the nose",
  nasolabialAngle: "the angle between the nose base and the upper lip",
  nasalProjection: "how far the nose stands off the face",
  upperLipELine: "the upper lip against the nose-to-chin line",
  lowerLipELine: "the lower lip against the same line",
  lowerThirdDepth: "the depth of the lower face in profile",
  foreheadSlope: "how far the forehead slopes back from vertical",
  midfaceRatioSide: "the depth of the midface, which only the profile shows",
};

// A metric with no entry above must never reach the page. It used to: the
// summary interpolated TRAITS[id] directly, so an unlisted metric printed
// "undefined" mid-sentence in front of the user.
function traitOf(id: string): string {
  return TRAITS[id] ?? "a measured proportion of the face";
}

// The detail view opens one measurement at a time and leads with what it IS,
// so the trait phrases get a public door. Same fallback, same guarantee: no
// metric id can ever put the word "undefined" on the page.
export function metricTrait(id: string): string {
  return traitOf(id);
}

// "About 100% of faces score higher" is not a measurement, it is a rounding
// artefact. The reference set is a sample: it cannot establish that literally
// every face scores higher, and a round 100 reads as a verdict rather than as
// the bottom of a range. Anything that rounds past 99 is reported as "more
// than 99%", which is what the data actually supports.
//
// Exported so the region rarity line in results.ts says it the same way; two
// copies of this rounding is how one of them ends up printing 100 again.
export function scoreHigherText(percentile: number): string {
  const above = 100 - percentile;
  return above >= 99 ? "more than 99%" : `${Math.round(above)}%`;
}

// THE MEASUREMENT, OR THE HONEST ABSENCE OF ONE.
//
// `m.value.toFixed(...)` on its own is why the Midface tab rendered blank.
// Pixel-derived measurements are allowed to be unavailable — hairline detection
// refuses rather than guesses when there is no step to find, which is correct —
// and scoreMetric marks those `implausible` and excludes them from every
// aggregate. What nothing did was stop the row from trying to PRINT one. The
// value is undefined, `.toFixed` throws, and the throw lands mid-innerHTML, so
// the whole analysis pane comes back empty. foreheadRatio is the only exempted
// metric and it lives in midface, which is why exactly one tab was dead.
//
// An em dash rather than a hidden row, and rather than a substituted number.
// Dropping the row would make the same region show four measurements on one
// photograph and five on the next with no explanation; inventing a value would
// put a fabricated measurement in a product sold on not fabricating them.
export function fmt(m: ScoredMetric): string {
  if (!Number.isFinite(m.value)) return "–";
  return `${m.value.toFixed(m.def.decimals)}${m.def.unit}`;
}

/** Whether this metric produced a reading at all. */
export function wasMeasured(m: ScoredMetric): boolean {
  return Number.isFinite(m.value);
}

function fmtMean(m: ScoredMetric, sex: Sex): string {
  return `${distFor(m.def, sex).mean.toFixed(m.def.decimals)}${m.def.unit}`;
}

const sexNoun = (sex: Sex) => (sex === "male" ? "male" : "female");

// ---------------------------------------------------------------------------
// Report reads lead with the supplied result. Reopening a report or changing
// tabs is not a new conversation, and a higher score is not proof of progress.
// ---------------------------------------------------------------------------
export type CoachTrend = "up" | "down" | "flat";

// The chip threshold (results.ts deltaChip) reused so the voice and the chips
// never disagree about whether a number moved.
export function trendOf(delta: number | null | undefined): CoachTrend {
  if (delta == null) return "flat";
  return delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
}

// Where a reading sits, as a band of the reference set.
//
// This replaced "ahead of 85 in every 100 guys" and "only 3 in every 100 guys
// are below you there". Both were a count of people arranged around the
// reader, which is the rarity-about-a-person sentence CLAUDE.md bars, and both
// printed a raw percentile next to a chip that had just rounded the same
// number to a band of five. One rule now: the band comes from standing(), the
// same function the chip and the curve read, so the three cannot disagree.
function bandOf(pct: number, sex: Sex): string {
  const s = standing(pct);
  return `${s.top ? "top" : "bottom"} ${s.pct}% of the ${sexNoun(sex)} reference set`;
}

export function regionSummary(
  r: RegionScore,
  sex: Sex,
  // Retained for callers that also carry voice context. Region text itself
  // stays factual and does not repeat a name, greeting or history claim.
  voice?: { name?: string; delta?: number | null },
): string {
  // Only what was actually read. An unmeasured metric has a NaN z, which sorts
  // unpredictably and can land at either end — so the sentence would name the
  // one measurement that does not exist as the region's best or its weakest,
  // and print an em dash and an "NaNth percentile" alongside it.
  const sorted = r.metrics.filter((m) => wasMeasured(m) && !m.implausible && Number.isFinite(m.zEff) && reliabilityOf(m.def.id) >= RELIABLE_MIN).sort((a, b) => b.zEff - a.zEff);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const name = REGION_NAMES[r.region].toLowerCase();
  // A region explanation is not a new conversation. Repeating the same
  // greeting on every tab obscures the one thing the person came to read.
  void voice;
  // A region CAN now arrive with nothing in it: measurements that failed are
  // dropped from the report rather than carried as undefined (see
  // scoreFrontSet), and the side view scores no metric at all in some regions.
  // `sorted[0].percentile` on an empty array is the same class of crash that
  // took the Midface tab out, one line further along, so it is answered here
  // rather than left to be discovered.
  if (!best || !worst) {
    if (!r.metrics.some((m) => wasMeasured(m) && !m.implausible)) {
      return `No usable measurements were captured for the ${name}, so this region is not scored. Check the photo and the required points; missing readings do not count against you.`;
    }
    return `There isn't enough reliable detail to interpret the ${name} on this photo. You can still inspect the available readings, but they shouldn't be used to pick a strength or a problem. Check the pose and point placement before comparing another scan.`;
  }

  // Explain the available reading and the reference used to compare it.
  const s1 = `${best.def.name} reads ${fmt(best)} on this photo, compared with a ${sexNoun(sex)} reference mean of ${fmtMean(best, sex)}. It measures ${traitOf(best.def.id)}.`;

  // A lower model standing is a comparison, not an instruction to change it.
  //
  // Except where the region has no score, and this is the part that was wrong
  // the first time round: naming "the one to work on" and then explaining two
  // sentences later that nothing here can be measured reliably is the product
  // contradicting itself inside one paragraph. If the numbers do not hold
  // still, neither does the ranking that picked a worst one, so there is no
  // honest target to hand somebody.
  const scored = regionIsScored(r);
  const s2 = scored && worst !== best && worst.conformance < 0.999
    ? `${worst.def.name}, at ${fmt(worst)}, has a lower model standing within this region. That is a comparison, not evidence that you need to change it.`
    : "";

  // Where that leaves you.
  //
  // A region whose measurements do not reproduce gets no position at all. The
  // sentence above is still worth saying — it reports what was read on this
  // photograph, which is true — but a placement is a claim about other people,
  // and a claim needs a measurement that holds still. When every metric in a
  // region wanders as much between two photos of one face as between two
  // faces, the ranking is a ranking of the lighting.
  const s3 = !scored
    ? `The region's repeatability is too low for a confident interpretation, so its score is shown as indicative. Review individual measurements before drawing conclusions.`
    : `Together, the measurements give this region ${r.score.toFixed(1)} out of 10 in TrueMax's model. Open a measurement to see its construction and reference band.`;

  return [s1, s2, s3].filter(Boolean).join(" ");
}

// How rare is this, stated only as precisely as the sample allows.
//
// The reference population is ~110 faces per sex. A sample that size can
// resolve down to roughly 1-in-110 and no further: beyond that the tail is
// fitted, not observed, and a denominator like "1 in 1000" is a decimal place
// invented out of nothing. The old version printed exactly that.
//
// This matters more here than it would elsewhere. A competitor in this category
// shows users "Top 0.01% · 1 in 8.35k", which would need something like a
// hundred thousand measured faces to mean anything. Being the product that
// doesn't do that is the entire positioning, and it costs nothing to be right.
// One constant, imported rather than restated. This file had its own
// `REFERENCE_N = 110` while precision.ts exported 100, so the cap on how rare a
// thing may be called and the disclosure of what it was measured against
// disagreed by ten faces — two numbers describing one sample, drifting apart
// exactly the way precision.ts's own comment says they must not.
const REFERENCE_N = ENGINE_REFERENCE_N;

export function rarityN(pct: number): number {
  return Math.max(2, Math.min(REFERENCE_N, Math.round(1 / Math.max(0.001, 1 - pct / 100))));
}

// Past the resolution of the sample, drop the denominator entirely.
//
// 1-in-110 is about the top 0.9%, so "the top 1%" is the finest band this
// reference can honestly express. Anything narrower — 0.1%, 0.01% — is a
// decimal place invented from a sample that cannot see it.
//
// The rule itself now lives in engine/rarity.ts, because the basic grid and
// the scale explainer need the same phrase and two implementations of it had
// already drifted: this one read the raw percentile while everything around it
// read the stated one, so a face at 87.6 was "1 in 8" here and "top 10%" in
// the chip beside it. Kept as a named export because four call sites read
// better for it.
export const rarityText = rarityPhrase;

// Where this face sits, said in the direction that is actually true.
//
// The rarity phrasing is symmetric and the meaning is not. At the 1st
// percentile "roughly 1 in 100 male profiles measure this way" is arithmetically
// correct and reads as a compliment — it is the identical sentence the TOP 1%
// gets, and next to a 3.6/10 it lands as though scoring badly were a
// distinction. Rarity is only worth saying when being rare is the point, which
// is above the median.
//
// Below it, the honest statement is the plain directional one: most people
// score higher, and here is roughly how many. Same number, no spin in either
// direction.
export function populationLine(pct: number, sex: Sex, subject: string, tailLimit?: number): string {
  const group = sexNoun(sex);
  // Directional position is useful; turning the same percentile into "1 in
  // N" makes the person's face the rarity claim. The scale explainer may teach
  // the curve with counts, but a report says only how many score higher.
  return `About ${scoreHigherText(clampToTail(pct, tailLimit))} of ${group} ${subject} score higher.`;
}

/**
 * Pull a percentile inside the band its sample can express, before any phrase
 * is built from it. Undefined limit leaves it exactly as it was.
 */
function clampToTail(pct: number, tailLimit?: number): number {
  if (!tailLimit || !Number.isFinite(pct)) return pct;
  return Math.max(tailLimit, Math.min(100 - tailLimit, pct));
}

// The headline chip.
//
// Below the median this once read "Top 99.1%", which is arithmetically true and
// lands as praise — a 3.5 sitting ahead of 0.9% of faces announcing itself as
// top-99%. That was replaced with "Ahead of 0.9%", which turned out to be the
// same bug wearing a different word. It is now the same sentence the curve and
// the view cards use, because there is one function for it — see `standing`.
export const topPctText = rankShort;

// ---------------------------------------------------------------------------
// Reading a rescan.
//
// The conservative current display puts the observed spread between two
// photographs of one person at about 0.6 points. That is a problem for weekly
// tracking and it is the one place the problem turns into the product: an app
// that says "that is noise, ignore it" while its competitors say "you dropped
// 0.4, here is what to buy" is the entire positioning.
//
// Which only works if it is said plainly. Hedging a fluctuation into "you may
// have seen a slight decline" is the same sale in a quieter voice.
// ---------------------------------------------------------------------------
export function deltaReadingCopy(d: ScanDelta): string {
  if (!usableDelta(d)) return "The earlier scan comparison is not available in this view.";
  return `<b>${comparisonReading(d)}</b> ${comparisonLimit(d)}`;
}

const DELTA_SD = DISPLAY_NOISE.toFixed(1);

function usableDelta(delta: ScanDelta): boolean {
  return Number.isFinite(delta.overall) && Number.isFinite(delta.daysAgo) && delta.daysAgo >= 0;
}

function comparisonReading(delta: ScanDelta): string {
  const size = Math.abs(delta.overall).toFixed(1);
  const span = delta.daysAgo === 0 ? "earlier today" : delta.daysAgo === 1 ? "one day ago" : `${delta.daysAgo} days ago`;
  return Number(size) === 0
    ? `The displayed score is unchanged from the scan ${span}.`
    : `The score is ${size} points ${delta.overall > 0 ? "higher" : "lower"} than the scan ${span}.`;
}

function comparisonLimit(delta: ScanDelta): string {
  if (delta.reading === "tooSoon") {
    return "Over this short interval, the difference cannot establish a lasting physical change. Compare photos with the same pose, expression, lighting and camera distance.";
  }
  if (delta.reading === "noise") {
    return `This is within the app's usual photo-to-photo spread of about ${DELTA_SD} points, so it does not establish a physical change. A scan comparison alone cannot show whether a routine worked.`;
  }
  return "This is outside the app's usual capture spread, but pose, lighting and point placement can still affect it. The difference does not identify a cause or prove that a routine worked.";
}

// A score comparison is the only history provided here. It cannot establish
// routine use, progress, a cause, or a reason to replace someone's plan.
function memoryLine(delta: ScanDelta): string {
  if (!usableDelta(delta)) return "The earlier scan comparison is not available in this view.";
  let trend = "";
  if (delta.vsAverage != null && Number.isFinite(delta.vsAverage) && Number.isInteger(delta.averageOf) && delta.averageOf >= 2) {
    const size = Math.abs(delta.vsAverage).toFixed(1);
    trend = Number(size) === 0
      ? ` It matches your displayed average across ${delta.averageOf} earlier scans.`
      : ` It is ${size} points ${delta.vsAverage > 0 ? "above" : "below"} your average across ${delta.averageOf} earlier scans.`;
  }
  return `${comparisonReading(delta)}${trend} ${comparisonLimit(delta)}`;
}

export interface CoachRead {
  good: string;
  work: string;
  memory: string;
  invite: string;
}

export function coachRead(
  r: Report,
  delta: ScanDelta | null,
  opts: { guestName?: string; selfName?: string; scope: "front" | "side" } = { scope: "front" },
): CoachRead {
  const sex = r.sex;
  // What is noticeably standing out. Region-level, because that is the unit a
  // person recognises in a mirror.
  const regions = r.regions.filter((region) => regionIsScored(region) && Number.isFinite(region.percentile) && Number.isFinite(region.score)).sort((a, b) => b.percentile - a.percentile);
  const best = regions[0];
  // "Standout" has to earn the word. The best region of a face can still sit
  // below average, and calling a 45th-percentile nose "the part doing the most
  // for you" is praise the number does not support — the same trap the region
  // summary gates at 55. Below the bar he says so and moves to the fixable
  // thing, which is the useful half anyway.
  const good = !best
    ? `There isn't enough reliable detail here to pick out a strongest area. Check the photo and points before drawing conclusions.`
    : best.percentile >= 55
      ? `Your ${REGION_NAMES[best.region].toLowerCase()} has the highest supported region reading here, in the ${bandOf(best.percentile, sex)}. Open its measurements to see which proportions contributed.`
      : `None of the measured regions stands clearly above the reference on this photo. That is a result from this model, not a judgment of how you look in person.`;

  // What is noticeably poor, restricted to things that can actually move. No
  // "lever", no "moves without surgery": naming a fixable thing and then
  // offering to fix it says the same thing without the vocabulary.
  const fixables = r.metrics
    .filter((m) => !m.implausible && Number.isFinite(m.value) && Number.isFinite(m.zEff) && reliabilityOf(m.def.id) >= RELIABLE_MIN && m.def.fixability >= 0.3 && m.conformance < 0.999 && m.def.id !== "gonialAngle")
    .sort((a, b) => a.zEff - b.zEff);
  const weakest = fixables[0];
  const work = weakest
    ? `${weakest.def.name} reads ${fmt(weakest)} in this photo and has a lower model standing. Check the points first; the number alone does not show what caused it or whether you need to change anything.`
    : "";

  const memory = opts.scope === "side"
    ? ""
    : opts.guestName
      ? `This is a guest scan. It is separate from your own history, average and trend.`
      : delta
        ? memoryLine(delta)
        : `There is no earlier scan comparison in this view. For a useful comparison, keep the pose, expression, lighting and camera distance consistent.`;

  const invite = weakest
    ? `Tell me your goal, and I can help you choose one practical next step.`
    : `Ask me about any measurement and I'll explain what it can and can't tell you.`;

  return { good, work, memory, invite };
}

// ---------------------------------------------------------------------------
// Plan explanations describe the reading and relevant choices. A fixability
// coefficient is a model input, not a measured fraction a routine can change.
// ---------------------------------------------------------------------------

// Keep advice-channel controls intact. A declined category still permits the
// reading, but never a claim that buying guidance would move a known amount.
interface Lever {
  title: string;
  tag: string;
  channel: AdviceChannel;
  body: (m: ScoredMetric, sex: Sex) => string;
  // Used when that advice channel is switched off
  neutral: (m: ScoredMetric, sex: Sex) => string;
}

function readingContext(m: ScoredMetric, sex: Sex): string {
  if (!wasMeasured(m)) return `${m.def.name} was not available in this scan.`;
  if (m.implausible) return `${m.def.name} needs a point-placement review before interpretation.`;
  return `${m.def.name} reads ${fmt(m)} in this photo, compared with a ${sexNoun(sex)} reference mean of ${fmtMean(m, sex)}. The reference is a comparison, not a target.`;
}

const neutralCopy = (m: ScoredMetric, sex: Sex) =>
  `${readingContext(m, sex)} You chose not to receive this category of advice, so no routine is suggested here.`;

// What a free or Starter plan sees in place of the method.
//
// Deliberately NOT `neutral`, which says "you asked me to keep those
// recommendations out" — true when someone has muted a channel, a lie when the
// reason is that they have not paid. A paywall that misrepresents itself as the
// user's own choice is the kind of small dishonesty this product is supposed to
// be the opposite of.
//
// The measured reading and its reference remain visible. Paid guidance is not
// a promise that the person needs a routine or that one would move the number.
export function lockedCopy(m: ScoredMetric, sex: Sex): string {
  return `${readingContext(m, sex)} Guidance for routines that fit your goals is part of Max.`;
}

const LEVERS: Record<string, Lever> = {
  gonialProxy: {
    channel: "diet",
    neutral: neutralCopy,
    title: "Check the jaw outline",
    tag: "REVIEW",
    body: (m, sex) =>
      `${readingContext(m, sex)} This front-view outline does not identify body fat or the reason for the shape. Review the jaw points in a neutral, level capture before interpreting a difference.`,
  },
  jawCheekRatio: {
    channel: "diet",
    neutral: neutralCopy,
    title: "Compare the lower-face outline",
    tag: "REVIEW",
    body: (m, sex) =>
      `${readingContext(m, sex)} This ratio reflects a photographed outline. It cannot tell whether food, sleep or body composition explains the reading. Use the same camera distance and expression for comparisons.`,
  },
  cheekboneHeight: {
    channel: "diet",
    neutral: neutralCopy,
    title: "Review cheek point placement",
    tag: "REVIEW",
    body: (m, sex) =>
      `${readingContext(m, sex)} The reading locates the widest point in the photographed outline. Check that point and the head angle before comparing scans; the number does not establish a need to change your weight.`,
  },
  fwhr: {
    channel: "lifestyle",
    neutral: neutralCopy,
    title: "Review capture geometry",
    tag: "REVIEW",
    body: (m, sex) =>
      `${readingContext(m, sex)} Check the head position and landmark placement. This photographic ratio does not establish a training or body-composition goal.`,
  },
  browPosition: {
    channel: "grooming",
    neutral: neutralCopy,
    title: "Optional brow grooming",
    tag: "GROOMING",
    body: (m, sex) =>
      `${readingContext(m, sex)} If brow shape is a goal you chose, consider a small grooming change based on your preferences. A different brow edge may change the detected points; that is not proof of an improvement.`,
  },
  mouthCornerTilt: {
    channel: "capture",
    neutral: neutralCopy,
    title: "Check the expression",
    tag: "CAPTURE",
    body: (m) =>
      `Corner tilt reads ${fmt(m)} in this photo. Expression and point placement can affect it. Use a relaxed, neutral mouth and compare like-for-like captures before treating a difference as persistent.`,
  },
  mirrorDeviation: {
    channel: "lifestyle",
    neutral: neutralCopy,
    title: "Check alignment and expression",
    tag: "REVIEW",
    body: (m) =>
      `Mirror-axis deviation reads ${fmt(m)} in this photo. It does not establish a posture or chewing problem. Keep the head level, face the camera directly and check the paired landmarks before comparing symmetry readings.`,
  },
  eyeAspectRatio: {
    channel: "lifestyle",
    neutral: neutralCopy,
    title: "Check the eye opening",
    tag: "REVIEW",
    body: (m) =>
      `Eye aspect ratio reads ${fmt(m)} in this photo. Blinking, expression and point placement can affect the visible opening. Compare relaxed captures with the same lighting; this number cannot diagnose sleep or diet.`,
  },
  lipHeightLowerThird: {
    channel: "grooming",
    neutral: neutralCopy,
    title: "Optional lip-line styling",
    tag: "GROOMING",
    body: (m) =>
      `Lip height reads ${fmt(m)} of the lower third in this photo. If lip-line styling is part of your goal, choose it around your preferences. Styling changes presentation; this reading does not tell you that your lips need changing.`,
  },
};

const DEFAULT_LEVER: Lever = {
  title: "Review the reading",
  tag: "REVIEW",
  channel: "lifestyle",
  neutral: neutralCopy,
  body: (m, sex) =>
    `${readingContext(m, sex)} Check the points and capture conditions first. Choose any routine around your own goal; this number does not identify a cause or predict a habit's effect.`,
};

export function leverFor(m: ScoredMetric): Lever {
  if (!wasMeasured(m) || m.implausible || reliabilityOf(m.def.id) < RELIABLE_MIN) {
    return {
      title: "Review the reading",
      tag: "REVIEW",
      channel: LEVERS[m.def.id]?.channel ?? DEFAULT_LEVER.channel,
      neutral: neutralCopy,
      body: (reading, sex) => `${readingContext(reading, sex)} ${!wasMeasured(reading) || reading.implausible
        ? "Check the photo and required points before interpreting this measurement."
        : "Its photo-to-photo repeatability is too low to guide a routine. Review the capture and points instead."}`,
    };
  }
  return LEVERS[m.def.id] ?? DEFAULT_LEVER;
}

// ---------------------------------------------------------------------------
// Landing the number.
//
// A bare "5.2" with nothing around it reads as a verdict, and for most people
// it lands worse than the measurement deserves — half of everyone is below the
// median by construction, and the median face is not a problem to be solved.
//
// Two jobs here, and neither is flattery. The first is to name the reaction
// out loud, because a scanner that pretends a middling number feels fine is
// obviously lying and loses the credibility everything else here is built on.
// The second is to put the percentile next to the score, since "5.2" and
// "ahead of 43.7% of men" are the same fact and only one of them is legible.
// Nothing in this file rounds, softens or inflates the number itself.
// ---------------------------------------------------------------------------

// The same rule as percentileLine, minus the group noun, for places with no
// room for a sentence — the view cards and the curve callout.
//
// It has to be one function rather than two matching ones, because the first
// version of the cards computed it separately and got a "Bottom 47%" sitting
// directly beneath a "Top 53.4%" on the chart. Both were describing the same
// face, one of them was arithmetically wrong, and a side view at the very
// bottom of the reference set came out as "Bottom 0%".
// THE ONE PLACE A STANDING IS PUT INTO WORDS.
//
// "Ahead of 1%" was the previous answer below the median, and it is arithmetically
// true and it does not work. Beside a 3.5 it was read as a top-1% badge — the
// same misreading, by the same person, that "Roughly 1 in 100 profiles measure
// this way" produced, and for the same reason: "ahead" is a word with a
// direction in it, and the direction it carries is up. A reader takes the tone
// from the word and the number from the digit, and those two disagreed.
//
// So below the median the standing names the side of the distribution it is
// actually on. "Bottom 1%" cannot be read as praise, which is the entire
// requirement — the number is identical either way, and the only thing that
// changes is that it can no longer be mistaken for its opposite.
//
// `statedPct` clamps to [1, 99], so "Bottom 0%" — the nonsense an earlier
// separately-computed version printed for a face at the very bottom of the
// reference set — is unreachable here by construction.
//
// `tailLimit` is how far into a tail this particular reading is allowed to
// name a band. It defaults to the front's settled behaviour and is widened
// only for the side profile, whose repeatability is still open — see
// SIDE_TAIL_LIMIT_PCT in engine/precision.ts for why.
function standing(pct: number, tailLimit?: number): { top: boolean; pct: number } {
  const shown = statedPct(pct, tailLimit);
  return shown < 50 ? { top: false, pct: shown } : { top: true, pct: 100 - shown };
}

// The same rule as percentileLine, minus the group noun, for places with no
// room for a sentence — the view cards and the curve callout.
//
// It has to be one function rather than two matching ones, because the first
// version of the cards computed it separately and got a "Bottom 47%" sitting
// directly beneath a "Top 53.4%" on the chart. Both were describing the same
// face and one of them was arithmetically wrong.
export function rankShort(pct: number, tailLimit?: number): string {
  const s = standing(pct, tailLimit);
  return s.top ? `Top ${s.pct}%` : `Bottom ${s.pct}%`;
}

export function percentileLine(pct: number, sex: Sex, tailLimit?: number): string {
  const s = standing(pct, tailLimit);
  const group = sex === "male" ? "men" : "women";
  return s.top ? `Top ${s.pct}% of ${group}` : `Bottom ${s.pct}% of ${group}`;
}

// The overview's one caveat, stated the same way for everyone.
//
// This replaced `egoLine`, which banded the score and changed its tone with it
// — "Damn, that one stings the ego a bit" under the median, congratulations
// above it. That voice belongs to the coach, not to the instrument. A panel of
// measurements that commiserates with you about the measurements is doing two
// jobs and undermining the first: the reason to trust a number here is that it
// reads the same whether it flatters you or not.
//
// The substance of the old line was worth keeping and is not banded, because it
// is equally true at every score.
export function overviewCaveat(): string {
  return `These are estimates from photographs, compared with TrueMax's reference model.
    Pose, expression, lighting and point placement can change the result. A score
    is not a medical assessment or an objective verdict on attractiveness.`;
}
