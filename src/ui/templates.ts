import type { RegionScore, ScoredMetric, Sex } from "../engine/types.js";
import { REGION_NAMES } from "../engine/scoring.js";
import type { AdviceChannel } from "../engine/goals.js";
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

export function fmt(m: ScoredMetric): string {
  return `${m.value.toFixed(m.def.decimals)}${m.def.unit}`;
}

function fmtMean(m: ScoredMetric, sex: Sex): string {
  return `${m.def.dist[sex].mean.toFixed(m.def.decimals)}${m.def.unit}`;
}

function ordinal(n: number): string {
  const r = Math.round(n);
  if (r % 100 >= 11 && r % 100 <= 13) return `${r}th`;
  switch (r % 10) {
    case 1: return `${r}st`;
    case 2: return `${r}nd`;
    case 3: return `${r}rd`;
    default: return `${r}th`;
  }
}

const sexNoun = (sex: Sex) => (sex === "male" ? "male" : "female");

// Region summary: strongest metric, weakest metric, rarity — 3 sentences,
// each anchored to a computed number.
export function regionSummary(r: RegionScore, sex: Sex): string {
  const sorted = [...r.metrics].sort((a, b) => b.zEff - a.zEff);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const name = REGION_NAMES[r.region].toLowerCase();

  let s1: string;
  if (best.percentile >= 55) {
    s1 = `${best.def.name} is the anchor here, at ${fmt(best)} against a ${sexNoun(sex)} average of ${fmtMean(best, sex)}, which lands in the top ${Math.max(1, Math.round(100 - best.percentile))}%. It measures ${traitOf(best.def.id)}.`;
  } else {
    s1 = `Nothing in this region carries hard: even ${best.def.name.toLowerCase()} only reaches the ${ordinal(best.percentile)} percentile at ${fmt(best)} (${sexNoun(sex)} average ${fmtMean(best, sex)}).`;
  }

  const s2 =
    worst.percentile < 45
      ? `The drag is ${worst.def.name.toLowerCase()} at ${fmt(worst)}, the ${ordinal(worst.percentile)} percentile against the ${fmtMean(worst, sex)} norm. That one is ${traitOf(worst.def.id)}.`
      : `Even the weakest number here, ${worst.def.name.toLowerCase()} at ${fmt(worst)}, holds the ${ordinal(worst.percentile)} percentile.`;

  const s3 =
    r.percentile >= 50
      ? `Net position: ${r.score.toFixed(1)}/10, meaning roughly ${rarityText(r.percentile)} ${sexNoun(sex)} faces measure this well across the ${name}.`
      : `Net position: ${r.score.toFixed(1)}/10. About ${Math.round(100 - r.percentile)}% of ${sexNoun(sex)} faces score higher here, and the gap is specific, not vague.`;

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
const REFERENCE_N = 110;

export function rarityN(pct: number): number {
  return Math.max(2, Math.min(REFERENCE_N, Math.round(1 / Math.max(0.001, 1 - pct / 100))));
}

// Past the resolution of the sample, drop the denominator entirely.
//
// 1-in-110 is about the top 0.9%, so "the top 1%" is the finest band this
// reference can honestly express. Anything narrower — 0.1%, 0.01% — is a
// decimal place invented from a sample that cannot see it.
export function rarityText(pct: number): string {
  const n = Math.round(1 / Math.max(0.001, 1 - pct / 100));
  return n <= REFERENCE_N ? `1 in ${Math.max(2, n)}` : "the top 1%";
}

// The headline chip.
//
// Below the median this used to read "Top 99.1%", which is arithmetically true
// and lands as praise — a 3.5 that sits ahead of 0.9% of faces was announcing
// itself as top-99%, directly contradicting the curve underneath it saying
// "Ahead of 0.9%". Under the median the honest phrasing is the one the curve
// already uses.
export function topPctText(pct: number): string {
  if (pct < 50) return pct < 1 ? "Ahead of <1%" : `Ahead of ${Math.round(pct)}%`;
  const rest = 100 - pct;
  return rest < 1 ? "Top 1%" : `Top ${Math.round(rest * 10) / 10}%`;
}

// ---------------------------------------------------------------------------
// Reading a rescan.
//
// The spread between two photographs of one person is 0.87 points post-shrinkage, and
// between two different people it is 1.20. That is a problem for weekly
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

const DELTA_SD = "1.3";

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
export function rankShort(pct: number): string {
  const rest = Math.round((100 - pct) * 10) / 10;
  return rest > 50 ? `Ahead of ${Math.round(pct * 10) / 10}%` : `Top ${rest}%`;
}

export function percentileLine(pct: number, sex: Sex): string {
  const rest = Math.round((100 - pct) * 10) / 10;
  const group = sex === "male" ? "men" : "women";
  // Below the median, "top X%" is a strained way to say it, so say the true
  // thing instead — it is the same number and it does not sound like spin.
  return rest > 50
    ? `Ahead of ${Math.round(pct * 10) / 10}% of ${group}`
    : `Top ${rest}% of ${group}`;
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
