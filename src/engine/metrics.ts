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
      male: { mean: 3.5, sd: 2.8, ideal: 6.0 },
      female: { mean: 4.5, sd: 2.8, ideal: 7.5 },
    },
  }),
  M({
    id: "eyeAspectRatio", name: "Eye aspect ratio", unit: "", decimals: 2,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 0.9,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 0.27, sd: 0.04, ideal: 0.25 },
      female: { mean: 0.28, sd: 0.04, ideal: 0.3 },
    },
  }),
  M({
    id: "eyeSeparationRatio", name: "Eye separation ratio", unit: "", decimals: 3,
    view: "front", region: "eyes", pillar: "Features", weight: 1.1,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.445, sd: 0.02, ideal: 0.45 },
      female: { mean: 0.45, sd: 0.02, ideal: 0.455 },
    },
  }),
  M({
    id: "intercanthalEyeWidth", name: "Intercanthal : eye width", unit: "×", decimals: 2,
    view: "front", region: "eyes", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.3, sd: 0.12, ideal: 1.28 },
      female: { mean: 1.3, sd: 0.12, ideal: 1.28 },
    },
  }),
  M({
    id: "browPosition", name: "Brow height", unit: "×IPD", decimals: 3,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 0.235, sd: 0.03, ideal: 0.215 },
      female: { mean: 0.26, sd: 0.03, ideal: 0.26 },
    },
  }),
  M({
    id: "browTilt", name: "Brow tilt", unit: "°", decimals: 1,
    view: "front", region: "eyes", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 2, sd: 4, ideal: 4 },
      female: { mean: 3, sd: 4, ideal: 6 },
    },
  }),

  // ---- Midface ----
  M({
    id: "fwhr", name: "Facial width-to-height (fWHR)", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Dimorphism", weight: 1.2,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 2.15, sd: 0.13, ideal: 2.25 },
      female: { mean: 2.1, sd: 0.13, ideal: 2.1 },
    },
  }),
  M({
    id: "midfaceRatio", name: "Midface ratio", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Harmony", weight: 1.2,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.0, sd: 0.07, ideal: 1.03 },
      female: { mean: 1.02, sd: 0.07, ideal: 1.05 },
    },
  }),
  M({
    id: "cheekboneHeight", name: "Cheekbone height", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 0.18, sd: 0.05, ideal: 0.15 },
      female: { mean: 0.18, sd: 0.05, ideal: 0.14 },
    },
  }),

  // ---- Jaw ----
  M({
    id: "jawCheekRatio", name: "Jaw : cheekbone width", unit: "", decimals: 3,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.2,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 0.87, sd: 0.04, ideal: 0.9 },
      female: { mean: 0.86, sd: 0.04, ideal: 0.83 },
    },
  }),
  M({
    id: "gonialProxy", name: "Gonial angularity (frontal)", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.3,
    direction: "band", fixability: 0.7,
    dist: {
      male: { mean: 140, sd: 6, ideal: 133 },
      female: { mean: 142, sd: 6, ideal: 138 },
    },
  }),
  M({
    id: "jawFrontalAngle", name: "Jaw frontal angle", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: 94, sd: 6, ideal: 97 },
      female: { mean: 95, sd: 6, ideal: 92 },
    },
  }),

  // ---- Chin ----
  M({
    id: "chinHeightRatio", name: "Chin height proportion", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 0.66, sd: 0.04, ideal: 0.67 },
      female: { mean: 0.65, sd: 0.04, ideal: 0.64 },
    },
  }),
  M({
    id: "philtrumChinRatio", name: "Chin : philtrum ratio", unit: "×", decimals: 2,
    view: "front", region: "chin", pillar: "Features", weight: 0.8,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 4.0, sd: 0.7, ideal: 4.2 },
      female: { mean: 3.9, sd: 0.7, ideal: 3.7 },
    },
  }),
  M({
    id: "chinWidthRatio", name: "Chin width ratio", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Angularity", weight: 0.8,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 0.55, sd: 0.06, ideal: 0.58 },
      female: { mean: 0.55, sd: 0.06, ideal: 0.52 },
    },
  }),
  M({
    id: "lowerFacePct", name: "Lower face proportion", unit: "%", decimals: 1,
    view: "front", region: "chin", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 53, sd: 3, ideal: 54 },
      female: { mean: 52, sd: 3, ideal: 51 },
    },
  }),

  // ---- Nose ----
  M({
    id: "noseMouthRatio", name: "Nose : mouth width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.65, sd: 0.06, ideal: 0.63 },
      female: { mean: 0.63, sd: 0.06, ideal: 0.6 },
    },
  }),
  M({
    id: "noseIntercanthal", name: "Nose : intercanthal width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.25, sd: 0.12, ideal: 1.2 },
      female: { mean: 1.2, sd: 0.12, ideal: 1.15 },
    },
  }),
  M({
    id: "nasalIndex", name: "Nasal index (frontal)", unit: "", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.88, sd: 0.09, ideal: 0.85 },
      female: { mean: 0.86, sd: 0.09, ideal: 0.82 },
    },
  }),

  // ---- Lips ----
  M({
    id: "lipRatio", name: "Lower : upper lip ratio", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 1.55, sd: 0.4, ideal: 1.6 },
      female: { mean: 1.5, sd: 0.4, ideal: 1.4 },
    },
  }),
  M({
    id: "mouthIPD", name: "Mouth width : IPD", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.95, sd: 0.1, ideal: 0.98 },
      female: { mean: 0.95, sd: 0.1, ideal: 1.0 },
    },
  }),
  M({
    id: "lipHeightLowerThird", name: "Lip fullness (of lower third)", unit: "%", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 29, sd: 5, ideal: 28 },
      female: { mean: 30, sd: 5, ideal: 33 },
    },
  }),
  M({
    id: "mouthCornerTilt", name: "Mouth corner tilt", unit: "°", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: 3.5, sd: 3.5, ideal: 4 },
      female: { mean: 3.5, sd: 3.5, ideal: 4.5 },
    },
  }),

  // ---- Proportions ----
  M({
    id: "topThirdEst", name: "Upper face proportion (est.)", unit: "%", decimals: 1,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.7,
    direction: "band", fixability: 0.15,
    dist: {
      male: { mean: 21, sd: 2.5, ideal: 21.5 },
      female: { mean: 21, sd: 2.5, ideal: 21.5 },
    },
  }),
  M({
    id: "middleLowerBalance", name: "Midface : lower face balance", unit: "×", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.83, sd: 0.06, ideal: 0.86 },
      female: { mean: 0.84, sd: 0.06, ideal: 0.87 },
    },
  }),
  M({
    id: "fifthsEyeRatio", name: "Eye width : face width (fifths)", unit: "", decimals: 3,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.18, sd: 0.013, ideal: 0.185 },
      female: { mean: 0.183, sd: 0.013, ideal: 0.19 },
    },
  }),
  M({
    id: "facialIndex", name: "Facial index (height : width)", unit: "", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 1.25, sd: 0.09, ideal: 1.3 },
      female: { mean: 1.25, sd: 0.09, ideal: 1.27 },
    },
  }),

  // ---- Symmetry ----
  M({
    id: "mirrorDeviation", name: "Mirror-axis deviation", unit: "% IPD", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 1.2,
    direction: "lower", fixability: 0.35,
    dist: {
      male: { mean: 3.2, sd: 1.4 },
      female: { mean: 3.2, sd: 1.4 },
    },
  }),
  M({
    id: "canthalAsymmetry", name: "Canthal tilt asymmetry", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.15,
    dist: {
      male: { mean: 1.6, sd: 1.2 },
      female: { mean: 1.6, sd: 1.2 },
    },
  }),
  M({
    id: "eyeMouthParallel", name: "Eye-line / mouth-line skew", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.8,
    direction: "lower", fixability: 0.3,
    dist: {
      male: { mean: 1.5, sd: 1.1 },
      female: { mean: 1.5, sd: 1.1 },
    },
  }),
  M({
    id: "midlineDeviation", name: "Midline deviation", unit: "% IPD", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.2,
    dist: {
      male: { mean: 2.0, sd: 1.2 },
      female: { mean: 2.0, sd: 1.2 },
    },
  }),
];
