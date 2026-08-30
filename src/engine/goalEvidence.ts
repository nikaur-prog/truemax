// ---------------------------------------------------------------------------
// What would show that a goal is working.
//
// A goal without evidence is a wish, so every goal carries the measurements
// that would move if it were achieved. The hard part is not gathering them: the
// goal definitions in goals.ts already name their metrics. The hard part is
// that some of those measurements cannot honestly carry a progress line, and
// attaching one anyway promises the person a number that will wander on
// lighting alone and then blame them for it.
//
// Two filters, both of them existing constraints rather than new opinions:
//
//   RELIABILITY. A measurement whose repeatability is under RELIABLE_MIN does
//   not reproduce across two photographs of the same face on the same day. It
//   cannot show movement because it does not hold still. fwhr is 0.00,
//   mirrorDeviation is 0.02, chinHeightRatio is 0.03, eyeMouthParallel is 0.00,
//   and all four are named as evidence by a goal today.
//
//   MOVABILITY. `fixability` is the share of the gap that moves without
//   surgery. A measurement at 0.10 is mostly bone, and a progress line on it is
//   a line that will not move however well somebody does. MOVE_MIN is the floor
//   that keeps those out.
//
// The result is deliberately smaller than the declared lists. A goal that ends
// up with nothing is not a bug and must not be papered over: the face scan
// genuinely does not measure hair or skin geometry, and saying so is the
// honest answer.
// ---------------------------------------------------------------------------

import { GOALS } from "./goals.js";
import { RELIABLE_MIN, reliabilityOf } from "./reliability.js";
import { METRICS } from "./metrics.js";
import { SIDE_METRICS } from "./sideMetrics.js";
import type { MetricDef } from "./types.js";

/**
 * The least movable a measurement may be and still carry a progress line.
 *
 * Below this it is mostly skeleton. Someone can do everything right for three
 * months and the number will not have anywhere to go, which reads as failure
 * and is not.
 */
export const MOVE_MIN = 0.15;

const ALL: MetricDef[] = [...METRICS, ...SIDE_METRICS];

/** Can this measurement honestly be offered as evidence that something worked? */
export function canShowProgress(id: string): boolean {
  const def = ALL.find((m) => m.id === id);
  if (!def) return false;
  return def.fixability >= MOVE_MIN && reliabilityOf(id) >= RELIABLE_MIN;
}

/**
 * The measurements to show under a goal, most informative first.
 *
 * "Most informative" is movability times reliability: how much of the gap can
 * move, multiplied by how much of the movement we would actually see. A metric
 * that is highly movable and barely reproducible is not a good progress line,
 * and neither is the reverse.
 */
export function evidenceFor(goalId: string): MetricDef[] {
  const goal = GOALS.find((g) => g.id === goalId);
  if (!goal) return [];
  return goal.metrics
    .filter(canShowProgress)
    .map((id) => ALL.find((m) => m.id === id)!)
    .sort((a, b) => weightOf(b) - weightOf(a));
}

function weightOf(m: MetricDef): number {
  return m.fixability * reliabilityOf(m.id);
}

/**
 * Why a goal has no measurable evidence, when it has none.
 *
 * Two genuinely different reasons and the copy has to distinguish them: a goal
 * the scan does not measure at all, and a goal whose measurements exist but are
 * not steady enough to show movement. Saying "no evidence" for both would let
 * the second one read as the first.
 */
export function noEvidenceReason(goalId: string): "unmeasured" | "tooNoisy" | null {
  const goal = GOALS.find((g) => g.id === goalId);
  if (!goal) return null;
  if (evidenceFor(goalId).length) return null;
  return goal.metrics.length ? "tooNoisy" : "unmeasured";
}
