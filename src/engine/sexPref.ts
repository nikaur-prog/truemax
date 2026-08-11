import type { Sex } from "./types.ts";

// ---------------------------------------------------------------------------
// Which reference population a face is scored against.
//
// This used to be inferred from face shape, and the inference did not work.
// Measured leave-one-out over 194 reference faces — rebuilding the mean shapes
// with each face removed, then classifying it:
//
//   accuracy                58.8%   (male 61.9%, female 55.1%)
//   always guess "male"     54.1%   <- the base rate of the same sample
//
// Four points above always saying the same word. The 70.7% it scored inside the
// app was measured against a model trained on those very faces.
//
// Two rules were tried and they turned out to be the same rule: nearest mean
// shape by Euclidean residual is mathematically identical to thresholding the
// projection onto the between-means axis at its midpoint, and the two agreed on
// 194 of 194 faces. So this is not a matter of picking a better decision rule
// over the same descriptor.
//
// What made it worth fixing rather than tolerating is the cost. Every percentile
// on the report comes from the chosen population, and switching it moves the
// score by a median of 0.70 points, 2.10 at p90 and 4.50 at worst — Kim
// Kardashian scores 7.7 against women and 4.0 against men. A coin flip was
// deciding a number larger than the entire within-person noise band.
//
// So it is asked, once, and remembered. That reverses an earlier decision to
// infer rather than ask, and the reason for the reversal is only that the
// inference was measured. A question that takes one tap beats a guess that is
// wrong three times in ten.
// ---------------------------------------------------------------------------

const KEY = "truemax:refPopulation";

export function storedSex(): Sex | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "male" || v === "female" ? v : null;
  } catch {
    // Private mode. The choice still works for this session, it just will not
    // be remembered — which is better than refusing to run.
    return null;
  }
}

export function storeSex(sex: Sex): void {
  try {
    localStorage.setItem(KEY, sex);
  } catch {
    /* storage unavailable — the caller keeps it in memory for this session */
  }
}
