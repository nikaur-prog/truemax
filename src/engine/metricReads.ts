import type { ScoredMetric, Sex } from "./types.js";
import { distFor } from "./metrics.js";

// ---------------------------------------------------------------------------
// What a reading LOOKS LIKE, one honest sentence per side of the average.
//
// The detail card states the number, the population, and the person's position
// — and then stops, leaving the one question everybody actually opens the card
// with: "so what does that mean on my face?" These lines answer it, and they
// answer it under three rules that are the whole reason this table is safe to
// ship:
//
//   1. GEOMETRY, NOT VERDICTS. Every sentence describes what the measurement
//      does to how the face reads — where width sits, which way a line leans —
//      never what the reader is. "The jaw corner turns more gradually" is a
//      description; anything resembling a diagnosis is banned, and the test
//      file enforces the ban by grepping this table for the words.
//   2. TRUE ON BOTH SIDES. Each metric gets a high line and a low line, and
//      each is written from the metric's actual construction — checked against
//      the compute function, not inferred from the name. A metric whose sign
//      convention is not yet settled gets NO entry rather than a guess:
//      browTilt is excluded below because its measured values sit ~12° from
//      the published convention and nobody has yet established which way the
//      construction runs (see the open calibration task). A missing line costs
//      one sentence; a flipped one tells someone their face leans the way it
//      does not.
//   3. ONLY WHEN IT LEANS. Within half a standard deviation of the average
//      there is no lean worth a sentence — printing "yours reads X" about a
//      dead-average value manufactures a trait out of noise, which is the
//      exact dishonesty the rest of the product is built to avoid.
// ---------------------------------------------------------------------------

interface Read {
  /** The reading sits above the population mean. */
  high: string;
  /** Below it. */
  low: string;
}

// Sentences complete on their own, lowercase start — the card renders them
// after a stable "On your face:" kicker, so they read as one voice.
const READS: Record<string, Read> = {
  // ---- eyes ----
  canthalTilt: {
    high: "the outer corners sit higher than the inner: the upward tilt that reads alert and awake",
    low: "the eye line runs flatter than average, or tips down at the outer corner, which can read tired even when you are not",
  },
  eyeAspectRatio: {
    high: "the aperture is on the rounder, more open side: softer and more expressive than the narrow cut",
    low: "the aperture is narrower than average: the compressed, intense look people call hooded or deep-set",
  },
  eyeSeparationRatio: {
    high: "the eyes sit wide across the face, which opens the midface up",
    low: "the eyes sit close in toward the nose, which compresses the centre of the face",
  },
  intercanthalEyeWidth: {
    high: "the space between the eyes is wide when counted in eye-widths: the wide-set look",
    low: "the inner corners sit close together: close-set eyes, which sharpen the focus of the midface",
  },
  browPosition: {
    high: "the brows ride high above the eyes, opening the upper lid and softening the whole upper third",
    low: "the brows sit low over the eyes: the compressed, heavier upper third that reads intense",
  },
  fwhr: {
    high: "the upper face is wide for its height: the broad, compact structure",
    low: "the upper face is narrow for its height, which reads longer and finer-boned",
  },
  // ---- midface ----
  midfaceRatio: {
    high: "the midface is short between the eyes and the mouth: the compact midface",
    low: "there is more vertical distance between the eyes and the mouth than average: a longer midface",
  },
  cheekFullness: {
    high: "the cheek bows outward between the cheekbone and the jaw: the fuller, softer midface",
    low: "the cheek runs flat or hollow below the cheekbone: the leaner midface with more visible structure",
  },
  cheekboneHeight: {
    high: "the cheek's fullest point sits lower on the face, further from the eyes",
    low: "the cheekbones sit high, close under the eyes: width carried at the top of the midface",
  },
  // ---- jaw ----
  jawCheekRatio: {
    high: "the jaw base runs nearly as wide as the cheekbones: the square lower face",
    low: "the jaw is narrow against the cheekbones, tapering the face toward the chin",
  },
  gonialProxy: {
    high: "seen from the front, the jaw turns its corner gradually: a softer angle into the neck",
    low: "the jaw turns a sharp visible corner: the angular hinge that defines the lower face",
  },
  jawFrontalAngle: {
    high: "the jaw base spreads wide from the chin: the flatter, squarer base",
    low: "the jaw base converges steeply into the chin: the narrow V-shaped lower face",
  },
  // ---- chin & lower third ----
  chinHeightRatio: {
    high: "the chin claims a large share of the lower third: the tall chin",
    low: "the chin is short against the mouth above it, which shortens the whole lower face",
  },
  philtrumChinRatio: {
    high: "the chin is tall against the philtrum: the balance tips toward the bottom of the face",
    low: "the philtrum is long against the chin below it, which stretches the space under the nose",
  },
  chinWidthRatio: {
    high: "the chin is broad across the jaw base: the flat, wide chin",
    low: "the chin comes to a narrow point against the jaw: the tapered chin",
  },
  lowerFacePct: {
    high: "the lower face takes more than its usual share of total height: the long lower third",
    low: "the lower face is short against the rest: the compact lower third",
  },
  // ---- nose ----
  noseMouthRatio: {
    high: "the nose is wide when measured against the mouth beneath it",
    low: "the nose is narrow against the mouth, which lets the mouth carry the lower face",
  },
  noseIntercanthal: {
    high: "the nostril base is wider than the space between the eyes: the nose reads broad at its base",
    low: "the nose base fits inside the space between the eyes: the narrow base",
  },
  nasalIndex: {
    high: "the nose is wide for its length: the shorter, broader shape",
    low: "the nose is long for its width: the narrow, extended shape",
  },
  // ---- lips ----
  lipRatio: {
    high: "the lower lip carries most of the mouth's volume: the heavy lower lip",
    low: "the two lips are close to even, or the upper carries more, less bottom-weight than average",
  },
  mouthIPD: {
    high: "the mouth is wide against the eye spacing: the broad smile line",
    low: "the mouth is narrow against the eyes above it: the small, centred mouth",
  },
  lipHeightLowerThird: {
    high: "the lips claim a big share of the lower third: the full mouth",
    low: "the lips are thin against the chin and philtrum around them",
  },
  mouthCornerTilt: {
    high: "the mouth corners sit above the lip line at rest: the upturned set",
    low: "the corners sit below the lip line at rest: the downturned set, which reads sterner than intended",
  },
  // ---- proportions ----
  foreheadRatio: {
    high: "the forehead is tall against the eye-line span",
    low: "the forehead is short, bringing the hairline down toward the brows",
  },
  topThirdEst: {
    high: "the forehead takes more than a third of the face's height",
    low: "the forehead takes less than its third: the low-hairline balance",
  },
  middleLowerBalance: {
    high: "the midface is long against the lower face: weight in the middle of the face",
    low: "the lower face outruns the midface: weight below the nose",
  },
  fifthsEyeRatio: {
    high: "each eye is wide against the face's total width: eyes that dominate their fifth",
    low: "each eye is narrow against the face's width, leaving more of the face to cheek and temple",
  },
  facialIndex: {
    high: "the face is long for its width: the narrow, vertical build",
    low: "the face is wide for its length: the broad, compact build",
  },
  // ---- symmetry ----
  mirrorDeviation: {
    high: "paired landmarks sit further from perfect mirror placement than average, visible only side by side, not in life",
    low: "paired landmarks sit unusually close to perfect mirror placement",
  },
  canthalAsymmetry: {
    high: "the two eyes carry noticeably different tilts: one line rides higher than the other",
    low: "the two eyes tilt almost identically",
  },
  eyeMouthParallel: {
    high: "the mouth line runs at a visible angle to the eye line rather than parallel",
    low: "the mouth line tracks the eye line closely: the level, parallel set",
  },
  midlineDeviation: {
    high: "the centre features drift off the facial midline more than average",
    low: "nose, philtrum and chin stack tightly on one vertical line",
  },
  // ---- side profile ----
  //
  // Only the side metrics that actually ship carry entries. Six more are
  // written and held in git history (ramusMandible, submentalCervical,
  // mandibularPlane, chinProjection, foreheadSlope, midfaceRatioSide) for the
  // day the repeatability work puts those metrics back on the report — at
  // which point the guarantee test will fail on their absence here, which is
  // that mechanism doing its job.
  gonialAngle: {
    high: "the jaw's corner opens gradually into the neck: the soft, obtuse hinge",
    low: "the jaw turns a tight corner behind the ear: the square hinge that defines a profile",
  },
  chinRecession: {
    high: "the lips stand ahead of the chin's line: the chin reads set back beneath them",
    low: "the chin holds its own against the lips: the forward, anchored base",
  },
  facialConvexity: {
    high: "the profile runs nearly straight from brow to chin: the flat, balanced line",
    low: "the profile bends noticeably at the nose base: the midface carries forward of brow and chin",
  },
  totalFacialConvexity: {
    high: "measured through the nose tip the profile still runs straight: the nose sits close to the face's line",
    low: "the nose tip breaks well clear of the brow-to-chin line, bending the profile around it",
  },
  nasofrontalAngle: {
    high: "the brow flows into the nose bridge with barely a step: the smooth transition",
    low: "there is a deep notch where the brow meets the bridge: the strong browed profile",
  },
  nasolabialAngle: {
    high: "the angle under the nose is open: the tip and lip lift away from each other",
    low: "the angle under the nose is closed: the tip sits low toward the lip",
  },
  nasalProjection: {
    high: "the nose stands well off the face for its length",
    low: "the nose sits close to the face, little projection at the tip",
  },
  upperLipELine: {
    high: "the upper lip reaches toward the nose-to-chin line: the fuller, forward mouth in profile",
    low: "the upper lip sits well behind the nose-to-chin line: the flat mouth in profile",
  },
  lowerLipELine: {
    high: "the lower lip presses toward the nose-to-chin line: bottom-heavy in profile",
    low: "the lower lip sits well behind the line: the recessive lower mouth",
  },
  lowerThirdDepth: {
    high: "the lower face is deep front-to-back: jaw and chin carry real forward volume",
    low: "the lower face is shallow front-to-back, sitting close to the neck",
  },
};

// Excluded on purpose, with the reason on record: an id here gets no read and
// the guarantee test treats that as correct rather than as a gap.
//
// browTilt's measured values sit about twelve degrees from the published
// convention on every calibrated face, and until someone establishes whether
// that is the construction or the convention, any sentence about which way the
// brow leans has even odds of being backwards.
export const READ_EXCLUDED = new Set(["browTilt"]);

/** How far off the mean a value must lean before a sentence is offered. */
const LEAN_SD = 0.5;

/**
 * The one-sentence read for this measurement on this face, or null.
 *
 * Null is a real answer, returned for: no entry (excluded convention), a
 * reading the engine already refused (implausible/unmeasured), or a value too
 * close to the average for "yours leans" to be true. Callers render nothing —
 * never a placeholder.
 */
export function metricRead(m: ScoredMetric, sex: Sex): string | null {
  if (m.implausible || !Number.isFinite(m.value)) return null;
  const read = READS[m.def.id];
  if (!read) return null;
  const d = distFor(m.def, sex);
  if (!(d.sd > 0)) return null;
  const z = (m.value - d.mean) / d.sd;
  if (Math.abs(z) < LEAN_SD) return null;
  return z > 0 ? read.high : read.low;
}

/** Exported for the guarantee test only. */
export const READ_TABLE: Readonly<Record<string, Read>> = READS;
