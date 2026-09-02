// ---------------------------------------------------------------------------
// Manual headline-score calibration.
//
// The Reel Creator lets an operator correct the primary rating when a scan is
// visibly off. That correction used to change only the headline, leaving (for
// example) a 7.5 face supported by a grid centred near 5.0. The exported card
// then looked internally inconsistent even though every individual number was
// valid on its own.
//
// A headline correction is not permission to invent new measurements. This
// helper therefore touches only the PRESENTATION scores derived from them. It
// recentres the group on the corrected overall while preserving every score's
// distance from the group's mean. If an extreme target would push a score past
// the 0–10 scale, the spread is compressed uniformly so the ordering survives
// without clipping several different features to the same value.
// ---------------------------------------------------------------------------

const SCORE_MIN = 0;
const SCORE_MAX = 10;

function clampScore(value: number): number {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, value));
}

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/**
 * Re-centre supporting scores around a manually corrected primary rating.
 *
 * - Input order is preserved, so strongest/weakest features stay strongest and
 *   weakest.
 * - The input array is never mutated.
 * - Every returned value is a one-decimal score inside the canonical scale.
 */
export function calibrateSupportingScores(scores: readonly number[], primary: number): number[] {
  if (!scores.length) return [];

  const finite = scores.filter(Number.isFinite).map(clampScore);
  const fallbackTarget = finite.length
    ? finite.reduce((sum, score) => sum + score, 0) / finite.length
    : (SCORE_MIN + SCORE_MAX) / 2;
  const target = clampScore(Number.isFinite(primary) ? primary : fallbackTarget);
  const values = scores.map((score) => clampScore(Number.isFinite(score) ? score : target));
  const mean = values.reduce((sum, score) => sum + score, 0) / values.length;
  const deviations = values.map((score) => score - mean);

  // Start by preserving the full spread. Only an actual scale boundary is
  // allowed to compress it, and every deviation gets the same multiplier.
  let spread = 1;
  for (const deviation of deviations) {
    if (deviation > 0) {
      spread = Math.min(spread, (SCORE_MAX - target) / deviation);
    } else if (deviation < 0) {
      spread = Math.min(spread, (target - SCORE_MIN) / -deviation);
    }
  }
  spread = Math.max(0, Math.min(1, spread));

  return deviations.map((deviation) => roundScore(clampScore(target + deviation * spread)));
}
