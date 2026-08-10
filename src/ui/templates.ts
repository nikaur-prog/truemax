import type { RegionScore, ScoredMetric, Sex } from "../engine/types.ts";
import { REGION_NAMES } from "../engine/scoring.ts";
import type { AdviceChannel } from "../engine/goals.ts";

// Deterministic explanation engine. No LLM, no randomness: banded templates
// with the actual computed numbers interpolated in. Every sentence must
// reference a real measurement — zero generic filler.

// What each metric *means*, phrased to slot after an em-dash.
const TRAITS: Record<string, string> = {
  canthalTilt: "a positive tilt reads alert and structurally dimorphic",
  eyeAspectRatio: "narrower apertures read intense, rounder read softer",
  eyeSeparationRatio: "how the eyes sit across the face's width",
  intercanthalEyeWidth: "eye spacing measured in eye-widths",
  browPosition: "low-set brows harden the whole upper third",
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
};

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
    s1 = `${best.def.name} is the anchor here: ${fmt(best)} against a ${sexNoun(sex)} average of ${fmtMean(best, sex)}, which lands in the top ${Math.max(1, Math.round(100 - best.percentile))}% — ${TRAITS[best.def.id]}.`;
  } else {
    s1 = `Nothing in this region carries hard: even ${best.def.name.toLowerCase()} only reaches the ${ordinal(best.percentile)} percentile at ${fmt(best)} (${sexNoun(sex)} average ${fmtMean(best, sex)}).`;
  }

  const s2 =
    worst.percentile < 45
      ? `The drag is ${worst.def.name.toLowerCase()} at ${fmt(worst)} — ${ordinal(worst.percentile)} percentile against the ${fmtMean(worst, sex)} norm; ${TRAITS[worst.def.id]}.`
      : `Even the weakest number here, ${worst.def.name.toLowerCase()} at ${fmt(worst)}, holds the ${ordinal(worst.percentile)} percentile.`;

  const s3 =
    r.percentile >= 50
      ? `Net position: ${r.score.toFixed(1)}/10 — roughly ${rarityText(r.percentile)} ${sexNoun(sex)} faces measure this well across the ${name}.`
      : `Net position: ${r.score.toFixed(1)}/10 — about ${Math.round(100 - r.percentile)}% of ${sexNoun(sex)} faces score higher here, and the gap is specific, not vague.`;

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

// The headline "Top X%" chip, floored at the same resolution.
export function topPctText(pct: number): string {
  const rest = 100 - pct;
  return rest < 1 ? "Top 1%" : `Top ${Math.round(rest * 10) / 10}%`;
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
  `${m.def.name} measures ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)} — the ${Math.round(
    m.def.fixability * 100,
  )}% of that gap that moves without surgery moves with ${kind}. You asked me to keep those recommendations out, so the number is here and the advice isn't.`;

const LEVERS: Record<string, Lever> = {
  gonialProxy: {
    channel: "diet",
    neutral: neutralCopy("composition work"),
    title: "Cut body fat",
    tag: "CORE",
    body: (m, sex) =>
      `Submental and jawline fat blunt the gonial turn. Yours measures ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)} — composition is the single biggest lever on this number.`,
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
      `Your fWHR of ${fmt(m)} (${sexNoun(sex)} mean ${fmtMean(m, sex)}) shifts with facial fat and head carriage — both trainable, neither surgical.`,
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
      `Corner tilt reads ${fmt(m)} — expression moves this number more than anatomy does. Recapture with a fully neutral mouth before chasing it.`,
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
    `${m.def.name} sits at ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)} — debloating, leaner composition and capture discipline close part of this gap.`,
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

export function egoLine(pct: number): string {
  if (pct >= 90)
    return `That is a genuinely high measurement — top decile against the reference set. The plan below is mostly about not losing it.`;
  if (pct >= 70)
    return `A strong number. Comfortably above the middle of the distribution, with specific things still worth moving.`;
  if (pct >= 45)
    return `Mid-table, and worth being unromantic about: the middle is where most faces land, because that is what a middle is.`;
  if (pct >= 25)
    return `Damn — that one stings the ego a bit. Two honest things about it: this measures the geometry in one photograph, not you, and the levers below are the ones that actually move it.`;
  return `Damn. That is a hard number to read, and softening it would make every other number here worth less. What it is not is a verdict — it is one photograph, scored on bone and soft tissue, and the plan below is the part you can change.`;
}
