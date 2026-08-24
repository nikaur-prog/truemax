// ---------------------------------------------------------------------------
// Reliability for measurements the generator has never seen.
//
// RELIABILITY in reliability.ts is generated from 90 photos of 14 people —
// the same face, repeatedly, so the within-person spread can be separated from
// the between-person one. That corpus was captured before some of the metrics
// below existed, so the generator has nothing to say about them, and
// `reliabilityOf` defaults anything it does not recognise to 0.5.
//
// A silent 0.5 is the wrong answer for a brand new measurement. It is a middling
// number that reads as "measured and fine" and lets an untested metric carry
// half the weight of the best-behaved one in the engine on its first day.
//
// So new metrics are seeded here, low, on purpose. The number is a statement
// about what is KNOWN, not about what the metric is worth: it will move the
// score a little, appear in the diagnostics dump where its behaviour across
// real faces becomes visible, and get a real value the moment the repeat-photo
// corpus is regenerated with it included. Delete an entry the day the generator
// produces one — reliability.ts wins over this file, so a stale entry here is
// dead rather than dangerous.
// ---------------------------------------------------------------------------

export const RELIABILITY_SEED: Record<string, number> = {
  // Built from three silhouette landmarks per side and averaged across both,
  // which is a favourable construction — no small differences, no left-right
  // subtraction, and the two sides cancel most of a head turn. The comparable
  // measurements built the same way (jawCheekRatio 0.47, chinWidthRatio 0.44)
  // sit near 0.45, so this is deliberately set below them rather than at them.
  cheekFullness: 0.3,
  // Hairline detection is a pixel measurement and its failure mode is a hard
  // one: hair that matches the skin, a receded hairline with no step to find,
  // a fringe sitting where the forehead should be. It refuses rather than
  // guesses when the contrast is weak, so the values that do arrive are the
  // confident ones — but "confident" has not yet been checked against the same
  // person photographed twice, which is the only thing this number means.
  foreheadRatio: 0.25,
  // Three hand-placed points, and one of them — labiale superius — is a soft
  // landmark on a mobile feature: a relaxed mouth and a slightly set one put it
  // in different places on the same face. The angle also opens at pogonion,
  // which means the two arms are short and a small slip at the vertex swings
  // the reading. Seeded below the other side constructions rather than at them
  // until the repeat-photo corpus is regenerated with it in.
  chinRecession: 0.25,
};
