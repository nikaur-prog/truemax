import type { RegionScore, ScoredMetric, Sex } from "../engine/types.ts";
import { REGION_NAMES } from "../engine/scoring.ts";

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
      ? `Net position: ${r.score.toFixed(1)}/10 — roughly 1 in ${rarityN(r.percentile)} ${sexNoun(sex)} faces measure this well across the ${name}.`
      : `Net position: ${r.score.toFixed(1)}/10 — about ${Math.round(100 - r.percentile)}% of ${sexNoun(sex)} faces score higher here, and the gap is specific, not vague.`;

  return `${s1} ${s2} ${s3}`;
}

export function rarityN(pct: number): number {
  return Math.max(2, Math.round(1 / Math.max(0.001, 1 - pct / 100)));
}

// ---------------------------------------------------------------------------
// Improvement plan copy — non-surgical levers only, each tied to the actual
// measured number it moves.
// ---------------------------------------------------------------------------

interface Lever {
  title: string;
  tag: string;
  body: (m: ScoredMetric, sex: Sex) => string;
}

const LEVERS: Record<string, Lever> = {
  gonialProxy: {
    title: "Cut body fat",
    tag: "CORE",
    body: (m, sex) =>
      `Submental and jawline fat blunt the gonial turn. Yours measures ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)} — composition is the single biggest lever on this number.`,
  },
  jawCheekRatio: {
    title: "Debloat protocol",
    tag: "DAILY",
    body: (m, sex) =>
      `Sodium, alcohol and short sleep puff the lower face and drag the measured jaw : cheek ratio (${fmt(m)} vs the ${fmtMean(m, sex)} norm). Two weeks of discipline shows up in this exact number.`,
  },
  cheekboneHeight: {
    title: "Body-fat reduction",
    tag: "CORE",
    body: (m) =>
      `Cheek fat pads bury the zygomatic line. Your widest point sits at ${fmt(m)} of eye-to-chin height; leaning out raises where the face visually breaks.`,
  },
  fwhr: {
    title: "Composition + posture",
    tag: "CORE",
    body: (m, sex) =>
      `Your fWHR of ${fmt(m)} (${sexNoun(sex)} mean ${fmtMean(m, sex)}) shifts with facial fat and head carriage — both trainable, neither surgical.`,
  },
  browPosition: {
    title: "Brow grooming",
    tag: "LOW-EFFORT",
    body: (m, sex) =>
      `The brow-to-eye gap measures ${fmt(m)} against a ${fmtMean(m, sex)} ${sexNoun(sex)} norm. Shaping the underside of the brow tightens this without touching anything else.`,
  },
  mouthCornerTilt: {
    title: "Neutral capture discipline",
    tag: "CAPTURE",
    body: (m) =>
      `Corner tilt reads ${fmt(m)} — expression moves this number more than anatomy does. Recapture with a fully neutral mouth before chasing it.`,
  },
  mirrorDeviation: {
    title: "Posture + chewing balance",
    tag: "HABIT",
    body: (m) =>
      `Unilateral chewing and forward head posture measurably worsen mirror deviation over time. Yours is ${fmt(m)} of IPD; balancing both sides protects the number.`,
  },
  eyeAspectRatio: {
    title: "Sleep + sodium discipline",
    tag: "DAILY",
    body: (m) =>
      `Periorbital puffiness changes the measured aperture (currently ${fmt(m)}). Consistent sleep and lower sodium restore the true measurement within weeks.`,
  },
  lipHeightLowerThird: {
    title: "Lip-line grooming",
    tag: "LOW-EFFORT",
    body: (m) =>
      `Beard and lip-line grooming shift how much of the lower third the lips claim (measured: ${fmt(m)}). The lowest-effort change on this list.`,
  },
};

const DEFAULT_LEVER: Lever = {
  title: "Targeted habit work",
  tag: "HABIT",
  body: (m, sex) =>
    `${m.def.name} sits at ${fmt(m)} against the ${sexNoun(sex)} average of ${fmtMean(m, sex)} — debloating, leaner composition and capture discipline close part of this gap.`,
};

export function leverFor(m: ScoredMetric): Lever {
  return LEVERS[m.def.id] ?? DEFAULT_LEVER;
}
