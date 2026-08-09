import type { Geom, Pt } from "./geometry.ts";
import { LM, MIRROR_PAIRS, dist, mid, angleAt, lineTiltDeg } from "./geometry.ts";
import type { MetricDef } from "./types.ts";

// ---------------------------------------------------------------------------
// Metric computers. Every distance is normalized by IPD (interpupillary
// distance) or expressed as a ratio/angle, so absolute image scale never
// matters. All coordinates are roll-corrected pixel space (see geometry.ts).
// ---------------------------------------------------------------------------

interface Derived {
  g: Geom;
  ipd: number;
  eyeMid: Pt; // midpoint between iris centers
  bizygo: number; // face width at the cheekbones
  bigonial: number; // jaw width at the gonial area
  mouthW: number;
  noseW: number;
  eyeWR: number;
  eyeWL: number;
  intercanthal: number;
  faceH: number; // mesh top → menton
  lowerThird: number; // subnasale → menton
  stomion: Pt;
}

function derive(g: Geom): Derived {
  const p = g.pt.bind(g);
  const alarXs = [...LM.ALAR_R, ...LM.ALAR_L].map((i) => p(i).x);
  return {
    g,
    ipd: g.ipd,
    eyeMid: mid(p(LM.IRIS_R), p(LM.IRIS_L)),
    bizygo: dist(p(LM.ZYGO_R), p(LM.ZYGO_L)),
    bigonial: dist(p(LM.GONION_R), p(LM.GONION_L)),
    mouthW: dist(p(LM.MOUTH_R), p(LM.MOUTH_L)),
    noseW: Math.max(...alarXs) - Math.min(...alarXs),
    eyeWR: dist(p(LM.EYE_R_OUTER), p(LM.EYE_R_INNER)),
    eyeWL: dist(p(LM.EYE_L_OUTER), p(LM.EYE_L_INNER)),
    intercanthal: dist(p(LM.EYE_R_INNER), p(LM.EYE_L_INNER)),
    faceH: dist(p(LM.FOREHEAD_TOP), p(LM.MENTON)),
    lowerThird: dist(p(LM.SUBNASALE), p(LM.MENTON)),
    stomion: mid(p(LM.LIP_UPPER_INNER), p(LM.LIP_LOWER_INNER)),
  };
}

// Canthal tilt of one eye: angle of inner→outer canthus line vs horizontal,
// positive when the outer corner sits higher.
function canthalTiltEye(g: Geom, inner: number, outer: number): number {
  return lineTiltDeg(g.pt(inner), g.pt(outer));
}

type Computer = (d: Derived) => number;

export const COMPUTERS: Record<string, Computer> = {
  // ---- Eyes ----
  canthalTilt: (d) =>
    (canthalTiltEye(d.g, LM.EYE_R_INNER, LM.EYE_R_OUTER) +
      canthalTiltEye(d.g, LM.EYE_L_INNER, LM.EYE_L_OUTER)) / 2,

  eyeAspectRatio: (d) => {
    const p = d.g.pt.bind(d.g);
    const hR = dist(p(LM.EYE_R_TOP), p(LM.EYE_R_BOTTOM));
    const hL = dist(p(LM.EYE_L_TOP), p(LM.EYE_L_BOTTOM));
    return (hR / d.eyeWR + hL / d.eyeWL) / 2;
  },

  eyeSeparationRatio: (d) => d.ipd / d.bizygo,

  intercanthalEyeWidth: (d) => d.intercanthal / ((d.eyeWR + d.eyeWL) / 2),

  browPosition: (d) => {
    const p = d.g.pt.bind(d.g);
    const hR = dist(p(LM.BROW_R_MID), p(LM.IRIS_R));
    const hL = dist(p(LM.BROW_L_MID), p(LM.IRIS_L));
    return (hR + hL) / 2 / d.ipd;
  },

  browTilt: (d) => {
    const p = d.g.pt.bind(d.g);
    const tR = lineTiltDeg(p(LM.BROW_R_MEDIAL), p(LM.BROW_R_LATERAL));
    const tL = lineTiltDeg(p(LM.BROW_L_MEDIAL), p(LM.BROW_L_LATERAL));
    return (tR + tL) / 2;
  },

  // ---- Midface ----
  fwhr: (d) => {
    const p = d.g.pt.bind(d.g);
    const lidY = (p(LM.EYE_R_TOP).y + p(LM.EYE_L_TOP).y) / 2;
    const upperFaceH = Math.abs(p(LM.LIP_TOP).y - lidY);
    return d.bizygo / upperFaceH;
  },

  midfaceRatio: (d) => d.ipd / dist(d.eyeMid, d.g.pt(LM.LIP_TOP)),

  cheekboneHeight: (d) => {
    const p = d.g.pt.bind(d.g);
    const zygoY = (p(LM.ZYGO_R).y + p(LM.ZYGO_L).y) / 2;
    return (zygoY - d.eyeMid.y) / (p(LM.MENTON).y - d.eyeMid.y);
  },

  // ---- Jaw ----
  jawCheekRatio: (d) => d.bigonial / d.bizygo,

  gonialProxy: (d) => {
    const p = d.g.pt.bind(d.g);
    const aR = angleAt(p(LM.GONION_R), p(LM.ZYGO_R), p(LM.MENTON));
    const aL = angleAt(p(LM.GONION_L), p(LM.ZYGO_L), p(LM.MENTON));
    return (aR + aL) / 2;
  },

  jawFrontalAngle: (d) => {
    const p = d.g.pt.bind(d.g);
    return angleAt(p(LM.MENTON), p(LM.GONION_R), p(LM.GONION_L));
  },

  // ---- Chin ----
  chinHeightRatio: (d) => dist(d.stomion, d.g.pt(LM.MENTON)) / d.lowerThird,

  philtrumChinRatio: (d) => {
    const p = d.g.pt.bind(d.g);
    const philtrum = dist(p(LM.SUBNASALE), p(LM.LIP_TOP));
    return dist(d.stomion, p(LM.MENTON)) / philtrum;
  },

  chinWidthRatio: (d) => {
    const p = d.g.pt.bind(d.g);
    return dist(p(LM.CHIN_SIDE_R), p(LM.CHIN_SIDE_L)) / d.bigonial;
  },

  lowerFacePct: (d) => {
    const p = d.g.pt.bind(d.g);
    return (d.lowerThird / dist(p(LM.GLABELLA), p(LM.MENTON))) * 100;
  },

  // ---- Nose ----
  noseMouthRatio: (d) => d.noseW / d.mouthW,

  noseIntercanthal: (d) => d.noseW / d.intercanthal,

  nasalIndex: (d) => {
    const p = d.g.pt.bind(d.g);
    return d.noseW / dist(p(LM.NASION), p(LM.SUBNASALE));
  },

  // ---- Lips ----
  lipRatio: (d) => {
    const p = d.g.pt.bind(d.g);
    const upper = dist(p(LM.LIP_TOP), p(LM.LIP_UPPER_INNER));
    const lower = dist(p(LM.LIP_LOWER_INNER), p(LM.LIP_BOTTOM));
    return lower / Math.max(upper, 1e-6);
  },

  mouthIPD: (d) => d.mouthW / d.ipd,

  lipHeightLowerThird: (d) => {
    const p = d.g.pt.bind(d.g);
    const total = dist(p(LM.LIP_TOP), p(LM.LIP_BOTTOM));
    return (total / d.lowerThird) * 100;
  },

  mouthCornerTilt: (d) => {
    const p = d.g.pt.bind(d.g);
    const cornerY = (p(LM.MOUTH_R).y + p(LM.MOUTH_L).y) / 2;
    // Positive = corners sit above the stomion line (upturned)
    return (Math.atan2(d.stomion.y - cornerY, d.mouthW / 2) * 180) / Math.PI;
  },

  // ---- Proportions ----
  topThirdEst: (d) => {
    const p = d.g.pt.bind(d.g);
    return (dist(p(LM.FOREHEAD_TOP), p(LM.GLABELLA)) / d.faceH) * 100;
  },

  middleLowerBalance: (d) => {
    const p = d.g.pt.bind(d.g);
    return dist(p(LM.GLABELLA), p(LM.SUBNASALE)) / d.lowerThird;
  },

  fifthsEyeRatio: (d) => (d.eyeWR + d.eyeWL) / 2 / d.bizygo,

  facialIndex: (d) => d.faceH / d.bizygo,

  // ---- Symmetry ----
  mirrorDeviation: (d) => {
    const p = d.g.pt.bind(d.g);
    const axisX = d.eyeMid.x;
    let sum = 0;
    for (const [a, b] of MIRROR_PAIRS) {
      const pa = p(a);
      const pb = p(b);
      const dx = axisX - pa.x - (pb.x - axisX); // mismatch of mirrored x
      const dy = pa.y - pb.y;
      sum += dx * dx + dy * dy;
    }
    return (Math.sqrt(sum / MIRROR_PAIRS.length) / d.ipd) * 100;
  },

  canthalAsymmetry: (d) =>
    Math.abs(
      canthalTiltEye(d.g, LM.EYE_R_INNER, LM.EYE_R_OUTER) -
        canthalTiltEye(d.g, LM.EYE_L_INNER, LM.EYE_L_OUTER),
    ),

  eyeMouthParallel: (d) => {
    const p = d.g.pt.bind(d.g);
    // Eye line is horizontal by construction (roll-corrected), so this is
    // simply the mouth line's tilt magnitude.
    return Math.abs(lineTiltDeg(p(LM.MOUTH_R), p(LM.MOUTH_L)));
  },

  midlineDeviation: (d) => {
    const p = d.g.pt.bind(d.g);
    const axisX = d.eyeMid.x;
    const offsets = [LM.NOSE_TIP, LM.SUBNASALE, LM.MENTON, LM.LIP_TOP].map(
      (i) => Math.abs(p(i).x - axisX),
    );
    return (offsets.reduce((a, b) => a + b, 0) / offsets.length / d.ipd) * 100;
  },
};

export function computeRawMetrics(g: Geom): Record<string, number> {
  const d = derive(g);
  const out: Record<string, number> = {};
  for (const [id, fn] of Object.entries(COMPUTERS)) out[id] = fn(d);
  return out;
}

// ---------------------------------------------------------------------------
// Metric definitions. Distribution means/SDs are in MESH-MEASUREMENT SPACE —
// seeded from published facial-anthropometry averages where the mesh tracks
// anatomy closely, hand-calibrated against test faces where it doesn't
// (see CALIBRATION.md). Tune means/SDs/ideals here; nothing else changes.
// ---------------------------------------------------------------------------

const M = (def: MetricDef) => def;

export const METRICS: MetricDef[] = [
  // ---- Eyes ----
  M({
    id: "canthalTilt", name: "Canthal tilt", unit: "°", decimals: 1,
    view: "front", region: "eyes", pillar: "Features", weight: 1.3,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: -21.72, sd: 15.938, ideal: -6.5 },
      female: { mean: 5.54, sd: 7.932, ideal: -2.392 },
    },
  }),
  M({
    id: "eyeAspectRatio", name: "Eye aspect ratio", unit: "", decimals: 2,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 0.9,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 0.36, sd: 0.089, ideal: 0.297 },
      female: { mean: 0.255, sd: 0.0697, ideal: 0.3247 },
    },
  }),
  M({
    id: "eyeSeparationRatio", name: "Eye separation ratio", unit: "", decimals: 3,
    view: "front", region: "eyes", pillar: "Features", weight: 1.1,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.4377, sd: 0.02609, ideal: 0.4161 },
      female: { mean: 0.4536, sd: 0.00578, ideal: 0.44782 },
    },
  }),
  M({
    id: "intercanthalEyeWidth", name: "Intercanthal : eye width", unit: "×", decimals: 2,
    view: "front", region: "eyes", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.345, sd: 0.2016, ideal: 1.442 },
      female: { mean: 1.401, sd: 0.2179, ideal: 1.288 },
    },
  }),
  M({
    id: "browPosition", name: "Brow height", unit: "×IPD", decimals: 3,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 0.6227, sd: 0.27087, ideal: 0.6841 },
      female: { mean: 0.2117, sd: 0.10867, ideal: 0.32037 },
    },
  }),
  M({
    id: "browTilt", name: "Brow tilt", unit: "°", decimals: 1,
    view: "front", region: "eyes", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: -46.62, sd: 12.098, ideal: -34.522 },
      female: { mean: 10.14, sd: 24.73, ideal: -14.59 },
    },
  }),

  // ---- Midface ----
  M({
    id: "fwhr", name: "Facial width-to-height (fWHR)", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Dimorphism", weight: 1.2,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 6.943, sd: 5.5271, ideal: 6.565 },
      female: { mean: 3.529, sd: 2.5427, ideal: 6.0717 },
    },
  }),
  M({
    id: "midfaceRatio", name: "Midface ratio", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Harmony", weight: 1.2,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.649, sd: 1.2513, ideal: 1.5 },
      female: { mean: 0.896, sd: 0.3662, ideal: 1.2622 },
    },
  }),
  M({
    id: "cheekboneHeight", name: "Cheekbone height", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 1.427, sd: 0.7947, ideal: 0.744 },
      female: { mean: -0.12, sd: 0.679, ideal: 0.559 },
    },
  }),

  // ---- Jaw ----
  M({
    id: "jawCheekRatio", name: "Jaw : cheekbone width", unit: "", decimals: 3,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.2,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 0.8938, sd: 0.01838, ideal: 0.8943 },
      female: { mean: 0.8732, sd: 0.00741, ideal: 0.88061 },
    },
  }),
  M({
    id: "gonialProxy", name: "Gonial angularity (frontal)", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.3,
    direction: "band", fixability: 0.7,
    dist: {
      male: { mean: 68.94, sd: 39.23, ideal: 91.68 },
      female: { mean: 164.11, sd: 8.362, ideal: 155.748 },
    },
  }),
  M({
    id: "jawFrontalAngle", name: "Jaw frontal angle", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: 42.4, sd: 12.839, ideal: 33.11 },
      female: { mean: 38.34, sd: 5.604, ideal: 43.03 },
    },
  }),

  // ---- Chin ----
  M({
    id: "chinHeightRatio", name: "Chin height proportion", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 0.671, sd: 0.0119, ideal: 0.67 },
      female: { mean: 0.689, sd: 0.0341, ideal: 0.7 },
    },
  }),
  M({
    id: "philtrumChinRatio", name: "Chin : philtrum ratio", unit: "×", decimals: 2,
    view: "front", region: "chin", pillar: "Features", weight: 0.8,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 4.331, sd: 1.3477, ideal: 5.035 },
      female: { mean: 2.857, sd: 1.9452, ideal: 4.8022 },
    },
  }),
  M({
    id: "chinWidthRatio", name: "Chin width ratio", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Angularity", weight: 0.8,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 0.501, sd: 0.0104, ideal: 0.5 },
      female: { mean: 0.492, sd: 0.0089, ideal: 0.496 },
    },
  }),
  M({
    id: "lowerFacePct", name: "Lower face proportion", unit: "%", decimals: 1,
    view: "front", region: "chin", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 69.58, sd: 3.662, ideal: 70.94 },
      female: { mean: 47.88, sd: 28.851, ideal: 72.13 },
    },
  }),

  // ---- Nose ----
  M({
    id: "noseMouthRatio", name: "Nose : mouth width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.825, sd: 0.0979, ideal: 0.854 },
      female: { mean: 0.756, sd: 0.0741, ideal: 0.822 },
    },
  }),
  M({
    id: "noseIntercanthal", name: "Nose : intercanthal width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.298, sd: 0.0875, ideal: 1.32 },
      female: { mean: 1.138, sd: 0.0979, ideal: 1.2359 },
    },
  }),
  M({
    id: "nasalIndex", name: "Nasal index (frontal)", unit: "", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.372, sd: 0.2684, ideal: 1.6404 },
      female: { mean: 0.955, sd: 0.3588, ideal: 1.3138 },
    },
  }),

  // ---- Lips ----
  M({
    id: "lipRatio", name: "Lower : upper lip ratio", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 0.244, sd: 0.2283, ideal: 0.329 },
      female: { mean: 1.068, sd: 0.891, ideal: 0.3795 },
    },
  }),
  M({
    id: "mouthIPD", name: "Mouth width : IPD", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.894, sd: 0.0697, ideal: 0.9637 },
      female: { mean: 0.852, sd: 0.0445, ideal: 0.8965 },
    },
  }),
  M({
    id: "lipHeightLowerThird", name: "Lip fullness (of lower third)", unit: "%", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 20.19, sd: 3.025, ideal: 23.215 },
      female: { mean: 31.39, sd: 5.308, ideal: 28.375 },
    },
  }),
  M({
    id: "mouthCornerTilt", name: "Mouth corner tilt", unit: "°", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: -43.35, sd: 26.82, ideal: -16.53 },
      female: { mean: 11.28, sd: 24.241, ideal: -12.961 },
    },
  }),

  // ---- Proportions ----
  M({
    id: "topThirdEst", name: "Upper face proportion (est.)", unit: "%", decimals: 1,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.7,
    direction: "band", fixability: 0.15,
    dist: {
      male: { mean: 9.92, sd: 4.552, ideal: 13.25 },
      female: { mean: 29.34, sd: 4.715, ideal: 24.625 },
    },
  }),
  M({
    id: "middleLowerBalance", name: "Midface : lower face balance", unit: "×", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.454, sd: 0.0741, ideal: 0.458 },
      female: { mean: 1.545, sd: 1.2009, ideal: 0.4125 },
    },
  }),
  M({
    id: "fifthsEyeRatio", name: "Eye width : face width (fifths)", unit: "", decimals: 3,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.1923, sd: 0.01927, ideal: 0.1801 },
      female: { mean: 0.1884, sd: 0.01512, ideal: 0.20352 },
    },
  }),
  M({
    id: "facialIndex", name: "Facial index (height : width)", unit: "", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 1.135, sd: 0.3543, ideal: 0.869 },
      female: { mean: 0.933, sd: 0.3543, ideal: 1.109 },
    },
  }),

  // ---- Symmetry ----
  M({
    id: "mirrorDeviation", name: "Mirror-axis deviation", unit: "% IPD", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 1.2,
    direction: "lower", fixability: 0.35,
    dist: {
      male: { mean: 128.41, sd: 75.687 },
      female: { mean: 105.78, sd: 20.653 },
    },
  }),
  M({
    id: "canthalAsymmetry", name: "Canthal tilt asymmetry", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.15,
    dist: {
      male: { mean: 6.17, sd: 4.818 },
      female: { mean: 6.43, sd: 3.988 },
    },
  }),
  M({
    id: "eyeMouthParallel", name: "Eye-line / mouth-line skew", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.8,
    direction: "lower", fixability: 0.3,
    dist: {
      male: { mean: 0.97, sd: 1.067 },
      female: { mean: 0.98, sd: 0.326 },
    },
  }),
  M({
    id: "midlineDeviation", name: "Midline deviation", unit: "% IPD", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.2,
    dist: {
      male: { mean: 60.61, sd: 32.706 },
      female: { mean: 62.18, sd: 49.371 },
    },
  }),
];
