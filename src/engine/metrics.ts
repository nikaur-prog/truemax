import type { Geom, Pt } from "./geometry.js";
import { LM, MIRROR_PAIRS, dist, mid, angleAt, lineTiltDeg } from "./geometry.js";
import type { MetricDef } from "./types.js";

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
    bizygo: dist(p(LM.MALAR_R), p(LM.MALAR_L)),
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
  const raw = lineTiltDeg(g.imagePt(inner), g.imagePt(outer));
  // A clockwise image roll adds to the subject-right eye and subtracts from
  // the subject-left eye. Correct each in the opposite direction. Averaging
  // then matches the visibly drawn canthus lines without the 3D z-shear that
  // previously turned neutral eyes into large opposing angles.
  return inner === LM.EYE_R_INNER
    ? raw - g.imageRollDeg
    : raw + g.imageRollDeg;
}

export function measureCanthalTilts(g: Geom): {
  right: number;
  left: number;
  average: number;
  asymmetry: number;
} {
  const right = canthalTiltEye(g, LM.EYE_R_INNER, LM.EYE_R_OUTER);
  const left = canthalTiltEye(g, LM.EYE_L_INNER, LM.EYE_L_OUTER);
  return {
    right,
    left,
    average: (right + left) / 2,
    asymmetry: Math.abs(right - left),
  };
}

type Computer = (d: Derived) => number;

export const COMPUTERS: Record<string, Computer> = {
  // ---- Eyes ----
  canthalTilt: (d) => measureCanthalTilts(d.g).average,

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
    const zygoY = (p(LM.MALAR_R).y + p(LM.MALAR_L).y) / 2;
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

  canthalAsymmetry: (d) => measureCanthalTilts(d.g).asymmetry,

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
  // The metric that was already working, held back by the wrong model.
  //
  // Across ten rated men the RAW value correlates +0.54 with the human
  // judgement — one of the few measurements in this engine carrying real
  // signal. Scored as a band around an ideal of 4.73 degrees, that signal was
  // then partly thrown away: the man rated highest in the set measured +7.8,
  // the strongest positive tilt present, and was marked 1.4 sigma OFF and
  // handed 3.9. He was penalised for having more of the good thing.
  //
  // A band says "there is a correct amount and both directions from it are
  // worse". That is true of some proportions and it is not true of canthal
  // tilt within the range human faces occupy: from the negative tilt that reads
  // as tired or downturned, up through neutral, to the positive tilt that reads
  // as alert, more is better the whole way. Anatomy caps it long before the
  // scoring would need to.
  M({
    id: "canthalTilt", name: "Canthal tilt", unit: "°", decimals: 1,
    view: "front", region: "eyes", pillar: "Features", weight: 1.3,
    direction: "higher", fixability: 0.1,
    dist: {
      male: { mean: 3.57, sd: 2.12 },
      female: { mean: 4.935, sd: 2.446 },
    },
  }),
  M({
    id: "eyeAspectRatio", name: "Eye aspect ratio", unit: "", decimals: 2,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 0.9,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 0.325, sd: 0.043, ideal: 0.316 },
      female: { mean: 0.3305, sd: 0.0467, ideal: 0.345 },
    },
  }),
  M({
    id: "eyeSeparationRatio", name: "Eye separation ratio", unit: "", decimals: 3,
    view: "front", region: "eyes", pillar: "Features", weight: 1.1,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.4685, sd: 0.01379, ideal: 0.47105 },
      female: { mean: 0.4821, sd: 0.00964, ideal: 0.49174 },
    },
  }),
  M({
    id: "intercanthalEyeWidth", name: "Intercanthal : eye width", unit: "×", decimals: 2,
    view: "front", region: "eyes", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.316, sd: 0.132, ideal: 1.259 },
      female: { mean: 1.3065, sd: 0.0919, ideal: 1.2615 },
    },
  }),
  M({
    id: "browPosition", name: "Brow height", unit: "×eye-span", decimals: 3,
    view: "front", region: "eyes", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 0.3421, sd: 0.0341, ideal: 0.3345 },
      female: { mean: 0.369, sd: 0.04285, ideal: 0.3891 },
    },
  }),
  M({
    id: "browTilt", name: "Brow tilt", unit: "°", decimals: 1,
    view: "front", region: "eyes", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: -4.92, sd: 2.076, ideal: -4.685 },
      female: { mean: -3.98, sd: 3.291, ideal: -1.115 },
    },
  }),

  // ---- Midface ----
  M({
    id: "fwhr", name: "Facial width-to-height (fWHR)", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Dimorphism", weight: 1.2,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 1.992, sd: 0.2298, ideal: 1.9395 },
      female: { mean: 2.1205, sd: 0.195, ideal: 2.1575 },
    },
  }),
  M({
    id: "midfaceRatio", name: "Midface ratio", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Harmony", weight: 1.2,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.034, sd: 0.126, ideal: 1.04 },
      female: { mean: 1.162, sd: 0.1201, ideal: 1.2065 },
    },
  }),
  M({
    id: "cheekboneHeight", name: "Cheekbone height", unit: "", decimals: 2,
    view: "front", region: "midface", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.5,
    dist: {
      male: { mean: 0.168, sd: 0.0133, ideal: 0.1625 },
      female: { mean: 0.145, sd: 0.0193, ideal: 0.1643 },
    },
  }),

  // ---- Jaw ----
  // Direction, not a band, and the ideal is gone. This metric was scored as
  // closeness to 1.0224 — a jaw WIDER than the cheekbones — and it ran exactly
  // backwards against human judgement.
  //
  // Ten men, rated by eye and then measured:
  //
  //   rated 7.0  ratio 0.923  scored 2.1   <- lowest ratio, worst score
  //   rated 6.8  ratio 0.930  scored 2.1
  //   rated 6.0  ratio 0.976  scored 3.3
  //   rated 3.1  ratio 1.017  scored 6.3   <- highest ratio, best score
  //   rated 2.7  ratio 0.954  scored 2.1
  //
  // The raw value correlates -0.54 with the human rating: a NARROWER jaw
  // relative to the cheekbones reads as more attractive, which is the cheekbone
  // taper everybody actually means when they talk about facial structure. The
  // old ideal sat at the opposite end of the range, so the two best faces in the
  // set were handed 2.1 and the heaviest face in the set was handed 6.3.
  //
  // That last part is the mechanism worth naming: bigonial/bizygo cannot tell a
  // strong bony jaw from a soft wide one. Both widen the lower face and both
  // push the ratio up, so under the old ideal the metric was rewarding body fat
  // and calling it structure.
  //
  // "lower" rather than a band at the bottom of the range, because a band would
  // need an ideal roughly 3 sigma below the population mean, which puts nearly
  // everybody far from it and reproduces the original failure mirrored. Within
  // the range real faces occupy, less is monotonically better.
  M({
    id: "jawCheekRatio", name: "Jaw : cheekbone width", unit: "", decimals: 3,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.2,
    direction: "lower", fixability: 0.5,
    dist: {
      male: { mean: 1.0091, sd: 0.02357 },
      female: { mean: 0.98935, sd: 0.01853 },
    },
  }),
  M({
    id: "gonialProxy", name: "Gonial angularity (frontal)", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.3,
    direction: "band", fixability: 0.7,
    dist: {
      male: { mean: 143.415, sd: 2.772, ideal: 144.225 },
      female: { mean: 143.375, sd: 2.002, ideal: 141.373 },
    },
  }),
  M({
    id: "jawFrontalAngle", name: "Jaw frontal angle", unit: "°", decimals: 1,
    view: "front", region: "jaw", pillar: "Angularity", weight: 1.0,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: 117.21, sd: 7.057, ideal: 112.68 },
      female: { mean: 107.38, sd: 9.563, ideal: 116.943 },
    },
  }),

  // ---- Chin ----
  M({
    id: "chinHeightRatio", name: "Chin height proportion", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Dimorphism", weight: 1.0,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 0.666, sd: 0.0252, ideal: 0.685 },
      female: { mean: 0.6595, sd: 0.023, ideal: 0.676 },
    },
  }),
  M({
    id: "philtrumChinRatio", name: "Chin : philtrum ratio", unit: "×", decimals: 2,
    view: "front", region: "chin", pillar: "Features", weight: 0.8,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 2.691, sd: 0.3632, ideal: 3.0542 },
      female: { mean: 3.27, sd: 0.5908, ideal: 3.56 },
    },
  }),
  M({
    id: "chinWidthRatio", name: "Chin width ratio", unit: "", decimals: 2,
    view: "front", region: "chin", pillar: "Angularity", weight: 0.8,
    direction: "band", fixability: 0.3,
    dist: {
      male: { mean: 0.504, sd: 0.0163, ideal: 0.5135 },
      female: { mean: 0.4985, sd: 0.0193, ideal: 0.4945 },
    },
  }),
  M({
    id: "lowerFacePct", name: "Lower face proportion", unit: "%", decimals: 1,
    view: "front", region: "chin", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 53.04, sd: 2.231, ideal: 53.755 },
      female: { mean: 51.555, sd: 2.469, ideal: 52.7 },
    },
  }),

  // ---- Nose ----
  M({
    id: "noseMouthRatio", name: "Nose : mouth width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.696, sd: 0.0474, ideal: 0.692 },
      female: { mean: 0.6205, sd: 0.0378, ideal: 0.6583 },
    },
  }),
  M({
    id: "noseIntercanthal", name: "Nose : intercanthal width", unit: "×", decimals: 2,
    view: "front", region: "nose", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 1.203, sd: 0.089, ideal: 1.191 },
      female: { mean: 1.1455, sd: 0.0808, ideal: 1.1115 },
    },
  }),
  M({
    id: "nasalIndex", name: "Nasal index (frontal)", unit: "", decimals: 2,
    view: "front", region: "nose", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.839, sd: 0.083, ideal: 0.8305 },
      female: { mean: 0.8565, sd: 0.0756, ideal: 0.821 },
    },
  }),

  // ---- Lips ----
  M({
    id: "lipRatio", name: "Lower : upper lip ratio", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.1,
    dist: {
      male: { mean: 1.4295, sd: 0.2261, ideal: 1.3895 },
      female: { mean: 1.629, sd: 0.2053, ideal: 1.4237 },
    },
  }),
  M({
    id: "mouthIPD", name: "Mouth width : eye span", unit: "×", decimals: 2,
    view: "front", region: "lips", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.923, sd: 0.0675, ideal: 0.862 },
      female: { mean: 0.894, sd: 0.0638, ideal: 0.8302 },
    },
  }),
  M({
    id: "lipHeightLowerThird", name: "Lip fullness (of lower third)", unit: "%", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.9,
    direction: "band", fixability: 0.25,
    dist: {
      male: { mean: 20.55, sd: 5.441, ideal: 22.73 },
      female: { mean: 33.96, sd: 8.303, ideal: 31.45 },
    },
  }),
  M({
    id: "mouthCornerTilt", name: "Mouth corner tilt", unit: "°", decimals: 1,
    view: "front", region: "lips", pillar: "Features", weight: 0.7,
    direction: "band", fixability: 0.4,
    dist: {
      male: { mean: -1.14, sd: 2.357, ideal: -2.95 },
      female: { mean: 1.295, sd: 2.884, ideal: -1.589 },
    },
  }),

  // ---- Proportions ----
  M({
    id: "topThirdEst", name: "Upper face proportion (est.)", unit: "%", decimals: 1,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.7,
    direction: "band", fixability: 0.15,
    dist: {
      male: { mean: 19.31, sd: 1.394, ideal: 18.925 },
      female: { mean: 18.685, sd: 1.193, ideal: 19.42 },
    },
  }),
  M({
    id: "middleLowerBalance", name: "Midface : lower face balance", unit: "×", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.8855, sd: 0.0771, ideal: 0.862 },
      female: { mean: 0.94, sd: 0.0927, ideal: 0.898 },
    },
  }),
  M({
    id: "fifthsEyeRatio", name: "Eye width : face width (fifths)", unit: "", decimals: 3,
    view: "front", region: "proportions", pillar: "Harmony", weight: 0.9,
    direction: "band", fixability: 0,
    dist: {
      male: { mean: 0.2014, sd: 0.01112, ideal: 0.20905 },
      female: { mean: 0.21005, sd: 0.00993, ideal: 0.21675 },
    },
  }),
  M({
    id: "facialIndex", name: "Facial index (height : width)", unit: "", decimals: 2,
    view: "front", region: "proportions", pillar: "Harmony", weight: 1.0,
    direction: "band", fixability: 0.2,
    dist: {
      male: { mean: 1.319, sd: 0.0667, ideal: 1.3305 },
      female: { mean: 1.303, sd: 0.0593, ideal: 1.3125 },
    },
  }),

  // ---- Symmetry ----
  M({
    id: "mirrorDeviation", name: "Mirror-axis deviation", unit: "% eye-span", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 1.2,
    direction: "lower", fixability: 0.35,
    dist: {
      male: { mean: 4.935, sd: 3.551 },
      female: { mean: 6.85, sd: 3.099 },
    },
  }),
  M({
    id: "canthalAsymmetry", name: "Canthal tilt asymmetry", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.15,
    dist: {
      male: { mean: 1.07, sd: 0.89 },
      female: { mean: 0.75, sd: 0.689 },
    },
  }),
  M({
    id: "eyeMouthParallel", name: "Eye-line / mouth-line skew", unit: "°", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.8,
    direction: "lower", fixability: 0.3,
    dist: {
      male: { mean: 0.865, sd: 0.919 },
      female: { mean: 0.91, sd: 1.164 },
    },
  }),
  M({
    id: "midlineDeviation", name: "Midline deviation", unit: "% eye-span", decimals: 1,
    view: "front", region: "symmetry", pillar: "Harmony", weight: 0.9,
    direction: "lower", fixability: 0.2,
    dist: {
      male: { mean: 1.6, sd: 0.786 },
      female: { mean: 2.51, sd: 1.794 },
    },
  }),
];
