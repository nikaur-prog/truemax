import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./geometry.ts";

// Where are the eyes actually pointed?
//
// Almost everyone looks at their own image on screen rather than at the lens,
// which lands the irises off-centre and drags canthal-tilt and eye-aperture
// measurements. The head can be perfectly square and the shot still wrong, so
// gaze is checked separately from pose.
//
// Measured as the iris centre's offset within its own eye opening, averaged
// across both eyes: 0 = looking straight down the lens, 1 = at the corner.

export interface Gaze {
  x: number; // negative = looking toward image-left, positive = image-right
  y: number; // negative = looking up, positive = looking down
  offset: number; // overall magnitude, 0..1
}

export function estimateGaze(lm: NormalizedLandmark[]): Gaze | null {
  const iris = lm[LM.IRIS_R];
  const irisL = lm[LM.IRIS_L];
  if (!iris || !irisL) return null;

  const eye = (
    irisIdx: number,
    outer: number,
    inner: number,
    top: number,
    bottom: number,
  ): { x: number; y: number } | null => {
    const i = lm[irisIdx];
    const o = lm[outer];
    const n = lm[inner];
    const t = lm[top];
    const b = lm[bottom];
    if (!i || !o || !n || !t || !b) return null;
    const cx = (o.x + n.x) / 2;
    const cy = (t.y + b.y) / 2;
    const halfW = Math.abs(o.x - n.x) / 2 || 1e-6;
    // Lid opening is much smaller than eye width, so vertical offset is
    // normalized by its own span or blinks would read as extreme gaze
    const halfH = Math.abs(t.y - b.y) / 2 || 1e-6;
    return { x: (i.x - cx) / halfW, y: (i.y - cy) / halfH };
  };

  const r = eye(LM.IRIS_R, LM.EYE_R_OUTER, LM.EYE_R_INNER, LM.EYE_R_TOP, LM.EYE_R_BOTTOM);
  const l = eye(LM.IRIS_L, LM.EYE_L_OUTER, LM.EYE_L_INNER, LM.EYE_L_TOP, LM.EYE_L_BOTTOM);
  if (!r || !l) return null;

  const x = (r.x + l.x) / 2;
  const y = (r.y + l.y) / 2;
  // Vertical carries more noise (lids move, blinks), so it counts for less
  return { x, y, offset: Math.hypot(x, y * 0.55) };
}
