// The pay formula: every view counts.
//
// This replaces the tier ladder's cliffs with a continuous rate. The ladder
// said "nothing until 250k"; the formula says 237,000 views is worth exactly
// what 237,000 views is worth. The deal, in one line:
//
//   earned = RPM × (views ÷ 1,000) × E
//
// where RPM is a flat rate per thousand views and E is an engagement factor
// computed from comments per thousand views — the bot filter as a dial
// instead of a cliff. Views bought from a farm arrive with silent comment
// sections and earn half-rate; a genuinely hot video earns up to 1.3×.
//
// E is computed PER VIDEO, from that video's own counts, so one botted
// upload cannot dilute (or inflate) the rate on anybody's honest ones.
// The unlock threshold is checked on COMBINED totals, because the promise
// "views combine across everything you post" holds here too.
//
// Nothing here reads the database, same as tiers.ts: callers hand in counts,
// this returns money, and the whole payout is auditable from one screen.
// Every constant is a per-sprint setting (league_sprints.formula) so the
// rate can be tuned monthly without touching code; these are the defaults
// a sprint starts from.

export interface EarningsFormula {
  /** Cents per 1,000 views. 200 = $2.00 RPM. */
  rpmCents: number;
  /** Comments per 1,000 views considered par (E = 1.0 exactly at par). */
  parCommentsPer1k: number;
  /** Floor and ceiling on the engagement factor. */
  eMin: number;
  eMax: number;
  /** Combined floors before any money shows. Both must be met. */
  thresholdViews: number;
  thresholdComments: number;
  /** What one video can earn, and what one creator can earn per sprint. */
  videoCapCents: number;
  creatorCapCents: number;
}

/**
 * Calibrated to the ladder it replaces: 250k at par paid $500 there and pays
 * $500 here; 237k pays ~$474 instead of $0. Par of 0.4 comments per 1k is
 * the same ratio the ladder's floors implied (100k views · 50 comments).
 */
export const DEFAULT_FORMULA: EarningsFormula = {
  rpmCents: 200,
  parCommentsPer1k: 0.4,
  eMin: 0.5,
  eMax: 1.3,
  thresholdViews: 25_000,
  thresholdComments: 25,
  videoCapCents: 60_000,
  creatorCapCents: 250_000,
};

export interface VideoTotals {
  views: number;
  comments: number;
}

/** The engagement dial for one video: comments per 1k views against par, clamped. */
export function engagementFactor(f: EarningsFormula, v: VideoTotals): number {
  if (v.views <= 0) return f.eMin;
  const per1k = v.comments / (v.views / 1000);
  return Math.min(f.eMax, Math.max(f.eMin, per1k / f.parCommentsPer1k));
}

/** Whether combined totals have crossed the unlock threshold. */
export function unlocked(f: EarningsFormula, combined: VideoTotals): boolean {
  return combined.views >= f.thresholdViews && combined.comments >= f.thresholdComments;
}

/**
 * How close the SHORTER of the two floors is to unlocking, for the progress
 * bar — the same honesty rule as the old ladder's bar: 90% of views with 20%
 * of comments must not read as 90%.
 */
export function unlockProgress(f: EarningsFormula, combined: VideoTotals): number {
  const v = Math.min(1, combined.views / f.thresholdViews);
  const c = Math.min(1, combined.comments / f.thresholdComments);
  return Math.min(v, c);
}

/** One video's earnings, engagement-adjusted and capped. */
export function videoEarnedCents(f: EarningsFormula, v: VideoTotals): number {
  const raw = f.rpmCents * (v.views / 1000) * engagementFactor(f, v);
  return Math.min(f.videoCapCents, Math.round(raw));
}

/**
 * A creator's accrual across their videos.
 *
 * Zero until the combined threshold is crossed; RETROACTIVE the moment it
 * is — the counter springs to life showing what all the views were worth,
 * not a zero that starts crawling. Per-video caps first, then the creator
 * cap over the sum.
 */
export function creatorAccruedCents(f: EarningsFormula, videos: VideoTotals[]): number {
  const combined = videos.reduce(
    (a, v) => ({ views: a.views + v.views, comments: a.comments + v.comments }),
    { views: 0, comments: 0 },
  );
  if (!unlocked(f, combined)) return 0;
  const sum = videos.reduce((a, v) => a + videoEarnedCents(f, v), 0);
  return Math.min(f.creatorCapCents, sum);
}

/**
 * The pro-rata scale when the month's accruals exceed the sprint pool.
 * 1.0 while the pool covers everybody; below it, every payout scales by the
 * same factor — and the dashboard's job is to show the pool filling BEFORE
 * this ever bites, not to surprise anyone at close.
 */
export function poolScale(poolCents: number, totalAccruedCents: number): number {
  if (totalAccruedCents <= 0) return 1;
  return Math.min(1, poolCents / totalAccruedCents);
}

/** Parse a sprint's stored formula, falling back to defaults per field. */
export function formulaFrom(raw: unknown): EarningsFormula | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<EarningsFormula>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    rpmCents: num(o.rpmCents, DEFAULT_FORMULA.rpmCents),
    parCommentsPer1k: num(o.parCommentsPer1k, DEFAULT_FORMULA.parCommentsPer1k) || DEFAULT_FORMULA.parCommentsPer1k,
    eMin: num(o.eMin, DEFAULT_FORMULA.eMin),
    eMax: num(o.eMax, DEFAULT_FORMULA.eMax),
    thresholdViews: num(o.thresholdViews, DEFAULT_FORMULA.thresholdViews),
    thresholdComments: num(o.thresholdComments, DEFAULT_FORMULA.thresholdComments),
    videoCapCents: num(o.videoCapCents, DEFAULT_FORMULA.videoCapCents),
    creatorCapCents: num(o.creatorCapCents, DEFAULT_FORMULA.creatorCapCents),
  };
}
