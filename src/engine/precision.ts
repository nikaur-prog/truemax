// ---------------------------------------------------------------------------
// How precisely a percentile may be stated.
//
// Every percentile in this app is read off quantiles of a reference set of
// roughly a hundred people. Sampling error alone on that is about six points
// near the median — sqrt(p(1-p)/n) — so "Ahead of 16.9%" claims three digits
// of resolution the sample cannot support, and "16" claims two. The number was
// never wrong; the precision was, and false precision is the specific way a
// measurement product loses trust: it invites somebody to read meaning into a
// one-point move that is pure sampling noise.
//
// Rounding to the nearest five is the honest resolution. Still a number
// somebody can read, compare and screenshot; no longer a promise that a single
// point means anything.
//
// DISPLAY ONLY. Scores, ordering, plan ranking, the potential calculation and
// stored history all keep the exact value, because the imprecision is in how
// the figure is SAID, not in the arithmetic. Rounding the stored number would
// destroy real information and make rescan deltas jump in five-point steps.
//
// This sits on top of SHRINK in scoring.ts and corrects a different thing.
// SHRINK corrects for one photograph being a noisy reading of a face. This
// corrects for the reference table being a finite sample of people. Two
// distinct uncertainties, and the engine now admits both.
// ---------------------------------------------------------------------------

// Reference faces behind the quantile tables, per sex, in round numbers. Used
// for the sentence that tells people what the percentile is measured against,
// so the claim on screen and the data on disk cannot drift apart silently.
export const REFERENCE_N = 100;

export function statedPct(pct: number): number {
  if (!Number.isFinite(pct)) return 50;
  return Math.max(1, Math.min(99, Math.round(pct / 5) * 5));
}
