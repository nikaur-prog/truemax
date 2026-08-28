import type { ScoredMetric } from "./types.js";

// ---------------------------------------------------------------------------
// Named traits, from measurements the engine already made.
//
// "Hunter eyes" is worth a hundred "canthal tilt 6.9 degrees" in a spoken
// format, and the community's shape names are not vibes: each one is a region
// of a space the engine measures anyway. This module owns the mapping so the
// short-cut video script and the in-app report both name shapes from the SAME
// thresholds, and a change of definition is one edit.
//
// The inputs are deliberately only measurements this repo has established as
// reliable: canthal tilt (reliability 0.73 band) carries the tilt axis, and
// the eye aspect ratio's own sex-relative z carries openness, so "narrow"
// means narrow FOR THE POPULATION rather than under an invented constant.
// Nothing here invents a measurement; it names a location in measured space.
// ---------------------------------------------------------------------------

export interface EyeShape {
  id: "hunter" | "almond" | "upturned" | "round" | "downturned" | "neutral";
  /** Voice-ready, lower case, no figure: "hunter eyes". */
  label: string;
}

// Tilt is in degrees (positive = outer corner above inner). The hunter and
// almond bands both need positive tilt; what separates them is aperture —
// hunter reads narrow and hooded, almond reads even. Openness uses the eye
// aspect ratio's z so the cut point tracks the population, not a constant.
const HUNTER_TILT = 5.5;
const ALMOND_TILT = 2;
const DOWNTURN_TILT = -1.5;
const OPEN_Z = 0.45;

export function eyeShapeFrom(metrics: ScoredMetric[]): EyeShape | null {
  const tiltM = metrics.find((m) => m.def.id === "canthalTilt");
  if (!tiltM || !Number.isFinite(tiltM.value)) return null;
  const tilt = tiltM.value;
  const aspect = metrics.find((m) => m.def.id === "eyeAspectRatio");
  const openZ = aspect && Number.isFinite(aspect.value) ? aspect.z : 0;

  if (tilt >= HUNTER_TILT) {
    return openZ > OPEN_Z
      ? { id: "upturned", label: "striking upturned eyes" }
      : { id: "hunter", label: "hunter eyes" };
  }
  if (tilt >= ALMOND_TILT) {
    return openZ > OPEN_Z
      ? { id: "round", label: "round, open eyes" }
      : { id: "almond", label: "almond eyes" };
  }
  if (tilt <= DOWNTURN_TILT) return { id: "downturned", label: "downturned eyes" };
  return openZ > OPEN_Z
    ? { id: "round", label: "round, open eyes" }
    : { id: "neutral", label: "even-set eyes" };
}
