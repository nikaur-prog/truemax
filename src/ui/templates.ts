import type { RegionScore, Report, ScoredMetric, Sex } from "../engine/types.js";
import { REGION_NAMES, regionIsScored } from "../engine/scoring.js";
import { distFor } from "../engine/metrics.js";
import { REFERENCE_N as ENGINE_REFERENCE_N, statedPct } from "../engine/precision.js";
import { rarityPhrase } from "../engine/rarity.js";
import type { AdviceChannel } from "../engine/goals.js";
import { DISPLAY_NOISE } from "../engine/history.js";
import type { ScanDelta } from "../engine/history.js";

// Deterministic explanation engine. No LLM, no randomness: banded templates
// with the actual computed numbers interpolated in. Every sentence must
// reference a real measurement — zero generic filler.

// What each metric *means*. Every entry is a noun phrase that completes the
// sentence "It measures ___", so the summary can introduce it with ordinary
// punctuation. They used to be written to slot after an em-dash, which is why
// a few were clauses rather than phrases and why the summaries were stitched
// together with dashes end to end.
const TRAITS: Record<string, string> = {
  canthalTilt: "eye-corner tilt, where a positive angle reads alert and structurally dimorphic",
  eyeAspectRatio: "aperture shape, where narrower reads intense and rounder reads softer",
  eyeSeparationRatio: "how the eyes sit across the face's width",
  intercanthalEyeWidth: "eye spacing, counted in eye-widths",
  browPosition: "brow height, where low-set brows harden the whole upper third",
  browTilt: "the rise of the brow from inner to outer end",
  fwhr: "upper-face width against height, a core dominance signal",
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
  if (!Number.isFinite(m.value)) return "—";
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
// What a coach would actually say.
//
// This used to read: "Midline deviation is the anchor here, at 0.5% eye-span
// against a male average of 1.6%, which lands in the top 15%. The drag is
// eye-line / mouth-line skew. Net position: 6.2/10." Every number in it is
// right and nobody talks like that. "Anchor", "drag" and "net position" are
// analyst words — they describe the reader's face the way a report describes a
// portfolio, and on a screen where somebody has just handed over a photograph
// of themselves that distance reads as a machine grading them.
//
// So the shape stays and the voice changes. Same three jobs, same numbers, in
// the order a person would say them: here is what is genuinely good, here is
// the one to work on, here is where that leaves you. Nothing is softened and
// nothing is added — a warmer sentence carrying a worse number would be the
// flattery this whole product refuses.
//
// The greeting is the user's NAME, with the emotion picked by their own
// trend. "Alright man" tested badly: a coach who knows you uses your name,
// and "man"/"bro"/"queen" on every tab stops being warmth and starts being a
// verbal tic, which is the same failure Max's wave had. So:
//
//   improving vs their history  →  "Nice, Nico. I see the improvements"
//   moving down                 →  "Alright, Nico" (never down on them; the
//                                   observation itself carries the news)
//   first scan / guest / flat   →  "Let's get down to business, Nico"
//
// Only Coach Max speaks like this. Every other line in the product states
// the observation plainly and scientifically; this greeting is the one place
// the product is somebody in your corner rather than an instrument.
// ---------------------------------------------------------------------------
export type CoachTrend = "up" | "down" | "flat";

// The chip threshold (results.ts deltaChip) reused so the voice and the chips
// never disagree about whether a number moved.
export function trendOf(delta: number | null | undefined): CoachTrend {
  if (delta == null) return "flat";
  return delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
}

// Takes the RAW name: regionSummary lands in textContent where escaping
// would print entities, while coachRead lands in innerHTML and escapes at
// its own boundary before calling in.
function opener(trend: CoachTrend, name?: string): string {
  const n = name?.trim() ? `, ${name.trim()}` : "";
  if (trend === "up") return `Nice${n}. I see the improvements`;
  if (trend === "down") return `Alright${n}`;
  return `Let's get down to business${n}`;
}

// "top 15%" reads as a rank. "ahead of 85 in every 100 guys" reads as a room
// you are standing in. Same fact; the second one is the one a coach says.
//
// "in every 100" rather than "out of 100" because the sentence has to survive
// the number being 1: "only 1 out of 100 guys sit below you" is broken, and
// "1 in every 100 guys is below you" is not.
const peers = (sex: Sex) => (sex === "male" ? "guys" : "women");

function aheadOf(pct: number, sex: Sex): string {
  const beaten = Math.max(1, Math.min(99, Math.round(pct)));
  return `ahead of ${beaten} in every 100 ${peers(sex)}`;
}

function behindYou(pct: number, sex: Sex): string {
  const below = Math.max(1, Math.min(99, Math.round(pct)));
  return below === 1
    ? `only 1 ${sex === "male" ? "guy" : "woman"} in every 100 is below you there`
    : `only ${below} in every 100 ${peers(sex)} are below you there`;
}

export function regionSummary(
  r: RegionScore,
  sex: Sex,
  // Who Coach Max is talking to and how this region moved since their last
  // scan. Both optional: a signed-out or first scan simply gets the
  // down-to-business opener without a trend claim.
  voice?: { name?: string; delta?: number | null },
): string {
  // Only what was actually read. An unmeasured metric has a NaN z, which sorts
  // unpredictably and can land at either end — so the sentence would name the
  // one measurement that does not exist as the region's best or its weakest,
  // and print an em dash and an "NaNth percentile" alongside it.
  const sorted = r.metrics.filter(wasMeasured).sort((a, b) => b.zEff - a.zEff);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const name = REGION_NAMES[r.region].toLowerCase();
  const hi = opener(trendOf(voice?.delta), voice?.name);
  // A region CAN now arrive with nothing in it: measurements that failed are
  // dropped from the report rather than carried as undefined (see
  // scoreFrontSet), and the side view scores no metric at all in some regions.
  // `sorted[0].percentile` on an empty array is the same class of crash that
  // took the Midface tab out, one line further along, so it is answered here
  // rather than left to be discovered.
  if (!best || !worst) {
    return `${hi}. I couldn't get a clean read on your ${name} from this photograph, so I'm not scoring it. It sits out of your total rather than counting against you. Worth a rescan in better light.`;
  }

  // What is good. Named, with the number, and with what it actually means —
  // praise that does not say what it is praising is worth nothing.
  const s1 = best.percentile >= 55
    ? `${hi}. Your ${best.def.name.toLowerCase()} is carrying this one. ${fmt(best)} where the ${sexNoun(sex)} average is ${fmtMean(best, sex)}, which puts you ${aheadOf(best.percentile, sex)}. That's ${traitOf(best.def.id)}, and yours is genuinely good.`
    : `${hi}. I'm not going to pretend anything in your ${name} is doing heavy lifting. The best of it is ${best.def.name.toLowerCase()} at ${fmt(best)} against a ${sexNoun(sex)} average of ${fmtMean(best, sex)}, which is about the middle of the room.`;

  // What to work on. Said outright, with the number, no cushioning — the warm
  // opener exists so that this sentence can afford to be blunt.
  //
  // Except where the region has no score, and this is the part that was wrong
  // the first time round: naming "the one to work on" and then explaining two
  // sentences later that nothing here can be measured reliably is the product
  // contradicting itself inside one paragraph. If the numbers do not hold
  // still, neither does the ranking that picked a worst one, so there is no
  // honest target to hand somebody.
  const scored = regionIsScored(r);
  const s2 = !scored
    ? `I'm not going to point you at one of these to fix, either.`
    : worst.percentile < 45
      ? `The one to go at is your ${worst.def.name.toLowerCase()}: ${fmt(worst)} against ${fmtMean(worst, sex)}, and ${behindYou(worst.percentile, sex)}. That one's ${traitOf(worst.def.id)}.`
      : `Nothing here is really letting you down. Even your weakest number, ${worst.def.name.toLowerCase()} at ${fmt(worst)}, is holding its own.`;

  // Where that leaves you.
  //
  // A region whose measurements do not reproduce gets no position at all. The
  // sentence above is still worth saying — it reports what was read on this
  // photograph, which is true — but a placement is a claim about other people,
  // and a claim needs a measurement that holds still. When every metric in a
  // region wanders as much between two photos of one face as between two
  // faces, the ranking is a ranking of the lighting.
  const s3 = !scored
    ? `Here's why: every measurement in your ${name} moves about as much between two photos of the same face as it does between two different people. There's nothing steady enough there to rank, so I'm not giving it a score and I'm keeping it out of your total. You still get the readings.`
    : r.percentile >= 50
      ? `All in, that's ${r.score.toFixed(1)} out of 10 across the ${name}. Roughly ${rarityText(r.percentile)} ${sexNoun(sex)} faces measure this well.`
      : `All in, ${r.score.toFixed(1)} out of 10 across the ${name}. About ${scoreHigherText(r.percentile)} of ${sexNoun(sex)} faces come in above you, and you now know the exact number standing in the way. Most people never get told that.`;

  return `${s1} ${s2} ${s3}`;
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
export function populationLine(pct: number, sex: Sex, subject: string): string {
  const group = sexNoun(sex);
  if (pct >= 50) {
    return `Roughly ${rarityText(pct)} ${group} ${subject} measure this way.`;
  }
  return `About ${scoreHigherText(pct)} of ${group} ${subject} score higher.`;
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
  const size = Math.abs(d.overall).toFixed(1);
  const when =
    d.daysAgo === 0 ? "today" : d.daysAgo === 1 ? "yesterday" : `${d.daysAgo} days ago`;
  const dir = d.overall > 0 ? "up" : "down";

  if (d.reading === "noise") {
    return `<b>That is not a change.</b> Two photos of the same face land ${DELTA_SD} points apart
      on average, which is more than two different people do, so ${size} ${dir} against ${when} is the
      same face measured twice. Lighting, angle, water retention in your face, the camera.
      Nothing to read into it.`;
  }
  if (d.reading === "tooSoon") {
    // "in yesterday" and "in today" are the obvious way to get this wrong.
    const span = d.daysAgo <= 1 ? "a day" : `${d.daysAgo} days`;
    return `<b>${size} ${dir} is a big gap, and it is still capture.</b> A face does not
      restructure in ${span}, so a swing this size means the two photographs differ, not that
      you do. Shoot both in the same light, at the same distance, at the same time of day, and
      compare those.`;
  }
  // This branch needs at least STRUCTURAL_DAYS, so "the last N days" always
  // reads correctly here — "since 7 days ago" does not.
  return `<b>${size} ${dir} over the last ${d.daysAgo} days, and that is outside normal capture spread.</b>
    Worth paying attention to. It is still not proof: ${DELTA_SD} points is what two photos of
    one unchanged face can differ by, and this only clears it. If something changed (sleep,
    training, weight, alcohol, how you are grooming), this is the scan where it would show.`;
}

const DELTA_SD = DISPLAY_NOISE.toFixed(1);

// ---------------------------------------------------------------------------
// Coach Max's read, and the part of it that has a memory.
//
// The old version said: "Best thing on the scan: eyes, top 15% of the
// reference set. The one I would attack first: brow tilt. Cut body fat is the
// LEVER, and it MOVES WITHOUT SURGERY." Two pieces of jargon in one sentence,
// neither of which anybody says out loud, on the tab that is supposed to be a
// coach talking rather than a report printing.
//
// It also had no memory worth the name. It printed a delta and stopped, which
// is a measurement, not coaching. A coach who has been working with you for a
// month opens with whether the work is showing, and if it is, wants to know
// what you actually did.
//
// THE HONESTY PROBLEM, and it is the whole design here. The obvious version
// congratulates anybody whose number went up. That is the exact sale this
// product exists not to make: two photographs of one unchanged face differ by
// about 0.6 points, so most "improvement" is the camera. history.ts already
// grades every delta as noise / tooSoon / worthNoting against that spread, and
// this copy is built on that grade rather than on the sign of the number.
//
// So even when a rise IS outside capture spread, Max does not simply take
// credit for it. He says it looks real, and then asks whether they have
// actually been doing the work, for two reasons that are both honest: it is
// the only way to tell a working routine from a flattering month, and the
// answer is the single most useful thing anybody could tell him. When the
// number has NOT moved he asks the same question, because "are you doing it"
// has to be asked in both directions or it is not a question, it is a
// congratulation with a question mark on it.
// ---------------------------------------------------------------------------

// Long enough for a routine to have shown up in a face. Skin and composition
// move over weeks; below this the honest read is "too early to tell" however
// the number went.
const ROUTINE_DAYS = 21;

function memoryLine(delta: ScanDelta, sex: Sex): string {
  const you = sex === "male" ? "bro" : "girl";
  const size = Math.abs(delta.overall).toFixed(1);
  // Against the running average where there is one. One prior scan can be an
  // outlier; the mean of several cannot, and "where you usually land" is the
  // more honest comparison against a noisy instrument.
  const trend = delta.vsAverage != null && delta.averageOf >= 2
    ? ` You're ${Math.abs(delta.vsAverage).toFixed(1)} ${delta.vsAverage > 0 ? "above" : "below"} your own average of the last ${delta.averageOf}, which is the number I actually watch.`
    : "";

  if (delta.reading === "tooSoon") {
    return `You rescanned after ${delta.daysAgo} ${delta.daysAgo === 1 ? "day" : "days"}. A face doesn't restructure that fast, so I'm reading that swing as the two photographs differing, not you. Same light, same distance, same time of day, and I'll have something worth telling you.`;
  }
  if (delta.reading === "noise") {
    return `Flat since last time, and flat is not the same as failing. Anything under ${DELTA_SD} points is the camera rather than your face, so this reads as no change either way.${trend} What I do want to know: have you actually been running what I gave you? Tell me straight either way. If you have, I'll stop guessing and start tightening it. If you haven't, that's the whole explanation and no drama.`;
  }
  // worthNoting: outside capture spread, so it is worth saying out loud.
  if (delta.overall > 0) {
    const earned = delta.daysAgo >= ROUTINE_DAYS
      ? `${size} up over ${delta.daysAgo} days, ${you}, and that's past what the camera can fake. That's the look of somebody who actually did the thing instead of just reading about it. Respect.`
      : `${size} up in ${delta.daysAgo} days, and that clears the noise floor, which most weeks don't.`;
    return `${earned}${trend} Do me a favour though: tell me what you've actually been doing. I want to know whether this is the routine landing or just a good month, because those two look identical from here and only one of them is worth doubling down on.`;
  }
  // Deliberately does NOT offer to change anything. Whether a protocol has had
  // long enough is protocol.ts's call, not this sentence's, and the version
  // that said "then it's the plan that's wrong and I'll rebuild it" would have
  // fired nine days into an eight-week routine.
  return `${size} down since last time, and that's past what I can blame on the camera.${trend} Before either of us reads anything into it: have you been keeping up with what we talked about? No judgement, I'd genuinely rather know. Most of what I'd recommend needs a couple of months before it shows up here at all, so one dip is not a reason to change anything yet.`;
}

// The part of a face somebody would actually name.
//
// "Want me to tell you exactly what to use on that cheekbone height" is not a
// sentence anybody says. A person does not have a cheekbone height problem,
// they have a cheek area they are unhappy with, and the offer has to be made
// in those words even though the measurement behind it is precise.
const AREA: Record<string, string> = {
  eyes: "eye area",
  midface: "cheeks",
  jaw: "jawline",
  chin: "chin and jaw",
  nose: "nose",
  lips: "lips",
  proportions: "overall proportions",
  symmetry: "symmetry",
};

function areaOf(region: string): string {
  return AREA[region] ?? "face";
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
  // A guest's delta is deliberately null, so a guest always gets the
  // down-to-business opener with THEIR name, never a trend claim borrowed
  // from the owner's history. Escaped here because these strings land in
  // innerHTML; the region summary path stays raw for textContent.
  const rawName = opts.guestName ?? opts.selfName;
  const hi = opener(trendOf(delta?.overall), rawName ? escapeForCopy(rawName) : undefined);
  const peer = sex === "male" ? "guys" : "women";

  // What is noticeably standing out. Region-level, because that is the unit a
  // person recognises in a mirror.
  const regions = [...r.regions].sort((a, b) => b.percentile - a.percentile);
  const best = regions[0];
  // "Standout" has to earn the word. The best region of a face can still sit
  // below average, and calling a 45th-percentile nose "the part doing the most
  // for you" is praise the number does not support — the same trap the region
  // summary gates at 55. Below the bar he says so and moves to the fixable
  // thing, which is the useful half anyway.
  const good = !best
    ? `${hi}. Not much to go on from this scan.`
    : best.percentile >= 55
      ? `${hi}. Your ${REGION_NAMES[best.region].toLowerCase()} is the standout on this scan, sitting ahead of ${Math.max(1, Math.min(99, Math.round(best.percentile)))} in every 100 ${peer}. That's the part of your face doing the most for you, so don't go changing it.`
      : `${hi}. Straight answer: nothing on this scan is jumping out as a strength yet. Your best region is your ${REGION_NAMES[best.region].toLowerCase()} and even that lands mid-pack. That's not a write-off, it just means the wins here come from work rather than from something you were born with.`;

  // What is noticeably poor, restricted to things that can actually move. No
  // "lever", no "moves without surgery": naming a fixable thing and then
  // offering to fix it says the same thing without the vocabulary.
  const fixables = r.metrics
    .filter((m) => m.def.fixability >= 0.3)
    .sort((a, b) => a.zEff - b.zEff);
  const weakest = fixables[0];
  const work = weakest
    ? `The one holding you back most is your ${weakest.def.name.toLowerCase()}, reading ${fmt(weakest)}. Good news is it's one of the ones that actually shifts with what you do day to day, so it's worth your attention rather than your worry.`
    : "";

  const memory = opts.scope === "side"
    ? ""
    : opts.guestName
      ? `This one's ${escapeForCopy(opts.guestName)}'s scan, so I'm keeping it as its own record. It stays off your history, your average and your trend.`
      : delta
        ? memoryLine(delta, sex)
        : `First scan on record, so there's nothing to compare it to yet. Scan again in a few weeks and I'll be able to tell you whether anything you're doing is working, which is the part that actually matters.`;

  const invite = weakest
    ? `Want me to help you with your ${areaOf(weakest.def.region)}? Ask me and I'll talk you through what actually works on it and how long it realistically takes.`
    : `Ask me anything off this scan and I'll tell you what I'd actually do about it.`;

  return { good, work, memory, invite };
}

// Names come from a user-controlled field and land in innerHTML. results.ts
// has its own escaper for exactly this, but coachRead is built here and the
// caller should not have to remember which of its four strings needs treating.
function escapeForCopy(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---------------------------------------------------------------------------
// Improvement plan copy — non-surgical levers only, each tied to the actual
// measured number it moves.
// ---------------------------------------------------------------------------

// Every lever declares which kind of advice it is. Someone who told us to keep
// food out of it still gets the measurement and still gets told it is fixable —
// they just don't get the diet paragraph. Suppressing the advice, never the
// number, is the line this whole product is built on.
interface Lever {
  title: string;
  tag: string;
  channel: AdviceChannel;
  body: (m: ScoredMetric, sex: Sex) => string;
  // Used when that advice channel is switched off
  neutral: (m: ScoredMetric, sex: Sex) => string;
}

const neutralCopy = (kind: string) => (m: ScoredMetric, sex: Sex) =>
  `${m.def.name} measures ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)}. The ${Math.round(
    m.def.fixability * 100,
  )}% of that gap that moves without surgery moves with ${kind}. You asked me to keep those recommendations out, so the number is here and the advice isn't.`;

// What a free or Starter plan sees in place of the method.
//
// Deliberately NOT `neutral`, which says "you asked me to keep those
// recommendations out" — true when someone has muted a channel, a lie when the
// reason is that they have not paid. A paywall that misrepresents itself as the
// user's own choice is the kind of small dishonesty this product is supposed to
// be the opposite of.
//
// What it withholds is the METHOD, never the measurement. The number, the gap,
// the population average and how much of that gap is even movable are all still
// here, because those are the things somebody came for and the things we claim
// to be honest about. What costs money is being told exactly what to do about
// it — which is the one part a person could get elsewhere, and the one part
// that takes real work to write well.
export function lockedCopy(m: ScoredMetric, sex: Sex): string {
  const movable = Math.round(m.def.fixability * 100);
  return `${m.def.name} measures ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(
    m,
    sex,
  )}, and about ${movable}% of that gap moves without surgery. The measurement is yours either way. The specific routine that moves it is part of Max.`;
}

const LEVERS: Record<string, Lever> = {
  gonialProxy: {
    channel: "diet",
    neutral: neutralCopy("composition work"),
    title: "Cut body fat",
    tag: "CORE",
    body: (m, sex) =>
      `Submental and jawline fat blunt the gonial turn. Yours measures ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)}. Composition is the single biggest lever on this number.`,
  },
  jawCheekRatio: {
    channel: "diet",
    neutral: neutralCopy("composition work"),
    title: "Debloat protocol",
    tag: "DAILY",
    body: (m, sex) =>
      `Sodium, alcohol and short sleep puff the lower face and drag the measured jaw : cheek ratio (${fmt(m)} vs the ${fmtMean(m, sex)} norm). Two weeks of discipline shows up in this exact number.`,
  },
  cheekboneHeight: {
    channel: "diet",
    neutral: neutralCopy("composition work"),
    title: "Body-fat reduction",
    tag: "CORE",
    body: (m) =>
      `Cheek fat pads bury the zygomatic line. Your widest point sits at ${fmt(m)} of eye-to-chin height; leaning out raises where the face visually breaks.`,
  },
  fwhr: {
    channel: "lifestyle",
    neutral: neutralCopy("habit and posture work"),
    title: "Composition + posture",
    tag: "CORE",
    body: (m, sex) =>
      `Your fWHR of ${fmt(m)} (${sexNoun(sex)} mean ${fmtMean(m, sex)}) shifts with facial fat and head carriage. Both are trainable and neither is surgical.`,
  },
  browPosition: {
    channel: "grooming",
    neutral: neutralCopy("grooming"),
    title: "Brow grooming",
    tag: "LOW-EFFORT",
    body: (m, sex) =>
      `The brow-to-eye gap measures ${fmt(m)} against a ${fmtMean(m, sex)} ${sexNoun(sex)} norm. Shaping the underside of the brow tightens this without touching anything else.`,
  },
  mouthCornerTilt: {
    channel: "capture",
    neutral: neutralCopy("capture discipline"),
    title: "Neutral capture discipline",
    tag: "CAPTURE",
    body: (m) =>
      `Corner tilt reads ${fmt(m)}. Expression moves this number more than anatomy does. Recapture with a fully neutral mouth before chasing it.`,
  },
  mirrorDeviation: {
    channel: "lifestyle",
    neutral: neutralCopy("posture and habit work"),
    title: "Posture + chewing balance",
    tag: "HABIT",
    body: (m) =>
      `Unilateral chewing and forward head posture measurably worsen mirror deviation over time. Yours is ${fmt(m)} of IPD; balancing both sides protects the number.`,
  },
  eyeAspectRatio: {
    channel: "lifestyle",
    neutral: neutralCopy("sleep and routine work"),
    title: "Sleep + sodium discipline",
    tag: "DAILY",
    body: (m) =>
      `Periorbital puffiness changes the measured aperture (currently ${fmt(m)}). Consistent sleep and lower sodium restore the true measurement within weeks.`,
  },
  lipHeightLowerThird: {
    channel: "grooming",
    neutral: neutralCopy("grooming"),
    title: "Lip-line grooming",
    tag: "LOW-EFFORT",
    body: (m) =>
      `Beard and lip-line grooming shift how much of the lower third the lips claim (measured: ${fmt(m)}). The lowest-effort change on this list.`,
  },
};

const DEFAULT_LEVER: Lever = {
  title: "Targeted habit work",
  tag: "HABIT",
  channel: "lifestyle",
  neutral: neutralCopy("habit work"),
  body: (m, sex) =>
    `${m.def.name} sits at ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)}. Debloating, leaner composition and capture discipline close part of this gap.`,
};

export function leverFor(m: ScoredMetric): Lever {
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
function standing(pct: number): { top: boolean; pct: number } {
  const shown = statedPct(pct);
  return shown < 50 ? { top: false, pct: shown } : { top: true, pct: 100 - shown };
}

// The same rule as percentileLine, minus the group noun, for places with no
// room for a sentence — the view cards and the curve callout.
//
// It has to be one function rather than two matching ones, because the first
// version of the cards computed it separately and got a "Bottom 47%" sitting
// directly beneath a "Top 53.4%" on the chart. Both were describing the same
// face and one of them was arithmetically wrong.
export function rankShort(pct: number): string {
  const s = standing(pct);
  return s.top ? `Top ${s.pct}%` : `Bottom ${s.pct}%`;
}

export function percentileLine(pct: number, sex: Sex): string {
  const s = standing(pct);
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
  return `One photograph, scored on bone proportion and soft tissue against a reference
    population. Two photos of the same face differ by about 0.9 points, so a single
    scan is one reading rather than a verdict.`;
}
