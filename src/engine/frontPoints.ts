import { LM } from "./geometry.js";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ---------------------------------------------------------------------------
// The front landmarks a person is allowed to correct.
//
// The frontal mesh is good — far better than the side seed, which is why the
// side got a compulsory walkthrough and this is an optional repair. But "good"
// is not "always", and when it misses, it misses in ways that are obvious to
// the person looking at their own face and invisible to everything else:
// the face-width points ride up into the hair on a wide crop, the jaw corner
// slides forward under yaw, an eye corner catches an eyelash.
//
// Those are not rounding errors. bizygo is the denominator of six metrics, so
// a face-width point in the wrong place moves a sixth of the front score. The
// person can see it is wrong and until now could do nothing about it except
// retake a photograph that was fine.
//
// WHAT IS EDITABLE, AND WHAT IS NOT. Only landmarks that feed a measurement
// appear here, for one reason: a handle that changes nothing is a lie about
// what the screen does. 478 draggable dots would also be a wall of work, and
// the mesh's interpolated points are not identifiable on a face anyway — no
// one can say where mesh vertex 214 belongs.
//
// GROUPS mirror the results tabs, so "my jaw score looks wrong" leads to the
// jaw points and not to a search.
//
// `moves` exists for the nose. Nose width is the widest extent across four
// candidate landmarks per side, so moving one of them and not its neighbours
// would either do nothing (if another candidate is still widest) or silently
// re-elect which point is the measurement. Dragging translates the whole
// group rigidly, which preserves the arrangement and moves the extent by
// exactly what the person dragged.
// ---------------------------------------------------------------------------

export type FrontGroup = "eyes" | "brows" | "nose" | "mouth" | "jaw" | "face";

export interface FrontPointSpec {
  id: string;
  label: string;
  hint: string;
  group: FrontGroup;
  /** The landmark the handle is drawn on. */
  index: number;
  /** Landmarks translated together with it. Defaults to [index]. */
  moves?: readonly number[];
}

export const FRONT_GROUP_LABEL: Record<FrontGroup, string> = {
  eyes: "Eyes",
  brows: "Brows",
  nose: "Nose",
  mouth: "Mouth",
  jaw: "Jaw",
  face: "Face",
};

export const FRONT_POINTS: readonly FrontPointSpec[] = [
  // --- eyes ---------------------------------------------------------------
  { id: "eyeROuter", label: "Right eye, outer corner", hint: "The outer corner of the eye on YOUR right, image left.", group: "eyes", index: LM.EYE_R_OUTER },
  { id: "eyeRInner", label: "Right eye, inner corner", hint: "Where the eyelids meet nearest the nose.", group: "eyes", index: LM.EYE_R_INNER },
  { id: "eyeRTop", label: "Right eye, upper lid", hint: "The highest point of the open eyelid.", group: "eyes", index: LM.EYE_R_TOP },
  { id: "eyeRBottom", label: "Right eye, lower lid", hint: "The lowest point of the lower lid.", group: "eyes", index: LM.EYE_R_BOTTOM },
  { id: "eyeLInner", label: "Left eye, inner corner", hint: "Where the eyelids meet nearest the nose.", group: "eyes", index: LM.EYE_L_INNER },
  { id: "eyeLOuter", label: "Left eye, outer corner", hint: "The outer corner of the eye on YOUR left, image right.", group: "eyes", index: LM.EYE_L_OUTER },
  { id: "eyeLTop", label: "Left eye, upper lid", hint: "The highest point of the open eyelid.", group: "eyes", index: LM.EYE_L_TOP },
  { id: "eyeLBottom", label: "Left eye, lower lid", hint: "The lowest point of the lower lid.", group: "eyes", index: LM.EYE_L_BOTTOM },

  // --- brows --------------------------------------------------------------
  { id: "browRMedial", label: "Right brow, inner end", hint: "The end of the eyebrow nearest the nose.", group: "brows", index: LM.BROW_R_MEDIAL },
  { id: "browRMid", label: "Right brow, peak", hint: "The lower edge of the brow at its highest point.", group: "brows", index: LM.BROW_R_MID },
  { id: "browRLateral", label: "Right brow, outer end", hint: "Where the eyebrow tapers out toward the temple.", group: "brows", index: LM.BROW_R_LATERAL },
  { id: "browLMedial", label: "Left brow, inner end", hint: "The end of the eyebrow nearest the nose.", group: "brows", index: LM.BROW_L_MEDIAL },
  { id: "browLMid", label: "Left brow, peak", hint: "The lower edge of the brow at its highest point.", group: "brows", index: LM.BROW_L_MID },
  { id: "browLLateral", label: "Left brow, outer end", hint: "Where the eyebrow tapers out toward the temple.", group: "brows", index: LM.BROW_L_LATERAL },

  // --- nose ---------------------------------------------------------------
  { id: "nasion", label: "Nose bridge (nasion)", hint: "The deepest dip of the bridge, between the eyes.", group: "nose", index: LM.NASION },
  { id: "noseTip", label: "Nose tip", hint: "The most forward point of the tip.", group: "nose", index: LM.NOSE_TIP },
  {
    id: "alarR",
    label: "Right nostril, outer edge",
    hint: "The widest point of the nostril wing on your right.",
    group: "nose",
    index: 98,
    moves: LM.ALAR_R,
  },
  {
    id: "alarL",
    label: "Left nostril, outer edge",
    hint: "The widest point of the nostril wing on your left.",
    group: "nose",
    index: 327,
    moves: LM.ALAR_L,
  },
  { id: "subnasale", label: "Base of the nose", hint: "Where the nose meets the upper lip, on the midline.", group: "nose", index: LM.SUBNASALE },

  // --- mouth --------------------------------------------------------------
  { id: "mouthR", label: "Mouth, right corner", hint: "The corner of the mouth on your right.", group: "mouth", index: LM.MOUTH_R },
  { id: "mouthL", label: "Mouth, left corner", hint: "The corner of the mouth on your left.", group: "mouth", index: LM.MOUTH_L },
  { id: "lipTop", label: "Top of the upper lip", hint: "The lip's outer edge on the midline: the cupid's bow dip.", group: "mouth", index: LM.LIP_TOP },
  { id: "lipUpperInner", label: "Upper lip, inner edge", hint: "Where the upper lip meets the mouth opening.", group: "mouth", index: LM.LIP_UPPER_INNER },
  { id: "lipLowerInner", label: "Lower lip, inner edge", hint: "Where the lower lip meets the mouth opening.", group: "mouth", index: LM.LIP_LOWER_INNER },
  { id: "lipBottom", label: "Bottom of the lower lip", hint: "The lip's outer edge on the midline, below the mouth.", group: "mouth", index: LM.LIP_BOTTOM },

  // --- jaw ----------------------------------------------------------------
  { id: "gonionR", label: "Right jaw corner", hint: "Where the jawline turns upward toward the ear.", group: "jaw", index: LM.GONION_R },
  { id: "gonionL", label: "Left jaw corner", hint: "Where the jawline turns upward toward the ear.", group: "jaw", index: LM.GONION_L },
  { id: "jawMidR", label: "Right jawline, midpoint", hint: "Halfway along the jaw between the corner and the chin.", group: "jaw", index: LM.JAW_MID_R },
  { id: "jawMidL", label: "Left jawline, midpoint", hint: "Halfway along the jaw between the corner and the chin.", group: "jaw", index: LM.JAW_MID_L },
  { id: "chinSideR", label: "Chin, right edge", hint: "Where the chin's outline turns into the jawline.", group: "jaw", index: LM.CHIN_SIDE_R },
  { id: "chinSideL", label: "Chin, left edge", hint: "Where the chin's outline turns into the jawline.", group: "jaw", index: LM.CHIN_SIDE_L },
  { id: "menton", label: "Bottom of the chin", hint: "The lowest point of the chin, on the midline.", group: "jaw", index: LM.MENTON },

  // --- face ---------------------------------------------------------------
  { id: "zygionR", label: "Face edge, right", hint: "The widest point of the face on your right: the silhouette, not the cheekbone.", group: "face", index: LM.ZYGION_R },
  { id: "zygionL", label: "Face edge, left", hint: "The widest point of the face on your left: the silhouette, not the cheekbone.", group: "face", index: LM.ZYGION_L },
  { id: "malarR", label: "Right cheekbone", hint: "The prominence of the cheekbone itself.", group: "face", index: LM.MALAR_R },
  { id: "malarL", label: "Left cheekbone", hint: "The prominence of the cheekbone itself.", group: "face", index: LM.MALAR_L },
  { id: "cheekMidR", label: "Right cheek, mid outline", hint: "The cheek's outline between the cheekbone and the jaw corner.", group: "face", index: LM.CHEEK_MID_R },
  { id: "cheekMidL", label: "Left cheek, mid outline", hint: "The cheek's outline between the cheekbone and the jaw corner.", group: "face", index: LM.CHEEK_MID_L },
  { id: "glabella", label: "Between the brows", hint: "The flat area of the forehead directly between the eyebrows.", group: "face", index: LM.GLABELLA },
  { id: "foreheadTop", label: "Top of the forehead", hint: "The top of the mesh at mid-forehead. Not the hairline.", group: "face", index: LM.FOREHEAD_TOP },
];

export const FRONT_GROUPS: readonly FrontGroup[] = ["face", "eyes", "brows", "nose", "mouth", "jaw"];

/**
 * A landmark array with one point moved, and everything else untouched.
 *
 * Returns a NEW array: the original cloud is the scan's record of what the
 * detector actually said, and an editor that mutated it in place would leave
 * no way back to the automatic reading. `z` is carried through unchanged —
 * the person is correcting where a point sits in the PHOTOGRAPH, and inventing
 * a new depth for it from a 2D drag would be making up data.
 */
export function moveFrontPoint(
  landmarks: NormalizedLandmark[],
  spec: FrontPointSpec,
  to: { x: number; y: number },
  width: number,
  height: number,
): NormalizedLandmark[] {
  const from = landmarks[spec.index];
  if (!from) return landmarks;
  const dx = to.x / width - from.x;
  const dy = to.y / height - from.y;
  const group = new Set(spec.moves ?? [spec.index]);
  return landmarks.map((p, i) =>
    group.has(i) ? { ...p, x: p.x + dx, y: p.y + dy } : p,
  );
}

/** How far a point has been moved from its detected position, in pixels. */
export function frontPointShift(
  original: NormalizedLandmark[],
  edited: NormalizedLandmark[],
  spec: FrontPointSpec,
  width: number,
  height: number,
): number {
  const a = original[spec.index];
  const b = edited[spec.index];
  if (!a || !b) return 0;
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

/** Every point the person has actually moved, for the "what changed" line. */
export function movedFrontPoints(
  original: NormalizedLandmark[],
  edited: NormalizedLandmark[],
  width: number,
  height: number,
  slop = 1.5,
): FrontPointSpec[] {
  return FRONT_POINTS.filter(
    (spec) => frontPointShift(original, edited, spec, width, height) > slop,
  );
}
