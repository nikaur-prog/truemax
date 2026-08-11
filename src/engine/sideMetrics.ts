import type { Pt } from "./geometry.ts";
import { angleAt, dist } from "./geometry.ts";
import type { MetricDef } from "./types.ts";

// ---------------------------------------------------------------------------
// Side-profile engine. MediaPipe cannot reliably auto-landmark a true 90°
// profile, so the side view uses a small set of user-verifiable points: the
// app auto-places a best guess, the user drags to correct, then these metrics
// compute from the corrected points. Every distance is normalized by the
// nasion→menton facial height so image scale never matters.
// ---------------------------------------------------------------------------

export const SIDE_POINTS = [
  { id: "trichion", label: "Hairline", hint: "Top of the forehead where hair starts" },
  { id: "glabella", label: "Brow ridge", hint: "Most prominent point between the brows" },
  { id: "nasion", label: "Nose bridge", hint: "Deepest dip between brow and nose" },
  { id: "pronasale", label: "Nose tip", hint: "Furthest-forward point of the nose" },
  { id: "subnasale", label: "Nose base", hint: "Where the nose meets the upper lip" },
  { id: "labialeSuperius", label: "Upper lip", hint: "Fullest point of the upper lip" },
  { id: "labialeInferius", label: "Lower lip", hint: "Fullest point of the lower lip" },
  { id: "pogonion", label: "Chin front", hint: "Furthest-forward point of the chin" },
  { id: "menton", label: "Chin bottom", hint: "Lowest point of the chin" },
  { id: "gonion", label: "Jaw corner", hint: "The angle where the jaw turns upward" },
  { id: "condylion", label: "Jaw top", hint: "Just in front of the ear canal" },
  { id: "cervicale", label: "Neck point", hint: "Where the under-chin meets the neck" },
  { id: "tragion", label: "Ear notch", hint: "Notch at the front of the ear" },
] as const;

export type SidePointId = (typeof SIDE_POINTS)[number]["id"];
export type SidePoints = Record<SidePointId, Pt>;

// Signed angle of a→b from vertical, positive = b is forward of a.
// `faceDir` is +1 when the subject faces image-right, -1 when image-left.
function fromVertical(a: Pt, b: Pt, faceDir: number): number {
  return (Math.atan2((b.x - a.x) * faceDir, a.y - b.y) * 180) / Math.PI;
}

// Perpendicular distance from p to line a→b; positive = ahead of the line.
//
// The multiplier is `faceDir`, and it used to be `-faceDir`, which inverted
// every projection measurement in the report.
//
// The tell is nasal projection. The nose tip is ahead of the nasion→subnasale
// line on every human face that has ever existed, so the metric must come back
// positive — and as shipped it came back NEGATIVE on all three test profiles
// (-16.5, -10.1, -19.6 against a +18±4 norm). That is not a face scoring badly,
// it is an axis pointing the wrong way: the engine was placing the tip of the
// nose behind the plane of the face and then charging 8 standard deviations for
// it. Corrected, the same profile reads +16.5 against that norm — z = -0.38,
// which is average, which is what a nose that looks like a nose should score.
//
// Verified in both directions on synthetic faces where the answer is true by
// construction (tools note in docs/SIDE_FIXTURES.md). With y growing downward,
// cross(a→p, a→b) is negative when p is ahead for a left-facing subject and
// positive when p is ahead for a right-facing one, so faceDir alone maps both
// onto "positive means forward".
function aheadOf(p: Pt, a: Pt, b: Pt, faceDir: number): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1e-6;
  return (((p.x - a.x) * vy - (p.y - a.y) * vx) / len) * faceDir;
}

export function computeSideMetrics(p: SidePoints, faceDir: number): Record<string, number> {
  const faceH = dist(p.nasion, p.menton) || 1e-6;

  return {
    // Jaw
    gonialAngle: angleAt(p.gonion, p.condylion, p.menton),
    ramusMandible: dist(p.condylion, p.gonion) / dist(p.gonion, p.menton),
    submentalCervical: angleAt(p.cervicale, p.menton, { x: p.cervicale.x, y: p.cervicale.y + faceH }),
    mandibularPlane: fromVertical(p.gonion, p.menton, faceDir) - 90,

    // Chin / projection
    chinProjection: (aheadOf(p.pogonion, p.nasion, p.subnasale, faceDir) / faceH) * 100,
    facialConvexity: angleAt(p.subnasale, p.glabella, p.pogonion),
    totalFacialConvexity: angleAt(p.pronasale, p.glabella, p.pogonion),

    // Nose
    nasofrontalAngle: angleAt(p.nasion, p.glabella, p.pronasale),
    nasolabialAngle: angleAt(p.subnasale, p.pronasale, p.labialeSuperius),
    nasalProjection: (aheadOf(p.pronasale, p.nasion, p.subnasale, faceDir) / faceH) * 100,

    // Lips (Ricketts' E-line: pronasale → pogonion)
    upperLipELine: (aheadOf(p.labialeSuperius, p.pronasale, p.pogonion, faceDir) / faceH) * 100,
    lowerLipELine: (aheadOf(p.labialeInferius, p.pronasale, p.pogonion, faceDir) / faceH) * 100,

    // Proportions
    lowerThirdDepth: dist(p.subnasale, p.menton) / faceH,
    // Negated, for the same class of reason as aheadOf above. A forehead slopes
    // BACK, and the norm states that as a positive 12°. fromVertical measures
    // how far the hairline sits forward of the brow, which for every real
    // forehead is negative — so the raw value came back at about -11° on all
    // three test profiles against a +12±6 norm, a 4-sigma penalty applied to
    // every human being. Negated, the same profiles read +11.3 and +11.9, which
    // is z = -0.12 and -0.02: normal foreheads scoring normally.
    foreheadSlope: -fromVertical(p.glabella, p.trichion, faceDir),
    midfaceRatioSide: dist(p.tragion, p.pronasale) / faceH,
  };
}

const S = (def: MetricDef) => def;

// Reference distributions seeded from published cephalometric norms
// (Legan–Burstone, Ricketts, Arnett). Side view is measured on real anatomy
// rather than a mesh approximation, so these track literature more closely
// than the front-face seeds — but still need hand-tuning against test faces.
//
// TWO OF THESE ARE MEASURABLY WRONG, and it is worth naming which rather than
// leaving the next person to rediscover it. Across every hand-verified profile
// measured so far (docs/SIDE_FIXTURES.md):
//
//   midfaceRatioSide   +2.7, +2.3, +2.5, +3.0   — every face, always high
//   submentalCervical  −2.5, −3.5, −4.0, −1.9   — every face, always low
//
// A metric that scores four of four faces at three sigma is not describing four
// unusual faces, it is describing a norm in the wrong place. midfaceRatioSide is
// the clearer case: it is tragion→pronasale over nasion→menton, which is not a
// standard cephalometric ratio at all, so its 1.02 mean was a guess rather than
// a citation, and real faces land nearer 1.3.
//
// They are NOT corrected here, because the fix needs profiles from many people
// and every fixture so far is one person. Setting a population mean from a
// single face would replace a wrong number with a differently wrong number and
// lose the evidence that it was wrong. Until then both quietly cost every user
// roughly a point of side score. See VALIDITY.md for the same argument at the
// level of the whole engine.
export const SIDE_METRICS: MetricDef[] = [
  S({
    id: "gonialAngle", name: "Gonial angle", unit: "°", decimals: 1,
    view: "side", region: "jaw", pillar: "Angularity", weight: 1.4,
    direction: "band", fixability: 0.15,
    dist: { male: { mean: 125, sd: 7, ideal: 119 }, female: { mean: 126, sd: 7, ideal: 122 } },
  }),
  S({
    id: "ramusMandible", name: "Ramus : mandible ratio", unit: "", decimals: 2,
    view: "side", region: "jaw", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: { male: { mean: 0.72, sd: 0.08, ideal: 0.75 }, female: { mean: 0.72, sd: 0.08, ideal: 0.73 } },
  }),
  S({
    id: "submentalCervical", name: "Submental cervical angle", unit: "°", decimals: 1,
    view: "side", region: "jaw", pillar: "Angularity", weight: 1.2,
    direction: "band", fixability: 0.8,
    dist: { male: { mean: 110, sd: 11, ideal: 95 }, female: { mean: 108, sd: 11, ideal: 95 } },
  }),
  S({
    id: "mandibularPlane", name: "Mandibular plane angle", unit: "°", decimals: 1,
    view: "side", region: "jaw", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.1,
    dist: { male: { mean: 23, sd: 6, ideal: 19 }, female: { mean: 25, sd: 6, ideal: 22 } },
  }),
  S({
    id: "chinProjection", name: "Chin projection", unit: "%", decimals: 1,
    view: "side", region: "chin", pillar: "Dimorphism", weight: 1.3,
    direction: "band", fixability: 0.1,
    dist: { male: { mean: -2, sd: 4, ideal: 1 }, female: { mean: -3, sd: 4, ideal: -1 } },
  }),
  S({
    id: "facialConvexity", name: "Facial convexity (glabella)", unit: "°", decimals: 1,
    view: "side", region: "proportions", pillar: "Harmony", weight: 1.2,
    direction: "band", fixability: 0,
    dist: { male: { mean: 167, sd: 5, ideal: 170 }, female: { mean: 166, sd: 5, ideal: 169 } },
  }),
  S({
    id: "totalFacialConvexity", name: "Total facial convexity", unit: "°", decimals: 1,
    view: "side", region: "proportions", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: { male: { mean: 138, sd: 6, ideal: 140 }, female: { mean: 137, sd: 6, ideal: 139 } },
  }),
  S({
    id: "nasofrontalAngle", name: "Nasofrontal angle", unit: "°", decimals: 1,
    view: "side", region: "nose", pillar: "Features", weight: 1.0,
    direction: "band", fixability: 0,
    dist: { male: { mean: 133, sd: 7, ideal: 130 }, female: { mean: 136, sd: 7, ideal: 134 } },
  }),
  S({
    id: "nasolabialAngle", name: "Nasolabial angle", unit: "°", decimals: 1,
    view: "side", region: "nose", pillar: "Features", weight: 1.0,
    direction: "band", fixability: 0,
    dist: { male: { mean: 97, sd: 8, ideal: 95 }, female: { mean: 103, sd: 8, ideal: 103 } },
  }),
  S({
    id: "nasalProjection", name: "Nasal projection", unit: "%", decimals: 1,
    view: "side", region: "nose", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0,
    dist: { male: { mean: 18, sd: 4, ideal: 17 }, female: { mean: 18, sd: 4, ideal: 17 } },
  }),
  S({
    id: "upperLipELine", name: "Upper lip to E-line", unit: "%", decimals: 1,
    view: "side", region: "lips", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: { male: { mean: -5, sd: 3, ideal: -5 }, female: { mean: -4, sd: 3, ideal: -3 } },
  }),
  S({
    id: "lowerLipELine", name: "Lower lip to E-line", unit: "%", decimals: 1,
    view: "side", region: "lips", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: { male: { mean: -3, sd: 3, ideal: -2 }, female: { mean: -2, sd: 3, ideal: -1 } },
  }),
  S({
    id: "lowerThirdDepth", name: "Lower-third depth", unit: "", decimals: 2,
    view: "side", region: "proportions", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0.15,
    dist: { male: { mean: 0.66, sd: 0.05, ideal: 0.67 }, female: { mean: 0.65, sd: 0.05, ideal: 0.65 } },
  }),
  S({
    id: "foreheadSlope", name: "Forehead slope", unit: "°", decimals: 1,
    view: "side", region: "proportions", pillar: "Dimorphism", weight: 0.8,
    direction: "band", fixability: 0,
    dist: { male: { mean: 12, sd: 6, ideal: 14 }, female: { mean: 9, sd: 6, ideal: 8 } },
  }),
  S({
    id: "midfaceRatioSide", name: "Midface depth ratio", unit: "", decimals: 2,
    view: "side", region: "midface", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: { male: { mean: 1.02, sd: 0.09, ideal: 1.0 }, female: { mean: 1.0, sd: 0.09, ideal: 0.98 } },
  }),
];
