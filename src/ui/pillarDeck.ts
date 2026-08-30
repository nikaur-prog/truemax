// The four pillars, opened.
//
// The report leads with regions, and that is deliberate: people arrive asking
// about their jaw, not about their Angularity. The pillars sit under the
// overview as four numbers and, until now, they were four numbers and nothing
// else — a score with no way to ask what it was made of.
//
// Tapping one opens the measurements that build it, in the same card the
// region rows open. That keeps the pillar secondary (it is a way INTO the
// measurements, not a second scoring system beside them) and it means the
// pillar view inherits every honesty rule the rest of the report already has:
// a region the report refused to score contributes nothing here either, an
// unmeasured metric is not in the deck, and an implausible reading still says
// "re-check" rather than pretending to a position.

import { regionIsScored } from "../engine/scoring.js";
import { reliabilityOf } from "../engine/reliability.js";
import type { PillarId, Report, ScoredMetric } from "../engine/types.js";

/**
 * What each pillar is, in the plain register the report uses everywhere except
 * Coach Max. Deliberately flat: Dimorphism in particular is a distance from the
 * middle of the two sexes and nothing more, and the copy says so rather than
 * letting the word do the implying.
 */
export const PILLAR_BLURB: Record<PillarId, string> = {
  Harmony:
    "How the parts relate to each other rather than how any one of them looks: whether the thirds of the face run even, whether the widths agree, whether the two sides match.",
  Angularity:
    "How sharply the face is cut. Cheekbone and jaw definition, the angle the jaw turns through, and the line under the chin.",
  Dimorphism:
    "How far the measurements sit from the middle of the two sexes, in the direction of your own. It is a distance, not a verdict: a face can sit far out on it and still score low elsewhere.",
  Features:
    "The individual parts read on their own terms, one at a time: eyes, brow, nose and lips.",
};

/**
 * The measurements behind one pillar, heaviest contributor first.
 *
 * "Heaviest" is weight x reliability, the same effective weight scoring.ts uses
 * to decide how much a measurement counts. Ordering by declared weight alone
 * would put a metric that reproduces at 0.00 at the top of the deck, which is
 * exactly the measurement that moved the number least.
 */
export function pillarDeck(report: Report, pillar: PillarId): ScoredMetric[] {
  const open = new Set(report.regions.filter(regionIsScored).map((r) => r.region));
  return report.regions
    .filter((r) => open.has(r.region))
    .flatMap((r) => r.metrics)
    .filter((m) => m.def.pillar === pillar && Number.isFinite(m.value))
    .sort((a, b) => effOf(b) - effOf(a));
}

function effOf(m: ScoredMetric): number {
  return m.def.weight * reliabilityOf(m.def.id);
}
