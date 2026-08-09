import type { Geom, Pt } from "./geometry.ts";
import { LM, MIRROR_PAIRS, dist, mid, angleAt, lineTiltDeg } from "./geometry.ts";
import type { MetricDef } from "./types.ts";

// ---------------------------------------------------------------------------
// Metric computers. Every distance is normalized by the inter-eye distance
// (gaze-independent, see geometry.ts) or expressed as a ratio/angle, so
// absolute image scale never matters. Coordinates are pose-normalized.
// ---------------------------------------------------------------------------

interface Derived {
  g: Geom;
  interEye: number;
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
    interEye: g.interEye,
    eyeMid: mid(g.eyeR, g.eyeL),
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

  eyeSeparationRatio: (d) => d.interEye / d.bizygo,

  intercanthalEyeWidth: (d) => d.intercanthal / ((d.eyeWR + d.eyeWL) / 2),

  browPosition: (d) => {
    const p = d.g.pt.bind(d.g);
    const hR = dist(p(LM.BROW_R_MID), d.g.eyeR);
    const hL = dist(p(LM.BROW_L_MID), d.g.eyeL);
    return (hR + hL) / 2 / d.interEye;
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

  midfaceRatio: (d) => d.interEye / dist(d.eyeMid, d.g.pt(LM.LIP_TOP)),

  cheekboneHeight: (d) => {
    const p = d.g.pt.bind(d.g);
    const zygoY = (p(LM.ZYGO_R).y + p(LM.ZYGO_L).y) / 2;
    return (zygoY - d.eyeMid.y) / (p(LM.MENTON).y - d.eyeMid.y);
  },

  // ---- Jaw ----
  jawCheekRatio: (d) => d.bigonial / d.bizygo,

  // Jawline bend measured at the mid-ramus point: how sharply the outline
  // turns between the jaw corner and the chin. A square jaw bends more (lower
  // angle), a rounded one runs straighter (closer to 180°).
  //
  // The earlier version took the angle at the gonion between the CHEEKBONE
  // and the chin. Those three points are nearly collinear in a frontal
  // projection, so the angle was near-degenerate head-on (~40°, anatomically
  // impossible for a jaw) and swung to ~120° as soon as the head turned —
  // MediaPipe's silhouette landmarks slide around the jaw with viewing angle,
  // which no projection can undo. This form uses three well-separated points
  // along the jaw outline itself.
  gonialProxy: (d) => {
    const p = d.g.pt.bind(d.g);
    const aR = angleAt(p(LM.JAW_MID_R), p(LM.GONION_R), p(LM.MENTON));
    const aL = angleAt(p(LM.JAW_MID_L), p(LM.GONION_L), p(LM.MENTON));
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

  mouthIPD: (d) => d.mouthW / d.interEye,

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
    return (Math.sqrt(sum / MIRROR_PAIRS.length) / d.interEye) * 100;
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
    return (offsets.reduce((a, b) => a + b, 0) / offsets.length / d.interEye) * 100;
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
      male: { mean: 1.23, sd: 1.305, ideal: 1.92 },
      female: { mean: 2.32, sd: 1.913, ideal: 3.07 },
    },
  }),
  M({
    id: "eyeAspectRatio", name: "Eye aspect ratio", unit: "", decimals: 2,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 0.9,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 0.297, sd: 0.0489, ideal: 0.275 },
      female: { mean: 0.29, sd: 0.0801, ideal: 0.2845 },
    },
  }),
  M({
    id: "eyeSeparationRatio", name: "Eye separation ratio", unit: "", decimals: 3,
    view: "front", region: "eyes", pillar: "Features", weight: 1.1,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.4204, sd: 0.01186, ideal: 0.4253 },
      female: { mean: 0.4306, sd: 0.01127, ideal: 0.44187 },
    },
  }),
  M({
    id: "intercanthalEyeWidth", name: "Intercanthal : eye width", unit: "×", decimals: 2,
    view: "front", region: "eyes", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.319, sd: 0.126, ideal: 1.271 },
      female: { mean: 1.266, sd: 0.0904, ideal: 1.2735 },
    },
  }),
  M({
    id: "browPosition", name: "Brow height", unit: "×eye-span", decimals: 3,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 0.3215, sd: 0.04136, ideal: 0.3101 },
      female: { mean: 0.3291, sd: 0.07754, ideal: 0.34995 },
    },
  }),
  M({
    id: "browTilt", name: "Brow tilt", unit: "°", decimals: 1,
    view: "front", region: "eyes", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: -4.23, sd: 1.408, ideal: -4.43 },
      female: { mean: -1.19, sd: 4.329, ideal: -1.01 },
    },
  }),

  // ---- Midface ----
  M({
    id: "fwhr", name: "Facial width-to-height (fWHR)", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Dimorphism", weight: 1.2,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 2.216, sd: 0.2417, ideal: 2.414 },
      female: { mean: 2.305, sd: 0.2031, ideal: 2.5045 },
    },
  }),
  M({
    id: "midfaceRatio", name: "Midface ratio", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Harmony", weight: 1.2,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.015, sd: 0.1349, ideal: 1.149 },
      female: { mean: 1.068, sd: 0.0756, ideal: 1.1436 },
    },
  }),
  M({
    id: "cheekboneHeight", name: "Cheekbone height", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 0.251, sd: 0.0593, ideal: 0.255 },
      female: { mean: 0.151, sd: 0.0504, ideal: 0.2014 },
    },
  }),

  // ---- Jaw ----
  M({
    id: "jawCheekRatio", name: "Jaw : cheekbone width", unit: "", decimals: 3,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.2,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 0.9127, sd: 0.01542, ideal: 0.9249 },
      female: { mean: 0.8933, sd: 0.02565, ideal: 0.89865 },
    },
  }),
  M({
    id: "gonialProxy", name: "Gonial angularity (frontal)", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.3,
    direction: "band", fixability: 0.7,
    dist: {
      male: { mean: 142.83, sd: 3.173, ideal: 143.34 },
      female: { mean: 142.56, sd: 2.209, ideal: 141.86 },
    },
  }),
  M({
    id: "jawFrontalAngle", name: "Jaw frontal angle", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: 118.84, sd: 10.719, ideal: 121.83 },
      female: { mean: 113.51, sd: 10.185, ideal: 123.54 },
    },
  }),

  // ---- Chin ----
  M({
    id: "chinHeightRatio", name: "Chin height proportion", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 0.666, sd: 0.0252, ideal: 0.675 },
      female: { mean: 0.671, sd: 0.0178, ideal: 0.6735 },
    },
  }),
  M({
    id: "philtrumChinRatio", name: "Chin : philtrum ratio", unit: "×", decimals: 2,
    view: "front", region: "chin", pillar: "Features", weight: 0.8,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 2.723, sd: 0.3929, ideal: 3.102 },
      female: { mean: 3.274, sd: 0.6405, ideal: 3.758 },
    },
  }),
  M({
    id: "chinWidthRatio", name: "Chin width ratio", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Angularity", weight: 0.8,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 0.509, sd: 0.0237, ideal: 0.518 },
      female: { mean: 0.502, sd: 0.0133, ideal: 0.5 },
    },
  }),
  M({
    id: "lowerFacePct", name: "Lower face proportion", unit: "%", decimals: 1,
    view: "front", region: "chin", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 52.77, sd: 2.55, ideal: 54.68 },
      female: { mean: 51.71, sd: 2.268, ideal: 53.105 },
    },
  }),

  // ---- Nose ----
  M({
    id: "noseMouthRatio", name: "Nose : mouth width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.707, sd: 0.0519, ideal: 0.658 },
      female: { mean: 0.663, sd: 0.0489, ideal: 0.668 },
    },
  }),
  M({
    id: "noseIntercanthal", name: "Nose : intercanthal width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.128, sd: 0.1127, ideal: 1.141 },
      female: { mean: 1.066, sd: 0.0193, ideal: 1.0635 },
    },
  }),
  M({
    id: "nasalIndex", name: "Nasal index (frontal)", unit: "", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.844, sd: 0.0726, ideal: 0.862 },
      female: { mean: 0.822, sd: 0.086, ideal: 0.887 },
    },
  }),

  // ---- Lips ----
  M({
    id: "lipRatio", name: "Lower : upper lip ratio", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 1.48, sd: 0.1661, ideal: 1.466 },
      female: { mean: 1.571, sd: 0.2016, ideal: 1.3694 },
    },
  }),
  M({
    id: "mouthIPD", name: "Mouth width : eye span", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.922, sd: 0.0623, ideal: 0.912 },
      female: { mean: 0.913, sd: 0.0415, ideal: 0.902 },
    },
  }),
  M({
    id: "lipHeightLowerThird", name: "Lip fullness (of lower third)", unit: "%", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 19.78, sd: 4.641, ideal: 23.93 },
      female: { mean: 29.01, sd: 10.69, ideal: 34.28 },
    },
  }),
  M({
    id: "mouthCornerTilt", name: "Mouth corner tilt", unit: "°", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: -1.75, sd: 3.128, ideal: -1.75 },
      female: { mean: 2.18, sd: 3.988, ideal: -0.295 },
    },
  }),

  // ---- Proportions ----
  M({
    id: "topThirdEst", name: "Upper face proportion (est.)", unit: "%", decimals: 1,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.7,
    direction: "band", fixability: 0.15,
    dist: {
      male: { mean: 19.35, sd: 1.453, ideal: 18.81 },
      female: { mean: 18.41, sd: 1.497, ideal: 19.495 },
    },
  }),
  M({
    id: "middleLowerBalance", name: "Midface : lower face balance", unit: "×", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.895, sd: 0.089, ideal: 0.829 },
      female: { mean: 0.934, sd: 0.083, ideal: 0.883 },
    },
  }),
  M({
    id: "fifthsEyeRatio", name: "Eye width : face width (fifths)", unit: "", decimals: 3,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.1815, sd: 0.01142, ideal: 0.1837 },
      female: { mean: 0.1883, sd: 0.01142, ideal: 0.19972 },
    },
  }),
  M({
    id: "facialIndex", name: "Facial index (height : width)", unit: "", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 1.131, sd: 0.0756, ideal: 1.08 },
      female: { mean: 1.09, sd: 0.0741, ideal: 1.1185 },
    },
  }),

  // ---- Symmetry ----
  M({
    id: "mirrorDeviation", name: "Mirror-axis deviation", unit: "% eye-span", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 1.2,
    direction: "lower", fixability: 0.35,
    dist: {
      male: { mean: 25.22, sd: 17.91 },
      female: { mean: 33.09, sd: 13.017 },
    },
  }),
  M({
    id: "canthalAsymmetry", name: "Canthal tilt asymmetry", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.15,
    dist: {
      male: { mean: 18.44, sd: 14.055 },
      female: { mean: 25.1, sd: 15.538 },
    },
  }),
  M({
    id: "eyeMouthParallel", name: "Eye-line / mouth-line skew", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.8,
    direction: "lower", fixability: 0.3,
    dist: {
      male: { mean: 8.22, sd: 8.91 },
      female: { mean: 12.21, sd: 9.533 },
    },
  }),
  M({
    id: "midlineDeviation", name: "Midline deviation", unit: "% eye-span", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.2,
    dist: {
      male: { mean: 1.4, sd: 0.519 },
      female: { mean: 3.02, sd: 2.446 },
    },
  }),
];
